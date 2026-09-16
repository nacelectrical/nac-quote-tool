// ═══════════════════════════════════════════════════════════════════════════
// HOW MANY DUCTS LEAVE THE PLENUM
// ═══════════════════════════════════════════════════════════════════════════
//
// A starting recommendation, and then the checks that have to pass before it is
// allowed to stand. The count is NOT the whole engineering decision — Nick was
// explicit about that — so this module returns a number AND the reasons it
// might be wrong, and an installer's own choice always wins while still being
// told what the engine thinks of it.
//
//   1-8 outlets   -> 2 spigots
//   9-12 outlets  -> 3 spigots
//   13+           -> work it out from airflow, areas, equipment and BTO limits
//
// which is max(2, ceil(outlets / 4)) up to twelve, and a real calculation past
// it rather than sitting on three forever.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { btoBodyGeometry } from './bto.mjs';

export const SPIGOT_RULE = Object.freeze({
  outletsPerSpigot: 4,
  minSpigots: 2,
  /** Past this many outlets the table stops and the calculation starts. */
  tableLimitOutlets: 12,
  /** A fabricated plenum needs this much metal between two collars. */
  collarGapMm: 60
});

const areaM2 = (mm) => Math.PI * Math.pow(mm / 2000, 2);
export const spigotVelocity = (ls, mm) => Math.round((ls / 1000) / areaM2(mm) * 100) / 100;

/**
 * The starting number of spigots for a job of this size.
 *
 * Past the table it is worked out from what the ducts can actually carry and
 * how many outlets one chain of fittings can reach, not left at three because
 * three was the last row of a lookup.
 */
export function recommendedSupplySpigotCount(outletCount, opts = {}) {
  const n = Math.max(0, Number(outletCount) || 0);
  const table = Math.max(SPIGOT_RULE.minSpigots, Math.ceil(n / SPIGOT_RULE.outletsPerSpigot));
  if (n <= SPIGOT_RULE.tableLimitOutlets) {
    return { count: table, basis: 'outlet_count',
             fromTable: true, requiresFreshCalculation: false,
             reason: n + ' outlets — max(2, ceil(' + n + '/4)) = ' + table + ' supply spigots.' };
  }

  // PAST TWELVE OUTLETS THE TABLE STOPS MEANING ANYTHING. What decides it then
  // is how much air one duct of the chosen size can carry inside the velocity
  // band, and how many installer areas there are to serve.
  const settings = opts.settings || DEFAULT_SETTINGS;
  const band = settings.duct.velocity.main;
  const mm = opts.diameterMm || 400;
  const systemLs = Number(opts.systemAirflowLs) || 0;
  const perDuctLimitLs = areaM2(mm) * band.max * 1000;
  const byAirflow = systemLs ? Math.ceil(systemLs / perDuctLimitLs) : 0;
  // CHAIN REACH IS GONE AS A DRIVER, AND NOTHING FAKE REPLACES IT.
  //
  // This used to divide the outlets by how many a chain of three-port fittings
  // could reach. That only ever made sense while a fitting was capped at three
  // ports and chaining was the way past the cap; neither is true now, so the
  // term is removed rather than quietly rescaled.
  //
  // What is left is airflow, installer areas, and — where a job has configured a
  // real fabricated body — how many collars one body can physically take. That
  // last one is a genuine limit on how many outlets a single area BTO can serve,
  // and it is the honest successor to the chain term: it is about metal, not
  // about a number taken off a reference drawing.
  const byFittings = 0;   // retired; kept so callers reading it see zero, not a stale figure
  const byAreas = Number(opts.installerAreaCount) || 0;
  const maxCollars = Number(opts.maxCollarsPerBody) || 0;
  const byCollarSpace = maxCollars ? Math.ceil(n / maxCollars) : 0;
  const count = Math.max(SPIGOT_RULE.minSpigots, byAirflow, byAreas, byCollarSpace);

  // BE HONEST ABOUT A THIN CALCULATION. Past the table, installer areas are the
  // strongest input, and without them a thirty-outlet house comes back as two
  // spigots on airflow alone — arithmetically true and practically useless. Say
  // so rather than letting the number stand unqualified.
  const inputsMissing = [];
  if (!byAreas) inputsMissing.push('installer area count');
  if (!systemLs) inputsMissing.push('system airflow');
  if (!maxCollars) inputsMissing.push('fabricated body collar capacity');

  return {
    count, basis: 'calculated', fromTable: false, requiresFreshCalculation: true,
    byAirflow, byFittings, byAreas, byCollarSpace,
    perDuctLimitLs: Math.round(perDuctLimitLs),
    inputsMissing,
    /** True when the figure rests on airflow alone and wants an estimator's eye. */
    provisional: inputsMissing.length > 0,
    reason: n + ' outlets is past the ' + SPIGOT_RULE.tableLimitOutlets +
      '-outlet table, so the count was calculated: ' + byAirflow + ' by airflow at ø' + mm +
      (byAreas ? ', ' + byAreas + ' by installer areas' : '') +
      (byCollarSpace ? ', ' + byCollarSpace + ' by fabricated collar capacity' : '') +
      '. Fitting port count does not enter into it — one BTO serves its area.' +
      (inputsMissing.length
        ? ' PROVISIONAL: no ' + inputsMissing.join(' or ') + ' was supplied, so this ' +
          'rests on what was. Confirm against the installer areas before ordering.'
        : '')
  };
}

/**
 * CAN THE PLENUM ACTUALLY TAKE THESE COLLARS?
 *
 * Off the unit's discharge flange, which is real manufacturer data where the
 * catalogue has it. Where it does not, this says so rather than guessing: a
 * fabricated box that will not take three 400s is a site problem nobody finds
 * until the metal arrives.
 */
export function checkPlenumCapacity({ count, diameterMm, unit }) {
  const text = unit?.supplyFlangeText || null;
  const m = text && /(\d+)\s*[x×]\s*(\d+)/i.exec(text);
  if (!m) {
    return { verified: false, ok: null, flangeText: text,
      note: 'No supply discharge flange on file for ' + (unit?.model || 'this unit') +
            ', so whether a fabricated plenum takes ' + count + ' × ø' + diameterMm +
            ' collars is UNVERIFIED. Confirm with the sheet metal shop.' };
  }
  // The flange reads "height x width" on these sheets.
  const a = Number(m[1]), b = Number(m[2]);
  const heightMm = Math.min(a, b), widthMm = Math.max(a, b);
  const rowMm = count * diameterMm + (count - 1) * SPIGOT_RULE.collarGapMm;
  const flangeAreaM2 = (heightMm / 1000) * (widthMm / 1000);
  const collarAreaM2 = count * areaM2(diameterMm);
  const fitsInOneRow = rowMm <= widthMm;
  return {
    verified: true,
    flangeText: text, flangeHeightMm: heightMm, flangeWidthMm: widthMm,
    collarRowMm: Math.round(rowMm),
    flangeAreaM2: Math.round(flangeAreaM2 * 1000) / 1000,
    collarAreaM2: Math.round(collarAreaM2 * 1000) / 1000,
    areaRatio: Math.round(collarAreaM2 / flangeAreaM2 * 100) / 100,
    fitsInOneRow,
    ok: true,
    note: fitsInOneRow
      ? count + ' × ø' + diameterMm + ' collars need ' + Math.round(rowMm) +
        ' mm across a ' + widthMm + ' mm discharge — they sit in one row.'
      : count + ' × ø' + diameterMm + ' collars need ' + Math.round(rowMm) +
        ' mm across a ' + widthMm + ' mm discharge. The plenum must be fabricated WIDER ' +
        'than the unit, or the collars split across two faces. Confirm with the sheet ' +
        'metal shop before ordering.'
  };
}

/**
 * Everything that has to be true before a spigot count is accepted.
 *
 * An installer's own choice is never overruled here — it is validated, and the
 * warnings are shown against it.
 */
export function validateSupplySpigots({ mains = [], diameterMm, unit, outletTotalLs,
                                        pressurePa = null, btos = [], manualOverride = false,
                                        areaNames = [] } = {}, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const band = settings.duct.velocity.main;
  const warnings = [];
  const blockers = [];
  const count = mains.length;

  // 1. the equipment and the fabricated plenum
  const plenum = checkPlenumCapacity({ count, diameterMm, unit });
  if (plenum.verified === false) {
    warnings.push({ code: 'PLENUM_CAPACITY_UNVERIFIED', severity: 'CHECK', message: plenum.note });
  } else if (!plenum.fitsInOneRow) {
    warnings.push({ code: 'PLENUM_COLLARS_DO_NOT_FIT_ONE_ROW', severity: 'WARNING',
      message: plenum.note });
  }

  // 2. velocity through every spigot
  const rows = mains.map((m, i) => {
    const v = spigotVelocity(m.airflowLs, m.diameterMm || diameterMm);
    return { key: m.key || String.fromCharCode(65 + i), area: areaNames[i] || m.name || null,
             diameterMm: m.diameterMm || diameterMm, airflowLs: m.airflowLs, velocityMs: v,
             withinMax: v <= band.max, belowPreferred: v < band.preferredMin };
  });
  for (const r of rows) {
    if (!r.withinMax) blockers.push({ code: 'MAIN_OVER_VELOCITY', severity: 'CRITICAL',
      message: 'Main ' + r.key + ' runs at ' + r.velocityMs + ' m/s in a ø' + r.diameterMm +
               ', over the ' + band.max + ' m/s limit.' });
    else if (r.belowPreferred) warnings.push({ code: 'MAIN_BELOW_PREFERRED_VELOCITY',
      severity: 'CHECK',
      message: 'Main ' + r.key + ' runs at ' + r.velocityMs + ' m/s, under the ' +
               band.preferredMin + ' m/s a main normally moves. Accepted where the ' +
               'installer has chosen this split; check the static pressure.' });
  }

  // 3. pressure against VERIFIED available static, never an assumed one
  const availablePa = unit?.availableStaticPa ?? null;
  if (pressurePa != null && availablePa != null) {
    if (pressurePa > availablePa) blockers.push({ code: 'OVER_AVAILABLE_STATIC',
      severity: 'CRITICAL', message: 'The system needs ' + pressurePa + ' Pa against ' +
        availablePa + ' Pa available on the ' + (unit?.model || 'unit') + '.' });
  } else if (pressurePa != null) {
    warnings.push({ code: 'AVAILABLE_STATIC_UNVERIFIED', severity: 'CHECK',
      message: 'No verified available-static figure for ' + (unit?.model || 'this unit') +
               ', so ' + pressurePa + ' Pa cannot be checked against anything.' });
  }

  // 4. every spigot serves a real area
  for (const r of rows) {
    if (!r.area) warnings.push({ code: 'MAIN_HAS_NO_AREA', severity: 'CHECK',
      message: 'Main ' + r.key + ' is not tied to an installer area.' });
  }

  // 6. FABRICATION, NOT A PORT LIMIT.
  //
  // This was a CRITICAL blocker on any fitting with more than three ports. That
  // number came from one reference drawing and should never have been a rule;
  // enforcing it is what drove the router to chain fittings to get under it.
  // What matters is whether the metal can be made, so each body is measured and
  // a fitting that will not fit asks for installer review instead.
  for (const b of btos) {
    const body = b.body || btoBodyGeometry(b);
    if (body.fits) continue;
    warnings.push({ code: 'BTO_FABRICATION_REVIEW', severity: 'WARNING',
      message: b.id + ' carries ' + b.ports.length + ' collars (' +
        body.collarDiametersMm.map(d => 'ø' + d).join(', ') + ') needing ' +
        body.requiredCollarRunMm + ' mm of collar space. ' +
        body.issues.map(i => i.message).join(' ') +
        ' Installer/fabrication review required — do not chain a second fitting.' });
  }
  // Accidental serial chains are a fault. A configured distribution tree —
  // e.g. 400-350-350 feeding two geographical local BTOs — is legitimate.
  for (const b of btos) {
    for (const p of b.ports) {
      if (!p.feedsBtoId || p.intentionalDistribution) continue;
      blockers.push({ code: 'BTO_CHAINED_TO_BTO', severity: 'CRITICAL',
        message: b.id + ' feeds ' + p.feedsBtoId + '. Each main must terminate at ' +
                 'exactly one BTO with every outlet direct off it.' });
    }
  }

  // 7. the mains add up to the outlets
  const mainTotal = rows.reduce((n, r) => n + r.airflowLs, 0);
  const diff = outletTotalLs == null ? 0 : mainTotal - outletTotalLs;
  if (Math.abs(diff) > 2) blockers.push({ code: 'MAINS_DO_NOT_RECONCILE', severity: 'CRITICAL',
    message: 'The mains carry ' + mainTotal + ' L/s against ' + outletTotalLs + ' L/s of outlets.' });

  // 8. a manual choice stands, and is still told the truth
  if (manualOverride) {
    warnings.push({ code: 'SPIGOT_COUNT_INSTALLER_APPROVED', severity: 'INFO',
      message: count + ' × ø' + diameterMm + ' supply spigots is an installer-approved ' +
               'configuration for this job. The checks above still apply to it.' });
  }

  return {
    count, diameterMm, rows, plenum,
    totalLs: mainTotal,
    reconciledLs: outletTotalLs ?? null,
    differenceLs: diff,
    rounding: Math.abs(diff) > 0 && Math.abs(diff) <= 2,
    warnings, blockers,
    ok: blockers.length === 0
  };
}

export default { recommendedSupplySpigotCount, validateSupplySpigots, checkPlenumCapacity,
                 spigotVelocity, SPIGOT_RULE };
