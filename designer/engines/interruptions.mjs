// NAC AI HVAC DESIGNER — WHEN TO INTERRUPT THE ESTIMATOR.
//
// The whole point of QUICK QUOTE MODE is that an estimator uploads a plan and
// the tool does the job. So the question this module answers is the narrow one:
//
//     WHAT IS GENUINELY MISSING THAT ONLY A HUMAN CAN SUPPLY?
//
// Anything answerable from the floor plan, the job record, NAC's defaults, the
// supplier data or HVAC Design Settings is NOT an interruption. The tool
// already knows it, and asking anyway is how a five-minute quote turns back
// into engineering software.
//
// An interruption has to earn its place by being one of:
//
//   BLOCKING   the quote would be wrong or impossible without an answer —
//              a missing supplier cost, an unmeasurable room, a static
//              pressure check that could not be carried out
//   CONFIRM    the tool has an answer but a person must own it — a
//              three-phase unit on an unconfirmed supply, a placeholder rate
//              walking into a customer's price, an auto-generated duct route
//   NOTE       worth seeing on the review screen, never worth stopping for
//
// Each item says what is wrong, what it costs if ignored, and where to fix it,
// because an interruption the estimator cannot act on is just an alarm.
//
// This module is PURE. It reads a design and returns a list. It fixes nothing,
// assumes nothing, and invents nothing.

import { SEVERITY } from './warnings.mjs';
import { isConditionedRoom, needsClassificationReview } from './classify.mjs';
import { round } from './units.mjs';

export const INTERRUPT = { BLOCKING: 'BLOCKING', CONFIRM: 'CONFIRM', NOTE: 'NOTE' };

/** Where an interruption is fixed, so the review screen can offer one click. */
export const FIX_IN = {
  ROOMS: 'rooms', EQUIPMENT: 'equipment', DUCTWORK: 'ductwork', PLAN: 'plan',
  MATERIALS: 'materials', FINANCIALS: 'financials', WARNINGS: 'warnings', SETTINGS: 'settings'
};

/**
 * @param {Array} covers warning codes this interruption already speaks for, so
 *        the same problem is never shown twice in different words. A blocker
 *        listed twice reads as two problems and costs the estimator a hunt.
 */
function item(level, id, title, detail, fixIn, extra = {}) {
  return { level, id, title, detail, fixIn, covers: extra.covers || [], ...extra };
}

/**
 * Everything that genuinely needs the estimator, worst first.
 *
 * @param {Object} design a design that has been through runPipeline
 * @returns {{blocking:Array, confirm:Array, notes:Array, all:Array,
 *            canQuote:Boolean, canAutoProceed:Boolean, summary:String}}
 */
export function collectInterruptions(design, opts = {}) {
  const d = design || {};
  const out = [];

  // ── The plan itself ───────────────────────────────────────────────────────
  if (!d.plan) {
    out.push(item(INTERRUPT.BLOCKING, 'NO_PLAN', 'No floor plan uploaded',
      'Upload the plan and the tool takes it from there.', FIX_IN.PLAN));
    // Nothing downstream is meaningful yet.
    return finish(out);
  }
  // RULE 4 — calibration is asked for only when a CONDITIONED room actually
  // needs a measurement taken off the image. A plan whose conditioned rooms all
  // carry printed dimensions does not need it, and a bathroom with no readable
  // size is never a reason to demand it.
  const calReq = d.calibrationRequirement;
  if (!d.calibration && calReq?.required !== false) {
    out.push(item(INTERRUPT.BLOCKING, 'NO_CALIBRATION', 'The plan has not been calibrated',
      (calReq?.reason ? calReq.reason + ' ' : '') +
      'An uploaded screenshot does not keep its original A3 or A4 scale, so those rooms ' +
      'cannot be measured until two known points are set.',
      FIX_IN.PLAN, { covers: ['MISSING_PLAN_CALIBRATION'] }));
  }

  // ── Rooms the tool could not measure ──────────────────────────────────────
  // Named individually: "3 rooms need checking" makes an estimator hunt.
  // `confidenceBand` is the band ('HIGH' | 'MEDIUM' | 'LOW'); `confidence` is a
  // percentage. Reading the number as a band is how a low-confidence room slips
  // through as merely unverified, which is the opposite of what has to happen.
  const rooms = d.rooms || [];
  const settled = (r) => r.status === 'Verified' || r.status === 'Manual';
  const unmeasured = rooms.filter(r => isConditionedRoom(r) && !r.areaSqM);
  const lowConfidence = rooms.filter(r => isConditionedRoom(r) && r.areaSqM &&
    r.confidenceBand === 'LOW' && !settled(r));
  // A HIGH-confidence read off a dimension chain printed on the plan IS
  // reliably answered by the plan, so quick mode accepts it and says so on the
  // review screen rather than asking. Only MEDIUM is worth a glance.
  const unverified = rooms.filter(r => isConditionedRoom(r) && r.areaSqM && !settled(r) &&
    r.confidenceBand !== 'LOW' && r.confidenceBand !== 'HIGH');

  // RULE 5 — ONE exact reason per room. A room with no readable size raises a
  // missing-dimension warning AND a low-confidence warning AND a
  // half-read-rooms warning, and an estimator faced with five red lines about
  // two rooms cannot see that the job is two numbers away from a design. Each
  // room speaks once and says which room it is.
  for (const r of unmeasured) {
    out.push(item(INTERRUPT.BLOCKING, 'ROOM_UNMEASURED:' + r.id,
      'DESIGN BLOCKED — ' + r.label.toUpperCase() + ' DIMENSIONS REQUIRED',
      'No size could be taken from the plan for ' + r.label + ', so this room is contributing ' +
      'nothing to the load. Type its size, or draw its boundary.', FIX_IN.ROOMS,
      { roomId: r.id,
        covers: ['ROOM_MISSING_A_DIMENSION', 'LOW_ROOM_MEASUREMENT_CONFIDENCE'] }));
  }
  for (const r of lowConfidence) {
    out.push(item(INTERRUPT.BLOCKING, 'ROOM_LOW_CONFIDENCE:' + r.id,
      'DESIGN BLOCKED — ' + r.label.toUpperCase() + ' DIMENSIONS NEED CONFIRMING',
      'Read at LOW confidence (' + round(r.areaSqM, 1) + ' m²). Sizing a system on a number ' +
      'the tool is not sure of is how a job gets undersized. Confirm or correct it.',
      FIX_IN.ROOMS, { roomId: r.id, covers: ['LOW_ROOM_MEASUREMENT_CONFIDENCE'] }));
  }

  // RULE 1 — a room the tool could not classify is a question about the JOB,
  // not about a measurement, so it is asked plainly and once. Excluded rooms
  // never reach here at all.
  const toClassify = rooms.filter(needsClassificationReview);
  if (toClassify.length) {
    out.push(item(INTERRUPT.CONFIRM, 'ROOMS_UNCLASSIFIED',
      toClassify.length + ' room' + (toClassify.length > 1 ? 's' : '') + ' need a yes or no',
      toClassify.map(r => r.label).join(', ') + '. NAC\'s rules do not settle ' +
      (toClassify.length > 1 ? 'these' : 'this one') + '. Say whether the job conditions ' +
      (toClassify.length > 1 ? 'them' : 'it') + '.',
      FIX_IN.ROOMS, { roomIds: toClassify.map(r => r.id) }));
  }
  if (unverified.length) {
    // A believable measurement that is not quite certain — one line, not one
    // each, and one press to accept the lot.
    out.push(item(INTERRUPT.CONFIRM, 'ROOMS_UNVERIFIED',
      unverified.length + ' room' + (unverified.length > 1 ? 's' : '') + ' read at medium confidence',
      unverified.map(r => r.label).join(', ') + '. The tool measured these off the plan and is ' +
      'reasonably confident. A glance is enough — confirming accepts all of them.',
      FIX_IN.ROOMS, { roomIds: unverified.map(r => r.id) }));
  }

  // ── Equipment ─────────────────────────────────────────────────────────────
  const unit = d.selectedUnit;
  if (d.stage && d.stage !== 'awaiting_room_verification' && !unit) {
    out.push(item(INTERRUPT.BLOCKING, 'NO_UNIT', 'No unit could be selected',
      'Nothing in the catalogue matches this load with a price against it.', FIX_IN.EQUIPMENT));
  }
  if (unit && (unit.supplierCost === null || unit.supplierCost === undefined)) {
    out.push(item(INTERRUPT.BLOCKING, 'UNIT_NO_COST',
      'Supplier cost missing for ' + unit.brandName + ' ' + unit.model,
      'This model is not on the MMEM price list loaded here. On cost-plus-fee the job cost ' +
      'is wrong without it, so the quote cannot be built. Enter the trade cost or pick a ' +
      'model that has one.', FIX_IN.EQUIPMENT, { covers: ['MISSING_SUPPLIER_COST'] }));
  }
  // Three phase is a site fact, not a design decision, and it is the expensive
  // one to get wrong — a three-phase unit on a single-phase house is a dead job.
  if (unit && /3/.test(String(unit.phase || '')) && !d.sitePhase) {
    out.push(item(INTERRUPT.CONFIRM, 'PHASE_UNCONFIRMED', 'Electrical phase not confirmed',
      unit.brandName + ' ' + unit.model + ' is a ' + unit.phase + ' unit. Confirm the site ' +
      'actually has three-phase supply before this goes out.', FIX_IN.EQUIPMENT));
  }

  // ── Static pressure ───────────────────────────────────────────────────────
  // The engine reports three states and "not completed" is not a pass.
  if (d.pressure && d.pressure.checkCompleted === false) {
    out.push(item(INTERRUPT.BLOCKING, 'PRESSURE_NOT_COMPLETED',
      'Static pressure check could not be completed',
      d.pressure.statusLabel || 'No manufacturer available static pressure is on file for this ' +
      'model, so the check could not be carried out. Enter the figure from the data sheet.',
      FIX_IN.EQUIPMENT, { covers: ['STATIC_PRESSURE_CHECK_NOT_COMPLETED'] }));
  } else if (d.pressure && d.pressure.status === 'fail') {
    out.push(item(INTERRUPT.BLOCKING, 'PRESSURE_FAIL', 'The system will not make its airflow',
      'Calculated ' + round(d.pressure.estimatedRequirementPa, 0) + ' Pa against ' +
      round(d.pressure.unitAvailableStaticPa, 0) + ' Pa available. Duct sizes or the unit ' +
      'have to change.', FIX_IN.DUCTWORK,
      { covers: ['ESTIMATED_PRESSURE_EXCEEDS_UNIT_CAPABILITY'] }));
  }

  // ── Duct routes ───────────────────────────────────────────────────────────
  const sections = d.network?.sections || [];
  const unmeasuredDucts = sections.filter(s => s.lengthMm === null || s.lengthMm === undefined);
  if (sections.length && unmeasuredDucts.length === sections.length) {
    out.push(item(INTERRUPT.BLOCKING, 'NO_DUCT_LENGTHS', 'No duct lengths yet',
      'Nothing has been routed or measured, so there is no ductwork on the bill of materials ' +
      'and the pressure figure is only the fittings.', FIX_IN.DUCTWORK));
  } else if (unmeasuredDucts.length) {
    out.push(item(INTERRUPT.CONFIRM, 'SOME_DUCT_LENGTHS',
      unmeasuredDucts.length + ' duct run' + (unmeasuredDucts.length > 1 ? 's have' : ' has') + ' no length',
      unmeasuredDucts.slice(0, 6).map(s => s.destination || s.id).join(', ') +
      (unmeasuredDucts.length > 6 ? ' and others' : '') +
      '. Those metres are missing from the quote.', FIX_IN.DUCTWORK));
  }
  // An automatically routed layout is a suggestion, always.
  if (d.autoRoute?.generated) {
    out.push(item(INTERRUPT.CONFIRM, 'AUTO_ROUTE_UNVERIFIED', 'Route requires site verification',
      'The duct layout was generated automatically. A floor plan does not show trusses, ' +
      'bulkheads, beams or existing services, so the route has to be checked against the ' +
      'roof space before anyone orders material.', FIX_IN.DUCTWORK,
      { confidence: d.autoRoute.confidence || null }));
  }

  // ── Money ─────────────────────────────────────────────────────────────────
  const bom = d.bom;
  if (bom?.unpricedCount) {
    out.push(item(INTERRUPT.BLOCKING, 'BOM_UNPRICED',
      bom.unpricedCount + ' material line' + (bom.unpricedCount > 1 ? 's have' : ' has') + ' no price',
      (bom.unpricedLabels || []).slice(0, 6).join(', ') +
      '. A quote built on these is short by whatever they are worth.', FIX_IN.MATERIALS,
      { covers: ['MATERIAL_PRICE_MISSING', 'PRICE_MISSING_COST_LINES'] }));
  }
  if (bom?.placeholderCount) {
    out.push(item(INTERRUPT.CONFIRM, 'BOM_PLACEHOLDER',
      bom.placeholderCount + ' material rate' + (bom.placeholderCount > 1 ? 's are' : ' is') + ' a shipped placeholder',
      'Worth ' + (bom.placeholderValue != null ? '$' + round(bom.placeholderValue, 2) : 'an unconfirmed amount') +
      ' of this job. These are NAC-supplied starting values, not confirmed prices, and on ' +
      'cost-plus-fee they go straight to the customer.', FIX_IN.MATERIALS,
      { covers: ['MATERIAL_PRICE_PLACEHOLDER', 'COST_BASED_ON_PLACEHOLDERS',
                 'PRICE_BASED_ON_PLACEHOLDER_RATES'] }));
  }
  if (d.commercials && (d.commercials.jobFee === null || d.commercials.jobFee === undefined)) {
    out.push(item(INTERRUPT.BLOCKING, 'NO_JOB_FEE', 'No job fee set',
      'The fee is the entire margin on a cost-plus job. Without it the quote is sold at cost.',
      FIX_IN.FINANCIALS));
  }

  // ── Anything critical the engines raised that is not already covered ──────
  // Anything already said above, in plainer words, is not said again.
  const covered = new Set(out.flatMap(x => [x.code, ...(x.covers || [])]).filter(Boolean));
  for (const w of (d.warnings || [])) {
    if (w.severity !== SEVERITY.CRITICAL || w.acknowledged) continue;
    if (covered.has(w.code)) continue;
    if (out.some(x => x.id.startsWith(w.code))) continue;
    out.push(item(INTERRUPT.BLOCKING, 'WARNING:' + w.code, w.message,
      'Raised by the ' + (w.stage || 'design') + ' engine and not yet dealt with.',
      FIX_IN.WARNINGS, { code: w.code }));
  }

  return finish(out);
}

function finish(out) {
  const blocking = out.filter(x => x.level === INTERRUPT.BLOCKING);
  const confirm = out.filter(x => x.level === INTERRUPT.CONFIRM);
  const notes = out.filter(x => x.level === INTERRUPT.NOTE);
  // RULE 5 — the ONE line the quick screen shows when the design will not run.
  // "Calibration required" when the real issue is one bedroom is the wording
  // that sent an estimator hunting round the whole plan. If a single room is
  // in the way, the headline names that room.
  // A room the tool cannot measure outranks everything else in the headline,
  // including "the plan has not been calibrated" — calibrating is only ONE of
  // the ways to settle it, and naming it instead sends the estimator off to
  // fix the whole plan when the real answer is two numbers. If rooms are in
  // the way, the rooms are the headline.
  const roomBlocks = blocking.filter(b => b.roomId);
  const blockReason = blocking.length === 0 ? null
    : roomBlocks.length
      ? 'DESIGN BLOCKED — ' +
        roomBlocks.map(b => b.title.replace(/^DESIGN BLOCKED — /, '')).join('  ·  ')
      : blocking.length === 1 ? blocking[0].title
      : blocking[0].title;

  return {
    blocking, confirm, notes, all: out,
    // The single exact reason the design cannot be produced, or null.
    blockReason,
    blockCount: blocking.length,
    // Can a quote be produced at all?
    canQuote: blocking.length === 0,
    // Can the tool carry straight on to the review screen without stopping?
    canAutoProceed: blocking.length === 0 && confirm.length === 0,
    summary: blocking.length
      ? blocking.length + ' thing' + (blocking.length > 1 ? 's' : '') + ' must be sorted before this can be quoted'
      : confirm.length
        ? confirm.length + ' thing' + (confirm.length > 1 ? 's' : '') + ' to confirm'
        : 'Nothing needs you — the design is ready to review'
  };
}
