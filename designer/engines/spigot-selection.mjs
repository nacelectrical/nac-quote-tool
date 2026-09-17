// ═══════════════════════════════════════════════════════════════════════════
// WHICH SUPPLY SPIGOT ARRANGEMENT THIS JOB GETS
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick: "Do not use outlet count as the deciding rule. Selection must consider:
// selected indoor unit; total airflow; manufacturer spigot/flange data;
// available static pressure; target main velocity; pressure loss; fabricated
// supply-plenum capacity; installer areas; roof geometry; route lengths;
// physical collar spacing."
//
// So the decision is not a number of outlets divided by four. It is a CHOICE
// BETWEEN WHOLE ARRANGEMENTS — 2 × ø350, 2 × ø400, 3 × ø400 and whatever else
// is configured — each of which is either physically possible on this job or is
// not, and which is then ranked on the things that actually differ between
// them. Every candidate keeps its own reasons, so the sheet can show the ones
// that were rejected and why, rather than a bare answer.
//
// ── WHAT IS HARD AND WHAT IS A PREFERENCE ──────────────────────────────────
//
// HARD (an arrangement that fails one of these is not available at all):
//   · main velocity above the configured ceiling
//   · a duct that will not go through the roof space that was measured
//   · collars that will not fit the plenum's collar face, where the shop has
//     been told not to widen the box
//   · main pressure loss beyond the unit's VERIFIED available static
//
// PREFERENCE (ranked, never silently decisive):
//   · one main per installer area — what NAC actually builds
//   · pressure loss along the longest main
//   · a plenum that does not have to be widened
//   · fewer and smaller ducts, as the tie-break, because that is cost
//
// ── WHAT IS NEVER INVENTED ─────────────────────────────────────────────────
//
// Available static and the discharge flange come from the equipment sheet. Where
// the sheet does not have them, the result says UNVERIFIED and the check is not
// performed rather than performed against a guess. An arrangement is never
// reported as proven against data that does not exist.
//
// ── SAVED AND APPROVED DESIGNS ARE NOT TOUCHED ─────────────────────────────
//
// A design that already carries `supplyMainConfig` keeps it. This module is
// asked what it would choose, the answer is recorded beside the stored one, and
// the stored one is what is built. Nick: "Do not silently reroute saved or
// approved designs when this logic is introduced."

import { DEFAULT_SETTINGS } from './settings.mjs';
import { pressureDropPaPerM } from './ducts.mjs';
import { checkPlenumCapacity, spigotVelocity, SPIGOT_RULE } from './supply-spigots.mjs';

/** The arrangements NAC builds. A job or a unit may add to them. */
export const STANDARD_ARRANGEMENTS = Object.freeze([
  Object.freeze({ key: '2x350', count: 2, diameterMm: 350 }),
  Object.freeze({ key: '2x400', count: 2, diameterMm: 400 }),
  Object.freeze({ key: '3x400', count: 3, diameterMm: 400 })
]);

/** How much room a flex main needs through a roof: the duct plus its insulation. */
export const FLEX_INSULATION_MM = 25;

/** The weights the ranking uses. Named, so a change is a decision, not a nudge. */
export const SELECTION_WEIGHTS = Object.freeze({
  perInstallerArea: 12,      // one main per area is what the installer builds
  pressurePaPerPoint: 0.3,   // loss along the longest main
  widenedPlenum: 4,          // a box the shop has to make wider than the unit
  perDuct: 2,                // fewer ducts is less labour and less metal
  perHundredMm: 1,           // and a smaller duct is cheaper than a bigger one
  abovePreferredVelocity: 6  // a main run fast is a main you can hear
});

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Every arrangement available to this job.
 *
 * Manufacturer-configured alternatives come first, because where an equipment
 * sheet states the spigot arrangements a unit is made with, those are the real
 * options and the generic list is not.
 */
export function availableArrangements({ unit = null, settings = null,
                                        extra = [] } = {}) {
  const fromUnit = Array.isArray(unit?.supplySpigotArrangements)
    ? unit.supplySpigotArrangements : [];
  const fromSettings = Array.isArray(settings?.duct?.supplySpigotArrangements)
    ? settings.duct.supplySpigotArrangements : [];
  const all = [...fromUnit, ...fromSettings, ...extra, ...STANDARD_ARRANGEMENTS]
    .filter(a => a && a.count > 0 && a.diameterMm > 0)
    .map(a => ({
      key: a.key || (a.count + 'x' + a.diameterMm),
      count: Number(a.count), diameterMm: Number(a.diameterMm),
      source: a.source ||
        (fromUnit.includes(a) ? 'manufacturer'
          : fromSettings.includes(a) ? 'configured'
            : extra.includes(a) ? 'job' : 'standard')
    }));
  const seen = new Set();
  return all.filter(a => !seen.has(a.key) && seen.add(a.key));
}

/**
 * Measure ONE arrangement against this job.
 *
 * Returns everything that was looked at, whether or not it decided anything, so
 * that a rejected candidate can be shown with its reason rather than vanishing.
 */
export function evaluateArrangement(arrangement, job, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const band = settings.duct.velocity.main;
  const { count, diameterMm } = arrangement;

  const systemLs = Number(job.systemAirflowLs) || 0;
  const perDuctLs = count ? systemLs / count : 0;
  const velocityMs = spigotVelocity(perDuctLs, diameterMm);

  // ── Pressure loss along the LONGEST main, which is the one that has to
  //    reach with something left for the branches.
  const longestMainM = Number(job.longestMainRouteM) ||
    (Array.isArray(job.mainRouteLengthsM) && job.mainRouteLengthsM.length
      ? Math.max(...job.mainRouteLengthsM) : 0);
  const paPerM = perDuctLs ? pressureDropPaPerM(diameterMm, perDuctLs, { settings }) : 0;
  const mainLossPa = round2(paPerM * longestMainM);

  const availableStaticPa = job.availableStaticPa ??
    (job.unit?.availableStaticPa ?? null);
  const staticVerified = availableStaticPa !== null && availableStaticPa !== undefined;

  // ── The fabricated plenum and the physical collar spacing on its face.
  const plenum = checkPlenumCapacity({ count, diameterMm, unit: job.unit || null });
  const collarRowMm = count * diameterMm + (count - 1) *
    (job.collarGapMm ?? SPIGOT_RULE.collarGapMm);
  const allowWidened = job.allowWidenedPlenum !== false;
  const maxPlenumWidthMm = job.maxPlenumWidthMm ?? null;

  // ── The roof the ducts have to go through.
  const needsClearanceMm = diameterMm + FLEX_INSULATION_MM * 2;
  const roofClearanceMm = job.roofGeometry?.minClearanceMm ?? null;

  const blockers = [];
  const notes = [];

  if (!systemLs) {
    notes.push({ code: 'AIRFLOW_UNKNOWN',
      message: 'No system airflow was supplied, so velocity and pressure loss could not ' +
               'be worked out for ' + arrangement.key + '.' });
  } else if (velocityMs > band.max) {
    blockers.push({ code: 'OVER_VELOCITY',
      message: count + ' × ø' + diameterMm + ' carries ' + Math.round(perDuctLs) +
        ' L/s per duct at ' + velocityMs + ' m/s, over the ' + band.max + ' m/s ceiling.' });
  } else if (velocityMs < band.preferredMin) {
    notes.push({ code: 'BELOW_PREFERRED_VELOCITY',
      message: velocityMs + ' m/s per main, under the ' + band.preferredMin +
        ' m/s a main normally moves. Quiet, and normal on a residential flex system — ' +
        'not a fault, and not a reason on its own to use fewer or smaller ducts.' });
  }

  if (roofClearanceMm !== null && needsClearanceMm > roofClearanceMm) {
    blockers.push({ code: 'ROOF_CLEARANCE',
      message: 'A ø' + diameterMm + ' insulated flex needs ' + needsClearanceMm +
        ' mm of clear roof; ' + roofClearanceMm + ' mm was measured.' });
  } else if (roofClearanceMm === null) {
    notes.push({ code: 'ROOF_CLEARANCE_UNMEASURED',
      message: 'No roof clearance was measured, so whether a ø' + diameterMm +
        ' main physically goes through is UNVERIFIED. Confirm on site.' });
  }

  if (staticVerified && mainLossPa > availableStaticPa) {
    blockers.push({ code: 'OVER_AVAILABLE_STATIC',
      message: 'The longest main alone loses ' + mainLossPa + ' Pa against ' +
        availableStaticPa + ' Pa available on the ' + (job.unit?.model || 'unit') + '.' });
  } else if (!staticVerified) {
    notes.push({ code: 'AVAILABLE_STATIC_UNVERIFIED',
      message: 'No verified available-static figure for ' + (job.unit?.model || 'this unit') +
        ', so ' + mainLossPa + ' Pa of main loss cannot be checked against anything.' });
  }

  const widened = plenum.verified === true && plenum.fitsInOneRow === false;
  if (widened && !allowWidened) {
    blockers.push({ code: 'PLENUM_COLLARS_DO_NOT_FIT',
      message: count + ' × ø' + diameterMm + ' needs ' + Math.round(collarRowMm) +
        ' mm of collar face on a ' + plenum.flangeWidthMm + ' mm discharge, and this job ' +
        'does not allow a widened plenum.' });
  }
  if (maxPlenumWidthMm && plenum.arrangement?.bodyWidthMm > maxPlenumWidthMm) {
    blockers.push({ code: 'PLENUM_TOO_WIDE',
      message: 'The plenum would have to be ' + plenum.arrangement.bodyWidthMm +
        ' mm across; the most that can be fabricated or lifted here is ' +
        maxPlenumWidthMm + ' mm.' });
  }
  if (plenum.verified === false) {
    notes.push({ code: 'PLENUM_CAPACITY_UNVERIFIED', message: plenum.note });
  }

  // ── Installer areas: what NAC actually builds to.
  const areas = Array.isArray(job.installerAreas) ? job.installerAreas.length
    : Number(job.installerAreaCount) || 0;
  const areaGap = areas ? Math.abs(count - areas) : 0;
  if (areas && count < areas) {
    notes.push({ code: 'FEWER_MAINS_THAN_AREAS',
      message: count + ' mains for ' + areas + ' installer areas — ' + (areas - count) +
        ' area(s) would be fed off a shared main.' });
  } else if (areas && count > areas) {
    notes.push({ code: 'MORE_MAINS_THAN_AREAS',
      message: count + ' mains for ' + areas + ' installer areas — one main would have ' +
        'no area of its own.' });
  } else if (!areas) {
    notes.push({ code: 'INSTALLER_AREAS_UNKNOWN',
      message: 'No installer areas were supplied, so the strongest input into this ' +
        'decision is missing and the choice rests on airflow, pressure and the plenum.' });
  }

  const W = SELECTION_WEIGHTS;
  const score = round2(
    areaGap * W.perInstallerArea +
    mainLossPa * W.pressurePaPerPoint +
    (widened ? W.widenedPlenum : 0) +
    count * W.perDuct +
    (diameterMm / 100) * W.perHundredMm +
    Math.max(0, velocityMs - band.preferred) * W.abovePreferredVelocity);

  return {
    key: arrangement.key,
    count, diameterMm,
    source: arrangement.source || 'standard',
    text: count + ' × ø' + diameterMm,
    perDuctAirflowLs: Math.round(perDuctLs),
    velocityMs,
    velocityBand: { preferredMin: band.preferredMin, preferred: band.preferred, max: band.max },
    withinVelocityCeiling: !systemLs ? null : velocityMs <= band.max,
    paPerM: round2(paPerM),
    longestMainM,
    mainLossPa,
    availableStaticPa: staticVerified ? availableStaticPa : null,
    availableStaticVerified: staticVerified,
    collarRowMm: Math.round(collarRowMm),
    collarGapMm: job.collarGapMm ?? SPIGOT_RULE.collarGapMm,
    plenum,
    plenumWidened: widened,
    plenumBodyWidthMm: plenum.arrangement?.bodyWidthMm ?? null,
    roofClearanceRequiredMm: needsClearanceMm,
    roofClearanceMeasuredMm: roofClearanceMm,
    installerAreaCount: areas,
    feasible: blockers.length === 0,
    blockers, notes,
    score
  };
}

/**
 * THE SELECTION.
 *
 * @returns {{ chosen, ranked, rejected, inputs, unverified, basis }}
 *   `chosen` is null when nothing is physically available — which is an answer,
 *   not a failure to answer, and the blockers say why.
 */
export function selectSupplySpigotArrangement(job = {}, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const candidates = availableArrangements({
    unit: job.unit, settings, extra: job.arrangements || []
  }).map(a => evaluateArrangement(a, job, { settings }));

  const feasible = candidates.filter(c => c.feasible).sort((a, b) => a.score - b.score);
  const rejected = candidates.filter(c => !c.feasible);
  const chosen = feasible[0] || null;

  // Everything that could not be checked because the data for it is not there.
  const unverified = [...new Set(candidates.flatMap(c => c.notes)
    .filter(n => /UNVERIFIED|UNKNOWN|UNMEASURED/.test(n.code)).map(n => n.code))];

  return {
    chosen,
    ranked: feasible,
    rejected,
    /** Second best, and what it would have cost — the comparison an estimator wants. */
    runnerUp: feasible[1] || null,
    inputs: {
      unit: job.unit?.model || null,
      systemAirflowLs: job.systemAirflowLs ?? null,
      availableStaticPa: job.availableStaticPa ?? job.unit?.availableStaticPa ?? null,
      supplyFlangeText: job.unit?.supplyFlangeText || null,
      installerAreaCount: Array.isArray(job.installerAreas) ? job.installerAreas.length
        : (job.installerAreaCount ?? null),
      longestMainRouteM: job.longestMainRouteM ??
        (Array.isArray(job.mainRouteLengthsM) && job.mainRouteLengthsM.length
          ? Math.max(...job.mainRouteLengthsM) : null),
      roofClearanceMm: job.roofGeometry?.minClearanceMm ?? null,
      targetVelocityMs: settings.duct.velocity.main.preferred,
      outletCount: job.outletCount ?? null
    },
    /** Named so nobody can read this as an outlet-count rule ever again. */
    basis: 'equipment, airflow, static pressure, velocity, pressure loss, plenum ' +
           'capacity, installer areas, roof geometry, route length and collar spacing',
    decidedByOutletCount: false,
    unverified,
    summary: chosen
      ? chosen.text + ' supply spigots — ' + chosen.perDuctAirflowLs + ' L/s per main at ' +
        chosen.velocityMs + ' m/s, ' + chosen.mainLossPa + ' Pa along the longest main' +
        (chosen.installerAreaCount
          ? ', ' + chosen.count + ' main(s) for ' + chosen.installerAreaCount +
            ' installer area(s)' : '') +
        (chosen.plenumWidened ? ', on a widened fabricated plenum' : '') + '.'
      : 'No supply spigot arrangement is physically available for this job. ' +
        rejected.map(r => r.text + ': ' + r.blockers.map(b => b.message).join(' ')).join(' ')
  };
}

/**
 * THE INSTALLER'S OWN CHOICE, AND THE RECORD OF IT.
 *
 * Nick: "Allow installer override, recording: original recommendation; selected
 * override; person; date and time; reason." The override always wins. It is
 * still measured against the same checks, and the warnings stand against it.
 */
export function overrideSpigotArrangement(selection, { count, diameterMm, by, reason,
                                                       at = null, job = null } = {},
                                          opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const key = count + 'x' + diameterMm;
  const evaluated = job
    ? evaluateArrangement({ key, count, diameterMm, source: 'installer_override' },
                          job, { settings })
    : (selection?.ranked || []).concat(selection?.rejected || []).find(c => c.key === key) || null;

  return {
    recommended: selection?.chosen
      ? { key: selection.chosen.key, count: selection.chosen.count,
          diameterMm: selection.chosen.diameterMm, text: selection.chosen.text,
          score: selection.chosen.score, summary: selection.summary }
      : null,
    selected: { key, count, diameterMm, text: count + ' × ø' + diameterMm },
    evaluation: evaluated,
    by: by || null,
    at: at || new Date().toISOString(),
    reason: reason || '',
    /** True when the installer picked something the engine would not have. */
    differsFromRecommendation: !!selection?.chosen && selection.chosen.key !== key,
    /** True when what they picked fails a HARD check. Recorded, never blocked. */
    overridesABlocker: !!evaluated && evaluated.feasible === false,
    warnings: evaluated && !evaluated.feasible
      ? evaluated.blockers.map(b => ({ code: 'INSTALLER_OVERRODE_' + b.code,
          severity: 'CRITICAL', message: b.message +
            ' This arrangement was chosen by ' + (by || 'the installer') +
            (reason ? ' (' + reason + ')' : '') + ' and is built as chosen.' }))
      : []
  };
}

/**
 * THE SAME ARRANGEMENT, AGAINST THE MAINS AS THEY WERE ACTUALLY ROUTED.
 *
 * The choice is made before the router runs, so its pressure term uses whatever
 * route length was known at the time — often none. Once the mains exist they
 * have a MEASURED length, and the loss along the longest one is a real number
 * rather than a blank. This re-measures and CHANGES NOTHING ELSE: the
 * arrangement that was built stays the arrangement that was built, because
 * re-deciding here would be rerouting a design behind somebody's back.
 */
export function remeasureSelection(selection, longestMainM, opts = {}) {
  if (!selection?.chosen || !longestMainM) return selection;
  const settings = opts.settings || DEFAULT_SETTINGS;
  const re = (c) => {
    const paPerM = c.perDuctAirflowLs
      ? pressureDropPaPerM(c.diameterMm, c.perDuctAirflowLs, { settings }) : 0;
    return { ...c, longestMainM, paPerM: round2(paPerM),
             mainLossPa: round2(paPerM * longestMainM),
             mainLengthMeasured: true };
  };
  return {
    ...selection,
    chosen: re(selection.chosen),
    ranked: selection.ranked.map(re),
    rejected: selection.rejected.map(re),
    runnerUp: selection.runnerUp ? re(selection.runnerUp) : null,
    inputs: { ...selection.inputs, longestMainRouteM: longestMainM,
              longestMainMeasured: true }
  };
}

export default { STANDARD_ARRANGEMENTS, SELECTION_WEIGHTS, FLEX_INSULATION_MM,
                 remeasureSelection,
                 availableArrangements, evaluateArrangement,
                 selectSupplySpigotArrangement, overrideSpigotArrangement };
