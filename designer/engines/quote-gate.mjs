// CAN THIS GO IN FRONT OF A CUSTOMER YET?
//
// The internal design sheet is always allowed out — an estimator needs to see
// the working, the gaps included. A CUSTOMER QUOTE is a different document: it
// is a number somebody is asked to sign, and a number built on a rate nobody
// confirmed is a number NAC will have to honour.
//
// Nick: "Block customer-quote finalisation when any required material has a
// placeholder price; no exact BTO configuration price; no size-specific
// zone-damper price; an unverified required supplier rate; an unresolved
// component-size mismatch. The internal design report may still be produced
// with a clear warning."
//
// So this answers one question and answers it out loud. Every blocker names the
// exact thing to fix and where to fix it; none of them is a general "pricing
// incomplete" that leaves somebody hunting.

export const QUOTE_BLOCK = Object.freeze({
  BTO_PRICE_REQUIRED: 'BTO_PRICE_REQUIRED',
  DAMPER_PRICE_REQUIRED: 'DAMPER_PRICE_REQUIRED',
  PLACEHOLDER_RATES: 'PLACEHOLDER_RATES',
  UNPRICED_LINES: 'UNPRICED_LINES',
  COMPONENT_SIZE_MISMATCH: 'COMPONENT_SIZE_MISMATCH'
});

/**
 * What stands between this design and a quote a customer can be given.
 *
 * @returns {{ ok, blockers, summary }} `ok` false means the quote cannot be
 *   finalised or issued. The internal sheet is unaffected.
 */
export function quoteGate(design) {
  const blockers = [];
  const bom = design?.bom || null;

  // ── Every BTO priced on its OWN configuration ──────────────────────────
  const btoLines = (bom?.items || []).filter(i => i.key === 'bto_fitting');
  const btoUnpriced = btoLines.filter(i => i.priceStatus === 'PRICE REQUIRED');
  if (btoUnpriced.length) {
    blockers.push({
      code: QUOTE_BLOCK.BTO_PRICE_REQUIRED,
      severity: 'CRITICAL',
      message: btoUnpriced.length + ' fabricated BTO configuration(s) have no price: ' +
        btoUnpriced.map(i => i.configKey).join(', ') + '. Enter the fabricator’s quoted ' +
        'price against each exact configuration — a ø400 three-port and a ø350 three-port ' +
        'are different fittings and one cannot be priced off the other.',
      configKeys: btoUnpriced.map(i => i.configKey),
      fittings: btoUnpriced.flatMap(i => i.fittings || [])
    });
  }
  const btoPlaceholder = btoLines.filter(i => i.priceStatus === 'PLACEHOLDER');
  if (btoPlaceholder.length) {
    blockers.push({
      code: QUOTE_BLOCK.BTO_PRICE_REQUIRED,
      severity: 'CRITICAL',
      message: btoPlaceholder.length + ' BTO configuration(s) carry an unconfirmed price: ' +
        btoPlaceholder.map(i => i.configKey).join(', ') + '. Attach the fabricator’s quote ' +
        'reference and mark the rate verified before quoting.',
      configKeys: btoPlaceholder.map(i => i.configKey)
    });
  }

  // ── Every motorised damper priced on its OWN size ──────────────────────
  const damperLines = (bom?.items || []).filter(i => i.key === 'zone_motor');
  const damperBad = damperLines.filter(i => i.priceStatus === 'PRICE REQUIRED' || !i.diameterMm);
  if (damperBad.length) {
    blockers.push({
      code: QUOTE_BLOCK.DAMPER_PRICE_REQUIRED,
      severity: 'CRITICAL',
      message: damperBad.length + ' motorised zone damper line(s) have no size-specific price' +
        (damperBad.some(i => !i.diameterMm) ? ' or no diameter at all' : '') +
        ': ' + damperBad.map(i => i.diameterMm ? 'ø' + i.diameterMm : 'unsized').join(', ') +
        '. A damper is bought by diameter; a generic rate cannot be quoted.',
      diameters: damperBad.map(i => i.diameterMm || null)
    });
  }

  // ── A component that will not physically go in ─────────────────────────
  const mismatched = (design?.zoneDampers || []).filter(d => d.sizeMismatch);
  if (mismatched.length) {
    blockers.push({
      code: QUOTE_BLOCK.COMPONENT_SIZE_MISMATCH,
      severity: 'CRITICAL',
      message: mismatched.map(d => d.mismatchMessage).join(' '),
      components: mismatched.map(d => d.id)
    });
  }

  // ── Anything else the order cannot cost ────────────────────────────────
  const otherUnpriced = (bom?.items || [])
    .filter(i => !i.priced && i.key !== 'bto_fitting' && i.key !== 'zone_motor' &&
                 !i.quotedSeparately);
  if (otherUnpriced.length) {
    blockers.push({
      code: QUOTE_BLOCK.UNPRICED_LINES,
      severity: 'CRITICAL',
      message: otherUnpriced.length + ' material line(s) have no cost: ' +
        otherUnpriced.map(i => i.label).join(', ') + '.',
      lines: otherUnpriced.map(i => i.label)
    });
  }
  if (bom?.placeholderCount) {
    blockers.push({
      code: QUOTE_BLOCK.PLACEHOLDER_RATES,
      severity: 'CRITICAL',
      message: bom.placeholderCount + ' material line(s) are on shipped placeholder rates worth $' +
        (bom.placeholderCost || 0).toFixed(2) + '. Confirm NAC’s own rates in HVAC Design ' +
        'Settings → Material rates before issuing a quote.',
      placeholderCost: bom.placeholderCost || 0
    });
  }

  return {
    ok: blockers.length === 0,
    blockers,
    /** One line for a button's tooltip or a banner. */
    summary: blockers.length === 0
      ? 'Pricing is complete — this design can be quoted.'
      : blockers.length + ' issue(s) block a customer quote. The internal design sheet ' +
        'can still be produced.'
  };
}

/** The gate as design warnings, so it appears wherever warnings appear. */
export function quoteGateWarnings(gate) {
  return (gate?.blockers || []).map(b => ({
    code: b.code,
    severity: 'CRITICAL',
    area: 'pricing',
    message: b.message,
    // The internal sheet is NOT blocked by these — only the customer quote.
    blocksCustomerQuote: true,
    blocksFinalApproval: false
  }));
}

export default { quoteGate, quoteGateWarnings, QUOTE_BLOCK };
