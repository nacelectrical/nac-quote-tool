// ─────────────────────────────────────────────────────────────────────────────
// HOW NAC ARRIVES AT A PRICE — AND ONLY ONE WAY AT A TIME
//
// There were two pricing ideas in the codebase and nothing declared which was
// in force, so both were half-applied at once.
//
// Nick: "The reports currently require an equipment sell price even though
// equipment supplier cost already enters job cost and the flat job fee creates
// the sell price. That is conflicting pricing logic."
//
// He is right, and it is worse than redundant. On job-cost-plus-fee the
// equipment SUPPLIER COST is what the customer's price is built from — it goes
// into the job cost and the fee goes on top. An installed SELL price stored
// against the same model is a second, independent answer to the same question.
// Requiring it meant a model NAC could buy and fit, at a cost NAC knew exactly,
// was refused for want of a number that method never uses.
//
// So the mode is explicit, it is stated on the internal estimate, and the two
// methods are never mixed:
//
//   COST_PLUS_JOB_FEE     what the job costs NAC to buy and do, plus a fixed
//                         fee. The fee IS the margin. Needs verified costs and
//                         a configured fee. Does NOT need a sell price on
//                         anything.
//
//   COMPONENT_SELL_PRICES every line carries its own sell price and the price
//                         is their sum. Needs sell prices. Does NOT add the
//                         flat fee unless somebody has explicitly said to.
//
// The customer document never shows which one was used. It is NAC's commercial
// method, not the customer's business.
// ─────────────────────────────────────────────────────────────────────────────

export const PRICING_MODE = Object.freeze({
  COST_PLUS_JOB_FEE: 'COST_PLUS_JOB_FEE',
  COMPONENT_SELL_PRICES: 'COMPONENT_SELL_PRICES'
});

/** The old free-text values, so a stored setting keeps working. */
const LEGACY = Object.freeze({
  materials_plus_fee: PRICING_MODE.COST_PLUS_JOB_FEE,
  catalogue_price: PRICING_MODE.COMPONENT_SELL_PRICES
});

// Number(null) is 0, and Number('') is 0. A null supplier cost and a null sell
// price both read as "$0, which is a number" and sailed through every check
// below. ABSENT and ZERO are different facts and this is where they part.
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const rows = (v) => Array.isArray(v) ? v : [];

/**
 * Which mode is in force, and where that came from.
 *
 * There is no inference and no default-by-accident: an unrecognised value is
 * reported as unset rather than quietly resolved to one of the two, because
 * guessing here is exactly how both got half-applied.
 */
export function activeMode(settings) {
  const C = settings?.commercial || {};
  const explicit = C.pricingMode ?? null;
  const legacy = C.pricingBasis ? (LEGACY[C.pricingBasis] ?? null) : null;

  // ── TWO ANSWERS IS NOT AN ANSWER ────────────────────────────────────────
  // If both keys are set and they disagree, nothing here picks a winner. That
  // is the whole failure this module exists to stop, and choosing quietly
  // would reproduce it one layer down.
  if (explicit && legacy && explicit !== legacy) {
    return {
      mode: null, source: null, ok: false,
      reason: 'Two different pricing methods are configured: pricingMode is ' + explicit
        + ' and pricingBasis is ' + C.pricingBasis + ' (' + legacy + '). Set pricingMode '
        + 'in HVAC Design Settings → Commercial and clear the old value.'
    };
  }
  if (explicit === PRICING_MODE.COST_PLUS_JOB_FEE
      || explicit === PRICING_MODE.COMPONENT_SELL_PRICES) {
    return { mode: explicit, source: 'pricingMode', ok: true };
  }
  if (legacy) {
    return { mode: legacy, source: 'pricingBasis (' + C.pricingBasis + ')', ok: true };
  }
  return {
    mode: null, source: null, ok: false,
    reason: 'No pricing mode is set. Choose COST_PLUS_JOB_FEE or COMPONENT_SELL_PRICES in '
      + 'HVAC Design Settings → Commercial.'
  };
}

/** Human wording for the internal estimate. Never for a customer document. */
export function modeLabel(mode) {
  if (mode === PRICING_MODE.COST_PLUS_JOB_FEE) {
    return 'Cost plus job fee — verified job cost with the fixed NAC fee on top';
  }
  if (mode === PRICING_MODE.COMPONENT_SELL_PRICES) {
    return 'Component sell prices — each line priced individually';
  }
  return 'NOT SET';
}

/**
 * Does this design have what the ACTIVE mode needs — and nothing borrowed from
 * the other one?
 *
 * @returns {{ok, mode, modeLabel, failures:Array, requires:Array}}
 */
export function pricingRequirements({ design, settings } = {}) {
  const active = activeMode(settings);
  const failures = [];
  const C = settings?.commercial || {};
  const bom = design?.bom || null;
  const unit = design?.selectedUnit || null;

  if (!active.ok) {
    return { ok: false, mode: null, modeLabel: modeLabel(null),
             failures: [{ code: 'PRICING_MODE_NOT_SET', severity: 'CRITICAL',
                          message: active.reason }],
             requires: [] };
  }

  if (active.mode === PRICING_MODE.COST_PLUS_JOB_FEE) {
    // The equipment the customer is buying has to have a cost NAC has verified.
    if (unit && n(unit.supplierCost) === null) {
      failures.push({ code: 'EQUIPMENT_COST_REQUIRED', severity: 'CRITICAL',
        message: 'On cost plus job fee the customer’s price is built from what the '
          + 'equipment costs NAC. ' + (unit.model || 'The selected unit')
          + ' has no supplier cost on file.' });
    }
    // Every material line has to cost something real.
    const unpriced = rows(bom?.items).filter(i => !i.priced && !i.quotedSeparately);
    if (unpriced.length) {
      failures.push({ code: 'MATERIAL_COSTS_REQUIRED', severity: 'CRITICAL',
        message: unpriced.length + ' material line(s) have no cost, so the job cost the price '
          + 'is built on is short by whatever they are worth.',
        lines: unpriced.map(i => i.label) });
    }
    // And the fee has to be configured, because the fee IS the margin.
    if (n(C.jobFee) === null || n(C.jobFee) <= 0) {
      failures.push({ code: 'JOB_FEE_REQUIRED', severity: 'CRITICAL',
        message: 'No job fee is configured. On this mode the fee is the entire margin, so a '
          + 'price without one sells the job at cost.' });
    }
    return {
      ok: failures.length === 0, mode: active.mode, modeSource: active.source,
      modeLabel: modeLabel(active.mode), failures,
      requires: ['Verified equipment supplier cost', 'Verified material costs',
                 'Configured job fee'],
      /** Stated explicitly so nothing asks for one by habit. */
      equipmentSellPriceRequired: false
    };
  }

  // COMPONENT_SELL_PRICES
  if (unit && n(unit.sellPrice) === null) {
    failures.push({ code: 'EQUIPMENT_SELL_PRICE_REQUIRED', severity: 'CRITICAL',
      message: 'On component sell prices every line carries its own price. '
        + (unit.model || 'The selected unit') + ' has no installed sell price on file.' });
  }
  const noSell = rows(bom?.items)
    .filter(i => !i.quotedSeparately && n(i.sellPrice) === null && (i.totalCost || 0) > 0);
  if (noSell.length) {
    failures.push({ code: 'MATERIAL_SELL_PRICES_REQUIRED', severity: 'CRITICAL',
      message: noSell.length + ' material line(s) have a cost but no sell price.',
      lines: noSell.map(i => i.label) });
  }
  if (n(C.jobFee) > 0 && C.applyJobFeeOnComponentPricing !== true) {
    failures.push({ code: 'JOB_FEE_WOULD_BE_MIXED_IN', severity: 'CRITICAL',
      message: 'A job fee of $' + n(C.jobFee) + ' is configured while the pricing mode is '
        + 'component sell prices. Adding a flat fee on top of individually priced lines '
        + 'charges the margin twice. Either clear the fee, or tick "apply the job fee on '
        + 'component pricing" to say you mean it.' });
  }
  return {
    ok: failures.length === 0, mode: active.mode, modeSource: active.source,
    modeLabel: modeLabel(active.mode), failures,
    requires: ['Equipment sell price', 'Material sell prices'],
    equipmentSellPriceRequired: true
  };
}

export default { PRICING_MODE, activeMode, modeLabel, pricingRequirements };
