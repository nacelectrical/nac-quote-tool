// ─────────────────────────────────────────────────────────────────────────────
// WHAT HAPPENS WHEN THE ZONES SHUT
//
// A zoned system with every closable zone shut is a fan pushing its whole
// airflow through whatever is left open. If that is not enough duct, the static
// pressure climbs, the fan noise climbs with it, the coil ices in cooling, and
// eventually a safety cuts the machine out. The customer rings about a system
// that "turns itself off".
//
// Three things had to change here.
//
// 1. THE MINIMUM IS A MANUFACTURER NUMBER, NOT A RULE OF THUMB.
//    The engine compared the open airflow against 40% of system airflow — a
//    configured fraction, not anything Daikin, Fujitsu or Panasonic published.
//    It is a reasonable default and it is not evidence. Where NAC has entered
//    the unit's own minimum airflow, that is the number. Where NAC has not, the
//    design says the minimum is UNVERIFIED and the fraction is named as the
//    rule of thumb it is. Nick: the AI must never invent engineering data.
//
// 2. A MANUAL BALANCING DAMPER IS NOT AN ANSWER.
//    It is a part somebody sets once, on a day, with the house in one state.
//    It does not open when the zones shut. Proposing one as the fix for a
//    minimum-airflow failure is proposing that the problem happen quietly.
//
// 3. SPILL AND BYPASS ARE PARTS, AND PARTS ARE PRICED.
//    Either is a legitimate engineering answer. Neither is free, and neither
//    may be assumed into a design to make a check pass. If the design carries
//    one it appears on the bill of materials; if it does not, no check may rely
//    on it.
// ─────────────────────────────────────────────────────────────────────────────

import { round } from './units.mjs';
import { minimumOpenAirflow, MINIMUM_SOURCE as MIN_SRC } from './minimum-airflow.mjs';
export { minimumOpenAirflow };

export { MINIMUM_SOURCE } from './minimum-airflow.mjs';

// ABSENT is not ZERO. Number(null) and Number('') are both 0.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * How much room an answer has to have before it counts as one.
 *
 * The Kauri report proposed making Z6 a constant zone and reached 40.0% against
 * a 40% requirement — two litres a second on a seven-hundred-litre system. That
 * is not clearance, it is the same number written twice.
 */
export const SUFFICIENT_MARGIN_FRACTION = 0.10;

function verdict(openLs, requiredLs) {
  if (openLs < requiredLs) return { sufficient: false, marginLs: Math.round(openLs - requiredLs) };
  const margin = openLs - requiredLs;
  return {
    sufficient: margin >= requiredLs * SUFFICIENT_MARGIN_FRACTION,
    marginLs: Math.round(margin),
    marginPct: requiredLs > 0 ? Math.round((margin / requiredLs) * 1000) / 10 : null
  };
}

function marginNote(v) {
  if (v.sufficient) return ' Clears by ' + v.marginLs + ' L/s.';
  if (v.marginLs < 0) return ' Still ' + Math.abs(v.marginLs) + ' L/s short.';
  return ' Clears by only ' + v.marginLs + ' L/s (' + (v.marginPct ?? 0) + '%), which is not a '
    + 'margin a real system holds \u2014 a damper tolerance or a dirty filter takes it below. '
    + 'Treat this as not solved.';
}

/**
 * Is the zoning safe, and what may be offered if it is not?
 *
 * Returns OPTIONS, never a decision: each one names the part, says what it
 * costs the design, and is approved by a person.
 */
export function zoningSafety({ zoneAnalysis, selectedUnit = null, design = null,
                               settings = null } = {}) {
  const failures = [];
  const options = [];
  const notes = [];

  if (!zoneAnalysis) return { ok: true, failures, options, notes, minimum: null };

  const systemLs = num(zoneAnalysis.systemAirflowLs) || 0;
  const minimum = minimumOpenAirflow(selectedUnit, systemLs, settings);
  const openLs = num(zoneAnalysis.minimumOpenAirflowLs) || 0;
  const shortfallLs = round(minimum.requiredLs - openLs, 0);
  const meets = openLs >= minimum.requiredLs;

  // ── §15 A ZONING DESIGN IS NOT APPROVED ON A RULE OF THUMB ──────────────
  //
  // An unverified minimum is a SCREENING check. It can tell an estimator to
  // look harder; it cannot sign off a zoning design, because the number it
  // compares against is NAC's own fraction and not anything the manufacturer
  // published. This is a failure, not a note: it blocks approval.
  if (!minimum.verified) {
    failures.push({
      code: 'MINIMUM_AIRFLOW_UNVERIFIED',
      severity: 'CRITICAL',
      screeningOnly: true,
      message: minimum.basis + ' Enter the published minimum \u2014 with the fan setting, the '
        + 'document, its revision and page, and who checked it \u2014 in HVAC Design Settings '
        + '\u2192 Equipment specs before this zoning can be approved.',
      missing: (minimum.missing || []).map(m => m.key)
    });
  }

  if (!meets && systemLs > 0) {
    failures.push({
      code: 'MINIMUM_OPEN_AIRFLOW_NOT_MET',
      severity: 'CRITICAL',
      message: 'With every closable zone shut, ' + round(openLs, 0) + ' L/s stays open against '
        + 'a required ' + minimum.requiredLs + ' L/s — ' + shortfallLs + ' L/s short. '
        + minimum.basis,
      openLs: round(openLs, 0),
      requiredLs: minimum.requiredLs,
      shortfallLs,
      minimumSource: minimum.source
    });

    // ── THE OPTIONS ────────────────────────────────────────────────────────
    // In the order an installer would consider them: change the zoning first,
    // add metal second, add a control component last.
    const zones = (zoneAnalysis.zones || []);
    const closable = zones.filter(z => !z.alwaysOpen);
    const biggest = [...closable].sort((a, b) => b.airflowLs - a.airflowLs)[0] || null;

    if (biggest) {
      const wouldOpen = round((num(zoneAnalysis.alwaysOpenLs) || 0) + biggest.airflowLs, 0);
      const v = verdict(wouldOpen, minimum.requiredLs);
      options.push({
        code: 'NOMINATE_CONSTANT_ZONE',
        title: 'Make ' + biggest.name + ' a constant zone',
        detail: 'It carries ' + round(biggest.airflowLs, 0) + ' L/s. Leaving it always open '
          + 'takes the permanently open airflow to ' + wouldOpen + ' L/s against the '
          + minimum.requiredLs + ' L/s required.' + marginNote(v, minimum.requiredLs),
        sufficient: v.sufficient,
        marginLs: v.marginLs,
        costsNothing: true,
        zoneId: biggest.id,
        requiresApproval: true
      });
    }

    const twoBiggest = [...closable].sort((a, b) => b.airflowLs - a.airflowLs).slice(0, 2);
    if (twoBiggest.length === 2) {
      const wouldOpen = round((num(zoneAnalysis.alwaysOpenLs) || 0)
        + twoBiggest.reduce((s, z) => s + z.airflowLs, 0), 0);
      const v = verdict(wouldOpen, minimum.requiredLs);
      options.push({
        code: 'MERGE_INTO_CONSTANT_GROUP',
        title: 'Hold ' + twoBiggest.map(z => z.name).join(' and ') + ' open together',
        detail: 'Two zones open gives ' + wouldOpen + ' L/s. Fewer zones, no extra parts, '
          + 'and less control over those rooms.' + marginNote(v, minimum.requiredLs),
        sufficient: v.sufficient,
        marginLs: v.marginLs,
        costsNothing: true,
        zoneIds: twoBiggest.map(z => z.id),
        requiresApproval: true
      });
    }

    options.push({
      code: 'SPILL_TO_COMMON_AREA',
      title: 'Add a spill path to a common area',
      detail: 'A sized spill grille or duct into a hallway or living space gives the air '
        + 'somewhere to go when the zones shut. It is REAL METAL: it has to be sized for '
        + shortfallLs + ' L/s, drawn, and priced on the bill of materials.',
      sufficient: null,
      costsNothing: false,
      mustBePriced: true,
      sizeForLs: shortfallLs,
      requiresApproval: true
    });

    // ── CONTROLLER-ENFORCED MINIMUM ─────────────────────────────────────
    // The best answer when the controller supports it: the controller itself
    // refuses to close below the minimum, so nothing depends on the customer
    // remembering anything. Only offered when the selected controller is known
    // to do it — claiming a controller behaviour it does not have is worse
    // than offering nothing.
    const ctrl = design?.controller || null;
    if (ctrl && ctrl.enforcesMinimumOpen === true) {
      options.push({
        code: 'CONTROLLER_ENFORCED_MINIMUM',
        title: 'Let the ' + (ctrl.name || 'controller') + ' hold the minimum open',
        detail: 'The controller will not close the last zones below the unit\u2019s minimum '
          + 'airflow, whatever the customer selects. Nothing depends on anybody remembering '
          + 'to leave a zone on.',
        sufficient: true,
        costsNothing: true,
        requiresApproval: true,
        verifiedBehaviour: true
      });
    } else if (ctrl) {
      notes.push({
        code: 'CONTROLLER_MINIMUM_BEHAVIOUR_UNKNOWN',
        severity: 'CHECK',
        message: 'It is not recorded whether the ' + (ctrl.name || 'selected controller')
          + ' enforces a minimum open airflow by itself. If it does, that is the cleanest '
          + 'answer here \u2014 confirm it against the controller manual and record it.'
      });
    }

    options.push({
      code: 'BYPASS_DAMPER',
      title: 'Add a barometric bypass damper',
      detail: 'A pressure-operated bypass returns surplus air to the return when the zones '
        + 'shut. It is a component with a price and a position on the drawing, and it takes '
        + 'return-air temperature up, so it is the last option rather than the easy one.',
      sufficient: null,
      costsNothing: false,
      mustBePriced: true,
      sizeForLs: shortfallLs,
      requiresApproval: true
    });
  }

  // ── A MANUAL BALANCING DAMPER IS NEVER THE ANSWER ─────────────────────────
  // If one has found its way into the design as the remedy, that is reported.
  const manualRemedy = (design?.extraMaterials || [])
    .filter(m => /manual\s*(balanc|regulat)/i.test(String(m?.label || m?.desc || '')));
  if (manualRemedy.length && !meets) {
    failures.push({
      code: 'MANUAL_DAMPER_PROPOSED_AS_REMEDY',
      severity: 'CRITICAL',
      message: 'A manual balancing damper is on this design against a minimum-airflow '
        + 'failure. A manual damper is set once, by hand, with the house in one state — it '
        + 'does not open when the zones shut, so it does not fix this. Use a spill path or a '
        + 'bypass, sized and priced.'
    });
  }

  // ── NOTHING IS ASSUMED INTO EXISTENCE ────────────────────────────────────
  // A spill or bypass only counts if it is on the bill of materials.
  const bomText = (design?.bom?.items || []).map(i => String(i.label || '')).join(' | ');
  const hasPricedRelief = /spill|bypass/i.test(bomText);
  if (!meets && hasPricedRelief) {
    notes.push({
      code: 'RELIEF_PATH_ON_THE_ORDER',
      severity: 'INFO',
      message: 'A spill or bypass component is on the bill of materials. Confirm it is sized '
        + 'for the ' + shortfallLs + ' L/s shortfall before the check is treated as answered.'
    });
  }

  // ── NOTHING CLAIMS EVERY ZONE IS INDEPENDENTLY SWITCHABLE ───────────────
  // A customer told that any zone can be used on its own, on a system where
  // that starves the unit, has been sold something the equipment will not do.
  const closable = (zoneAnalysis.zones || []).filter(z => !z.alwaysOpen);
  const independentlySafe = closable.every(z =>
    num(z.airflowLs) !== null && num(z.airflowLs) >= minimum.requiredLs);

  return {
    ok: failures.length === 0,
    meetsMinimum: meets,
    /** May the proposal say every area is independently switchable? */
    allZonesIndependentlySwitchable: independentlySafe && minimum.verified,
    independentlySwitchableNote: independentlySafe
      ? (minimum.verified ? null
         : 'Every zone carries more than the screening minimum, but the minimum itself is '
           + 'not verified, so this cannot be stated to a customer yet.')
      : 'At least one zone carries less than the minimum on its own, so the proposal must '
        + 'not say every area can be run independently.',
    minimum,
    openLs: round(openLs, 0),
    shortfallLs: meets ? 0 : shortfallLs,
    failures,
    options,
    notes,
    /** Never true unless a real, priced component is in the design. */
    bypassAssumed: false
  };
}

export default { zoningSafety, minimumOpenAirflow, MINIMUM_SOURCE: MIN_SRC };
