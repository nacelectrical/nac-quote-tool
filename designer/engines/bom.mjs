// NAC AI HVAC DESIGNER — PART 22: bill of materials.
// Every line is derived from the design, not typed twice. Quantities trace back
// to the duct network, outlet schedule, zone plan and return design.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { resolveCost, OUTLET_MATERIAL_KEY, PRICE_SOURCE } from './materials.mjs';

function line(key, quantity, ctx, extra = {}) {
  const r = resolveCost(key, ctx);
  const qty = round(Number(quantity), 2);
  return {
    key,
    label: r.label,
    unit: r.unit,
    quantity: qty,
    unitCost: r.cost,
    totalCost: r.cost !== null ? round(r.cost * qty, 2) : null,
    priceSource: r.source,
    priced: r.cost !== null,
    diameterMm: ctx.diameterMm ?? null,
    ...extra
  };
}

/**
 * @param {Object} design { equipment, network, outlets, zones, returnDesign,
 *                          controller, refrigerantPipeM, drainPipeM, cableM }
 */
export function buildBillOfMaterials(design, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const nacRates = opts.nacRates || null;
  const ctx = { nacRates };
  const items = [];

  // ── Equipment ──────────────────────────────────────────────────────────────
  const unit = design.selectedUnit;
  if (unit) {
    items.push({
      key: 'indoor_outdoor_system',
      label: unit.brandName + ' ' + unit.model + ' — ' + unit.capacityKw + ' kW ' + unit.phase + ' ducted system',
      unit: 'system', quantity: 1,
      unitCost: unit.supplierCost ?? null,
      totalCost: unit.supplierCost ?? null,
      priceSource: unit.supplierCost !== null && unit.supplierCost !== undefined ? PRICE_SOURCE.NAC : null,
      priced: unit.supplierCost !== null && unit.supplierCost !== undefined,
      sellPrice: unit.sellPrice ?? null,
      category: 'equipment'
    });
    items.push({ ...line('outdoor_feet', 1, ctx), category: 'equipment' });
  }
  if (design.controller) {
    items.push({
      key: 'zone_controller',
      label: design.controller.name,
      unit: 'each', quantity: 1,
      unitCost: design.controller.cost ?? null,
      totalCost: design.controller.cost ?? null,
      priceSource: design.controller.cost !== undefined && design.controller.cost !== null ? PRICE_SOURCE.NAC : null,
      priced: design.controller.cost !== undefined && design.controller.cost !== null,
      sellPrice: design.controller.price ?? null,
      category: 'equipment'
    });
  }

  // ── Zone motors ────────────────────────────────────────────────────────────
  const closableZones = (design.zones?.zones || []).filter(z => !z.alwaysOpen);
  if (closableZones.length) {
    items.push({ ...line('zone_motor', closableZones.length, ctx), category: 'zoning' });
  }

  // ── Ductwork ───────────────────────────────────────────────────────────────
  const byDiameter = {};
  const fittingCounts = {};
  for (const s of (design.network?.sections || [])) {
    if (s.lengthM) byDiameter[s.diameterMm] = round((byDiameter[s.diameterMm] || 0) + s.lengthM, 2);
    for (const f of (s.fittings || [])) {
      fittingCounts[f.type] = (fittingCounts[f.type] || 0) + f.quantity;
    }
  }
  Object.keys(byDiameter).sort((a, b) => Number(a) - Number(b)).forEach(d => {
    items.push({ ...line('flex_duct', byDiameter[d], { ...ctx, diameterMm: Number(d) }), category: 'ductwork' });
  });

  const fittingMap = { supply_plenum: 'supply_plenum', y_piece: 'y_piece', reducer: 'reducer',
                       takeoff: 'takeoff', joiner: 'joiner', damper_open: 'damper_manual' };
  Object.entries(fittingCounts).forEach(([type, qty]) => {
    const key = fittingMap[type];
    if (!key) return;                             // bends are part of the flex run
    items.push({ ...line(key, qty, ctx), category: 'ductwork' });
  });

  const totalDuctM = design.network?.totalDuctLengthM || 0;
  if (totalDuctM > 0) {
    // One support roughly every 1.5 m of flex, per manufacturer install guidance.
    items.push({ ...line('hanging_kit', Math.ceil(totalDuctM / 1.5), ctx), category: 'ductwork' });
  }

  // ── Outlets ────────────────────────────────────────────────────────────────
  const outletCounts = {};
  for (const o of (design.outlets?.rows || [])) {
    outletCounts[o.type] = (outletCounts[o.type] || 0) + o.quantity;
  }
  Object.entries(outletCounts).forEach(([type, qty]) => {
    const key = OUTLET_MATERIAL_KEY[type];
    if (key) items.push({ ...line(key, qty, ctx), category: 'outlets' });
  });

  // ── Return air ─────────────────────────────────────────────────────────────
  if (design.returnDesign) {
    items.push({ ...line('return_grille', design.returnDesign.returnCount, ctx), category: 'return' });
    items.push({ ...line('return_filter', design.returnDesign.returnCount, ctx), category: 'return' });
    items.push({ ...line('return_plenum', design.returnDesign.returnCount, ctx), category: 'return' });
    if (design.returnDesign.duct?.lengthM) {
      items.push({ ...line('flex_duct', design.returnDesign.duct.lengthM,
        { ...ctx, diameterMm: design.returnDesign.duct.diameterMm }), category: 'return' });
    }
  }

  // ── Services ───────────────────────────────────────────────────────────────
  items.push({ ...line('drain_kit', 1, ctx), category: 'services' });
  if (design.drainPipeM) items.push({ ...line('drain_pipe', design.drainPipeM, ctx), category: 'services' });
  if (design.refrigerantPipeM) items.push({ ...line('refrigerant_pipe', design.refrigerantPipeM, ctx), category: 'services' });
  if (design.cableM) {
    items.push({ ...line('interconnect_cable', design.cableM, ctx), category: 'services' });
    items.push({ ...line('power_cable', design.cableM, ctx), category: 'services' });
  }
  items.push({ ...line('isolator', 1, ctx), category: 'services' });
  items.push({ ...line('consumables', 1, ctx), category: 'services' });

  // ── Estimator additions / edits ────────────────────────────────────────────
  for (const extra of (design.extraMaterials || [])) {
    items.push({
      key: extra.key || 'custom',
      label: extra.label,
      unit: extra.unit || 'each',
      quantity: round(Number(extra.quantity) || 1, 2),
      unitCost: extra.unitCost !== undefined && extra.unitCost !== null ? Number(extra.unitCost) : null,
      totalCost: extra.unitCost !== undefined && extra.unitCost !== null
        ? round(Number(extra.unitCost) * (Number(extra.quantity) || 1), 2) : null,
      priceSource: PRICE_SOURCE.NAC,
      priced: extra.unitCost !== undefined && extra.unitCost !== null,
      category: extra.category || 'other',
      addedByEstimator: true
    });
  }

  const placeholderLines = items.filter(i => i.priceSource === PRICE_SOURCE.PLACEHOLDER);
  const unpricedLines = items.filter(i => !i.priced);

  const warnings = [];
  if (placeholderLines.length) {
    warnings.push({ code: 'MATERIAL_PRICE_PLACEHOLDER', severity: 'CHECK',
      message: placeholderLines.length + ' material line(s) are still on shipped placeholder rates, not NAC prices: ' +
        placeholderLines.slice(0, 6).map(l => l.label).join(', ') +
        (placeholderLines.length > 6 ? ' and ' + (placeholderLines.length - 6) + ' more' : '') +
        '. Set them in HVAC Design Settings → Material rates.' });
  }
  if (unpricedLines.length) {
    warnings.push({ code: 'MATERIAL_PRICE_MISSING', severity: 'WARNING',
      message: unpricedLines.length + ' line(s) have no cost at all: ' +
        unpricedLines.map(l => l.label).join(', ') + '.' });
  }

  const byCategory = {};
  for (const i of items) {
    byCategory[i.category] = round((byCategory[i.category] || 0) + (i.totalCost || 0), 2);
  }

  return {
    items,
    byCategory,
    totalCost: round(items.reduce((s, i) => s + (i.totalCost || 0), 0), 2),
    materialsCost: round(items.filter(i => i.category !== 'equipment')
      .reduce((s, i) => s + (i.totalCost || 0), 0), 2),
    equipmentCost: round(items.filter(i => i.category === 'equipment')
      .reduce((s, i) => s + (i.totalCost || 0), 0), 2),
    lineCount: items.length,
    placeholderCount: placeholderLines.length,
    warnings
  };
}

/**
 * Re-apply the estimator's BOM edits after a rebuild. Edits are matched on the
 * line's key and label rather than its index, so they survive a design change
 * that adds or removes lines.
 */
export function applyBomEdits(bom, edits) {
  if (!edits || !edits.length) return bom;
  let out = bom;
  for (const e of edits) {
    const i = out.items.findIndex(it => (it.key + '|' + it.label) === e.match);
    if (i === -1) continue;
    const patch = {};
    if (e.quantity !== undefined && e.quantity !== null) patch.quantity = e.quantity;
    if (e.unitCost !== undefined) patch.unitCost = e.unitCost;
    out = editBomLine(out, i, patch);
  }
  return out;
}

/** Estimator edit of a BOM line — quantity or cost. */
export function editBomLine(bom, index, patch) {
  const items = bom.items.map((it, i) => {
    if (i !== index) return it;
    const next = { ...it, ...patch, edited: true };
    const q = Number(next.quantity) || 0;
    next.totalCost = next.unitCost !== null && next.unitCost !== undefined
      ? round(Number(next.unitCost) * q, 2) : null;
    next.priced = next.totalCost !== null;
    next.priceSource = PRICE_SOURCE.NAC;
    return next;
  });
  const byCategory = {};
  for (const i of items) byCategory[i.category] = round((byCategory[i.category] || 0) + (i.totalCost || 0), 2);
  return {
    ...bom, items, byCategory,
    totalCost: round(items.reduce((s, i) => s + (i.totalCost || 0), 0), 2),
    materialsCost: round(items.filter(i => i.category !== 'equipment').reduce((s, i) => s + (i.totalCost || 0), 0), 2),
    equipmentCost: round(items.filter(i => i.category === 'equipment').reduce((s, i) => s + (i.totalCost || 0), 0), 2)
  };
}
