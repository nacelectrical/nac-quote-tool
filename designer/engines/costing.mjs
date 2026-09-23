// NAC AI HVAC DESIGNER — PART 24: commercial calculations.
//
// NAC's pricing basis is simple: everything bought for the job, plus a flat fee
// on top. The fee is not a cost — it is the job's margin, covering labour,
// overhead and profit together. So:
//
//     equipment + materials + subcontractor + other  =  total job cost
//                                          + job fee  =  sell price (ex GST)
//                                             + GST   =  sell price (inc GST)
//                                     gross profit    =  the job fee, exactly
//
// The alternative basis — the installed price already stored per model in the
// existing Price Setup screen — is kept and selectable, so a job can still be
// priced the old way when that suits.
//
// This does not introduce a second margin engine. GST is derived exactly the
// way the current quote tool derives it, and the quote lines are the shape
// admin.html already writes.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { activeMode, modeLabel, PRICING_MODE } from './pricing-mode.mjs';

/**
 * The install charge.
 *
 * In 'flat' mode this is a single line — NAC's fee for doing the job, whatever
 * its size. In 'hourly' mode the hours are built from the design.
 */
export function calculateLabour(design, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const C = settings.commercial;

  if (C.labourMode !== 'hourly') {
    const rows = [{
      task: 'Installation — flat job fee',
      hours: null,
      cost: round(C.jobFee, 2)
    }];
    for (const extra of (design.extraLabour || [])) {
      rows.push({
        task: extra.task,
        hours: extra.hours !== undefined && extra.hours !== null ? round(Number(extra.hours), 2) : null,
        cost: extra.cost !== undefined && extra.cost !== null ? round(Number(extra.cost), 2) : 0,
        addedByEstimator: true
      });
    }
    return {
      mode: 'flat',
      rows,
      jobFee: round(C.jobFee, 2),
      jobFeeExGst: C.jobFeeExGst !== false,
      ratePerHour: null,
      totalHours: null,
      // The fee is margin, not cost — nothing here goes into total job cost.
      totalCost: 0,
      totalFee: round(rows.reduce((s, r) => s + (r.cost || 0), 0), 2)
    };
  }

  const outletCount = design.outlets?.totals?.total || 0;
  const zoneCount = (design.zones?.zones || []).filter(z => !z.alwaysOpen).length;
  const ductM = design.network?.totalDuctLengthM || 0;

  const rows = [
    { task: 'Indoor unit installation', hours: C.labourHoursIndoorUnit },
    { task: 'Outdoor unit installation', hours: C.labourHoursOutdoorUnit },
    { task: 'Ductwork (' + round(ductM, 1) + ' m)', hours: round(ductM * C.labourHoursPerDuctMetre, 2) },
    { task: 'Outlets (' + outletCount + ')', hours: round(outletCount * C.labourHoursPerOutlet, 2) },
    { task: 'Zoning (' + zoneCount + ' motorised zones)', hours: round(zoneCount * C.labourHoursPerZone, 2) },
    { task: 'Return air', hours: C.labourHoursReturn },
    { task: 'Commissioning & balancing', hours: C.labourHoursCommissioning }
  ];
  for (const extra of (design.extraLabour || [])) {
    rows.push({ task: extra.task, hours: round(Number(extra.hours) || 0, 2), addedByEstimator: true });
  }

  const totalHours = round(rows.reduce((s, r) => s + (r.hours || 0), 0), 2);
  rows.forEach(r => { r.cost = round((r.hours || 0) * C.labourRatePerHour, 2); });

  return {
    mode: 'hourly',
    rows,
    jobFee: null,
    ratePerHour: C.labourRatePerHour,
    totalHours,
    totalCost: round(totalHours * C.labourRatePerHour, 2),
    totalFee: 0
  };
}

/**
 * Full commercial summary.
 *
 * @param {Object} args
 *   bom            — from buildBillOfMaterials()
 *   labour         — from calculateLabour()
 *   cataloguePrice — the installed price NAC has stored for the chosen model
 *   sellOverride   — an explicit price the estimator typed, which always wins
 *   extras         — [{ label, price, qty }] additional sell lines (inc GST)
 *   subcontractor  — cost only
 *   otherCost      — cost only
 */
export function calculateCommercials({ bom, labour, cataloguePrice = null, sellOverride = null,
                                       extras = [], subcontractorCost = 0, otherCost = 0 }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const C = settings.commercial;
  const gstRate = C.gstRate;

  const equipmentCost = bom?.equipmentCost || 0;
  const materialsCost = bom?.materialsCost || 0;
  const labourCost = labour?.totalCost || 0;        // 0 in flat mode — the fee is margin
  const subCost = Number(subcontractorCost) || 0;
  const other = Number(otherCost) || 0;
  const totalJobCost = round(equipmentCost + materialsCost + labourCost + subCost + other, 2);

  const extraSell = (extras || []).reduce((s, e) => s + (Number(e.price) || 0) * (Number(e.qty) || 1), 0);

  // ── LINES CHARGED AT A FIXED SELL PRICE ───────────────────────────────────
  //
  // Nick set a price for six sundry lines and said they are what NAC CHARGE.
  // They are therefore not in `totalJobCost` — nothing above counted them,
  // because their totalCost is null — and the job fee is NOT worked out over
  // them. They are added to the customer's price after the fee.
  //
  // Doing it the other way round charges margin on them twice: once in the
  // price NAC set, and again as their share of the $6,000.
  const fixedSellExGst = round(Number(bom?.fixedSellTotal) || 0, 2);

  const flat = labour?.mode === 'flat';
  const feeTotal = flat ? (labour.totalFee ?? C.jobFee) : 0;
  // The ACTIVE MODE decides, not a free-text string compared in three places.
  const mode = activeMode(settings).mode;
  const usesFee = flat && (mode === PRICING_MODE.COST_PLUS_JOB_FEE
    || (mode === PRICING_MODE.COMPONENT_SELL_PRICES
        && C.applyJobFeeOnComponentPricing === true));

  // ── Work out the sell price ───────────────────────────────────────────────
  let sellIncGst = null;
  let basis = null;

  if (sellOverride !== null && sellOverride !== undefined && sellOverride !== '') {
    sellIncGst = round(Number(sellOverride) + extraSell, 2);
    basis = { key: 'override', label: 'Price entered by the estimator' };
  } else if (usesFee) {
    // Everything bought for the job, plus the fee on top.
    const feeExGst = C.jobFeeExGst !== false ? feeTotal : feeTotal / (1 + gstRate);
    // Job cost, plus the fee over that cost, plus the fixed-price lines AFTER
    // the fee. The fee base is stated so the sheet can show the arithmetic.
    const exGst = totalJobCost + feeExGst + fixedSellExGst;
    sellIncGst = round(exGst * (1 + gstRate) + extraSell, 2);
    basis = {
      key: 'materials_plus_fee',
      label: fixedSellExGst > 0
        ? 'Job cost + flat fee, plus fixed-price lines'
        : 'Job cost + flat fee',
      jobFee: round(feeTotal, 2),
      jobFeeExGst: C.jobFeeExGst !== false,
      feeAppliedExGst: round(feeExGst, 2),
      /** The base the fee was worked out over — NOT the whole sell price. */
      feeBaseExGst: totalJobCost,
      fixedSellExGst
    };
  } else if (mode === PRICING_MODE.COMPONENT_SELL_PRICES
             && cataloguePrice !== null && cataloguePrice !== undefined) {
    sellIncGst = round(Number(cataloguePrice) + extraSell, 2);
    basis = { key: 'catalogue_price', label: 'Installed price from Price Setup' };
  }

  // GST is derived exactly the way the existing quote tool derives it: stored
  // prices are inc GST, so the ex-GST figure comes back out of them.
  const sellExGst = sellIncGst !== null ? round(sellIncGst / (1 + gstRate), 2) : null;
  const gstAmount = sellIncGst !== null ? round(sellIncGst - sellExGst, 2) : null;

  const grossProfit = sellExGst !== null ? round(sellExGst - totalJobCost, 2) : null;
  const grossMarginPct = sellExGst && sellExGst !== 0 ? round((grossProfit / sellExGst) * 100, 1) : null;

  // ── THE MARGIN FIGURE IS NOT THE WHOLE TRUTH WHEN A LINE IS SELL-PRICED ──
  //
  // `grossProfit` is sell minus RECORDED cost. The fixed-price lines have no
  // recorded cost, so every dollar of them reads as profit — and some of it is
  // what NAC paid the supplier. The number is stated with what is unknown
  // beside it rather than quietly overstated.
  const marginExcludesCostOf = fixedSellExGst > 0
    ? { fixedSellExGst, lines: bom?.fixedSellLabels || [],
        note: 'Gross profit is the job fee plus whatever margin is inside $'
          + fixedSellExGst.toFixed(2) + ' of fixed-price lines. What NAC pay for those '
          + 'lines is not recorded, so the true margin is lower than the figure shown '
          + 'by exactly their cost.' }
    : null;

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = [];
  if (sellIncGst === null) {
    warnings.push({ code: 'NO_SELL_PRICE', severity: 'CHECK',
      message: mode === PRICING_MODE.COMPONENT_SELL_PRICES
        ? 'No NAC installed price is configured for the selected model. Set it in the existing Price Setup screen, or switch the pricing basis to job cost + flat fee.'
        : 'No sell price could be worked out. Check the pricing basis in HVAC Design Settings → Commercial.' });
  }

  if (usesFee && bom?.unpricedCount) {
    // On this basis the price is built from the costs, so a line with no cost
    // is not a gap in the internal view — it is money left on the table.
    warnings.push({ code: 'PRICE_MISSING_COST_LINES', severity: 'CRITICAL',
      message: bom.unpricedCount + ' line(s) have no cost, so the sell price is short by whatever they ' +
        'are worth: ' + (bom.unpricedLabels || []).join(', ') + '. Enter their cost before quoting.' });
  }

  if (usesFee && bom?.placeholderCount) {
    // On this basis the material rates drive the customer's price directly, so
    // a placeholder rate is a pricing error, not just a costing note.
    warnings.push({ code: 'PRICE_BASED_ON_PLACEHOLDER_RATES', severity: 'WARNING',
      message: 'The sell price is built on ' + bom.placeholderCount + ' material line(s) still on shipped ' +
        'placeholder rates, worth $' + round(bom.placeholderCost || 0, 2) + ' of the job cost. On the ' +
        'job-cost-plus-fee basis those rates go straight through to the customer — set NAC\'s real rates ' +
        'in HVAC Design Settings → Material rates before quoting.',
      placeholderCost: round(bom.placeholderCost || 0, 2),
      placeholderCount: bom.placeholderCount });
  } else if (bom?.placeholderCount) {
    warnings.push({ code: 'COST_BASED_ON_PLACEHOLDERS', severity: 'CHECK',
      message: 'Job cost includes ' + bom.placeholderCount + ' material line(s) still on shipped placeholder rates.' });
  }

  const expectedProfit = (C.jobFeeExGst !== false ? feeTotal : feeTotal / (1 + gstRate))
    + fixedSellExGst;
  if (usesFee && grossProfit !== null && Math.abs(grossProfit - expectedProfit) > 1 && !extraSell) {
    warnings.push({ code: 'MARGIN_NOT_EQUAL_TO_FEE', severity: 'CHECK',
      message: 'Gross profit is ' + round(grossProfit, 2) + ' rather than the ' +
        round(expectedProfit, 2) + ' expected (the ' + feeTotal + ' job fee' +
        (fixedSellExGst > 0 ? ' plus $' + fixedSellExGst.toFixed(2) + ' of fixed-price lines' : '') +
        ') — check the extra sell lines and cost entries.' });
  }
  if (!usesFee && grossMarginPct !== null && grossMarginPct < 20) {
    warnings.push({ code: 'LOW_GROSS_MARGIN', severity: 'WARNING',
      message: 'Gross margin is ' + grossMarginPct + '% — check the cost lines and the installed price.' });
  }
  if (grossProfit !== null && grossProfit < 0) {
    warnings.push({ code: 'NEGATIVE_GROSS_PROFIT', severity: 'CRITICAL',
      message: 'This job sells for less than it costs. Gross profit is ' + round(grossProfit, 2) + '.' });
  }

  return {
    equipmentCost: round(equipmentCost, 2),
    materialsCost: round(materialsCost, 2),
    labourCost: round(labourCost, 2),
    subcontractorCost: round(subCost, 2),
    otherCost: round(other, 2),
    totalJobCost,
    jobFee: usesFee ? round(feeTotal, 2) : null,
    pricingBasis: basis,
    /** The internal estimate states this. The customer document never does. */
    pricingMode: mode,
    pricingModeLabel: modeLabel(mode),
    sellPriceIncGst: sellIncGst,
    sellPriceExGst: sellExGst,
    gstAmount,
    gstRate,
    cataloguePrice: cataloguePrice ?? null,
    grossProfit,
    grossMarginPct,
    /** Non-null when the margin above is known to be overstated, and by what. */
    marginExcludesCostOf,
    fixedSellExGst,
    extras,
    warnings
  };
}

/**
 * Convert a finished design into the line-item shape the EXISTING NAC quote
 * pipeline already uses (admin.html writes exactly this into nac_quotes, and
 * sign.html renders it). No new quote format is introduced.
 */
export function toQuoteLineItems(design, commercials) {
  const items = [];
  const unit = design.selectedUnit;
  if (unit) {
    items.push({
      name: unit.brandName + ' ' + unit.model + ' ' + unit.capacityKw + 'kW',
      desc: unit.capacityKw + 'kW ' + unit.phase + ' ducted reverse cycle system — ' +
        (design.outlets?.totals?.total || 0) + ' outlets, ' +
        ((design.zones?.zones || []).length) + ' zones',
      price: commercials.sellPriceIncGst,
      link: design.brandUrl || '',
      _brand: unit.brandName,
      _model: unit.model,
      _kw: unit.capacityKw,
      _designId: design.id || null
    });
  }
  for (const e of (commercials.extras || [])) {
    items.push({ name: e.label, desc: e.desc || '', price: (Number(e.price) || 0) * (Number(e.qty) || 1), link: '' });
  }
  return items;
}
