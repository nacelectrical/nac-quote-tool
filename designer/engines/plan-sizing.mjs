// ─────────────────────────────────────────────────────────────────────────────
// PRELIMINARY SIZING, AND WHAT IT IS ALLOWED TO CALL ITSELF
//
// Nick, 4 November 2026: "NAC's previous 145 W/m² and 50 L/s per kW rules may
// be available as clearly labelled, configurable estimating methods. Check
// current settings before using them. Do not present these rules as a
// detailed engineering calculation or manufacturer performance data."
//
// That last sentence is the whole design of this file. Two numbers come out of
// here and they are not the same kind of thing:
//
//   AN ESTIMATING RULE is arithmetic over a floor area. 145 W/m² is a number
//   NAC chose from experience; it is not a heat load calculation, it does not
//   know where the windows are, and it must never be printed as though it
//   does. Every figure derived from one carries `method`, the rule's own
//   label, and `isEstimate: true`.
//
//   A MEASUREMENT is what the plan actually says. An area read off a printed
//   dimension is a fact about the drawing. The rooms engine already grades
//   these (verified_architectural, dimension_chain, calibrated_geometry,
//   manual) and refuses to size off a room with no source.
//
// Nothing here invents a room, a dimension or a capacity, and nothing here
// talks to a language model. The plan reader does that, separately, and is
// forbidden from doing arithmetic.
//
// ── WHAT COMES OUT ──────────────────────────────────────────────────────────
//   · the rooms being conditioned, and their areas
//   · the rooms whose measurement is uncertain or missing, and why
//   · the ceiling height and the other assumptions in force
//   · a preliminary load per room and for the system
//   · a recommended capacity, with the rule that produced it named
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_SETTINGS } from './settings.mjs';
import { systemLoad, legacySizing, roomLoad, describeAssumptions } from './loads.mjs';
import { sizableRooms, conditionedRooms, totalConditionedArea, crossCheckFloorArea,
         summariseRoomMeasurements } from './rooms.mjs';
import { round } from './units.mjs';

/**
 * The estimating methods NAC may size with.
 *
 * Both are RULES OF THUMB and both say so. `perRoom` is the detailed
 * calculation and is not in here, because it is not a rule of thumb — it is in
 * loads.mjs and it carries its own assumptions.
 */
export const ESTIMATING_RULES = Object.freeze({
  AREA_RULE: 'area_rule',
  PER_ROOM: 'per_room'
});

/** Which rule a figure came from, in words a proposal could print. */
export function methodLabel(method, settings = DEFAULT_SETTINGS) {
  if (method === ESTIMATING_RULES.AREA_RULE) {
    return 'NAC estimating rule — ' + settings.load.baseWattsPerM2
      + ' W/m² of conditioned floor area';
  }
  return 'Room-by-room estimate — floor area with allowances for ceiling '
    + 'height, glazing, orientation and occupancy';
}

const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Airflow at NAC's own rule.
 *
 * Nick's rule is 50 L/s per kW. It is a SIZING SANITY CHECK and a way of
 * talking about the system; it is not a duct calculation and there is no duct
 * calculation here any more. It is returned so the screen can show it, labelled
 * as the rule it is, and it is configurable.
 */
export function ruleAirflowLs(kw, settings = DEFAULT_SETTINGS) {
  const perKw = n(settings?.load?.litresPerSecondPerKw) ?? 50;
  const k = n(kw);
  if (k === null || k <= 0) return null;
  return {
    litresPerSecond: round(k * perKw, 0),
    perKw,
    method: ESTIMATING_RULES.AREA_RULE,
    label: 'NAC estimating rule — ' + perKw + ' L/s per kW',
    isEstimate: true,
    note: 'An indicative air volume for the system as a whole. It is not a duct '
      + 'calculation and nothing is sized from it.'
  };
}

/**
 * Everything the Plan and rooms step needs to show.
 *
 * @param {Array}  rooms     rooms as the rooms engine builds them
 * @param {object} opts
 * @param {object} opts.settings
 * @param {string} opts.method        which estimating rule leads
 * @param {number} opts.printedFloorAreaSqM  the sheet's own under-roof area
 * @param {object} opts.override      { designKw, reason, by, at }
 */
export function preliminarySizing(rooms, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const method = opts.method === ESTIMATING_RULES.AREA_RULE
    ? ESTIMATING_RULES.AREA_RULE : ESTIMATING_RULES.PER_ROOM;
  const all = Array.isArray(rooms) ? rooms : [];

  // ── WHO IS IN, AND WHO CANNOT BE ──────────────────────────────────────
  // `sizableRooms` is conditioned rooms whose measurement is good enough to
  // size from. A conditioned room that is NOT sizable is the interesting
  // case: it is in the job and nobody knows how big it is.
  const conditioned = conditionedRooms(all);
  const sizable = sizableRooms(all, { allowOverride: !!opts.allowOverride });
  const sizableIds = new Set(sizable.map(r => r.id));
  const unmeasured = conditioned.filter(r => !sizableIds.has(r.id)).map(r => ({
    id: r.id,
    label: r.label,
    reason: r.measurement?.source
      ? 'Measured from ' + r.measurement.source + ', which is not good enough to size from.'
      : 'No dimension has been read or entered for this room.',
    areaSqM: n(r.areaSqM),
    confidence: r.measurement?.confidence ?? null
  }));

  const areaSqM = totalConditionedArea(sizable);

  // ── THE TWO ESTIMATES, BOTH SHOWN ─────────────────────────────────────
  // NAC's rule and the room-by-room estimate are both produced every time.
  // Showing one and hiding the other is how a number stops being questioned.
  const rule = legacySizing(areaSqM, settings);
  const detailed = sizable.length ? systemLoad(sizable, { ...opts, settings }) : null;

  const ruleKw = round(rule.watts / 1000, 2);
  const detailedKw = detailed ? detailed.designKw : null;
  const chosenKw = method === ESTIMATING_RULES.AREA_RULE ? ruleKw : (detailedKw ?? ruleKw);

  // ── AN OVERRIDE KEEPS WHAT IT OVERRODE ────────────────────────────────
  // Nick: "Allow recorded installer overrides while retaining the original
  // calculation and reason." The calculated figure is never replaced; the
  // override sits beside it with a name on it.
  const ov = opts.override || null;
  const overrideKw = ov ? n(ov.designKw) : null;
  const overridden = overrideKw !== null && overrideKw > 0;

  return {
    method,
    methodLabel: methodLabel(method, settings),
    /** Every figure below is an ESTIMATE. Nothing here is a heat load. */
    isEstimate: true,

    rooms: sizable.map(r => {
      const load = detailed
        ? detailed.rooms.find(x => x.roomId === r.id || x.id === r.id)
        : null;
      return {
        id: r.id,
        label: r.label,
        areaSqM: n(r.areaSqM),
        source: r.measurement?.source || null,
        confidence: r.measurement?.confidence ?? null,
        coolingW: load ? load.coolingW : round((n(r.areaSqM) || 0)
          * settings.load.baseWattsPerM2, 0),
        shareOfTotalPct: load ? load.shareOfTotal : null
      };
    }),
    excluded: all.filter(r => !r.conditioned).map(r => ({ id: r.id, label: r.label })),
    unmeasured,

    totalConditionedAreaSqM: areaSqM,
    roomCount: sizable.length,

    estimates: {
      areaRule: { kw: ruleKw, wattsPerM2: rule.wattsPerM2,
                  label: methodLabel(ESTIMATING_RULES.AREA_RULE, settings),
                  isEstimate: true },
      perRoom: detailedKw === null ? null
        : { kw: detailedKw, averageWattsPerM2: detailed.averageWattsPerM2,
            label: methodLabel(ESTIMATING_RULES.PER_ROOM, settings),
            isEstimate: true }
    },
    /** How far apart the two are. A wide gap is a prompt to check the inputs. */
    varianceVsRulePct: (detailedKw !== null && ruleKw > 0)
      ? round(((detailedKw - ruleKw) / ruleKw) * 100, 1) : null,

    recommendedKw: overridden ? overrideKw : chosenKw,
    calculatedKw: chosenKw,
    override: overridden ? {
      designKw: overrideKw,
      reason: String(ov.reason || '').trim(),
      by: String(ov.by || '').trim(),
      at: ov.at || null,
      /** What it replaced, kept so the decision can always be read back. */
      replaced: { designKw: chosenKw, method, methodLabel: methodLabel(method, settings) }
    } : null,

    airflow: ruleAirflowLs(overridden ? overrideKw : chosenKw, settings),
    assumptions: describeAssumptions(settings, opts),
    measurementSummary: summariseRoomMeasurements(all),
    floorAreaCrossCheck: opts.printedFloorAreaSqM
      ? crossCheckFloorArea(all, opts.printedFloorAreaSqM) : null
  };
}

/**
 * Is this sizing fit to choose equipment against?
 *
 * Not a gate on quoting — NAC can quote a job sized off nothing but experience
 * — but the screen has to be able to say what is thin about it.
 */
export function sizingReadiness(sizing) {
  const notes = [];
  if (!sizing || !sizing.roomCount) {
    notes.push({ code: 'NO_ROOMS_SIZED', severity: 'CRITICAL',
      message: 'No room has a measurement good enough to size from. Enter the room '
        + 'dimensions, or confirm the plan’s scale.' });
    return { ok: false, notes };
  }
  for (const r of sizing.unmeasured) {
    notes.push({ code: 'ROOM_NOT_MEASURED', severity: 'CHECK', roomId: r.id,
      message: r.label + ': ' + r.reason });
  }
  if (sizing.varianceVsRulePct !== null && Math.abs(sizing.varianceVsRulePct) > 20) {
    notes.push({ code: 'ESTIMATES_DISAGREE', severity: 'CHECK',
      message: 'The room-by-room estimate is ' + sizing.varianceVsRulePct + '% from NAC’s '
        + sizing.estimates.areaRule.wattsPerM2 + ' W/m² rule. Worth checking the room '
        + 'areas and the ceiling height before choosing equipment.' });
  }
  const cross = sizing.floorAreaCrossCheck;
  if (cross && !cross.agrees) {
    for (const w of cross.warnings) notes.push({ ...w, code: w.code });
  }
  return { ok: !notes.some(x => x.severity === 'CRITICAL'), notes };
}

export default { ESTIMATING_RULES, methodLabel, ruleAirflowLs, preliminarySizing,
                 sizingReadiness };
