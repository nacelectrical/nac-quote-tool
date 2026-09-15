// NAC AI HVAC DESIGNER — PART 16 & 17: duct sizing and duct length measurement.
//
// All sizing is deterministic fluid mechanics against the diameters and
// velocity targets configured in HVAC Design Settings. Duct lengths come from
// the calibrated plan geometry (a route the estimator draws), or from manual
// entry — never from an assumption the estimator cannot see.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { allowedDiametersFor, reducerRequired, capBranchToParent,
         finalSizeForAirflow, mainFloorForFinals,
         MIN_MAIN_DIAMETER_MM } from './nac-standard.mjs';
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
/**
 * The diameters AUTO DESIGN is allowed to choose from for a given duct role.
 *
 * This is where NAC's install practice overrules the physics. A velocity
 * calculation approves a 150 for a bedroom and NAC does not fit one, so the
 * ladder for a final connection starts at 200 and stops at 300 — a room that
 * wants more air than one 300 should carry gets another outlet, not a bigger
 * duct. Trunks and major branches are unaffected.
 *
 * Returns the ladder plus the rule that produced it, so the reason can be shown
 * against the chosen size rather than left to be guessed at.
 */
export function autoLadderFor(role, settings = DEFAULT_SETTINGS) {
  // THE NAC DUCT DESIGN STANDARD decides which sizes may be chosen. Settings
  // republish the same numbers for the Design Settings screen, so an estimator
  // who edits them there still wins — but the DEFAULTS come from one place.
  const D = settings.duct;
  const std = allowedDiametersFor(role);
  if (role === 'final') {
    const F = D.finalBranch || {};
    const ladder = (F.autoLadderMm || std.sizes)
      .filter(d => d >= (F.preferredMinMm ?? std.min) && d <= (F.maxMm ?? std.max));
    return { ladder, min: F.preferredMinMm ?? std.min, max: F.maxMm ?? std.max, rule: std.rule };
  }
  if (role === 'branch') {
    const floor = D.branchMinMm ?? std.min;
    return { ladder: D.availableDiametersMm.filter(d => d >= floor && d <= D.maxDiameterMm),
             min: floor, max: D.maxDiameterMm, rule: std.rule };
  }
  const floor = D.autoMinDiameterMm ?? std.min;
  return { ladder: D.availableDiametersMm.filter(d => d >= floor && d <= D.maxDiameterMm),
           min: floor, max: D.maxDiameterMm, rule: std.rule };
}

export function selectDiameter(airflowLs, role = 'branch', opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const D = settings.duct;
  const band = D.velocity[role] || D.velocity.branch;
  const flow = Number(airflowLs) || 0;

  // NAC's install rules decide what may be chosen; the velocity band then
  // decides which of those to use. Doing it the other way round is how a
  // bedroom ended up on a 150.
  const { ladder, min, max, rule } = autoLadderFor(role, settings);
  const usable = ladder.length ? ladder : D.availableDiametersMm;

  // A FINAL follows NAC's airflow bands, not the velocity band alone: NAC fits
  // a size up from what the maths allows, and the final duct is the same size
  // as the neck it connects to. The velocity check can still raise it where a
  // lot of air goes through one outlet, but never lower it.
  if (role === 'final') {
    const byPractice = finalSizeForAirflow(flow);
    const byVelocity = usable.find(d => velocity(d, flow) <= band.max) ?? Math.max(...usable);
    const chosenMm = Math.min(Math.max(byPractice, byVelocity), Math.max(...usable));
    const v = velocity(chosenMm, flow);
    return {
      diameterMm: chosenMm,
      velocityMs: round(v, 2),
      withinMax: v <= band.max,
      withinPreferred: v >= band.preferredMin && v <= band.preferred,
      role, band, ladder: usable, ladderRule: rule,
      atLadderMinimum: chosenMm === min,
      atLadderMaximum: chosenMm === max,
      overCapacity: v > band.max,
      carryLimitLs: round(ductAreaM2(chosenMm) * band.max * 1000, 0),
      idealDiameterMm: round(idealDiameterMm(flow, band.preferred), 0),
      reason: 'NAC fits a ' + chosenMm + ' mm final at ' + round(flow, 0) + ' L/s per outlet' +
        (byVelocity > byPractice ? ', raised by the velocity check' : '') + '. ' + rule,
      considered: usable.map(d => ({ diameterMm: d, velocityMs: round(velocity(d, flow), 2),
        withinMax: velocity(d, flow) <= band.max,
        withinPreferred: velocity(d, flow) >= band.preferredMin && velocity(d, flow) <= band.preferred }))
    };
  }

  const considered = usable.map(d => {
    const v = velocity(d, flow);
    return {
      diameterMm: d,
      velocityMs: round(v, 2),
      withinMax: v <= band.max,
      withinPreferred: v >= band.preferredMin && v <= band.preferred
    };
  });

  // Prefer the smallest diameter sitting in the preferred band; otherwise the
  // smallest that is simply under the maximum; otherwise the largest allowed.
  const preferred = considered.find(c => c.withinPreferred);
  const acceptable = considered.find(c => c.withinMax);
  const chosen = preferred || acceptable || considered[considered.length - 1];

  // A final that is still over its velocity limit at the largest size NAC
  // fits is not a duct problem — the room needs another outlet. Say so, rather
  // than quietly running it over speed or reaching for a 350.
  const overCapacity = !acceptable && !preferred;
  const carryLimitLs = round(ductAreaM2(chosen.diameterMm) * band.max * 1000, 0);

  return {
    ...chosen,
    role,
    band,
    ladder: usable,
    ladderRule: rule,
    atLadderMinimum: min !== null && chosen.diameterMm === min,
    atLadderMaximum: max !== null && chosen.diameterMm === max,
    overCapacity,
    carryLimitLs,
    idealDiameterMm: round(idealDiameterMm(flow, band.preferred), 0),
    reason: overCapacity
      ? round(flow, 0) + ' L/s is more than a ' + chosen.diameterMm + ' mm ' + role +
        ' should carry (' + carryLimitLs + ' L/s at ' + band.max + ' m/s). ' +
        (role === 'final'
          ? 'Split this room across more outlets rather than fitting a larger final.'
          : 'Split the run.')
      : preferred
        ? 'Smallest size NAC fits on a ' + role + ' that sits inside the preferred ' +
          band.preferredMin + '-' + band.preferred + ' m/s band.' + (rule ? ' ' + rule : '')
        : min !== null && chosen.diameterMm === min && chosen.velocityMs < band.preferredMin
          ? round(flow, 0) + ' L/s runs slowly in a ' + min + ' mm (' + chosen.velocityMs +
            ' m/s), but ' + min + ' mm is NAC\'s minimum ' + role +
            ' size — a smaller duct is not fitted.' + (rule ? ' ' + rule : '')
          : 'No size falls in the preferred band; smallest under the ' + band.max +
            ' m/s maximum (' + chosen.velocityMs + ' m/s).' + (rule ? ' ' + rule : ''),
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
                                   diameterOverrides = {}, extraFittingsByRoomId = {},
                                   topology = null }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const outletsByRoom = new Map((outlets?.rows || []).map(o => [o.roomId, o]));

  // A routed tree replaces the flat assumption entirely: real trunk segments
  // carrying summed downstream airflow, junctions, and branches hung off them.
  // Without one, the original shape stands — every branch straight off the
  // plenum — so a design that has never been routed behaves exactly as before.
  if (topology?.generated && topology.segments?.length) {
    return sizeTopology(topology, { diameterOverrides, extraFittingsByRoomId }, opts);
  }

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

/**
 * Walk the real parent chain from every terminal back to the plenum and keep
 * the worst path. This is the run the fan has to satisfy.
 */
function indexRunThroughTree(network) {
  const byId = new Map(network.sections.map(s => [s.id, s]));
  // A terminal is anything nothing else hangs off.
  const hasChild = new Set(network.sections.map(s => s.parentId).filter(Boolean));
  const terminals = network.sections.filter(s => !hasChild.has(s.id));
  if (!terminals.length) return null;

  let worst = null;
  for (const t of terminals) {
    const path = [];
    let cur = t;
    const guard = new Set();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      path.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    const totalPa = round(path.reduce((s, x) => s + (x.pressureDropPa || 0), 0), 1);
    if (!worst || totalPa > worst.totalPa) {
      worst = {
        totalPa,
        destination: t.destination,
        path: path.map(s => ({
          id: s.id, role: s.role, destination: s.destination,
          diameterMm: s.diameterMm, lengthM: s.lengthM,
          effectiveLengthM: s.effectiveLengthM, pressureDropPa: s.pressureDropPa
        }))
      };
    }
  }
  return worst;
}

/**
 * Size a routed tree.
 *
 * Each segment already carries the airflow it has to move — summed from the
 * leaves back up by the router, so a trunk steps down after every take-off.
 * Sizing is the SAME sizeSection used by the flat path; what changed is that
 * the airflow handed to it is now the real downstream total rather than one
 * room's share.
 *
 * A REDUCER is recorded wherever a trunk meets a smaller trunk, because that is
 * a fitting somebody has to buy and fit, and it is only knowable once the tree
 * exists.
 */
function sizeTopology(topology, { diameterOverrides = {}, extraFittingsByRoomId = {} }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const sections = [];

  for (const seg of topology.segments) {
    const extra = seg.roomId ? (extraFittingsByRoomId[seg.roomId] || []) : [];
    const sized = sizeSection({
      id: seg.id,
      role: seg.role === 'trunk' ? 'main' : seg.role,   // a trunk is velocity-banded as a main
      destination: seg.destination,
      airflowLs: seg.airflowLs,
      lengthMm: seg.lengthMm ?? null,
      // The estimator's manual override wins; failing that, a size the
      // topology generator has already decided (the plenum's mains are all one
      // size, which is a decision about the PLENUM, not about one duct's
      // velocity) ; failing both, velocity picks it.
      diameterMm: diameterOverrides[seg.id] ?? seg.diameterMm,
      rigid: !!seg.rigid,
      fittings: [...(seg.fittings || []), ...extra]
    }, opts);

    sections.push({
      ...sized,
      // The geometry is part of the section, not a parallel drawing model.
      role: seg.role,
      parentId: seg.parentId ?? null,
      junctionId: seg.junctionId ?? null,
      roomId: seg.roomId ?? null,
      zone: seg.zone ?? null,
      // Which trunk arm this run belongs to — the drawing colours by it and the
      // pressure check walks it, so it has to survive sizing like the lock does.
      arm: seg.arm ?? null,
      // A major branch is the take-off feeding a group of rooms. The drawing
      // labels it and the installer sheet lists it, so it has to survive sizing.
      major: !!seg.major,
      serves: seg.serves ?? null,
      plenumOutlet: !!seg.plenumOutlet,
      // The NAC topology model's own fields. Without these the drawing, the
      // topology table and the validator all lose track of which main a run
      // belongs to and whether it comes off a BTO.
      nacRole: seg.nacRole ?? null,
      mainKey: seg.mainKey ?? null,
      btoNumber: seg.btoNumber ?? null,
      outletId: seg.outletId ?? null,
      flex: seg.flex !== false,
      // THE NAC BTO RULE: every take-off records the parent duct size, its own
      // size, the air it carries and what it serves. Filled in below once the
      // parent's diameter is known.
      bto: !!seg.bto || !!seg.major || seg.role === 'branch',
      points: seg.points || null,
      auto: true,
      // A lock is the estimator's decision about a real roof space. It has to
      // survive sizing, or the run redraws as unlocked and the next re-route
      // quietly overwrites it.
      locked: !!seg.locked,
      lockedBy: seg.lockedBy || null,
      lockedAt: seg.lockedAt || null,
      // Geometry the estimator moved by hand, so the drawing can show which
      // runs are theirs and which the tool laid out.
      edited: !!seg.edited,
      editedAt: seg.editedAt || null
    });
  }

  // THE NAC DUCT DESIGN STANDARD: a main may not reduce past a final it still
  // has to serve. Velocity alone wanted to take a main down to 200 while two
  // 250 finals were still to come off it, which forced those finals down a
  // size — the same room ending up with a 250 and a 200 for identical airflow.
  // The install rule outranks the velocity band here: a slow main tail costs
  // nothing, an undersized final is noise at the diffuser.
  //
  // Worked from the leaves back toward the plenum, so lifting a stretch also
  // lifts every stretch above it and a main can never be narrower than the one
  // it feeds.
  {
    const byIdNow = new Map(sections.map(s => [s.id, s]));
    const kids = new Map();
    for (const s of sections) {
      if (!s.parentId) continue;
      if (!kids.has(s.parentId)) kids.set(s.parentId, []);
      kids.get(s.parentId).push(s);
    }
    const isMain = (s) => s.role === 'main' || s.role === 'trunk';
    const depth = (s) => { let n = 0, c = s; while (c?.parentId && n < 40) { c = byIdNow.get(c.parentId); n += 1; } return n; };
    const mains = sections.filter(isMain).sort((a, b) => depth(b) - depth(a));
    for (const m of mains) {
      const children = kids.get(m.id) || [];
      // What each final coming off this stretch ASKS FOR from its airflow,
      // before any capping — capping to a too-small main is the bug.
      // FINALS ONLY. The rule is about the run into an OUTLET — that is what
      // must not be full bore on its main. A major branch is an intermediate
      // duct that legitimately sits one size under the main feeding it, and
      // counting it here inflated every main on a tree whose children are
      // branches rather than finals.
      const finalWants = children.filter(c => c.role === 'final')
        .map(c => c.cappedFromMm || c.diameterMm);
      const childMain = Math.max(0, ...children.filter(isMain).map(c => c.diameterMm || 0));
      // A MAIN IS NEVER A 250 — the floor is the largest final still to come
      // off it, or the smallest main NAC runs, whichever is bigger.
      const floor = Math.max(MIN_MAIN_DIAMETER_MM,
        mainFloorForFinals(m.diameterMm, finalWants, childMain || null));
      if (floor > m.diameterMm) {
        m.heldUpFromMm = m.diameterMm;
        m.diameterMm = floor;
        m.sizeNote = floor === MIN_MAIN_DIAMETER_MM
          ? 'Held at ' + floor + ' mm: NAC does not run a main smaller than this.'
          : 'Held at ' + floor + ' mm: a main is never reduced past a final ' +
            'still to come off it.';
      }
    }
  }

  // THE NAC DUCT DESIGN STANDARD: a take-off is never larger than the run
  // feeding it. The branch velocity band is tighter than the trunk band, so a
  // major branch could ask for a size up from the main it comes off — which is
  // not a duct anybody installs.
  const parentOf = new Map(sections.map(s => [s.id, s.parentId]));
  const sizeById = new Map(sections.map(s => [s.id, s.diameterMm]));
  for (const s of sections) {
    if (s.role !== 'branch' && s.role !== 'final') continue;
    const pid = parentOf.get(s.id);
    const parentMm = pid ? sizeById.get(pid) : null;
    const capped = capBranchToParent(s.diameterMm, parentMm);
    if (capped !== s.diameterMm) {
      s.cappedFromMm = s.diameterMm;
      s.diameterMm = capped;
      s.sizeNote = 'Held at ' + capped + ' mm: a take-off is never larger than the ' +
                   parentMm + ' mm run feeding it.';
      sizeById.set(s.id, capped);
    }
  }

  // Reducers. THE NAC DUCT DESIGN STANDARD decides when one genuinely exists:
  // only where a main or major duct steps down because the air it is still
  // carrying has dropped. Never to reach outlet size — that is what the BTO is
  // for, and calling a take-off a reducer put a fitting on the order nobody
  // installs and a loss in the calculation that is not there.
  const byId = new Map(sections.map(s => [s.id, s]));
  for (const s of sections) {
    if (!s.parentId) continue;
    const parent = byId.get(s.parentId);
    if (!reducerRequired(parent, s)) continue;
    s.reducerFrom = parent.diameterMm;
    s.reducerTo = s.diameterMm;
  }

  // THE NAC BTO RULE — MAIN FLEX -> BTO -> CORRECTLY SIZED FINAL FLEX -> OUTLET.
  // Every take-off carries the four things an installer and the order need:
  // what it comes off, what size it is, what it carries and what it serves.
  for (const s of sections) {
    if (!s.bto) { s.btoRecord = null; continue; }
    const parent = s.parentId ? byId.get(s.parentId) : null;
    s.btoRecord = {
      id: 'bto_' + s.id,
      sectionId: s.id,
      parentSectionId: parent?.id ?? null,
      parentDiameterMm: parent?.diameterMm ?? null,
      branchDiameterMm: s.diameterMm ?? null,
      branchAirflowLs: s.airflowLs ?? null,
      serves: s.serves || (s.destination ? [s.destination] : []),
      major: !!s.major,
      // The transition happens AT the take-off. There is no reducer here.
      reducer: false
    };
  }

  const totalsByDiameter = {};
  for (const s of sections) {
    totalsByDiameter[s.diameterMm] = round((totalsByDiameter[s.diameterMm] || 0) + (s.lengthM || 0), 2);
  }

  return {
    sections,
    routed: true,
    topology: { nodes: topology.nodes, footprint: topology.footprint, spine: topology.spine,
                plenum: topology.plenum, junctionCount: topology.junctionCount },
    reducerCount: sections.filter(s => s.reducerFrom).length,
    // Every take-off in the design, which is what the BOM buys and the
    // installer sheet lists.
    btos: sections.filter(s => s.btoRecord).map(s => s.btoRecord),
    btoCount: sections.filter(s => s.btoRecord).length,
    // THE NAC SUPPLY PLENUM RULE: the mains leaving the fan coil, with the size
    // and airflow the BOM and the installer sheet need.
    supplyMains: sections.filter(s => s.plenumOutlet).map(s => ({
      segmentId: s.id, arm: s.arm ?? null, diameterMm: s.diameterMm,
      airflowLs: s.airflowLs, serves: s.serves || null
    })),
    mainSupplyCount: sections.filter(s => s.plenumOutlet).length,
    junctionCount: topology.junctionCount || 0,
    totalDuctLengthM: round(sections.reduce((s, x) => s + (x.lengthM || 0), 0), 2),
    totalsByDiameter,
    warnings: sections.flatMap(s => s.warnings).concat(topology.warnings || []),
    settingsVelocity: settings.duct.velocity
  };
}

/** The index run — the highest-pressure path from the unit to a diffuser. */
export function indexRun(network) {
  // A ROUTED design is a real tree, so the index run has to be walked through
  // it. The flat shape below only ever looked at main + branch + final, which
  // on a routed system silently ignores every intermediate trunk run and
  // UNDERSTATES the pressure the fan has to make.
  if (network?.routed) return indexRunThroughTree(network);

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
