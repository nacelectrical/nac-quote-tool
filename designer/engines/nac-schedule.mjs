// ═══════════════════════════════════════════════════════════════════════════
// THE NAC DUCT DESIGN SCHEDULE
// ═══════════════════════════════════════════════════════════════════════════
//
// The design as PLAIN TEXT, before anybody draws it.
//
// A drawing can hide a bad design behind nice curves. A schedule cannot: every
// duct, every take-off, every reducer and the reason it exists are written
// down in numbers an estimator can check against what NAC actually installs.
//
// This is the thing that gets approved. The renderer draws whatever this says,
// so if the schedule is wrong the drawing is wrong, and the schedule is where
// that gets caught.
//
// It reads the SIZED network — the same sections the BOM, the pressure
// calculation and the plan all read — so it can never describe a different
// system from the one being quoted.

import {
  FINAL_FLEX, SUPPLY_PLENUM, RETURN_AIR, MAIN_REDUCTIONS, STOCKED_DIAMETERS_MM,
  MIN_MAIN_DIAMETER_MM, RETURN_DUCT_SIZES_MM, plenumBalance
} from './nac-standard.mjs';
import { DEFAULT_SETTINGS } from './settings.mjs';
import { buildOutletRegister } from './outlet-register.mjs';

const pad = (v, n) => String(v ?? '').padEnd(n);
const rpad = (v, n) => String(v ?? '').padStart(n);
const dia = (mm) => (mm ? 'ø' + mm : '—');

/** Velocity in m/s for an airflow in L/s through a round duct of diameter mm. */
export function velocityMs(airflowLs, diameterMm) {
  if (!airflowLs || !diameterMm) return null;
  const r = diameterMm / 2000;
  const area = Math.PI * r * r;
  return Math.round(((airflowLs / 1000) / area) * 100) / 100;
}

/**
 * Everything the schedule states, as data.
 *
 * Text formatting is a separate step so the same figures can go into the PDF,
 * the screen and a test without being re-derived anywhere.
 */
export function nacScheduleData(design, opts = {}) {
  const settings = opts.settings || design?.settings || DEFAULT_SETTINGS;
  const band = settings.duct?.velocity?.main || { preferredMin: 4, preferred: 6, max: 8 };
  const sections = design?.network?.sections || [];
  const byId = new Map(sections.map(s => [s.id, s]));
  const children = new Map();
  for (const s of sections) {
    if (!s.parentId) continue;
    if (!children.has(s.parentId)) children.set(s.parentId, []);
    children.get(s.parentId).push(s);
  }

  const finals = sections.filter(s => s.role === 'final');
  const mains = sections.filter(s => s.role === 'main' || s.role === 'trunk');
  const majors = sections.filter(s => s.role === 'branch');
  const plenumDucts = sections.filter(s => !s.parentId && s.role !== 'return');

  /** Every outlet fed from this run, however far downstream. */
  const downstreamOutlets = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const out = [];
    for (const c of (children.get(id) || [])) {
      if (c.role === 'final') out.push(c);
      out.push(...downstreamOutlets(c.id, seen));
    }
    return out;
  };

  // ── 1. Supply plenum ─────────────────────────────────────────────────────
  const plenumSizes = [...new Set(plenumDucts.map(s => s.diameterMm))];
  const balance = plenumBalance(plenumDucts.map(s => s.airflowLs));
  const plenum = {
    ductCount: plenumDucts.length,
    allowedMin: SUPPLY_PLENUM.minMains,
    allowedMax: SUPPLY_PLENUM.maxMains,
    // THE NAC PLENUM RULE: one size across all of them, air shared evenly.
    sizesMm: plenumSizes,
    sameSize: plenumSizes.length === 1,
    ductSizeMm: plenumSizes.length === 1 ? plenumSizes[0] : null,
    balance,
    tolerancePct: SUPPLY_PLENUM.balanceTolerancePct,
    totalAirflowLs: plenumDucts.reduce((n, s) => n + (s.airflowLs || 0), 0),
    ducts: plenumDucts.map(s => ({
      id: s.id,
      name: 'Main ' + (s.mainKey || s.id),
      diameterMm: s.diameterMm,
      airflowLs: s.airflowLs,
      velocityMs: velocityMs(s.airflowLs, s.diameterMm),
      serves: s.serves || [],
      zones: [...new Set(downstreamOutlets(s.id).map(f => f.zone).filter(Boolean))],
      outletCount: downstreamOutlets(s.id).length
    }))
  };

  // ── 2. Mains and major branches ──────────────────────────────────────────
  // A main is ONE duct. Where it steps down it is recorded as stretches of
  // that same duct, not as separate ducts — a reduction is not a new main.
  const mainKeys = [...new Set(mains.map(s => s.mainKey).filter(Boolean))].sort();
  const mainRuns = mainKeys.map(key => {
    const chain = mains.filter(s => s.mainKey === key)
      .sort((a, b) => (a.id === 'main_' + key ? -1 : b.id === 'main_' + key ? 1 : a.id.localeCompare(b.id)));
    return {
      key,
      name: 'Main ' + key,
      leavesPlenumAtMm: chain[0]?.diameterMm ?? null,
      airflowLs: chain[0]?.airflowLs ?? null,
      reductions: chain.filter(s => s.reducerFrom).length,
      stretches: chain.map(s => {
        const outs = downstreamOutlets(s.id);
        return {
          id: s.id,
          diameterMm: s.diameterMm,
          airflowLs: s.airflowLs,
          velocityMs: velocityMs(s.airflowLs, s.diameterMm),
          lengthM: s.lengthM,
          reducedFromMm: s.reducerFrom || null,
          outletCount: outs.length,
          outlets: outs.map(f => f.destination)
        };
      })
    };
  });

  const majorBranches = majors.map(s => {
    const outs = downstreamOutlets(s.id);
    return {
      id: s.id,
      parentId: s.parentId,
      parentDiameterMm: byId.get(s.parentId)?.diameterMm ?? null,
      diameterMm: s.diameterMm,
      airflowLs: s.airflowLs,
      velocityMs: velocityMs(s.airflowLs, s.diameterMm),
      serves: s.serves || [],
      outletCount: outs.length
    };
  });

  // ── 3. Branch take-offs ──────────────────────────────────────────────────
  const outletRowByRoom = new Map((design?.outlets?.rows || []).map(r => [r.roomId, r]));
  const roomLabel = (s) => outletRowByRoom.get(s.roomId)?.label || s.destination;

  const btos = sections.filter(s => s.bto)
    .sort((a, b) => (a.btoNumber || 0) - (b.btoNumber || 0))
    .map(s => {
      const parent = byId.get(s.parentId);
      const row = outletRowByRoom.get(s.roomId);
      return {
        number: s.btoNumber,
        parentId: s.parentId,
        parentRole: parent?.role === 'branch' ? 'major branch' : 'main',
        parentDiameterMm: parent?.diameterMm ?? null,
        branchDiameterMm: s.diameterMm,
        airflowLs: s.airflowLs,
        // A take-off either feeds ONE outlet, or it feeds a major branch that
        // then feeds several. Both are real take-offs somebody fits; only the
        // first has a room and an outlet behind it.
        feedsBranch: s.nacRole === 'MAJOR_BRANCH',
        room: s.nacRole === 'MAJOR_BRANCH' ? '—' : roomLabel(s),
        outlet: s.nacRole === 'MAJOR_BRANCH'
          ? s.id + ' (' + (s.serves || []).length + ' rooms)' : s.destination,
        outletOfRoom: row ? row.quantity : 1,
        zone: s.zone || null,
        reducedAtBto: parent && parent.diameterMm !== s.diameterMm
      };
    });

  // ── 4. Final outlets, per room ───────────────────────────────────────────
  //
  // READ OFF THE OUTLET REGISTER. The neck printed here is the neck the order
  // buys and the neck the plan draws, because all three now read one record.
  // This used to take `row.neckMm` straight from the outlet engine while the
  // size column beside it came from the network, so a declared ø250 outlet duct
  // was listed as a ø300 neck on the same line as the ø250 flex feeding it.
  const register = design?.outletRegister || buildOutletRegister(design);
  const regByRoom = new Map();
  for (const o of register) {
    if (!regByRoom.has(o.roomId)) regByRoom.set(o.roomId, []);
    regByRoom.get(o.roomId).push(o);
  }

  const rooms = [];
  for (const row of (design?.outlets?.rows || [])) {
    const runs = finals.filter(f => f.roomId === row.roomId);
    if (!runs.length) continue;
    const regRows = regByRoom.get(row.roomId) || [];
    const necks = [...new Set(regRows.map(o => o.neckMm).filter(Boolean))];
    rooms.push({
      room: row.label,
      zone: runs[0].zone || null,
      outletCount: regRows.length || row.quantity,
      perOutletLs: row.perOutletLs,
      totalLs: row.airflowLs,
      finalSizesMm: [...new Set(runs.map(r => r.diameterMm))].sort((a, b) => a - b),
      // One neck size per room in every real case; the array form is there so a
      // room with two different outlets cannot be silently reduced to one.
      neckMm: necks.length === 1 ? necks[0] : (necks.length ? necks : row.neckMm),
      neckByBandMm: regRows[0]?.neckByBandMm ?? row.neckMm,
      neckFollowsDeclaredDuct: regRows.some(o => o.neckFollowsDeclaredDuct),
      outletIds: regRows.map(o => o.id),
      outletType: row.typeLabel,
      velocityMs: velocityMs(row.perOutletLs, runs[0].diameterMm),
      btoNumbers: runs.map(r => r.btoNumber).sort((a, b) => a - b)
    });
  }

  // ── 5. Return air ────────────────────────────────────────────────────────
  const rd = design?.returnDesign || null;
  const ret = {
    // GRILLES and DUCTS are different counts. A return POINT is a grille in a
    // ceiling; a return DUCT is a run back to a spigot on the fan coil, and the
    // unit fixes how many of those there are.
    pointCount: rd?.returnCount ?? null,
    ductCount: rd?.duct?.ductCount ?? rd?.returnCount ?? null,
    fromUnitSpec: !!rd?.duct?.fromUnitSpec,
    unitConnection: rd?.duct?.unitReturnFlangeText || null,
    perDuctLs: rd?.perDuctLs ?? rd?.perReturnLs ?? null,
    allowedMin: RETURN_AIR.minReturns,
    allowedMax: RETURN_AIR.maxReturns,
    totalAirflowLs: rd?.designAirflowLs ?? null,
    rule: rd?.returnCountRule || null,

    // One row per DUCT, carrying the air that is actually in that duct.
    ducts: [...Array(rd?.duct?.ductCount ?? rd?.returnCount ?? 0)].map((_, i) => ({
      index: i + 1,
      diameterMm: rd?.duct?.diameterMm ?? null,
      airflowLs: rd?.perDuctLs ?? rd?.perReturnLs ?? null,
      velocityMs: velocityMs(rd?.perDuctLs ?? rd?.perReturnLs, rd?.duct?.diameterMm),
      grilleSize: rd?.returns?.[i]?.grilleSize ?? null,
      faceVelocityMs: rd?.returns?.[i]?.faceVelocityMs ?? null
    })),
    // One row per GRILLE.
    points: (rd?.returns || []).map(r => ({
      index: r.index, airflowLs: r.airflowLs,
      grilleSize: r.grilleSize, faceVelocityMs: r.faceVelocityMs
    }))
  };

  // ── 6. Reducers, each with the reason it is there ────────────────────────
  // A reducer is only ever on a main, and only where the air coming off the
  // take-offs above it has left the main oversized. The reason states both
  // halves of that: what the main would run at if it stayed, and what it runs
  // at once it steps down.
  const reducers = sections.filter(s => s.reducerFrom).map((s, i) => {
    const parent = byId.get(s.parentId);
    const takenOff = (children.get(s.parentId) || [])
      .filter(c => c.role === 'final' || c.role === 'branch');
    const vIfKept = velocityMs(s.airflowLs, s.reducerFrom);
    const vAfter = velocityMs(s.airflowLs, s.diameterMm);
    // How small this stretch was ALLOWED to go. A main tail carrying 150 L/s
    // would like to be a 200, but it still has 250 finals coming off it, so it
    // stays a 250 and runs slow. That is the install rule beating the velocity
    // band, and the schedule has to say so rather than look like a mistake.
    const finalsFloor = Math.max(0, ...downstreamOutlets(s.id).map(f => f.diameterMm || 0));
    const floorMm = Math.max(finalsFloor, MIN_MAIN_DIAMETER_MM);
    const heldByFinals = s.diameterMm <= floorMm && vAfter < band.preferredMin;
    const heldBy = !heldByFinals ? null
      : finalsFloor >= MIN_MAIN_DIAMETER_MM ? 'finals' : 'min_main';
    return {
      ref: 'R' + (i + 1),
      onRun: s.mainKey ? 'Main ' + s.mainKey : s.id,
      sectionId: s.id,
      fromMm: s.reducerFrom,
      toMm: s.reducerTo,
      afterBtos: takenOff.map(c => c.btoNumber).filter(Boolean).sort((a, b) => a - b),
      airflowBeforeLs: parent?.airflowLs ?? null,
      airflowAfterLs: s.airflowLs,
      velocityIfNotReducedMs: vIfKept,
      velocityAfterMs: vAfter,
      bandMinMs: band.preferredMin,
      bandMaxMs: band.max,
      onFinal: s.role === 'final',
      bandPreferredMs: band.preferred,
      // Two different reasons, and the schedule must say which one applies.
      // Below the MINIMUM the old size is genuinely not working any more;
      // between the minimum and the target it is merely oversized, and the
      // step is bought because the smaller duct is closer to how NAC runs a
      // main. Saying "under the minimum" when it is 4.40 against a 4.00
      // minimum is the sort of near-enough reason that hides a real mistake.
      finalsFloorMm: finalsFloor || null,
      floorMm,
      heldByFinals,
      heldBy,
      reason: vIfKept < band.preferredMin ? 'below_minimum' : 'oversized',
      why: s.role === 'final'
        ? 'ON A FINAL — not allowed. The BTO takes the branch to final size.'
        : takenOff.length
          ? (parent?.airflowLs ?? '?') + ' L/s becomes ' + s.airflowLs + ' L/s after take-off' +
            (takenOff.length > 1 ? 's ' : ' ') +
            takenOff.map(c => c.btoNumber).filter(Boolean).join(', ') + '. ' +
            (vIfKept < band.preferredMin
              ? 'Left at ' + dia(s.reducerFrom) + ' the main would run at ' + vIfKept +
                ' m/s, under the ' + band.preferredMin + ' m/s minimum for a main'
              : 'Left at ' + dia(s.reducerFrom) + ' the main would run at ' + vIfKept +
                ' m/s against a ' + band.preferred + ' m/s target — oversized for what ' +
                'it still carries') +
            '; at ' + dia(s.diameterMm) + ' it runs at ' + vAfter + ' m/s' +
            (heldByFinals
              ? ', below the ' + band.preferredMin + ' m/s band \u2014 it cannot go ' +
                'smaller because ' + (heldBy === 'finals'
                  ? dia(finalsFloor) + ' finals still come off it.'
                  : dia(MIN_MAIN_DIAMETER_MM) + ' is the smallest main NAC runs.')
              : '.')
          : 'Airflow falls to ' + s.airflowLs + ' L/s; ' + dia(s.diameterMm) +
            ' holds ' + vAfter + ' m/s.'
    };
  });

  return {
    plan: design?.plan?.name || null,
    unit: design?.selectedUnit
      ? design.selectedUnit.brandName + ' ' + design.selectedUnit.model : null,
    systemAirflowLs: design?.airflow?.systemAirflowLs ?? null,
    conditionedRooms: rooms.length,
    plenum, mainRuns, majorBranches, btos, rooms, ret, reducers,
    totals: {
      mains: plenumDucts.length,
      mainStretches: mains.length,
      majorBranches: majors.length,
      btos: btos.length,
      outletBtos: btos.filter(b => !b.feedsBranch).length,
      finals: finals.length,
      outlets: rooms.reduce((n, r) => n + r.outletCount, 0),
      returns: ret.ductCount,
      reducers: reducers.length
    }
  };
}

/**
 * The NAC hard rules, checked against the schedule itself.
 *
 * Every one of these is a rule Nick has stated, and each is checked against
 * the figures above rather than against the code that produced them — so a
 * routing change that breaks a rule shows up here as a FAIL, not as a drawing
 * somebody has to squint at.
 */
export function checkNacSchedule(data) {
  const checks = [];
  const check = (rule, ok, detail) => checks.push({ rule, ok: !!ok, detail });
  // A NOTE is not a failure. Some rules pull against one another on a real
  // house — you cannot both follow the areas an installer works in and share
  // the air evenly when one area is two thirds of it. Where that happens the
  // schedule says which way it went and by how much, rather than failing a
  // design that is right or quietly redrawing the house to make a number come
  // out.
  const note = (rule, ok, detail) => checks.push({ rule, ok: !!ok, note: !ok, detail });

  check('Supply plenum carries ' + SUPPLY_PLENUM.minMains + ' or ' + SUPPLY_PLENUM.maxMains + ' ducts only',
    data.plenum.ductCount >= SUPPLY_PLENUM.minMains && data.plenum.ductCount <= SUPPLY_PLENUM.maxMains,
    data.plenum.ductCount + ' ducts off the plenum');

  check('Every duct off the plenum is the same size',
    data.plenum.sameSize,
    data.plenum.sameSize ? data.plenum.ductCount + ' x ' + dia(data.plenum.ductSizeMm)
      : data.plenum.sizesMm.map(dia).join(' + '));

  note('The air is shared evenly across them (within ' +
    data.plenum.tolerancePct + '%)',
    data.plenum.balance.balanced,
    data.plenum.balance.flows.join(' / ') + ' L/s against a ' +
    data.plenum.balance.meanLs + ' L/s even share \u2014 worst ' +
    data.plenum.balance.worstDeviationPct + '% off. ' +
    'The mains follow the areas of the house, so where one area carries most of ' +
    'the air the ducts off the plenum carry it too.');

  const smallMains = data.mainRuns.flatMap(m =>
    m.stretches.filter(s => s.diameterMm < MIN_MAIN_DIAMETER_MM)
      .map(s => m.name + '/' + s.id + ' ' + dia(s.diameterMm)));
  check('No main is smaller than ' + dia(MIN_MAIN_DIAMETER_MM),
    smallMains.length === 0,
    smallMains.length ? smallMains.join(', ')
      : 'smallest main run is ' + dia(Math.min(...data.mainRuns
          .flatMap(m => m.stretches.map(s => s.diameterMm)))));

  check('Return is ' + RETURN_AIR.minReturns + ' or ' + RETURN_AIR.maxReturns + ' ducts only',
    data.ret.ductCount >= RETURN_AIR.minReturns && data.ret.ductCount <= RETURN_AIR.maxReturns,
    data.ret.ductCount + ' return duct(s)');

  const badFinal = data.rooms.filter(r =>
    r.finalSizesMm.some(mm => !FINAL_FLEX.autoSizesMm.includes(mm)));
  check('Finals are ' + FINAL_FLEX.autoSizesMm.join(' / ') + ' only',
    badFinal.length === 0,
    badFinal.length ? badFinal.map(r => r.room + ' ' + dia(r.finalSizesMm[0])).join(', ')
      : [...new Set(data.rooms.flatMap(r => r.finalSizesMm))].sort((a, b) => a - b)
        .map(dia).join(' / ') + ' across ' + data.totals.finals + ' finals');

  const small = data.rooms.filter(r => r.finalSizesMm.some(mm => mm < FINAL_FLEX.minMm));
  check('No final below ' + FINAL_FLEX.minMm + ' mm — no 150s',
    small.length === 0,
    small.length ? small.map(r => r.room).join(', ') : 'smallest final is ' +
      dia(Math.min(...data.rooms.flatMap(r => r.finalSizesMm))));

  const big = data.rooms.filter(r => r.finalSizesMm.some(mm => mm > FINAL_FLEX.maxMm));
  check('No final above ' + FINAL_FLEX.maxMm + ' mm',
    big.length === 0,
    big.length ? big.map(r => r.room).join(', ') : 'largest final is ' +
      dia(Math.max(...data.rooms.flatMap(r => r.finalSizesMm))));

  // More air than one 300 can carry means ANOTHER OUTLET, never a bigger duct.
  const maxPerOutlet = data.rooms.filter(r => r.perOutletLs > 160);
  check('More airflow is met by another outlet, not a bigger final',
    maxPerOutlet.length === 0,
    maxPerOutlet.length ? maxPerOutlet.map(r => r.room + ' ' + r.perOutletLs + ' L/s').join(', ')
      : 'heaviest outlet is ' + Math.max(...data.rooms.map(r => r.perOutletLs)) + ' L/s');

  // A take-off onto a MAJOR BRANCH is a real take-off too — the bedroom wing
  // comes off the main through one. What the rule is about is that no outlet is
  // reached any other way, so it is the OUTLET take-offs that must match the
  // finals, not every take-off on the job.
  check('Every final outlet comes directly from a BTO',
    data.totals.outletBtos === data.totals.finals,
    data.totals.outletBtos + ' take-offs to an outlet for ' + data.totals.finals +
    ' finals' + (data.totals.btos > data.totals.outletBtos
      ? ', plus ' + (data.totals.btos - data.totals.outletBtos) + ' onto a major branch' : ''));

  const reducerOnFinal = data.reducers.filter(r => r.onFinal);
  check('No reducer between a BTO and its outlet',
    reducerOnFinal.length === 0,
    reducerOnFinal.length ? reducerOnFinal.map(r => r.ref).join(', ')
      : data.totals.reducers + ' reducers, all on mains');

  const overReduced = data.mainRuns.filter(m => m.reductions > MAIN_REDUCTIONS.maxPerMain);
  check('Reducers only where a main genuinely reduces (max ' +
    MAIN_REDUCTIONS.maxPerMain + ' per main)',
    overReduced.length === 0,
    overReduced.length ? overReduced.map(m => m.name + ' ' + m.reductions).join(', ')
      : data.mainRuns.map(m => m.name + ': ' + m.reductions).join(', '));

  // An "artificial trunk fragment" is a stretch of main that carries the same
  // size as the one before it — a split for no reason.
  const fragments = data.mainRuns.flatMap(m =>
    m.stretches.filter((s, i) => i > 0 && !s.reducedFromMm).map(s => m.name + '/' + s.id));
  check('No artificial trunk fragments — a main splits only where it reduces',
    fragments.length === 0,
    fragments.length ? fragments.join(', ')
      : data.totals.mainStretches + ' stretches across ' + data.totals.mains +
        ' mains = ' + data.totals.mains + ' runs + ' +
        (data.totals.mainStretches - data.totals.mains) + ' reductions');

  // SUPPLY and RETURN have different ladders, and that is deliberate. "Never a
  // 450" is a rule about supply; on the return a 450 is what goes on a big
  // unit, because the whole system comes back through one or two ducts.
  const supplySizes = [...new Set([
    ...data.plenum.ducts.map(d => d.diameterMm),
    ...data.mainRuns.flatMap(m => m.stretches.map(s => s.diameterMm)),
    ...data.majorBranches.map(b => b.diameterMm),
    ...data.rooms.flatMap(r => r.finalSizesMm)
  ])].filter(Boolean);
  const offLadder = supplySizes.filter(mm => !STOCKED_DIAMETERS_MM.includes(mm));
  check('Every SUPPLY size is one NAC stocks — no 450, no 500',
    offLadder.length === 0,
    offLadder.length ? offLadder.map(dia).join(', ')
      : supplySizes.sort((a, b) => a - b).map(dia).join(' / '));

  const badReturn = data.ret.ducts.map(d => d.diameterMm)
    .filter(mm => mm && !RETURN_DUCT_SIZES_MM.includes(mm));
  check('Every RETURN duct is a size NAC fits (' +
    RETURN_DUCT_SIZES_MM.join(' / ') + ')',
    badReturn.length === 0,
    badReturn.length ? badReturn.map(dia).join(', ')
      : [...new Set(data.ret.ducts.map(d => dia(d.diameterMm)))].join(' / '));

  // Every duct carries only its own share — the double-count that had 601 L/s
  // in a duct the design thought was carrying 300.
  const ductTotal = data.ret.ducts.reduce((n, d) => n + (d.airflowLs || 0), 0);
  check('The return ducts carry the whole system between them',
    data.ret.totalAirflowLs ? Math.abs(ductTotal - data.ret.totalAirflowLs) <= 2 : true,
    data.ret.ductCount + ' × ' + dia(data.ret.ducts[0]?.diameterMm) + ' carrying ' +
    ductTotal + ' L/s of ' + data.ret.totalAirflowLs + ' L/s');

  const oversizedBranch = data.btos.filter(b =>
    b.parentDiameterMm && b.branchDiameterMm > b.parentDiameterMm);
  check('No take-off is larger than the duct it comes off',
    oversizedBranch.length === 0,
    oversizedBranch.length ? oversizedBranch.map(b => 'BTO ' + b.number).join(', ')
      : 'all ' + data.totals.btos + ' take-offs within their parent');

  // FULL BORE: a take-off the same size as the main it comes off, with air
  // still to carry past it. Rejected at 250; it is the same fault at 300.
  const fullBore = data.btos.filter(b => b.parentRole === 'main' &&
    b.parentDiameterMm && b.branchDiameterMm >= b.parentDiameterMm);
  check('No take-off is the same size as the main it comes off',
    fullBore.length === 0,
    fullBore.length
      ? fullBore.map(b => 'BTO ' + b.number + ' ' + dia(b.branchDiameterMm) +
          ' off ' + dia(b.parentDiameterMm)).join(', ')
      : 'every take-off is at least a size under its main');

  const hard = checks.filter(c => !c.note);
  return { ok: hard.every(c => c.ok), checks,
           passed: hard.filter(c => c.ok).length,
           failed: hard.filter(c => !c.ok).length,
           hardCount: hard.length,
           notes: checks.filter(c => c.note && !c.ok) };
}

/**
 * The schedule as text, in the order an estimator reads it.
 */
/** Break a sentence into lines no longer than n characters. */
function wrapAt(text, n) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > n) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines;
}

export function nacDuctSchedule(design, opts = {}) {
  const d = nacScheduleData(design, opts);
  const v = checkNacSchedule(d);
  const L = [];
  const rule = (c) => L.push('─'.repeat(c || 78));

  L.push('NAC DUCT DESIGN SCHEDULE');
  rule();
  L.push('System      ' + (d.unit || '—'));
  L.push('Airflow     ' + d.systemAirflowLs + ' L/s over ' + d.conditionedRooms +
         ' conditioned rooms, ' + d.totals.outlets + ' outlets');
  L.push('');

  // ── 1 ────────────────────────────────────────────────────────────────────
  L.push('1. SUPPLY PLENUM');
  rule();
  L.push('   Supply ducts off the plenum: ' + d.plenum.ductCount +
         ' \u00d7 ' + dia(d.plenum.ductSizeMm) +
         '   (NAC fits ' + d.plenum.allowedMin + ' or ' + d.plenum.allowedMax +
         ', all one size)');
  L.push('   Even share: ' + d.plenum.balance.meanLs + ' L/s each. Worst duct is ' +
         d.plenum.balance.worstDeviationPct + '% off that (tolerance ' +
         d.plenum.tolerancePct + '%).');
  L.push('');
  L.push('   ' + pad('DUCT', 9) + pad('SIZE', 7) + rpad('AIRFLOW', 10) +
         rpad('VELOCITY', 11) + rpad('OUTLETS', 9) + '   SERVES');
  for (const x of d.plenum.ducts) {
    L.push('   ' + pad(x.name, 9) + pad(dia(x.diameterMm), 7) +
           rpad(x.airflowLs + ' L/s', 10) + rpad(x.velocityMs + ' m/s', 11) +
           rpad(x.outletCount, 9) + '   ' + x.serves.join(', '));
  }
  L.push('   ' + pad('', 9) + pad('total', 7) + rpad(d.plenum.totalAirflowLs + ' L/s', 10) +
         rpad('', 11) + rpad(d.totals.outlets, 9));
  L.push('');

  // ── 2 ────────────────────────────────────────────────────────────────────
  L.push('2. MAINS AND MAJOR FLEX DUCTS');
  rule();
  for (const m of d.mainRuns) {
    L.push('   ' + m.name.toUpperCase() + ' — leaves the plenum at ' +
           dia(m.leavesPlenumAtMm) + ', ' + m.airflowLs + ' L/s, ' +
           m.reductions + ' reduction' + (m.reductions === 1 ? '' : 's') +
           ' (' + m.stretches.length + ' stretch' + (m.stretches.length === 1 ? '' : 'es') + ')');
    L.push('     ' + pad('ID', 12) + pad('SIZE', 7) + rpad('AIRFLOW', 10) +
           rpad('VELOCITY', 11) + rpad('LENGTH', 9) + rpad('OUTLETS', 9) + '   DOWNSTREAM');
    for (const s of m.stretches) {
      L.push('     ' + pad(s.id, 12) + pad(dia(s.diameterMm), 7) +
             rpad(s.airflowLs + ' L/s', 10) + rpad(s.velocityMs + ' m/s', 11) +
             rpad(s.lengthM + ' m', 9) + rpad(s.outletCount, 9) + '   ' +
             s.outlets.join(', '));
    }
    L.push('');
  }
  if (d.majorBranches.length) {
    L.push('   MAJOR BRANCHES');
    L.push('     ' + pad('ID', 16) + pad('OFF', 8) + pad('SIZE', 7) + rpad('AIRFLOW', 10) +
           rpad('VELOCITY', 11) + '   SERVES');
    for (const b of d.majorBranches) {
      L.push('     ' + pad(b.id, 16) + pad(dia(b.parentDiameterMm), 8) +
             pad(dia(b.diameterMm), 7) + rpad(b.airflowLs + ' L/s', 10) +
             rpad(b.velocityMs + ' m/s', 11) + '   ' + b.serves.join(', '));
    }
  } else {
    L.push('   MAJOR BRANCHES: none. Every outlet on this plan sits close enough to');
    L.push('   a main to take off it directly, so no group of rooms shares a run out.');
  }
  L.push('');

  // ── 3 ────────────────────────────────────────────────────────────────────
  L.push('3. BRANCH TAKE-OFFS (BTO)');
  rule();
  L.push('   ' + rpad('BTO', 4) + '   ' + pad('OFF', 12) + pad('PARENT', 8) + pad('BRANCH', 8) +
         rpad('AIRFLOW', 10) + '   ' + pad('ROOM', 17) + 'OUTLET SERVED');
  for (const b of d.btos) {
    L.push('   ' + rpad(b.number, 4) + '   ' + pad(b.parentId, 12) +
           pad(dia(b.parentDiameterMm), 8) + pad(dia(b.branchDiameterMm), 8) +
           rpad(b.airflowLs + ' L/s', 10) + '   ' + pad(b.room, 17) +
           (b.feedsBranch ? b.outlet
            : b.outletOfRoom > 1 ? b.outlet : b.room + ' (single outlet)'));
  }
  L.push('');
  L.push('   ' + d.totals.btos + ' take-offs: ' + d.totals.outletBtos + ' to an outlet, ' +
         (d.totals.btos - d.totals.outletBtos) + ' to a major branch — ' +
         'every outlet comes off its own BTO.');
  L.push('');

  // ── 4 ────────────────────────────────────────────────────────────────────
  L.push('4. FINAL OUTLETS');
  rule();
  L.push('   ' + pad('ROOM', 17) + rpad('OUTLETS', 8) + rpad('EACH', 10) + rpad('TOTAL', 10) +
         '   ' + pad('FINAL FLEX', 13) + pad('NECK', 9) + 'FROM BTO');
  for (const r of d.rooms) {
    L.push('   ' + pad(r.room, 17) + rpad(r.outletCount, 8) +
           rpad(r.perOutletLs + ' L/s', 10) + rpad(r.totalLs + ' L/s', 10) + '   ' +
           pad(r.finalSizesMm.map(dia).join(' / '), 13) +
           pad(r.neckMm ? r.neckMm + ' mm' : '—', 9) + r.btoNumbers.join(', '));
  }
  L.push('   ' + pad('', 17) + rpad(d.totals.outlets, 8) + rpad('', 10) +
         rpad(d.rooms.reduce((n, r) => n + r.totalLs, 0) + ' L/s', 10) + '   total');
  L.push('');

  // ── 5 ────────────────────────────────────────────────────────────────────
  L.push('5. RETURN AIR');
  rule();
  L.push('   Return grilles: ' + d.ret.pointCount + '   ducts back to the unit: ' +
         d.ret.ductCount + ' \u00d7 ' + dia(d.ret.ducts[0]?.diameterMm) +
         '   (NAC fits ' + d.ret.allowedMin + ' or ' + d.ret.allowedMax + ' returns)');
  if (d.ret.fromUnitSpec) {
    L.push('   From the unit: ' + d.ret.unitConnection +
           ' \u2014 the fan coil\'s own return connection, so that is the duct.');
  } else if (d.ret.rule) {
    L.push('   ' + d.ret.rule + ' The unit states a rectangular flange, not round');
    L.push('   spigots, so NAC standard return sizing applies.');
  }
  L.push('');
  L.push('   ' + pad('DUCT', 10) + pad('SIZE', 7) + rpad('AIRFLOW', 10) + rpad('VELOCITY', 11) +
         '   ' + pad('GRILLE', 15) + 'FACE VELOCITY');
  for (const r of d.ret.ducts) {
    L.push('   ' + pad('Return ' + r.index, 10) + pad(dia(r.diameterMm), 7) +
           rpad(r.airflowLs + ' L/s', 10) + rpad(r.velocityMs + ' m/s', 11) + '   ' +
           pad(r.grilleSize, 15) + r.faceVelocityMs + ' m/s');
  }
  L.push('   ' + pad('', 10) + pad('total', 7) + rpad(d.ret.totalAirflowLs + ' L/s', 10));
  L.push('');

  // ── 6 ────────────────────────────────────────────────────────────────────
  L.push('6. REDUCERS — AND WHY EACH ONE EXISTS');
  rule();
  if (!d.reducers.length) {
    L.push('   None. No main on this plan loses enough air to need one.');
  }
  for (const r of d.reducers) {
    L.push('   ' + r.ref + '  ' + r.onRun + '   ' + dia(r.fromMm) + ' → ' + dia(r.toMm) +
           '   on ' + r.sectionId);
    L.push('       ' + r.why);
  }
  L.push('');

  // ── 7 ────────────────────────────────────────────────────────────────────
  L.push('7. NAC HARD RULE CHECK');
  rule();
  for (const c of v.checks) {
    const mark = c.ok ? 'PASS' : (c.note ? 'NOTE' : 'FAIL');
    // A note carries a reason, and a reason does not fit on the end of a line.
    if (c.note && !c.ok) {
      L.push('   NOTE  ' + c.rule);
      for (const line of wrapAt(c.detail, 66)) L.push('         ' + line);
    } else {
      L.push('   ' + mark + '  ' + pad(c.rule, 62) + (c.detail ? '  ' + c.detail : ''));
    }
  }
  L.push('');
  rule();
  L.push((v.ok ? 'SCHEDULE PASSES ALL NAC HARD RULES' : 'SCHEDULE FAILS ' + v.failed + ' RULE(S)') +
         '   (' + v.passed + '/' + v.hardCount + ')' +
         (v.notes.length ? '   \u00b7  ' + v.notes.length + ' note' +
          (v.notes.length > 1 ? 's' : '') + ' to read' : ''));

  return L.join('\n');
}
