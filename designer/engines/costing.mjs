// NAC AI HVAC DESIGNER — PART 24: commercial calculations.
//
// This does NOT introduce a second margin engine. The customer-facing sell
// price is still NAC's existing installed price for the selected model (the
// figure already stored in `nac_brands_v4` and used by the current quote tool),
// plus any extras. Everything here is the INTERNAL cost view built around that
// same number: cost to do the job, gross profit, gross margin.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';

export function calculateLabour(design, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const C = settings.commercial;

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

  const totalHours = round(rows.reduce((s, r) => s + r.hours, 0), 2);
  return {
    rows,
    ratePerHour: C.labourRatePerHour,
    totalHours,
    totalCost: round(totalHours * C.labourRatePerHour, 2)
  };
}

/**
 * Full commercial summary.
 *
 * @param {Object} args
 *   bom            — from buildBillOfMaterials()
 *   labour         — from calculateLabour()
 *   sellPrice      — NAC's existing installed sell price (inc GST) for the
 *                    chosen system, i.e. exactly what the current quote tool
 *                    already puts in front of the customer. Optional.
 *   extras         — [{ label, price, qty }] additional sell lines
 *   subcontractor  — cost only
 *   otherCost      — cost only
 */
export function calculateCommercials({ bom, labour, sellPrice = null, extras = [],
                                       subcontractorCost = 0, otherCost = 0 }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const gstRate = settings.commercial.gstRate;

  const equipmentCost = bom?.equipmentCost || 0;
  const materialsCost = bom?.materialsCost || 0;
  const labourCost = labour?.totalCost || 0;
  const subCost = Number(subcontractorCost) || 0;
  const other = Number(otherCost) || 0;
  const totalJobCost = round(equipmentCost + materialsCost + labourCost + subCost + other, 2);

  const extraSell = (extras || []).reduce((s, e) => s + (Number(e.price) || 0) * (Number(e.qty) || 1), 0);
  const sellIncGst = sellPrice !== null && sellPrice !== undefined
    ? round(Number(sellPrice) + extraSell, 2) : null;

  // NAC's existing quote maths: stored prices are inc GST, so the ex-GST figure
  // is derived exactly the way the current tool derives it.
  const sellExGst = sellIncGst !== null ? round(sellIncGst / (1 + gstRate), 2) : null;
  const gstAmount = sellIncGst !== null ? round(sellIncGst - sellExGst, 2) : null;

  const grossProfit = sellExGst !== null ? round(sellExGst - totalJobCost, 2) : null;
  const grossMarginPct = sellExGst && sellExGst !== 0 ? round((grossProfit / sellExGst) * 100, 1) : null;

  const warnings = [];
  if (sellIncGst === null) {
    warnings.push({ code: 'NO_SELL_PRICE', severity: 'CHECK',
      message: 'No NAC installed price is configured for the selected model. Set it in the existing Price Setup screen — the designer does not invent sell prices.' });
  } else if (grossMarginPct !== null && grossMarginPct < 20) {
    warnings.push({ code: 'LOW_GROSS_MARGIN', severity: 'WARNING',
      message: 'Gross margin is ' + grossMarginPct + '% — check the cost lines and the installed price.' });
  }
  if (bom?.placeholderCount) {
    warnings.push({ code: 'COST_BASED_ON_PLACEHOLDERS', severity: 'CHECK',
      message: 'Job cost includes ' + bom.placeholderCount + ' material line(s) still on shipped placeholder rates.' });
  }

  return {
    equipmentCost: round(equipmentCost, 2),
    materialsCost: round(materialsCost, 2),
    labourCost: round(labourCost, 2),
    subcontractorCost: round(subCost, 2),
    otherCost: round(other, 2),
    totalJobCost,
    sellPriceIncGst: sellIncGst,
    sellPriceExGst: sellExGst,
    gstAmount,
    gstRate,
    grossProfit,
    grossMarginPct,
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
