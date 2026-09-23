// WHAT ONE EXACT BTO COSTS.
//
// A branch take-off is FABRICATED, not picked off a shelf. `bto_400_250_250_250`
// and `bto_350_250_250_250` are both "a three-port BTO" and they are two
// different pieces of metal at two different prices — different inlet, different
// box, different amount of sheet, different labour. Pricing them off one generic
// rate is guessing, and a guess that walks into a customer quote is the kind of
// mistake that is only found on invoice day.
//
// Nick: "If an exact configured rate does not exist: mark the line PRICE
// REQUIRED; allow the internal design report to be generated; block the
// customer quote from being finalised or issued; do not silently use one
// generic BTO price; do not substitute the price of another configuration."
//
// So there is NO fallback here. A configuration either has a rate somebody
// entered against that exact key, or it has no price at all.

import { findFitting, describeFitting } from './mmem-fittings.mjs';

/** Where a price came from, in the order of how much it can be trusted. */
export const BTO_PRICE_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',            // a fabricator quoted this exact configuration
  PLACEHOLDER: 'PLACEHOLDER',      // a rate is entered but not confirmed
  REQUIRED: 'PRICE REQUIRED'       // nothing for this configuration
});

/** The settings record BTO configuration rates live in. */
export const BTO_RATES_KEY = 'nac_hvac_bto_rates';

/**
 * One stored price, normalised.
 *
 * A rate may be entered as a bare number for speed on site, or as the full
 * record a fabricator's quote deserves. Both are accepted; the bare number is
 * treated as unverified, because nobody attached a quote to it.
 */
export function normaliseBtoRate(configKey, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' || typeof raw === 'string') {
    const cost = Number(raw);
    if (!isFinite(cost)) return null;
    return {
      configKey, cost,
      supplier: null, description: null, sku: null, quoteRef: null,
      sellBasis: 'cost_plus_margin', effectiveDate: null,
      verified: false,
      bodyLengthMm: null, bodyDepthMm: null,
      status: BTO_PRICE_STATUS.PLACEHOLDER
    };
  }
  const cost = raw.cost === null || raw.cost === undefined || raw.cost === ''
    ? null : Number(raw.cost);
  if (cost === null || !isFinite(cost)) return null;
  const verified = !!raw.verified;
  return {
    configKey,
    cost,
    supplier: raw.supplier || raw.fabricator || null,
    description: raw.description || null,
    sku: raw.sku || raw.code || null,
    quoteRef: raw.quoteRef || raw.quoteReference || null,
    sellBasis: raw.sellBasis || 'cost_plus_margin',
    effectiveDate: raw.effectiveDate || null,
    verified,
    // A fabricator quoting a price usually quotes it against a body. When they
    // do, that body is CONFIGURED — it stops being derived and stops needing a
    // fabrication review.
    bodyLengthMm: raw.bodyLengthMm ?? null,
    bodyDepthMm: raw.bodyDepthMm ?? null,
    status: verified ? BTO_PRICE_STATUS.VERIFIED : BTO_PRICE_STATUS.PLACEHOLDER
  };
}

/** Every configuration rate this job has, keyed by exact configuration. */
export function btoRateBook(rates = null) {
  const book = new Map();
  for (const [k, v] of Object.entries(rates || {})) {
    const norm = normaliseBtoRate(k, v);
    if (norm) book.set(k, norm);
  }
  return book;
}

/**
 * ── THE INTERIM RATE ────────────────────────────────────────────────────────
 *
 * Nick: "just do all bto as 75+ each no matter what until i get the exact
 * descriptions."
 *
 * The BTOs are on MMEM's pricelist as items 65 to 105, and until those lines
 * are in hand no exact configuration can be priced from them. Rather than
 * leave every job blocked on a fitting list that has not arrived, one interim
 * rate covers them all.
 *
 * It is a STOPGAP and it is labelled as one. The status is PLACEHOLDER, never
 * VERIFIED, so:
 *
 *   · `priceIsQuotable` still refuses it;
 *   · the bill of materials counts it among the unconfirmed rates;
 *   · the estimator sees the UNCONFIRMED MATERIAL PRICES dialog and has to
 *     accept it before a quote is created.
 *
 * Nick's earlier rule stands underneath this one: "do not silently use one
 * generic BTO price; do not substitute the price of another configuration."
 * Nothing here is silent, and no configuration borrows another's price — they
 * all carry the same declared interim figure, which is a different thing.
 *
 * WHEN THE PRICELIST ARRIVES: enter the real rates against their exact
 * configuration keys. An entered rate always wins, so the interim figure
 * retires configuration by configuration as the real ones land.
 */
export const BTO_INTERIM_RATE = 75.00;

/** Why the interim rate exists, in a sentence a report can print. */
export const BTO_INTERIM_NOTE =
  'Interim rate of $' + BTO_INTERIM_RATE.toFixed(2) + ' per fitting, pending the exact ' +
  'descriptions and prices from MMEM items 65\u2013105. It is NOT a fabricator\u2019s ' +
  'quote for this configuration and it has not been confirmed against one.';

/**
 * The price for one exact configuration.
 *
 * Never substitutes one configuration's quoted price for another's. Where no
 * rate has been entered at all, the declared interim rate above applies and
 * says so.
 */
export function resolveBtoPrice(configKey, { rates = null, book = null,
                                             interimRate = BTO_INTERIM_RATE,
                                             catalogue = true } = {}) {
  const b = book || btoRateBook(rates);
  const hit = b.get(configKey);
  if (hit) return hit;

  // ── AN MMEM PART, WHERE THIS CONFIGURATION IS ONE ───────────────────────
  //
  // MMEM sell take-offs and Y-pieces as catalogue parts with fixed inlets and
  // fixed outlets. Where the design asks for a combination they make, that is
  // not a fabricated fitting at all: it is a part number at a listed price,
  // and it is quotable on the same footing as any other supplier line.
  //
  // Matching is exact. A ø400 with three ø250 outlets is not a DB8 — the DB8
  // has three ø300 outlets — so it falls through to the interim rate rather
  // than being priced as something it is not.
  if (catalogue) {
    const f = findFitting(configKey);
    if (f) {
      return {
        configKey, cost: f.cost,
        supplier: 'MMEM', description: describeFitting(f), sku: f.code,
        quoteRef: null, sellBasis: 'cost_plus_margin', effectiveDate: null,
        verified: true,
        catalogueFitting: f.code,
        bodyLengthMm: null, bodyDepthMm: null,
        status: BTO_PRICE_STATUS.VERIFIED,
        note: 'MMEM ' + f.code + ' \u2014 ' + describeFitting(f) + ', $' + f.cost.toFixed(2) +
              '. A stocked part, not a fabricated fitting.'
      };
    }
  }

  // No interim rate configured — back to the original behaviour, which is to
  // carry no price at all rather than a borrowed one.
  if (interimRate === null || interimRate === undefined || !isFinite(Number(interimRate))) {
    return {
      configKey, cost: null,
      supplier: null, description: null, sku: null, quoteRef: null,
      sellBasis: null, effectiveDate: null, verified: false,
      bodyLengthMm: null, bodyDepthMm: null,
      status: BTO_PRICE_STATUS.REQUIRED,
      note: 'No rate has been entered for ' + configKey + '. Enter the fabricator’s ' +
            'price for this exact configuration — it is not the same fitting as any other.'
    };
  }

  return {
    configKey, cost: Number(interimRate),
    supplier: null, description: null, sku: null, quoteRef: null,
    sellBasis: 'cost_plus_margin', effectiveDate: null,
    verified: false,
    interim: true,
    bodyLengthMm: null, bodyDepthMm: null,
    status: BTO_PRICE_STATUS.PLACEHOLDER,
    note: BTO_INTERIM_NOTE
  };
}

/** True when this price is good enough to put in front of a customer. */
export function priceIsQuotable(price) {
  return !!price && price.status === BTO_PRICE_STATUS.VERIFIED;
}

export default { resolveBtoPrice, btoRateBook, normaliseBtoRate, priceIsQuotable,
                 BTO_PRICE_STATUS, BTO_RATES_KEY, BTO_INTERIM_RATE, BTO_INTERIM_NOTE };
