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
 * The price for one exact configuration.
 *
 * Never substitutes. A `bto_400_350_350` with no rate does not borrow the
 * `bto_400_250_250_250` rate, or an average, or a generic manifold price.
 */
export function resolveBtoPrice(configKey, { rates = null, book = null } = {}) {
  const b = book || btoRateBook(rates);
  const hit = b.get(configKey);
  if (hit) return hit;
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

/** True when this price is good enough to put in front of a customer. */
export function priceIsQuotable(price) {
  return !!price && price.status === BTO_PRICE_STATUS.VERIFIED;
}

export default { resolveBtoPrice, btoRateBook, normaliseBtoRate, priceIsQuotable,
                 BTO_PRICE_STATUS, BTO_RATES_KEY };
