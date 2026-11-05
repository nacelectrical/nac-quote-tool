// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT OPTIONS AND WHAT THEY COST NAC
//
// Nick, 4 November 2026: "Present one or several equipment options. Each option
// must show... supplier cost, approved pricing basis, customer price including
// GST... Distinguish markup from margin and prevent duplicated charges...
// Support new installations and replacements... Use existing approved prices
// where available. Never invent missing rates... Keep fixed quotes and
// provisional estimates clearly distinct."
//
// NOTHING HERE INVENTS A NUMBER. Every figure either comes from a source this
// module can name — NAC's own catalogue, the MMEM trade list, a price the
// estimator typed — or it is absent and says so. There is no fallback rate, no
// typical cost, no assumed margin. A missing figure is a missing figure, and
// the quote is a provisional estimate until somebody fills it in.
//
// ── MARKUP IS NOT MARGIN ────────────────────────────────────────────────────
//
// They are different numbers and they are confused constantly, in a way that
// costs money rather than just reading oddly:
//
//     markup = profit ÷ COST       what NAC add on
//     margin = profit ÷ SELL       what NAC keep of what the customer pays
//
// A 50% markup is a 33% margin. An estimator told to work on "50%" who applies
// it the wrong way round prices the job a third under. Both figures are
// returned, both are labelled, and neither is called the other.
// ─────────────────────────────────────────────────────────────────────────────

import { findSupplierLine, MMEM_META } from './supplier-pricing.mjs';

const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();
const r2 = (v) => Math.round(v * 100) / 100;

// ── WHAT KIND OF JOB IT IS ──────────────────────────────────────────────────

/**
 * A new installation and a replacement are not the same job, and quoting one
 * as the other is how the old system ends up still on the roof.
 */
export const JOB_TYPE = Object.freeze({
  NEW_INSTALL: 'new_install',
  REPLACEMENT: 'replacement'
});

export function jobTypeLabel(type) {
  return type === JOB_TYPE.REPLACEMENT
    ? 'Replacing an existing system'
    : 'New installation';
}

/**
 * The scope lines a replacement carries that a new installation does not.
 *
 * NAMED, NOT PRICED. Nick: "Never invent missing rates." What a licensed
 * de-gas costs on a given roof is NAC's to say, so each line comes back with
 * `priceIncGst: null` and the estimator either prices it, marks it included in
 * the system price, or the quote stays a provisional estimate.
 */
export const REPLACEMENT_SCOPE = Object.freeze([
  { id: 'degas', label: 'Recover the refrigerant from the existing system',
    why: 'Licensed work. It is illegal to vent it, and it has to be recorded.' },
  { id: 'remove_old', label: 'Remove the existing indoor and outdoor units',
    why: 'Including the roof or ground mount they sit on.' },
  { id: 'dispose', label: 'Take the old equipment away and dispose of it',
    why: 'So it does not end up in the customer’s yard.' },
  { id: 'reuse_check', label: 'Check what can be reused — ducting, outlets, wiring',
    why: 'What is reused is not re-charged, and what is not reusable has to be '
      + 'in the price before the quote goes out.' }
]);

/**
 * What a replacement quote is missing, in words.
 *
 * It does not add the lines itself. An estimator who has already written
 * "remove and dispose of the existing system" into the inclusions in their own
 * words should not have four more lines appear underneath it.
 */
export function replacementGaps(draft) {
  if (draft?.jobType !== JOB_TYPE.REPLACEMENT) return [];
  const text = [...(draft.inclusions || []), ...(draft.exclusions || []),
                trimmed(draft.scope?.summary), trimmed(draft.siteNotes)]
    .join(' \n ').toLowerCase();
  const mentions = {
    degas: /de-?gas|degas|recover|refrigerant|reclaim/,
    remove_old: /remove|removal|take out|decommission|strip out/,
    dispose: /dispos|take away|tip|scrap|remove from site|rubbish/,
    reuse_check: /reus|re-use|existing duct|retain|keep the duct/
  };
  return REPLACEMENT_SCOPE
    .filter(line => !mentions[line.id].test(text))
    .map(line => ({ ...line,
      message: 'This is a replacement and nothing in the scope mentions: '
        + line.label.toLowerCase() + '. ' + line.why }));
}

// ── WHERE A PRICE CAME FROM ─────────────────────────────────────────────────

export const PRICE_BASIS = Object.freeze({
  /** A price NAC has approved for this exact model, in Price Setup. */
  APPROVED_CATALOGUE: 'approved_catalogue',
  /** A figure the estimator typed for this job. */
  ESTIMATOR: 'estimator',
  /** Nothing. Not a zero — an absence. */
  NONE: 'none'
});

/**
 * Which it is, and the figure.
 *
 * AN APPROVED PRICE WINS NOTHING BY ITSELF. If the estimator typed a different
 * number for this job, that is the number quoted — they are standing in front
 * of the house and the catalogue is not. But the two figures are both reported,
 * so a screen that is quoting $1,500 under NAC's own approved price says so
 * rather than letting it through silently.
 */
export function priceBasisOf(system, catalogue = []) {
  const typed = n(system?.priceIncGst);
  const model = trimmed(system?.model);
  const approvedLine = model
    ? (catalogue || []).find(c =>
        trimmed(c.model).toLowerCase() === model.toLowerCase()
        || trimmed(c.code).toLowerCase() === model.toLowerCase())
    : null;
  const approved = n(approvedLine?.priceIncGst ?? approvedLine?.installedPriceIncGst);

  if (typed === null) {
    return approved === null
      ? { basis: PRICE_BASIS.NONE, priceIncGst: null, approvedIncGst: null,
          label: 'No price',
          message: 'No price for ' + (model || 'this option') + '. There is no approved '
            + 'figure for it in Price Setup and nobody has typed one. '
            + 'A price is not something this tool will make up.' }
      : { basis: PRICE_BASIS.APPROVED_CATALOGUE, priceIncGst: approved,
          approvedIncGst: approved, label: 'Approved price from Price Setup' };
  }
  const out = { basis: PRICE_BASIS.ESTIMATOR, priceIncGst: typed,
    approvedIncGst: approved, label: 'Price entered for this job' };
  if (approved !== null && Math.round(approved * 100) !== Math.round(typed * 100)) {
    const diff = r2(typed - approved);
    out.differsFromApproved = diff;
    out.message = 'Quoted at $' + typed.toFixed(2) + ', and NAC’s approved price for '
      + model + ' is $' + approved.toFixed(2) + ' — '
      + (diff < 0 ? '$' + Math.abs(diff).toFixed(2) + ' under' : '$' + diff.toFixed(2) + ' over')
      + '. Fine if it is deliberate.';
  }
  return out;
}

/**
 * NAC's approved prices, flattened out of the records the existing quote tool
 * already owns.
 *
 * `nac_brands_v4` is brands → models, and each model carries `price` — which
 * the Prices screen labels "your price (ex GST)". So it is converted to the
 * GST-inclusive figure NAC quote on, once, here, rather than in three screens
 * that each get it slightly different.
 *
 * A model with no price is LEFT OUT rather than included at zero. Nick: "Only
 * priced models appear in quotes", and a zero that reads as a price is worse
 * than an absence that reads as one.
 */
export function approvedPriceList(brands, gstRate = 0.1) {
  const out = [];
  for (const b of (Array.isArray(brands) ? brands : [])) {
    for (const m of (Array.isArray(b?.models) ? b.models : [])) {
      const exGst = n(m?.price);
      if (exGst === null || exGst <= 0) continue;
      out.push({
        brand: trimmed(b.name), brandId: trimmed(b.id),
        model: trimmed(m.name), code: trimmed(m.name),
        capacityKw: n(m.kw), phase: trimmed(m.phase),
        priceExGst: exGst,
        priceIncGst: r2(exGst * (1 + gstRate))
      });
    }
  }
  return out;
}

// ── WHAT IT COSTS NAC ───────────────────────────────────────────────────────

/**
 * The supplier cost of one system, and where the figure came from.
 *
 * In order: what the estimator entered for this job, then the MMEM trade list.
 * Nothing else. A model MMEM do not list and nobody has costed comes back
 * `null`, which is the honest answer and which makes the margin unknown rather
 * than wrong.
 */
export function supplierCostOf(system) {
  const entered = n(system?.supplierCost);
  if (entered !== null) {
    return { cost: entered, basis: 'entered', source: 'Entered for this job',
      gstInclusive: system?.supplierCostIncGst === true };
  }
  const line = findSupplierLine(
    trimmed(system?.brandId) || trimmed(system?.brand).toLowerCase().replace(/[^a-z0-9]+/g, ''),
    trimmed(system?.model), n(system?.capacityKw) ?? 0, trimmed(system?.phase));
  if (line) {
    return { cost: line.cost, basis: 'mmem', gstInclusive: false,
      source: MMEM_META.source + ', ' + MMEM_META.edition
        + ' (' + MMEM_META.basis + ')', code: line.code, series: line.series };
  }
  return { cost: null, basis: 'none', gstInclusive: false,
    source: null,
    message: 'No supplier cost for ' + (trimmed(system?.model) || 'this option')
      + '. It is not on the MMEM list this tool carries and nobody has entered one, '
      + 'so the margin on this option is unknown rather than estimated.' };
}

/**
 * Markup and margin, both, separately, with what is unknown said out loud.
 *
 * @param {object} args
 *   priceIncGst  what the customer pays
 *   gstRate      the rate this quote is on
 *   costExGst    what NAC pay, ex GST
 *   otherCostExGst  installation cost NAC have recorded beyond the equipment
 */
export function marginOf({ priceIncGst, gstRate = 0.1, costExGst = null,
                           otherCostExGst = 0 } = {}) {
  const sell = n(priceIncGst);
  if (sell === null) {
    return { known: false, reason: 'no_price',
      message: 'No customer price, so there is no margin to work out.' };
  }
  const sellExGst = r2(sell / (1 + gstRate));
  const equip = n(costExGst);
  const other = n(otherCostExGst) ?? 0;
  if (equip === null) {
    return { known: false, reason: 'no_cost', sellIncGst: sell, sellExGst,
      message: 'The supplier cost of this option is not recorded, so its margin is '
        + 'unknown. It is not being estimated.' };
  }
  const cost = r2(equip + other);
  const profit = r2(sellExGst - cost);
  return {
    known: true,
    sellIncGst: sell, sellExGst, costExGst: cost, profitExGst: profit,
    /** Profit over COST. What NAC add on. */
    markupPct: cost > 0 ? Math.round((profit / cost) * 1000) / 10 : null,
    /** Profit over SELL. What NAC keep of what the customer pays. */
    marginPct: sellExGst > 0 ? Math.round((profit / sellExGst) * 1000) / 10 : null,
    // Spelled out, because the two get swapped and the mistake is expensive.
    explain: 'Markup is profit over cost — what NAC add on. Margin is profit over '
      + 'the sell price — what NAC keep. They are not the same number: a 50% '
      + 'markup is a 33% margin.',
    /** True when the installation cost beyond the equipment is not recorded. */
    equipmentOnly: other === 0,
    note: other === 0
      ? 'Equipment cost only. Labour, materials and anything subcontracted are '
        + 'not in this figure, so the real margin on the job is lower.'
      : null
  };
}

// ── THE SAME THING CHARGED TWICE ────────────────────────────────────────────

/**
 * Charges that look like they are counted twice.
 *
 * Nick: "prevent duplicated charges." Every one of these is something that has
 * happened on a real quote: the zone controller in the system price and on its
 * own line, an upgrade for a controller the quote already includes, a scope
 * line charged as an upgrade as well.
 *
 * It REPORTS rather than fixes. Two of these are legitimate on the right job
 * (a second controller really can be a second charge), and silently removing a
 * line from somebody's quote is worse than telling them about it.
 */
export function duplicateCharges(draft, { upgrades = [] } = {}) {
  const found = [];
  const d = draft || {};
  const ctrl = d.controller || {};
  const selected = new Set(d.selectedUpgradeIds || []);
  const byId = new Map((upgrades || []).map(u => [u.id, u]));

  // ── The controller, in the price and on a line ─────────────────────────
  if (ctrl.includedInPrice === true && n(ctrl.priceIncGst) > 0) {
    found.push({ code: 'CONTROLLER_CHARGED_TWICE',
      message: 'The zone control is marked as included in the system price AND carries '
        + 'its own charge of $' + n(ctrl.priceIncGst).toFixed(2)
        + '. One of those is wrong.' });
  }

  // ── A controller upgrade on a quote that already has that controller ───
  const ctrlName = trimmed(ctrl.name).toLowerCase();
  for (const id of selected) {
    const u = byId.get(id);
    if (!u) continue;
    const title = trimmed(u.title).toLowerCase();
    // Both are controllers, and one names the other.
    const bothControllers = /touch|zone|control|thermostat/.test(title) && ctrlName;
    if (bothControllers && (title.includes(ctrlName) || ctrlName.includes(title.split(' ')[0]))) {
      found.push({ code: 'UPGRADE_DUPLICATES_CONTROLLER', upgradeId: id,
        message: '"' + u.title + '" is being charged as an upgrade and the quote already '
          + 'has ' + ctrl.name + ' as its zone control. Charging both charges the '
          + 'customer twice for one controller.' });
    }
  }

  // ── An upgrade that is already written into the inclusions ─────────────
  const inclusions = (d.inclusions || []).map(x => trimmed(x).toLowerCase());
  for (const id of selected) {
    const u = byId.get(id);
    if (!u) continue;
    const title = trimmed(u.title).toLowerCase();
    if (!title) continue;
    const hit = inclusions.find(line => line.includes(title));
    if (hit) {
      found.push({ code: 'UPGRADE_ALREADY_INCLUDED', upgradeId: id,
        message: '"' + u.title + '" is charged as an upgrade and is also listed as '
          + 'included: "' + hit + '". Either it is in the price or it is extra.' });
    }
  }

  // ── The same model quoted as two options ───────────────────────────────
  const seen = new Map();
  for (const s of (d.systems || [])) {
    const key = [trimmed(s.brand).toLowerCase(), trimmed(s.model).toLowerCase()]
      .join('|');
    if (key === '|') continue;
    if (seen.has(key)) {
      found.push({ code: 'SAME_MODEL_TWICE', systemId: s.id,
        message: (s.brand + ' ' + s.model).trim() + ' is on this quote twice. '
          + 'A customer choosing between two identical options is not choosing.' });
    }
    seen.set(key, s.id);
  }

  return found;
}

// ── A FIXED QUOTE IS NOT AN ESTIMATE ────────────────────────────────────────

export const FIRMNESS = Object.freeze({
  FIXED: 'fixed',
  PROVISIONAL: 'provisional'
});

/**
 * Is this a fixed quote or a provisional estimate, and why?
 *
 * Nick: "Keep fixed quotes and provisional estimates clearly distinct." They
 * are different promises. A fixed price is one NAC will hold to; a provisional
 * estimate is one that will move once somebody has been on the roof. Telling a
 * customer the second while they read it as the first is how a job is argued
 * about at invoice time.
 *
 * It is FIXED only when nothing about it is still open. Anything unresolved
 * makes it provisional, and every reason is returned so the customer page can
 * say what still has to be confirmed rather than just hedging.
 */
export function firmnessOf(draft, { upgrades = [] } = {}) {
  const d = draft || {};
  const reasons = [];

  // The estimator can always say so themselves, and that wins outright: they
  // know something about the job that nothing here does.
  if (d.provisional === true) {
    reasons.push({ code: 'MARKED_PROVISIONAL',
      message: trimmed(d.provisionalReason)
        || 'Marked as a provisional estimate by the estimator.' });
  }

  for (const s of (d.systems || [])) {
    if (n(s.priceIncGst) === null || n(s.priceIncGst) <= 0) {
      reasons.push({ code: 'OPTION_UNPRICED',
        message: (trimmed(s.brand) + ' ' + trimmed(s.model)).trim() || 'An option'
          + ' has no price, so nothing about it can be fixed.' });
    }
  }

  // An allowance is, by definition, not a fixed price.
  const allowanceText = [...(d.inclusions || []),
                         trimmed(d.scope?.summary)].join(' \n ').toLowerCase();
  if (/\ballowance\b|\bto be confirmed\b|\btbc\b|\bsubject to\b|\bprovisional\b/
      .test(allowanceText)) {
    reasons.push({ code: 'ALLOWANCE_IN_SCOPE',
      message: 'The scope carries an allowance or a "to be confirmed", which is not a '
        + 'fixed price. Say what it depends on.' });
  }

  // A replacement with nothing said about the old system is not a fixed price
  // for taking it away.
  for (const gap of replacementGaps(d)) {
    reasons.push({ code: 'REPLACEMENT_SCOPE_OPEN', message: gap.message });
  }

  // A measurement nobody has stood behind.
  const unmeasured = (d.rooms || []).filter(rm =>
    rm && rm.include !== false && !(rm.measurement && rm.measurement.source));
  if (unmeasured.length) {
    reasons.push({ code: 'ROOMS_UNMEASURED',
      message: unmeasured.length + ' room(s) have no measurement behind them, so the '
        + 'sizing is an estimate and the price built on it cannot be fixed.' });
  }

  const firmness = reasons.length ? FIRMNESS.PROVISIONAL : FIRMNESS.FIXED;
  return {
    firmness,
    fixed: firmness === FIRMNESS.FIXED,
    reasons,
    /** What a customer is told, in words that do not hedge. */
    customerLabel: firmness === FIRMNESS.FIXED
      ? 'Fixed price'
      : 'Provisional estimate',
    customerNote: firmness === FIRMNESS.FIXED
      ? 'This is a fixed price for the work described. It does not change unless you '
        + 'ask us to change the job.'
      : 'This is a provisional estimate, not a fixed price. '
        + 'We will confirm it once the items below are settled.'
  };
}

/**
 * Everything §5 asks an option to show, for one system, in one object.
 *
 * The internal view. `customer` is the subset a customer may see, and it is the
 * only part that ever reaches a proposal: no cost, no margin, no markup, no
 * supplier name, no pricing basis.
 */
export function optionDetail(system, { catalogue = [], gstRate = 0.1,
                                       otherCostExGst = 0 } = {}) {
  const s = system || {};
  const price = priceBasisOf(s, catalogue);
  const cost = supplierCostOf(s);
  const costExGst = cost.cost === null ? null
    : (cost.gstInclusive ? r2(cost.cost / (1 + gstRate)) : cost.cost);
  const margin = marginOf({ priceIncGst: price.priceIncGst, gstRate, costExGst,
                            otherCostExGst });

  return {
    id: trimmed(s.id),
    brand: trimmed(s.brand),
    model: trimmed(s.model),
    outdoorModel: trimmed(s.outdoorModel),
    /** The pair, as a customer should see it named. */
    modelPair: [trimmed(s.model), trimmed(s.outdoorModel)].filter(Boolean).join(' / '),
    capacityKw: n(s.capacityKw),
    phase: trimmed(s.phase),
    image: s.image && trimmed(s.image.src)
      ? { src: trimmed(s.image.src), alt: trimmed(s.image.alt) || null } : null,
    priceIncGst: price.priceIncGst,
    priceBasis: price,
    supplierCost: cost,
    supplierCostExGst: costExGst,
    margin,
    warrantyYears: n(s.warrantyYears),
    note: trimmed(s.note),
    /** What is missing, in words, for the estimator's checks panel. */
    gaps: [price.message, cost.message,
           margin.known ? null : margin.message].filter(Boolean),
    customer: {
      brand: trimmed(s.brand),
      model: [trimmed(s.model), trimmed(s.outdoorModel)].filter(Boolean).join(' / '),
      capacityKw: n(s.capacityKw),
      phase: trimmed(s.phase),
      priceIncGst: price.priceIncGst,
      warrantyYears: n(s.warrantyYears),
      note: trimmed(s.note)
    }
  };
}

export default {
  JOB_TYPE, jobTypeLabel, REPLACEMENT_SCOPE, replacementGaps,
  PRICE_BASIS, priceBasisOf, approvedPriceList, supplierCostOf, marginOf,
  duplicateCharges,
  FIRMNESS, firmnessOf, optionDetail
};
