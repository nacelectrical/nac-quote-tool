// NAC AI HVAC DESIGNER — PART 22: bill of materials.
// Every line is derived from the design, not typed twice. Quantities trace back
// to the duct network, outlet schedule, zone plan and return design.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { resolveCost, OUTLET_MATERIAL_KEY, PRICE_SOURCE, MATERIAL_CATALOGUE,
         QUOTED_SEPARATELY } from './materials.mjs';
import { btoBomLines, btoSpec } from './bto.mjs';
import { btoRateBook, resolveBtoPrice, BTO_PRICE_STATUS } from './bto-pricing.mjs';
import { damperBomLines } from './zone-dampers.mjs';

function line(key, quantity, ctx, extra = {}) {
  const r = resolveCost(key, ctx);
  const qty = round(Number(quantity), 2);
  return {
    key,
    label: r.label,
    unit: r.unit,
    quotedSeparately: QUOTED_SEPARATELY.includes(key),
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
  const ctx = { nacRates, btoRates: opts.btoRates || null };
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

  // Which duct feeds each room, for the outlet neck sizes further down.
  const branchDiameterByRoom = {};
  for (const sec of (design.network?.sections || [])) {
    const m = /^branch_(.+)$/.exec(sec.id || '');
    if (m && sec.diameterMm) branchDiameterByRoom[m[1]] = sec.diameterMm;
  }

  // ── MOTORISED ZONE DAMPERS, BY EXACT SIZE ──────────────────────────────
  //
  // Read straight off the damper COMPONENTS, which took their diameter from the
  // duct each one is fitted in. There is no generic line: a ø250 motor and a
  // ø300 motor are different part numbers at different prices, and a BOM that
  // says "zone motor × 5" cannot be ordered. Nick: "The BOM must state the
  // actual diameter. A generic damper line is not acceptable."
  //
  // There is no manual balancing damper line at all. Not on a main, not on a
  // BTO port, not on an outlet branch, not on a return.
  const dampers = design.zoneDampers || [];
  for (const row of damperBomLines(dampers, { nacRates: ctx.nacRates || null })) {
    items.push({ key: row.key, label: row.label, unit: row.unit, quantity: row.quantity,
      unitCost: row.unitCost, totalCost: row.totalCost, priced: row.priced,
      priceSource: row.priceSource, supplierCode: row.supplierCode,
      diameterMm: row.diameterMm, actuator: row.actuator, skuKey: row.skuKey,
      effectiveDate: row.effectiveDate, priceStatus: row.priceStatus,
      dampers: row.dampers,
      category: 'zoning', airSide: 'supply',
      note: 'Motorised zone control. The damper is the size of the duct it is ' +
            'fitted in; change the duct and this line changes with it.' });
  }
  // One 15 m zone lead per motorised damper.
  if (dampers.length) {
    items.push({ ...line('zone_cable', dampers.length, ctx), category: 'zoning' });
  }

  // ── Ductwork ───────────────────────────────────────────────────────────────
  const byDiameter = {};
  const fittingCounts = {};
  // A RUN OFF A BTO DOES NOT ALSO NEED A SADDLE COLLAR. The spigot it leaves
  // is part of the manifold. Counting both bought twelve butterfly take-offs
  // AND four fittings for the same eleven connections.
  const onAManifold = new Set((design.btos || [])
    .flatMap(b => b.ports.map(p => p.sectionId).filter(Boolean)));
  for (const s of (design.network?.sections || [])) {
    if (s.lengthM) byDiameter[s.diameterMm] = round((byDiameter[s.diameterMm] || 0) + s.lengthM, 2);
    for (const f of (s.fittings || [])) {
      if (f.type === 'takeoff' && onAManifold.has(s.id)) continue;
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

  // NO MANUAL BALANCING DAMPER. Nick: "Manual balancing dampers are not
  // required ... Only actual motorised zone dampers are permitted." The design
  // balances with duct size and motorised zone control, so a manual damper is
  // neither drawn, scheduled nor bought — the previous BOM carried ten of them
  // at $420 that nobody was going to install. `damper_open` is no longer
  // emitted by any router; the mapping is gone so a stale design cannot revive
  // it through the order either.
  const fittingMap = { supply_plenum: 'supply_plenum', y_piece: 'y_piece', reducer: 'reducer',
                       takeoff: 'takeoff', joiner: 'joiner' };
  Object.entries(fittingCounts).forEach(([type, qty]) => {
    const key = fittingMap[type];
    if (!key) return;                             // bends are part of the flex run
    const row = { ...line(key, qty, ctx), category: 'ductwork' };
    // THE SUPPLY PLENUM IS ORDERED AS IT IS DRAWN. A generic "supply plenum"
    // line against a drawing that shows a 1152 → 1440 mm fabricated transition
    // is a line the sheet metal shop cannot make. The arrangement is recorded
    // once in the design and read here, so the order and the sheet agree.
    if (type === 'supply_plenum' && design.supplyPlenum) {
      const a = design.supplyPlenum;
      row.airSide = 'supply';
      row.label = (a.kind === 'widened'
        ? 'Fabricated transition supply plenum — ' + a.flangeWidthMm + ' mm throat widening to ' +
          a.bodyWidthMm + ' mm'
        : 'Supply plenum — ' + a.bodyWidthMm + ' mm flush to the discharge') +
        ', ' + a.collarCount + ' × ø' + a.collarDiameterMm + ' collars in one row';
      row.note = a.description;
    }
    items.push(row);
  });

  // THE NAC BOM RULE: the order follows the REAL topology. A reducer is only
  // known once the tree has been sized — it is where a main steps down because
  // the air it still carries has dropped — so it is counted off the sized
  // sections rather than from a fitting list written before sizing. Counting it
  // the old way bought nothing for four reducers the drawing showed.
  const realReducers = (design.network?.sections || []).filter(s => s.reducerFrom).length;
  const alreadyCounted = fittingCounts.reducer || 0;
  if (realReducers > alreadyCounted) {
    items.push({ ...line('reducer', realReducers - alreadyCounted, ctx), category: 'ductwork',
      note: 'Where a main or major duct steps down. A take-off to outlet size is not a reducer.' });
  }

  // ── PHYSICAL BRANCH TAKE-OFFS ───────────────────────────────────────────
  // The fittings are real metal with a part number. They are counted off the
  // derived BTO entities — one line per inlet size and port count, because a
  // 400 three-port body and a 300 two-port body are different things to order.
  // EVERY LINE IS PRICED ON ITS OWN EXACT CONFIGURATION. There is no generic
  // BTO rate any more: `bto_400_250_250_250` and `bto_350_250_250_250` are two
  // different pieces of metal, and pricing one off the other is a guess that
  // ends up on an invoice.
  const btoBook = btoRateBook(ctx.btoRates || null);
  for (const row of btoBomLines(design.btos || [])) {
    const first = (design.btos || []).find(b => b.id === row.fittings[0]);
    const body = first?.body || null;
    const price = resolveBtoPrice(row.configKey, { book: btoBook });
    items.push({ ...line('bto_fitting', row.quantity, ctx),
      // The exact rate REPLACES the catalogue rate, and when there is no exact
      // rate the line carries no price at all rather than a borrowed one.
      unitCost: price.cost,
      totalCost: price.cost === null ? null : round(price.cost * row.quantity, 2),
      priced: price.cost !== null,
      priceSource: price.status === BTO_PRICE_STATUS.VERIFIED ? PRICE_SOURCE.SUPPLIER
        : price.status === BTO_PRICE_STATUS.PLACEHOLDER ? PRICE_SOURCE.PLACEHOLDER : null,
      supplierCode: price.sku,
      configKey: row.configKey,
      groupKey: row.groupKey,
      outletDiametersMm: row.outletDiametersMm,
      btoPrice: price,
      priceStatus: price.status,
      fabricator: price.supplier,
      quoteRef: price.quoteRef,
      effectiveDate: price.effectiveDate,
      // SUPPLY AIR, EXPLICITLY. A return box is priced on its own lines under
      // the return category and must never total into these.
      category: 'ductwork', airSide: 'supply',
      diameterMm: row.inletDiameterMm,
      label: row.label,
      portCount: row.portCount,
      fittings: row.fittings,
      // What the sheet metal shop is actually being asked for.
      bodyText: body?.bodyText || null,
      collarDiametersMm: body?.collarDiametersMm || null,
      requiredCollarRunMm: body?.requiredCollarRunMm ?? null,
      fabricationDescription: body?.bomDescription || null,
      dimensionsVerified: body ? body.verified : null,
      // ── THE COLLAR LAYOUT THE SHOP HAS TO MARK OUT ──────────────────────
      // Which face, which centre, what clearance. A body on this line is
      // fabrication-ready ONLY when somebody gave us the box and the collars
      // were laid out on it and fitted.
      bodyLengthMm: body?.bodyLengthMm ?? null,
      bodyWidthMm: body?.bodyWidthMm ?? null,
      bodyHeightMm: body?.bodyHeightMm ?? null,
      bodySource: body?.faceLayout?.bodySource || null,
      proposedBodyText: body?.proposedBodyText || null,
      collarFaceLayout: body?.faceLayout
        ? { pass: body.faceLayout.pass, validated: body.faceLayout.validated,
            status: body.faceLayout.status, multiFace: body.faceLayout.multiFace,
            facesUsed: body.faceLayout.facesUsed,
            collars: body.faceLayout.collars.map(c => ({
              portIndex: c.portIndex, face: c.face, faceLabel: c.faceLabel,
              nominalDiameterMm: c.nominalDiameterMm,
              outsideDiameterMm: c.outsideDiameterMm,
              centreUmm: c.centreUmm, centreVmm: c.centreVmm,
              edgeClearanceMm: c.edgeClearanceUmm,
              clearanceToPreviousMm: c.clearanceToPreviousMm,
              destination: c.destination })),
            unplaced: body.faceLayout.unplacedCollars }
        : null,
      fabricationReady: !!body?.layoutValidated,
      layoutStatus: body?.layoutStatus || null,
      note: 'Supply-air multi-spigot branch take-off. Not a saddle collar, not one ' +
            'per outlet, and never a return-air component.' +
            (body && !body.verified
              ? ' Body size is a PROPOSAL worked out from a collar-by-collar face ' +
                'layout, not a fabricator\u2019s standard body — confirm against the ' +
                'fabricator\u2019s bodies before ordering.' : '') +
            (body && body.verified && !body.layoutValidated
              ? ' THE COLLARS DO NOT FIT THIS BODY: ' +
                (body.issues || []).map(i => i.message).join(' ') : '') });
  }

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
    // THE GRILLE ON THE ORDER IS THE GRILLE ON THE DRAWING. The catalogue rate
    // is for one standard size; when the design specifies another — 600 x 400
    // here — the line has to say so, or the drawing and the order describe two
    // different pieces of metal.
    const spec = design.returnDesign.returns?.[0];
    const sizeText = spec ? spec.grilleWidthMm + ' x ' + spec.grilleHeightMm + ' mm' : null;
    const grille = line('return_grille', design.returnDesign.returnCount, ctx);
    const sameAsRate = !sizeText || grille.label.includes(sizeText.replace(' mm', ''));
    items.push({ ...grille, category: 'return', airSide: 'return',
      designedSize: sizeText,
      label: sizeText ? 'Return air grille and filter ' + sizeText : grille.label,
      note: sameAsRate ? undefined
        : 'Design calls for ' + sizeText + '. Rate shown is the catalogue\u2019s ' +
          'standard grille — confirm the price for this size.',
      rateIsForAnotherSize: !sameAsRate });
    // MMEM supply the grille and filter as one item. Only add a separate filter
    // line if the grille rate in use does not already cover it.
    if (!resolveCost('return_grille', ctx).includesFilter) {
      items.push({ ...line('return_filter', design.returnDesign.returnCount, ctx),
        category: 'return', airSide: 'return' });
    }
    // THE FAN-COIL RETURN BOX — ONE, not one per grille.
    //
    // This bought a "return plenum" per grille, which described a fitting on
    // each return path. There isn't one. Both return ducts land on the SAME box
    // on the return side of the fan coil, so that is one item, and the grille
    // count is not the box count. Nick: "Return-air plenum/box: 1."
    const rc = design.returnComponents;
    items.push({ ...line('return_plenum', 1, ctx), category: 'return', airSide: 'return',
      label: 'Fan-coil return-air plenum / box — ' +
             (rc?.plenum?.inletCount ?? design.returnDesign.returnCount) + ' × ø' +
             (rc?.plenum?.inletDiameterMm ?? design.returnDesign.duct?.diameterMm ?? '?') +
             ' inlet',
      note: 'One box on the return side of the fan coil, taking every return duct. ' +
            'Not a BTO and not counted with the supply fittings.' });
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
  // A line NAC quote separately carries no rate ON PURPOSE. It is not a price
  // somebody forgot, so it must not block the quote the way a genuine hole
  // does — but it still appears on the bill of materials saying what it is.
  const separateLines = items.filter(i => i.quotedSeparately);
  const unpricedLines = items.filter(i => !i.priced && !i.quotedSeparately);

  const warnings = [];
  if (separateLines.length) {
    warnings.push({ code: 'QUOTED_SEPARATELY', severity: 'CHECK',
      message: separateLines.map(l => l.label).join(', ') +
        ' carries no rate here because NAC quote it separately. Add it to the quote as its own ' +
        'line — the price below does not include it.' });
  }
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
    quotedSeparatelyCount: separateLines.length,
    quotedSeparatelyLabels: separateLines.map(l => l.label),
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
