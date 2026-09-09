// NAC AI HVAC DESIGNER — PART 16 & 17: duct sizing and duct length measurement.
//
// All sizing is deterministic fluid mechanics against the diameters and
// velocity targets configured in HVAC Design Settings. Duct lengths come from
// the calibrated plan geometry (a route the estimator draws), or from manual
// entry — never from an assumption the estimator cannot see.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round, mmToM } from './units.mjs';
import { polylineLengthMm } from './calibration.mjs';

/** Cross-sectional area (m²) of a round duct given its diameter in mm. */
export function ductAreaM2(diameterMm) {
  const r = mmToM(diameterMm) / 2;
  return Math.PI * r * r;
}

/** Air velocity (m/s) for an airflow in L/s through a round duct. */
export function velocity(diameterMm, airflowLs) {
  const a = ductAreaM2(diameterMm);
  if (!a) return 0;
  return (Number(airflowLs) / 1000) / a;
}

/** Diameter (mm) that would give exactly the target velocity. */
export function idealDiameterMm(airflowLs, targetVelocityMs) {
  const q = Number(airflowLs) / 1000;
  if (!(q > 0) || !(targetVelocityMs > 0)) return 0;
  return Math.sqrt((4 * q) / (Math.PI * targetVelocityMs)) * 1000;
}

/**
 * Friction loss in Pa per metre, using the standard Darcy–Weisbach fit for
 * galvanised duct at 20 °C, then scaled by the flexible-duct roughness factor
 * from settings (fully extended flex is materially rougher than spiral).
 */
export function pressureDropPaPerM(diameterMm, airflowLs, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const q = Number(airflowLs) / 1000;         // m³/s
  const d = mmToM(diameterMm);                // m
  if (!(q > 0) || !(d > 0)) return 0;
  const galv = 0.022243 * Math.pow(q, 1.852) / Math.pow(d, 4.973);
  const roughness = opts.rigid ? 1 : settings.duct.flexRoughnessFactor;
  return galv * roughness;
}

/**
 * Choose the smallest catalogued diameter that keeps velocity inside the
 * configured band for the duct's role. Returns the selection plus every
 * diameter that was considered, so the choice is auditable.
 */
export function selectDiameter(airflowLs, role = 'branch', opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const D = settings.duct;
  const band = D.velocity[role] || D.velocity.branch;
  const flow = Number(airflowLs) || 0;

  const considered = D.availableDiametersMm.map(d => {
    const v = velocity(d, flow);
    return {
      diameterMm: d,
      velocityMs: round(v, 2),
      withinMax: v <= band.max,
      withinPreferred: v >= band.preferredMin && v <= band.preferred
    };
  });

  // Prefer the smallest diameter sitting in the preferred band; otherwise the
  // smallest that is simply under the maximum; otherwise the largest available.
  const preferred = considered.find(c => c.withinPreferred);
  const acceptable = considered.find(c => c.withinMax);
  const chosen = preferred || acceptable || considered[considered.length - 1];

  return {
    ...chosen,
    role,
    band,
    idealDiameterMm: round(idealDiameterMm(flow, band.preferred), 0),
    reason: preferred
      ? 'Smallest catalogued diameter inside the preferred ' + band.preferredMin + '–' + band.preferred + ' m/s band for a ' + role + ' duct.'
      : acceptable
        ? 'No diameter falls in the preferred band; smallest diameter under the ' + band.max + ' m/s maximum.'
        : 'Airflow exceeds every catalogued diameter at the ' + band.max + ' m/s maximum.',
    considered
  };
}

/** Size one duct section and compute its pressure contribution. */
export function sizeSection({ id, role, destination, airflowLs, lengthMm, diameterMm, rigid = false, fittings = [] }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const D = settings.duct;
  const band = D.velocity[role] || D.velocity.branch;

  const sel = diameterMm
    ? { diameterMm, velocityMs: round(velocity(diameterMm, airflowLs), 2), role, band,
        reason: 'Diameter set manually by the estimator.', manual: true,
        idealDiameterMm: round(idealDiameterMm(airflowLs, band.preferred), 0), considered: [] }
    : selectDiameter(airflowLs, role, opts);

  const lengthM = lengthMm !== null && lengthMm !== undefined ? mmToM(lengthMm) : 0;
  const paPerM = pressureDropPaPerM(sel.diameterMm, airflowLs, { ...opts, rigid });

  // Fittings are converted to equivalent straight metres.
  const eq = settings.pressure.equivalentLengthM;
  const fittingDetail = (fittings || []).map(f => {
    const key = typeof f === 'string' ? f : f.type;
    const qty = typeof f === 'string' ? 1 : (f.quantity || 1);
    const perUnitM = eq[key] ?? 0;
    return { type: key, quantity: qty, equivalentM: round(perUnitM * qty, 2), known: eq[key] !== undefined };
  });
  const fittingEquivM = fittingDetail.reduce((s, f) => s + f.equivalentM, 0);
  const effectiveLengthM = lengthM + fittingEquivM;

  const warnings = [];
  if (sel.velocityMs > band.max) warnings.push({ code: 'EXCESSIVE_DUCT_VELOCITY', severity: 'WARNING',
    message: (destination || id) + ': ' + sel.velocityMs + ' m/s exceeds the ' + band.max + ' m/s maximum for a ' + role + ' duct.' });
  else if (sel.velocityMs > band.preferred) warnings.push({ code: 'DUCT_VELOCITY_ABOVE_PREFERRED', severity: 'CHECK',
    message: (destination || id) + ': ' + sel.velocityMs + ' m/s is above the preferred ' + band.preferred + ' m/s for a ' + role + ' duct — consider the next size up.' });
  if (lengthM > D.longRunWarnM) warnings.push({ code: 'LONG_DUCT_RUN', severity: 'CHECK',
    message: (destination || id) + ': ' + round(lengthM, 1) + ' m run exceeds the ' + D.longRunWarnM + ' m review threshold.' });
  if (lengthMm === null || lengthMm === undefined) warnings.push({ code: 'DUCT_LENGTH_NOT_MEASURED', severity: 'CHECK',
    message: (destination || id) + ': duct length has not been measured or entered.' });
  fittingDetail.filter(f => !f.known).forEach(f => warnings.push({ code: 'UNKNOWN_FITTING', severity: 'INFO',
    message: (destination || id) + ': no equivalent length configured for fitting "' + f.type + '".' }));

  return {
    id, role, destination,
    airflowLs: round(airflowLs, 0),
    diameterMm: sel.diameterMm,
    velocityMs: sel.velocityMs,
    lengthMm: lengthMm ?? null,
    lengthM: round(lengthM, 2),
    fittings: fittingDetail,
    fittingEquivalentM: round(fittingEquivM, 2),
    effectiveLengthM: round(effectiveLengthM, 2),
    paPerM: round(paPerM, 3),
    pressureDropPa: round(paPerM * effectiveLengthM, 1),
    selection: sel,
    warnings
  };
}

// ── PART 17: duct length from the calibrated plan ───────────────────────────

/**
 * Length of a drawn duct route. `points` are image pixel coordinates; the
 * calibration converts them to millimetres. A configurable slack factor covers
 * rise, drop and the sag that always exists in a real flex install.
 */
export function routeLength(calibration, points, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const planMm = polylineLengthMm(calibration, points);
  if (planMm === null) {
    return { planMm: null, lengthMm: null, lengthM: null, source: 'unavailable',
             note: 'Calibrate the plan before measuring duct routes.' };
  }
  const slack = opts.slackFactor ?? settings.duct.routeSlackFactor;
  const lengthMm = planMm * slack;
  return {
    planMm: round(planMm, 0),
    slackFactor: slack,
    lengthMm: round(lengthMm, 0),
    lengthM: round(mmToM(lengthMm), 2),
    segments: (points || []).length - 1,
    source: 'drawn_route',
    note: 'Measured from the drawn route on the calibrated plan (' + round(mmToM(planMm), 2) +
      ' m plan length × ' + slack + ' for rise, drop and slack).'
  };
}

/** Straight-line fallback when no route has been drawn. */
export function estimatedLength(calibration, fromPx, toPx, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const r = routeLength(calibration, [fromPx, toPx], { ...opts, slackFactor: settings.duct.straightLineFactor });
  if (r.lengthMm === null) return r;
  return { ...r, source: 'straight_line_estimate',
    note: 'Straight-line plan distance × ' + settings.duct.straightLineFactor +
      ' — no route drawn. Draw the route or enter the length for an accurate figure.' };
}

export function manualLength(lengthM) {
  const mm = Number(lengthM) * 1000;
  return { planMm: null, lengthMm: round(mm, 0), lengthM: round(Number(lengthM), 2),
           source: 'manual', note: 'Length entered by the estimator.' };
}

// ── Network assembly ────────────────────────────────────────────────────────

/**
 * Build the supply-side duct network for a residential ducted system:
 *   indoor unit → main duct → supply plenum → one branch per room
 *                                          → final connections where a room
 *                                            has more than one outlet.
 */
export function buildDuctNetwork({ airflow, outlets, routesByRoomId = {}, mainRoute = null,
                                   diameterOverrides = {}, extraFittingsByRoomId = {} }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const outletsByRoom = new Map((outlets?.rows || []).map(o => [o.roomId, o]));

  const sections = [];

  // Main duct — carries the whole system airflow from the unit to the plenum.
  const mainLen = mainRoute?.lengthMm ?? null;
  sections.push(sizeSection({
    id: 'main', role: 'main', destination: 'Supply plenum',
    airflowLs: airflow.allocatedAirflowLs,
    lengthMm: mainLen,
    diameterMm: diameterOverrides.main,
    rigid: true,
    fittings: ['supply_plenum']
  }, opts));

  // One branch per room.
  for (const row of airflow.rows) {
    const out = outletsByRoom.get(row.roomId);
    const route = routesByRoomId[row.roomId] || null;
    const qty = out?.quantity ?? 1;
    const fittings = ['takeoff', 'damper_open', ...(extraFittingsByRoomId[row.roomId] || [])];
    if (qty > 1) fittings.push({ type: 'y_piece', quantity: qty - 1 });

    sections.push(sizeSection({
      id: 'branch_' + row.roomId,
      role: 'branch',
      destination: row.label,
      airflowLs: row.adjustedLs,
      lengthMm: route?.lengthMm ?? null,
      diameterMm: diameterOverrides['branch_' + row.roomId],
      fittings
    }, opts));

    // Final connections when a room is served by more than one outlet.
    if (qty > 1) {
      for (let i = 0; i < qty; i++) {
        sections.push(sizeSection({
          id: 'final_' + row.roomId + '_' + (i + 1),
          role: 'final',
          destination: row.label + ' outlet ' + (i + 1),
          airflowLs: row.adjustedLs / qty,
          lengthMm: route?.finalLengthsMm?.[i] ?? null,
          diameterMm: diameterOverrides['final_' + row.roomId + '_' + (i + 1)],
          fittings: ['bend_90']
        }, opts));
      }
    }
  }

  const totalsByDiameter = {};
  for (const s of sections) {
    if (s.role === 'main' && s.selection?.manual !== true) { /* main still counted below */ }
    const key = s.diameterMm;
    totalsByDiameter[key] = round((totalsByDiameter[key] || 0) + (s.lengthM || 0), 2);
  }

  return {
    sections,
    totalDuctLengthM: round(sections.reduce((s, x) => s + (x.lengthM || 0), 0), 2),
    totalsByDiameter,
    warnings: sections.flatMap(s => s.warnings),
    settingsVelocity: settings.duct.velocity
  };
}

/** The index run — the highest-pressure path from the unit to a diffuser. */
export function indexRun(network) {
  const main = network.sections.find(s => s.role === 'main');
  const branches = network.sections.filter(s => s.role === 'branch');
  if (!branches.length) return null;

  let worst = null;
  for (const b of branches) {
    const finals = network.sections.filter(s => s.role === 'final' && s.id.startsWith('final_' + b.id.replace('branch_', '') + '_'));
    const finalWorst = finals.length ? finals.reduce((a, c) => (c.pressureDropPa > a.pressureDropPa ? c : a)) : null;
    const total = (main?.pressureDropPa || 0) + b.pressureDropPa + (finalWorst?.pressureDropPa || 0);
    if (!worst || total > worst.totalPa) {
      worst = {
        totalPa: round(total, 1),
        destination: b.destination,
        path: [main, b, finalWorst].filter(Boolean).map(s => ({
          id: s.id, role: s.role, destination: s.destination,
          diameterMm: s.diameterMm, lengthM: s.lengthM,
          effectiveLengthM: s.effectiveLengthM, pressureDropPa: s.pressureDropPa
        }))
      };
    }
  }
  return worst;
}
