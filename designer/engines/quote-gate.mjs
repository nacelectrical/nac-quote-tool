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
  COMPONENT_SIZE_MISMATCH: 'COMPONENT_SIZE_MISMATCH',
  // ── The Kauri set ───────────────────────────────────────────────────────
  // A price is the last number in a chain, and every one of these breaks the
  // chain further up. A design that cannot say how big the house is cannot say
  // what the machine costs; a supply graph that carries 1921 L/s of air
  // through 800 L/s of outlets cannot have its ductwork counted.
  SCALE_NOT_VERIFIED: 'SCALE_NOT_VERIFIED',
  EQUIPMENT_NOT_SELECTED: 'EQUIPMENT_NOT_SELECTED',
  SUPPLY_GRAPH_INVALID: 'SUPPLY_GRAPH_INVALID',
  PLENUM_INVALID: 'PLENUM_INVALID',
  DUCT_SIZE_INCONSISTENT: 'DUCT_SIZE_INCONSISTENT',
  PRESSURE_NOT_CALCULATED: 'PRESSURE_NOT_CALCULATED',
  CAPACITY_BELOW_LOAD: 'CAPACITY_BELOW_LOAD',
  OUTLET_SCHEDULE_DISAGREEMENT: 'OUTLET_SCHEDULE_DISAGREEMENT'
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

  // ── THE DESIGN ITSELF HAS TO BE VALID BEFORE ITS PRICE MEANS ANYTHING ───
  //
  // Everything above asks whether the parts are priced. These ask whether
  // there is a design to price. On 34 Kauri every one of them was false and a
  // sell price of $15,079.33 was printed anyway.

  const caps = design?.capabilities || null;
  if (caps && caps.mayPrice === false) {
    blockers.push({
      code: QUOTE_BLOCK.SCALE_NOT_VERIFIED,
      severity: 'CRITICAL',
      message: (typeof caps.reasonFor === 'function' ? caps.reasonFor('price') : null)
        || 'This design may not carry a price yet.',
      remedy: 'Measure one known distance on the plan — a printed dimension, a wall the '
            + 'estimator has measured, or a scale bar — and calibrate against it.'
    });
  }

  if (design?.equipmentBlocked?.blocked) {
    blockers.push({
      code: QUOTE_BLOCK.EQUIPMENT_NOT_SELECTED,
      severity: 'CRITICAL',
      message: 'No equipment is selected, so there is no machine to quote. '
        + (design.equipmentBlocked.reason || '')
        + ' The candidate list is for internal comparison only and no model may be named '
        + 'to the customer.'
    });
  }

  for (const f of (design?.supplyGraphCheck?.failures || [])) {
    blockers.push({ code: QUOTE_BLOCK.SUPPLY_GRAPH_INVALID, severity: 'CRITICAL',
                    message: f.message, failureCode: f.code });
  }
  for (const f of (design?.plenumCheck?.failures || [])) {
    blockers.push({ code: QUOTE_BLOCK.PLENUM_INVALID, severity: 'CRITICAL',
                    message: f.message, failureCode: f.code });
  }
  for (const f of (design?.ductSizeCheck?.failures || [])) {
    blockers.push({ code: QUOTE_BLOCK.DUCT_SIZE_INCONSISTENT, severity: 'CRITICAL',
                    message: f.message, failureCode: f.code });
  }

  // A static-pressure check is part of what a customer is paying for. An
  // uncalculated one is not a passed one.
  if (design?.network?.sections?.length && design?.pressureReadiness
      && design.pressureReadiness.ok === false) {
    blockers.push({
      code: QUOTE_BLOCK.PRESSURE_NOT_CALCULATED,
      severity: 'CRITICAL',
      message: 'Static pressure is ' + (design.pressure?.status || 'NOT CALCULATED') + '. '
        + (design.pressureReadiness.reason || '')
    });
  }

  // A unit below the calculated load is NOT handled here. It is a real thing an
  // estimator knowingly signs off — the approved Dungannon job runs a 16 kW
  // machine against a 22.5 kW calculated load — and it already carries a
  // CRITICAL SYSTEM_UNDERSIZED warning that blocks final approval. What it may
  // never do is reach a customer described as adequate, so that rejection lives
  // in the PRESENTATION gate, next to the words it would contradict.

  // The plan, the schedule and the order must describe the same outlets.
  const consistency = design?.outletConsistency || null;
  for (const f of (consistency?.failures || [])) {
    blockers.push({ code: QUOTE_BLOCK.OUTLET_SCHEDULE_DISAGREEMENT, severity: 'CRITICAL',
                    message: f.message, failureCode: f.code });
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
