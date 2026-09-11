// NAC AI HVAC DESIGNER — PART 22: bill of materials.
// Every line is derived from the design, not typed twice. Quantities trace back
// to the duct network, outlet schedule, zone plan and return design.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { resolveCost, OUTLET_MATERIAL_KEY, PRICE_SOURCE, MATERIAL_CATALOGUE } from './materials.mjs';

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
    priceNote: r.note || null,
    supplierCode: r.supplierCode || null,
    priced: r.cost !== null,
    diameterMm: ctx.diameterMm ?? null,
    ...extra
  };
}

/**
 * A line for something sold by the length or roll — flex duct, drain pipe,
 * paircoil. MMEM sell flex in 6 m lengths, so a 7 m run costs two lengths, not
 * 7 metres. Off-cuts of the same diameter are reused across the job, which is
 * why the rounding happens on the job total rather than per run.
 *
 * The line reports what is bought (whole lengths) and what the design needs
 * (metres), so the estimator can see the off-cut rather than wonder about it.
 */
function packLine(key, metres, ctx, extra = {}) {
  const r = resolveCost(key, ctx);
  const m = round(Number(metres), 2);
  // No pack price — a NAC per-metre rate, or a size MMEM have not quoted. The
  // line still reports the metres so callers never have to branch on it.
  if (!r.pack || !r.pack.lengthM) {
    return line(key, m, ctx, { metresRequired: m, metresBought: m, offcutM: 0,
      ratePerM: r.cost, ...extra });
  }

  const packs = Math.ceil(m / r.pack.lengthM);
  const boughtM = round(packs * r.pack.lengthM, 2);
  return {
    key,
    label: r.label,
    unit: r.pack.lengthM + ' m length',
    quantity: packs,
    unitCost: r.pack.cost,
    totalCost: round(r.pack.cost * packs, 2),
    priceSource: r.source,
    priceNote: r.note || null,
    supplierCode: r.pack.code || r.supplierCode || null,
    priced: true,
    diameterMm: ctx.diameterMm ?? null,
    metresRequired: m,
    metresBought: boughtM,
    offcutM: round(boughtM - m, 2),
    ratePerM: r.cost,
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

  // ── Zone motors and zone wiring ────────────────────────────────────────────
  // A zone damper is the size of the branch duct feeding it, so the diameter
  // comes from the duct network rather than being assumed.
  const branchDiameterByRoom = {};
  for (const sec of (design.network?.sections || [])) {
    const m = /^branch_(.+)$/.exec(sec.id || '');
    if (m && sec.diameterMm) branchDiameterByRoom[m[1]] = sec.diameterMm;
  }
  const closableZones = (design.zones?.zones || []).filter(z => !z.alwaysOpen);
  if (closableZones.length) {
    const motorsByDiameter = {};
    let unsized = 0;
    for (const z of closableZones) {
      // A zone can gather several rooms; the damper sits on the largest branch.
      const diameters = (z.roomIds || []).map(id => branchDiameterByRoom[id]).filter(Boolean);
      if (!diameters.length) { unsized += 1; continue; }
      const d = Math.max(...diameters);
      motorsByDiameter[d] = (motorsByDiameter[d] || 0) + 1;
    }
    Object.keys(motorsByDiameter).sort((a, b) => Number(a) - Number(b)).forEach(d => {
      items.push({ ...line('zone_motor', motorsByDiameter[d], { ...ctx, diameterMm: Number(d) }),
        category: 'zoning' });
    });
    if (unsized) {
      items.push({ ...line('zone_motor', unsized, ctx), category: 'zoning',
        sizeUnknown: true });
    }
    // One 15 m zone lead per motorised damper.
    items.push({ ...line('zone_cable', closableZones.length, ctx), category: 'zoning' });
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
  // Return duct shares the flex tally so off-cuts are not double-counted.
  const returnDuct = design.returnDesign?.duct;
  if (returnDuct?.lengthM) {
    byDiameter[returnDuct.diameterMm] =
      round((byDiameter[returnDuct.diameterMm] || 0) + returnDuct.lengthM, 2);
  }
  Object.keys(byDiameter).sort((a, b) => Number(a) - Number(b)).forEach(d => {
    items.push({ ...packLine('flex_duct', byDiameter[d], { ...ctx, diameterMm: Number(d) }),
      category: 'ductwork' });
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
  // A round diffuser is priced by its neck, which is the duct that reaches it.
  // Other outlet types are not sized by diameter, so they stay flat-rated.
  const outletCounts = {};
  for (const o of (design.outlets?.rows || [])) {
    const key = OUTLET_MATERIAL_KEY[o.type];
    if (!key) continue;
    const d = MATERIAL_CATALOGUE[key]?.byDiameter ? branchDiameterByRoom[o.roomId] || null : null;
    const bucket = key + '|' + (d || '');
    outletCounts[bucket] = (outletCounts[bucket] || 0) + o.quantity;
  }
  Object.entries(outletCounts).forEach(([bucket, qty]) => {
    const [key, d] = bucket.split('|');
    items.push({ ...line(key, qty, d ? { ...ctx, diameterMm: Number(d) } : ctx),
      category: 'outlets' });
  });

  // ── Return air ─────────────────────────────────────────────────────────────
  if (design.returnDesign) {
    const grille = line('return_grille', design.returnDesign.returnCount, ctx);
    items.push({ ...grille, category: 'return' });
    // MMEM supply the grille and filter as one item. Only add a separate filter
    // line if the grille rate in use does not already cover it.
    if (!resolveCost('return_grille', ctx).includesFilter) {
      items.push({ ...line('return_filter', design.returnDesign.returnCount, ctx), category: 'return' });
    }
    items.push({ ...line('return_plenum', design.returnDesign.returnCount, ctx), category: 'return' });
    // The return duct is counted with the supply flex above, so it is not
    // added again here.
  }

  // ── Services ───────────────────────────────────────────────────────────────
  items.push({ ...line('drain_kit', 1, ctx), category: 'services' });
  if (design.drainPipeM) {
    items.push({ ...packLine('drain_pipe', design.drainPipeM, ctx), category: 'services' });
    items.push({ ...line('drain_insulation', Math.ceil(design.drainPipeM), ctx), category: 'services' });
    // Two elbows to leave the unit and two to discharge, plus one per 3 m run.
    items.push({ ...line('drain_elbow', 4 + Math.ceil(design.drainPipeM / 3), ctx), category: 'services' });
  }
  if (design.refrigerantPipeM) {
    items.push({ ...packLine('refrigerant_pipe', design.refrigerantPipeM, ctx), category: 'services' });
  }
  if (design.cableM) {
    items.push({ ...line('interconnect_cable', design.cableM, ctx), category: 'services' });
    items.push({ ...line('power_cable', design.cableM, ctx), category: 'services' });
  }
  items.push({ ...line('isolator', 1, ctx), category: 'services' });
  // One roll of tape per 8 m of duct, rounded up, plus the sundries allowance.
  if (totalDuctM > 0) {
    items.push({ ...line('duct_tape', Math.max(1, Math.ceil(totalDuctM / 8)), ctx), category: 'services' });
  }
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

  return summariseBom(items);
}

/**
 * Everything about a bill of materials that is DERIVED from its lines: the
 * money, the counts, and the warnings.
 *
 * This exists as one function because it has to run again after every estimator
 * edit. It used to be inline, so editing a line recomputed the totals but left
 * unpricedCount, placeholderCount and the warnings stale — an estimator who
 * entered the missing cost was still told the line had no cost, and (once the
 * quote gate was added) could never get past it.
 */
export function summariseBom(items) {
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
        unpricedLines.map(l => l.label).join(', ') +
        '. Ask the supplier to quote them, or enter a rate in HVAC Design ' +
        'Settings → Material rates.' });
  }

  // A size the supplier has not quoted is worth saying out loud even when a
  // placeholder covers it, because it is a buying problem, not just a pricing one.
  const offQuote = [...new Set(items
    .filter(i => i.diameterMm && MATERIAL_CATALOGUE[i.key]?.quotedDiameters
                 && !MATERIAL_CATALOGUE[i.key].quotedDiameters.includes(i.diameterMm)
                 && i.priceSource !== PRICE_SOURCE.NAC)
    .map(i => i.label))];
  if (offQuote.length) {
    warnings.push({ code: 'SIZE_NOT_ON_SUPPLIER_QUOTE', severity: 'CHECK',
      message: offQuote.length + ' size(s) are not on the supplier quote: ' +
        offQuote.join(', ') + '. Confirm availability and price before ordering.' });
  }

  const byCategory = {};
  for (const i of items) {
    byCategory[i.category] = round((byCategory[i.category] || 0) + (i.totalCost || 0), 2);
  }

  // What the placeholder lines are actually worth. On job-cost-plus-fee this
  // is the amount of the customer's price built on rates nobody at NAC has
  // confirmed — the number the estimator needs before sending a quote.
  const placeholderCost = round(placeholderLines.reduce((s, i) => s + (i.totalCost || 0), 0), 2);

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
    placeholderCost,
    placeholderLabels: placeholderLines.map(l => l.label),
    placeholderDetail: placeholderLines.map(l => ({ label: l.label, quantity: l.quantity,
                                                    unit: l.unit, unitCost: l.unitCost,
                                                    totalCost: l.totalCost })),
    unpricedCount: unpricedLines.length,
    unpricedLabels: unpricedLines.map(l => l.label),
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
  // Re-derive EVERYTHING from the new lines. Recomputing only the totals left
  // the counts and warnings describing a bill of materials that no longer
  // existed.
  return { ...bom, ...summariseBom(items) };
}
