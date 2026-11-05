// ─────────────────────────────────────────────────────────────────────────────
// WHAT STANDS BETWEEN A JOB AND A QUOTE
//
// Nick, 4 November 2026: "Remove the active duct-design workflow and its
// dependencies from quoting... Designer-specific approval blockers."
//
// This file used to hold seventeen blockers and fourteen of them were about a
// DRAWING: the supply graph, the plenum, duct size consistency, static
// pressure, BTO prices and stock, fitting availability, upsized fitting legs,
// damper prices, component size mismatches, the outlet schedule, and whether
// the plan's scale had been verified. Every one of them could stop a quote NAC
// was perfectly able to give, and the ductwork they described is no longer
// designed here at all.
//
// They are gone, with the engines behind them. The checkpoint tag
// `checkpoint/before-designer-removal` has the file as it was.
//
// WHAT REMAINS is everything that is about the OFFER rather than the drawing:
//
//   · a system has been selected
//   · every line somebody is being charged for has a cost
//   · no line is sitting on a shipped placeholder rate
//
// and, on a quote-only job — which is now every job — the early return below,
// because `quoteDraftGate()` in quote-draft.mjs is what checks that offer and
// it checks it properly.
//
// `quoteGateWarnings()` keeps its shape so the screens that render warnings do
// not need to know any of this happened.
// ─────────────────────────────────────────────────────────────────────────────

export const QUOTE_BLOCK = Object.freeze({
  /** A material or equipment line nobody has costed. */
  UNPRICED_LINES: 'UNPRICED_LINES',
  /** A line still on a rate that shipped with the application. */
  PLACEHOLDER_RATES: 'PLACEHOLDER_RATES',
  /** Nothing has been chosen to quote. */
  EQUIPMENT_NOT_SELECTED: 'EQUIPMENT_NOT_SELECTED'
});

const rows = (v) => Array.isArray(v) ? v : [];

/**
 * @param {object} design  a quote source — a quote draft rendered by
 *   `draftToQuoteSource()`, or a historical design row being re-read.
 */
export function quoteGate(design) {
  // ── A QUOTE-ONLY JOB IS CHECKED BY ITS OWN GATE ────────────────────────
  // Nothing here applies: there is no bill of materials to price and no
  // drawing to be consistent with. `quoteDraftGate()` checks the offer —
  // equipment, prices, customer, scope, incompatible options — and says so in
  // its own words. Returning ok with a reason beats returning ok silently.
  if (design && design.quoteOnly === true) {
    return {
      ok: true, blockers: [], warnings: [], quoteOnly: true,
      summary: 'Quote only — there is no duct design on this job, so the design '
        + 'checks do not apply. The offer itself is checked by quoteDraftGate().'
    };
  }

  const blockers = [];
  const warnings = [];

  if (!design?.selectedUnit) {
    blockers.push({
      code: QUOTE_BLOCK.EQUIPMENT_NOT_SELECTED,
      severity: 'CRITICAL',
      message: 'No system has been selected, so there is nothing to price.'
    });
  }

  // ── EVERY LINE A CUSTOMER PAYS FOR HAS A COST ──────────────────────────
  // Only lines that are actually being charged. A line marked
  // `quotedSeparately` is somebody else's invoice and is not NAC's to cost.
  const bom = design?.bom || null;
  const unpriced = rows(bom?.items).filter(i => i && !i.priced && !i.quotedSeparately);
  if (unpriced.length) {
    blockers.push({
      code: QUOTE_BLOCK.UNPRICED_LINES,
      severity: 'CRITICAL',
      message: unpriced.length + ' line(s) have no cost: '
        + unpriced.map(i => i.label).join(', ') + '.',
      lines: unpriced.map(i => i.label)
    });
  }

  // ── A SHIPPED RATE IS NOT NAC'S RATE ───────────────────────────────────
  // A placeholder costs something plausible, which is exactly what makes it
  // dangerous: the quote adds up and the margin is fiction.
  if (bom?.placeholderCount) {
    blockers.push({
      code: QUOTE_BLOCK.PLACEHOLDER_RATES,
      severity: 'CRITICAL',
      message: bom.placeholderCount + ' line(s) are on rates that shipped with the '
        + 'application, worth $' + Number(bom.placeholderCost || 0).toFixed(2)
        + '. Enter NAC’s own rates before quoting.',
      placeholderCost: bom.placeholderCost || 0
    });
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    summary: blockers.length === 0
      ? 'Nothing blocks a quote on this job.'
      : blockers.length + ' issue(s) block a customer quote.'
  };
}

/** The gate as warnings, so it appears wherever warnings appear. */
export function quoteGateWarnings(gate) {
  return [
    ...(gate?.blockers || []).map(b => ({
      code: b.code, severity: 'CRITICAL', area: 'pricing', message: b.message,
      blocksCustomerQuote: true, blocksFinalApproval: false
    })),
    ...(gate?.warnings || []).map(w => ({
      code: w.code, severity: w.severity || 'WARNING', area: 'pricing', message: w.message,
      blocksCustomerQuote: false, blocksFinalApproval: false
    }))
  ];
}

export default { quoteGate, quoteGateWarnings, QUOTE_BLOCK };
