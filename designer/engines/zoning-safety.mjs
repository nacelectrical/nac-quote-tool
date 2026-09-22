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

export const MINIMUM_SOURCE = Object.freeze({
  /** The unit's published minimum airflow, entered by NAC from the data sheet. */
  MANUFACTURER: 'MANUFACTURER_DATA',
  /** The configured fraction. A default, and never presented as a unit limit. */
  RULE_OF_THUMB: 'NAC_RULE_OF_THUMB'
});

// ABSENT is not ZERO. Number(null) and Number('') are both 0, so an unentered
// minimum airflow would read as "0 L/s, which is a number" rather than as the
// missing manufacturer data it is.
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * How much room an answer has to have before it counts as one.
 *
 * The Kauri report proposed making Z6 a constant zone and reached 40.0% against
 * a 40% requirement — a margin of two litres a second on a seven-hundred-litre
 * system. That is not clearance, it is the same number written twice. A zone
 * balance shifts with every damper tolerance, every crushed flex and every
 * filter that needs changing, so an option that only just clears is reported as
 * only just clearing.
 */
export const SUFFICIENT_MARGIN_FRACTION = 0.10;

/** Does this much open airflow actually answer the requirement? */
function verdict(openLs, requiredLs) {
  if (openLs < requiredLs) return { sufficient: false, marginLs: Math.round(openLs - requiredLs) };
  const margin = openLs - requiredLs;
  return {
    sufficient: margin >= requiredLs * SUFFICIENT_MARGIN_FRACTION,
    marginLs: Math.round(margin),
    marginPct: requiredLs > 0 ? Math.round((margin / requiredLs) * 1000) / 10 : null
  };
}

function marginNote(v, requiredLs) {
  if (v.sufficient) return ' Clears by ' + v.marginLs + ' L/s.';
  if (v.marginLs < 0) return ' Still ' + Math.abs(v.marginLs) + ' L/s short.';
  return ' Clears by only ' + v.marginLs + ' L/s ('
    + (v.marginPct ?? 0) + '%), which is not a margin a real system holds — a damper '
    + 'tolerance or a dirty filter takes it below. Treat this as not solved.';
}

/**
 * The minimum airflow this system must keep open, and where that number is
 * from.
 *
 * @param {object} selectedUnit  the chosen unit, or null
 * @param {number} systemLs      design airflow
 * @param {object} settings
 */
export function minimumOpenAirflow(selectedUnit, systemLs, settings) {
  const fraction = settings?.zoning?.minOpenAirflowFraction ?? 0.40;
  const byFraction = round((num(systemLs) || 0) * fraction, 0);

  // NAC may have entered the unit's own minimum from the data sheet. Several
  // spellings are accepted because this is a field a person types.
  const specs = selectedUnit?.specs || selectedUnit || {};
  const published = num(specs.minimumAirflowLs)
    ?? num(specs.minAirflowLs)
    ?? num(specs.minimumSupplyAirflowLs);

  if (published !== null && published > 0) {
    return {
      requiredLs: round(published, 0),
      source: MINIMUM_SOURCE.MANUFACTURER,
      verified: true,
      basis: (selectedUnit?.model || 'The selected unit') + ' publishes a minimum airflow of '
        + round(published, 0) + ' L/s.',
      ruleOfThumbLs: byFraction,
      fraction
    };
  }

  return {
    requiredLs: byFraction,
    source: MINIMUM_SOURCE.RULE_OF_THUMB,
    verified: false,
    basis: 'No published minimum airflow has been entered for '
      + (selectedUnit?.model || 'the selected unit') + '. This check uses NAC\'s configured '
      + round(fraction * 100, 0) + '% of design airflow, which is a default rather than a '
      + 'manufacturer limit.',
    ruleOfThumbLs: byFraction,
    fraction
  };
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

  if (!minimum.verified) {
    notes.push({
      code: 'MINIMUM_AIRFLOW_UNVERIFIED',
      severity: 'CHECK',
      message: minimum.basis + ' Enter it from the data sheet before this check is relied on.'
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

  return {
    ok: failures.length === 0,
    meetsMinimum: meets,
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

export default { zoningSafety, minimumOpenAirflow, MINIMUM_SOURCE };
