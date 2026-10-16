// ─────────────────────────────────────────────────────────────────────────────
// ALTERNATIVE SYSTEMS — "here is the Daikin, here is the Braemar, pick one"
//
// NAC have quoted this way for years: up to three systems, the customer
// chooses. sign.html has done it since before any of this existed. The new
// quote presentation was built around a single designed system and could not,
// which made it a downgrade on the one thing an estimator does every day.
//
// An OPTION is an alternative: one of these gets installed, and the price on
// the page is the price of the one chosen. That is a different thing from an
// UPGRADE, which is an extra added on top of whatever system is chosen — Wi-Fi
// control, another zone. The two are kept apart here and on the page, because
// a customer who thinks they are adding a second unit has been misled.
//
// Nothing invented: every option carries a real brand, a real model, a real
// capacity and a real price, or it does not go on the page.
// ─────────────────────────────────────────────────────────────────────────────

import { looksUnfilled } from './customer-data.mjs';

/** What sign.html has always allowed, and what fits a page a person reads. */
export const MAX_SYSTEM_OPTIONS = 3;

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
/** Absent stays absent: Number(null) and Number('') are both 0. */
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** One alternative system, normalised. Nothing is defaulted into existence. */
export function normaliseSystemOption(input = {}, index = 0) {
  const brand = trimmed(input.brand ?? input.brandName);
  const model = trimmed(input.model ?? input.modelName);
  return {
    id: trimmed(input.id) || ('opt-' + (index + 1)),
    brand,
    /** The catalogue's own brand id, so a brand-locked upgrade can be matched. */
    brandId: trimmed(input.brandId) || trimmed(brand).toLowerCase().replace(/[^a-z0-9]+/g, '') || null,
    model,
    label: [brand, model].filter(Boolean).join(' ') || trimmed(input.label),
    capacityKw: n(input.capacityKw ?? input.kw),
    phase: trimmed(input.phase),
    sku: trimmed(input.sku ?? input.supplierCode) || null,
    priceIncGst: n(input.priceIncGst ?? input.price),
    recommended: input.recommended === true,
    /**
     * The manufacturer's warranty on THIS brand, in years.
     *
     * It differs between the systems on the page — Braemar carry 7 years where
     * another brand carries something else — and a customer comparing two
     * prices is entitled to see that next to them rather than find it later.
     * It is a manufacturer's figure, so it is stated by NAC or it is absent;
     * nothing here supplies one.
     */
    warrantyYears: n(input.warrantyYears),
    /** One line NAC may add — why this one. Never generated. */
    note: trimmed(input.note)
  };
}

/**
 * Are these options fit to put in front of a customer?
 *
 * Every failure names the option, because "an option is invalid" is no use to
 * somebody looking at three cards on a screen.
 */
export function systemOptionsStatus(input = [], opts = {}) {
  const raw = Array.isArray(input) ? input : [];
  const options = raw.map((o, i) => normaliseSystemOption(o, i));
  const failures = [];

  if (options.length > MAX_SYSTEM_OPTIONS) {
    failures.push({ code: 'TOO_MANY_SYSTEM_OPTIONS', severity: 'CRITICAL',
      message: options.length + ' system options. A customer chooses between at most '
        + MAX_SYSTEM_OPTIONS + '; past that it is a catalogue, not a quote.' });
  }

  const seen = new Set();
  for (const o of options) {
    const who = o.label || o.id;
    if (seen.has(o.id)) {
      failures.push({ code: 'DUPLICATE_SYSTEM_OPTION', severity: 'CRITICAL', optionId: o.id,
        message: 'Two system options share the id "' + o.id + '". A customer’s choice could '
          + 'not be told apart afterwards.' });
    }
    seen.add(o.id);

    if (!o.brand || !o.model || looksUnfilled(o.brand) || looksUnfilled(o.model)) {
      failures.push({ code: 'SYSTEM_OPTION_NOT_REAL', severity: 'CRITICAL', optionId: o.id,
        message: 'System option ' + who + ' does not name a real brand and model. A customer '
          + 'may not be asked to choose something nobody can order.' });
    }
    if (o.capacityKw === null || o.capacityKw <= 0) {
      failures.push({ code: 'SYSTEM_OPTION_NO_CAPACITY', severity: 'CRITICAL', optionId: o.id,
        message: 'System option ' + who + ' has no capacity. The customer is choosing between '
          + 'systems and cannot see what they are getting.' });
    }
    if (o.priceIncGst === null || o.priceIncGst <= 0) {
      failures.push({ code: 'SYSTEM_OPTION_NOT_PRICED', severity: 'CRITICAL', optionId: o.id,
        message: 'System option ' + who + ' has no price. Every option on the page is one the '
          + 'customer can accept, so every option needs its own price.' });
    }
  }

  const recommended = options.filter(o => o.recommended);
  if (recommended.length > 1) {
    failures.push({ code: 'MORE_THAN_ONE_RECOMMENDED', severity: 'CRITICAL',
      message: recommended.length + ' options are marked recommended. Recommend one, or none.' });
  }

  // Alternatives for the SAME job. A 7 kW beside a 16 kW is not a choice, it is
  // one of them being wrong, and the customer has no way to tell which.
  const caps = options.map(o => o.capacityKw).filter(c => c !== null && c > 0);
  if (caps.length > 1) {
    const lo = Math.min(...caps), hi = Math.max(...caps);
    const spread = opts.capacityTolerance ?? 0.25;
    if (hi > lo * (1 + spread)) {
      failures.push({ code: 'SYSTEM_OPTIONS_NOT_COMPARABLE', severity: 'WARNING',
        message: 'The options run from ' + lo + ' kW to ' + hi + ' kW. They are alternatives '
          + 'for one job, so a customer choosing on price is choosing on capacity without '
          + 'being told.' });
    }
  }

  const critical = failures.filter(f => f.severity === 'CRITICAL');
  return {
    ok: options.length > 0 && critical.length === 0,
    /** True when this quote offers a choice at all. */
    offersChoice: options.length > 1,
    count: options.length,
    options,
    failures,
    recommendedId: recommended[0]?.id || null
  };
}

/**
 * The option a customer has chosen, or the one NAC would have them choose.
 *
 * Falls back to the recommendation, then to the first — never to nothing, so a
 * page always has a price on it.
 */
export function chooseSystemOption(options = [], chosenId = null) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return null;
  const wanted = trimmed(chosenId);
  return list.find(o => o.id === wanted)
      || list.find(o => o.recommended)
      || list[0];
}

/**
 * The options a design already implies.
 *
 * A designed job has one selected unit at one price. That is a single option,
 * and expressing it this way means the page has ONE shape whether the customer
 * is choosing or not.
 */
export function optionsFromDesign(design) {
  const u = design?.selectedUnit;
  const price = n(design?.commercials?.sellPriceIncGst);
  if (!u || price === null) return [];
  return [normaliseSystemOption({
    id: 'designed',
    brand: u.brandName ?? u.brand,
    model: u.model ?? u.modelName,
    capacityKw: u.capacityKw ?? u.kw,
    phase: u.phase,
    sku: u.supplierCode ?? u.sku,
    priceIncGst: price,
    recommended: true
  }, 0)];
}

export default { MAX_SYSTEM_OPTIONS, normaliseSystemOption, systemOptionsStatus,
                 chooseSystemOption, optionsFromDesign };
