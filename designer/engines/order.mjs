// NAC AI HVAC DESIGNER — WHAT TO ORDER, AND WHAT TO INSTALL.
//
//   CUSTOMER ACCEPTS → READY TO ORDER → supplier order list + installer sheet
//
// Once a customer has signed, the estimator's question changes from "what does
// this cost?" to "what do I buy and what does the installer need?". Those are
// two different documents and this builds both from the design that was
// actually quoted — never from a fresh recalculation, because the job that was
// sold is the job that gets installed.
//
// THE SUPPLIER ORDER LIST IS A BUYING DOCUMENT. It orders in the units NAC buy
// in: flex duct by the 6 m length, not by the metre. Anything with no
// confirmed price is listed and flagged rather than quietly left off, because
// a line missing from an order is a second trip to the wholesaler.
//
// This module is PURE and it invents nothing. If the design does not carry a
// supplier code, the line says so.

import { round } from './units.mjs';

export const READY_TO_ORDER = 'READY TO ORDER';

/** Job states, in the order a job moves through them. */
export const JOB_STATE = {
  DESIGNED: 'designed',
  QUOTED: 'quoted',
  ACCEPTED: 'accepted',
  READY_TO_ORDER: 'ready_to_order'
};

/**
 * Has the customer accepted, and is this job ready to be bought?
 *
 * Acceptance is recorded on the QUOTE, not the design, because the customer
 * signs a quote. A design whose quote has been accepted is ready to order.
 */
export function jobState(design, quoteRow = null) {
  if (quoteRow?.accepted) return JOB_STATE.READY_TO_ORDER;
  if (design?.quoteId) return JOB_STATE.QUOTED;
  if (design?.approved) return JOB_STATE.DESIGNED;
  return JOB_STATE.DESIGNED;
}

/**
 * What to buy.
 *
 * Grouped the way a wholesaler's counter works: the equipment, then the
 * ductwork, then the fittings, then the electrical and sundries. Quantities are
 * in PURCHASE units — a 6 m length of flex is one length, not six metres.
 */
export function supplierOrderList(design) {
  const d = design || {};
  const bom = d.bom;
  if (!bom?.items?.length) {
    return { ready: false, groups: [], lines: [], warnings: [
      { code: 'NO_BOM', severity: 'CRITICAL', message: 'This design has no bill of materials to order from.' }
    ] };
  }

  const GROUP = {
    equipment: 'Equipment',
    ductwork: 'Ductwork',
    outlets: 'Outlets and grilles',
    zoning: 'Zoning',
    services: 'Electrical, drain and sundries'
  };

  const lines = bom.items.map(i => ({
    key: i.key,
    label: i.label,
    // What is actually ordered: whole lengths where NAC buy whole lengths.
    quantity: i.quantity,
    unit: i.unit,
    supplierCode: i.supplierCode || null,
    diameterMm: i.diameterMm ?? null,
    // The metres behind a pack quantity, so the counter can be checked.
    metresRequired: i.metresRequired ?? null,
    offcutM: i.offcutM ?? null,
    unitCost: i.unitCost ?? null,
    totalCost: i.totalCost ?? null,
    priced: i.priced !== false && i.unitCost !== null && i.unitCost !== undefined,
    quotedSeparately: !!i.quotedSeparately,
    group: GROUP[i.category] || 'Other',
    // A line NAC has no confirmed price for still gets ordered — it just says so.
    priceSource: i.priceSource || null
  })).filter(l => l.quantity > 0);

  // The unit itself is not a BOM material line on every design, so it is added
  // explicitly. An installer cannot fit a system nobody ordered.
  if (d.selectedUnit && !lines.some(l => l.key === 'indoor_unit')) {
    lines.unshift({
      key: 'system', label: d.selectedUnit.brandName + ' ' + d.selectedUnit.model +
        ' — ' + d.selectedUnit.capacityKw + ' kW ' + d.selectedUnit.phase + ' ducted system',
      quantity: 1, unit: 'set',
      supplierCode: d.selectedUnit.supplierCode || null,
      unitCost: d.selectedUnit.supplierCost ?? null,
      totalCost: d.selectedUnit.supplierCost ?? null,
      priced: d.selectedUnit.supplierCost !== null && d.selectedUnit.supplierCost !== undefined,
      group: GROUP.equipment
    });
  }

  const groups = [];
  for (const name of [...new Set(lines.map(l => l.group))]) {
    const items = lines.filter(l => l.group === name);
    groups.push({
      name, items,
      lineCount: items.length,
      cost: round(items.reduce((s, l) => s + (l.totalCost || 0), 0), 2)
    });
  }

  const unpriced = lines.filter(l => !l.priced && !l.quotedSeparately);
  const separate = lines.filter(l => l.quotedSeparately);
  const noCode = lines.filter(l => !l.supplierCode && !l.quotedSeparately);

  const warnings = [];
  if (unpriced.length) warnings.push({ code: 'ORDER_LINE_UNPRICED', severity: 'CHECK',
    message: unpliceLabels(unpriced) + ' have no confirmed price. They are on the order — ' +
             'check what they actually cost before it goes in.' });
  if (separate.length) warnings.push({ code: 'ORDER_LINE_QUOTED_SEPARATELY', severity: 'CHECK',
    message: unpliceLabels(separate) + ' are quoted separately and are NOT priced here. ' +
             'Order them against their own quote.' });
  if (noCode.length) warnings.push({ code: 'ORDER_LINE_NO_CODE', severity: 'INFO',
    message: noCode.length + ' line(s) have no supplier code on file, so they have to be ' +
             'described at the counter.' });

  return {
    ready: true,
    designId: d.id || null,
    quoteId: d.quoteId || null,
    customer: d.customer?.name || null,
    site: d.customer?.address || d.job?.siteAddress || null,
    groups,
    lines,
    lineCount: lines.length,
    totalCost: round(lines.reduce((s, l) => s + (l.totalCost || 0), 0), 2),
    unpricedCount: unpriced.length,
    warnings
  };
}

function unpliceLabels(lines) {
  const names = lines.slice(0, 5).map(l => l.label);
  return names.join(', ') + (lines.length > 5 ? ' and ' + (lines.length - 5) + ' more' : '');
}

/**
 * What the installer needs on site.
 *
 * Not a cost document — there is not a dollar figure anywhere in it. It is the
 * system, the duct schedule with sizes and lengths, where the outlets and zones
 * go, and the things the estimator could not settle from the plan.
 */
export function installerSheet(design) {
  const d = design || {};
  const sections = (d.network?.sections || []);

  const ducts = sections.map(s => ({
    id: s.id,
    role: s.role,
    serves: s.destination,
    diameterMm: s.diameterMm,
    lengthM: s.lengthM,
    airflowLs: s.airflowLs,
    zone: s.zone || null,
    reducer: s.reducerFrom ? s.reducerFrom + ' → ' + s.reducerTo : null,
    locked: !!s.locked
  }));

  const outlets = (d.outlets?.rows || []).map(o => ({
    room: o.label, quantity: o.quantity, type: o.typeLabel,
    perOutletLs: o.perOutletLs
  }));

  const zones = (d.zones?.zones || []).map(z => ({
    name: z.name || z.id,
    rooms: (z.roomNames || z.roomIds || []).join(', '),
    airflowLs: z.airflowLs ?? null
  }));

  // Everything the tool could not settle, carried through to site. An installer
  // finding this out on the roof is a callback.
  const toVerify = [];
  if (d.autoRoute?.generated) {
    toVerify.push('The duct layout was generated automatically. Verify it against the roof ' +
                  'space, trusses, beams and existing services before installing.');
  }
  for (const w of (d.routeScore?.warnings || [])) {
    if (w.code !== 'UNVERIFIED_ROUTE') toVerify.push(w.message);
  }
  if (d.pressure?.checkCompleted === false) {
    toVerify.push(d.pressure.statusLabel ||
      'Static pressure check was not completed — no manufacturer figure on file.');
  }
  if (d.autoRoute?.plenum?.source && d.autoRoute.plenum.source !== 'placed') {
    toVerify.push('The supply plenum position was assumed, so trunk lengths are approximate.');
  }

  return {
    designId: d.id || null,
    quoteId: d.quoteId || null,
    customer: d.customer?.name || null,
    site: d.customer?.address || d.job?.siteAddress || null,
    system: d.selectedUnit
      ? d.selectedUnit.brandName + ' ' + d.selectedUnit.model + ' — ' +
        d.selectedUnit.capacityKw + ' kW ' + d.selectedUnit.phase
      : null,
    controller: d.controller?.name || null,
    totalAirflowLs: d.airflow?.allocatedAirflowLs ?? null,
    estimatedStaticPa: d.pressure?.estimatedRequirementPa ?? null,
    unitAvailableStaticPa: d.pressure?.unitAvailableStaticPa ?? null,
    returnDesign: d.returnDesign
      ? { count: d.returnDesign.returnCount,
          grille: d.returnDesign.returns?.[0]?.grilleSize || null,
          duct: d.returnDesign.duct?.diameterMm || null,
          lengthM: d.returnDesign.duct?.lengthM ?? null }
      : null,
    ducts,
    outlets,
    zones,
    dampers: (d.zoneDampers || []).map(z => ({ zone: z.zone, serves: z.roomId })),
    toVerify,
    routeConfidence: d.autoRoute?.confidence || null,
    // No money on an installer's sheet. Not a single figure.
    containsPricing: false
  };
}
