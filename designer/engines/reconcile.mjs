// ─────────────────────────────────────────────────────────────────────────────
// DO THE DRAWING, THE SCHEDULE, THE BOM AND THE PRESSURE DESCRIBE ONE SYSTEM?
//
// The review asked for exactly this: "Reconcile component IDs, connectivity,
// dimensions, lengths, airflow, zones and quantities across the drawing, duct
// schedule, BOM and pressure calculation."
//
// They are produced by different engines from the same design, and nothing was
// checking that they agreed. A duct schedule listing eleven runs, a BOM pricing
// nine, and a pressure figure built from an index run through a twelfth is four
// documents about four systems — and every one of them looks right on its own.
//
// This takes a finished design and asks, of each pair that SHOULD agree,
// whether it does. It does not fix anything and it does not guess: a
// disagreement is reported with both numbers, because which one is wrong is a
// question for whoever reads it.
//
// VOCABULARY. A finding is:
//   MISMATCH   two places state the same fact differently. Always a defect.
//   UNKNOWN    something could not be checked because an input is absent.
//              NOT a pass — the distinction the pressure engine already makes.
// ─────────────────────────────────────────────────────────────────────────────

const rows = (v) => Array.isArray(v) ? v : [];
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const round = (v, p = 2) => Math.round(v * Math.pow(10, p)) / Math.pow(10, p);

/** Within a cent, a litre, or a hundredth of a metre — not within a guess. */
const close = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

function mismatch(code, what, a, b, detail) {
  return { level: 'MISMATCH', code, what, left: a, right: b, detail };
}
function unknown(code, what, detail) {
  return { level: 'UNKNOWN', code, what, detail };
}

/**
 * @param {object} d a design that has been through runPipeline
 * @returns {{ok:boolean, findings:Array, checked:number, facts:object}}
 */
export function reconcileDesign(d) {
  const findings = [];
  let checked = 0;
  const check = (fn) => { checked++; const f = fn(); if (f) findings.push(f); };

  const net = d.network || {};
  const sections = rows(net.sections);
  const supply = sections.filter(s => s.role !== 'return');
  const bom = d.bom || {};
  const items = rows(bom.items);
  const sched = d.nacSchedule || null;
  const pressure = d.pressure || null;

  // ── 1. EVERY SECTION HAS AN ID, AND NO TWO SHARE ONE ────────────────────
  check(() => {
    const ids = supply.map(s => s.id).filter(Boolean);
    if (ids.length !== supply.length) {
      return mismatch('SECTION_ID_MISSING', 'duct sections with an id',
        ids.length, supply.length, 'A run with no id cannot be matched to a '
        + 'schedule line, a drawing or a BOM entry.');
    }
    const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dupes.length) {
      return mismatch('SECTION_ID_DUPLICATE', 'unique section ids',
        ids.length - dupes.length, ids.length, 'Repeated: ' + [...new Set(dupes)].join(', '));
    }
    return null;
  });

  // ── 2. THE TOTAL DUCT LENGTH IS THE SUM OF THE RUNS ─────────────────────
  check(() => {
    const stated = n(net.totalDuctLengthM);
    if (stated === null) return unknown('DUCT_TOTAL_UNKNOWN', 'total duct length',
      'The network states no total length.');
    const summed = round(supply.reduce((t, s) => t + (n(s.lengthM) || 0), 0));
    return close(stated, summed) ? null
      : mismatch('DUCT_TOTAL_MISMATCH', 'total supply duct length', stated, summed,
          'The stated total and the sum of the runs disagree by '
          + round(Math.abs(stated - summed)) + ' m.');
  });

  // ── 3. THE PER-DIAMETER TOTALS ADD UP TO THE SAME THING ─────────────────
  check(() => {
    const byDia = net.totalsByDiameter || null;
    if (!byDia || !Object.keys(byDia).length) {
      return unknown('DIAMETER_TOTALS_UNKNOWN', 'metres by diameter',
        'The network states no per-diameter totals, so the BOM cannot be checked '
        + 'against them.');
    }
    const fromSections = {};
    for (const s of supply) {
      const k = String(s.diameterMm);
      fromSections[k] = round((fromSections[k] || 0) + (n(s.lengthM) || 0));
    }
    for (const [dia, metres] of Object.entries(byDia)) {
      const mine = fromSections[String(dia)] || 0;
      if (!close(n(metres) || 0, mine, 0.02)) {
        return mismatch('DIAMETER_TOTAL_MISMATCH', 'metres of ø' + dia,
          n(metres), mine, 'The schedule of diameters and the runs themselves disagree.');
      }
    }
    return null;
  });

  // ── 4. THE BOM BUYS DUCT FOR THE RUNS THAT EXIST ────────────────────────
  check(() => {
    const ductLines = items.filter(i => /duct/i.test(String(i.key || '')) && n(i.lengthM) !== null);
    if (!ductLines.length) {
      // Some BOMs carry duct by 6 m length rather than by the metre.
      const byLength = items.filter(i => /duct/i.test(String(i.key || '')));
      if (!byLength.length) {
        return unknown('BOM_DUCT_UNKNOWN', 'duct on the bill of materials',
          'No duct line is on the BOM, so it cannot be checked against the routes.');
      }
      return null;
    }
    const bomM = round(ductLines.reduce((t, i) => t + (n(i.lengthM) || 0), 0));
    const netM = round(supply.reduce((t, s) => t + (n(s.lengthM) || 0), 0));
    // The BOM may legitimately carry MORE than the routes (waste, 6 m lengths,
    // the return). It must never carry less — that is duct nobody bought.
    return bomM + 0.05 >= netM ? null
      : mismatch('BOM_DUCT_SHORT', 'metres of duct bought', bomM, netM,
          'The bill of materials buys ' + round(netM - bomM) + ' m less duct than the '
          + 'routes need.');
  });

  // ── 5. OUTLET COUNT: REGISTER, SCHEDULE AND BOM ─────────────────────────
  check(() => {
    const fromOutlets = n(d.outlets && d.outlets.totals && d.outlets.totals.total);
    if (fromOutlets === null) {
      return unknown('OUTLET_TOTAL_UNKNOWN', 'outlet count', 'No outlet total is recorded.');
    }
    const register = rows(d.outletRegister && d.outletRegister.rows);
    if (register.length) {
      const regCount = register.reduce((t, r) => t + (n(r.quantity) ?? 1), 0);
      if (regCount !== fromOutlets) {
        return mismatch('OUTLET_COUNT_MISMATCH', 'outlets', fromOutlets, regCount,
          'The outlet totals and the outlet register disagree.');
      }
    }
    const bomOutlets = items.filter(i => /diffuser|linear|outlet/i.test(String(i.key || '')))
      .reduce((t, i) => t + (n(i.quantity) ?? 0), 0);
    if (bomOutlets > 0 && bomOutlets !== fromOutlets) {
      return mismatch('BOM_OUTLET_MISMATCH', 'outlets', fromOutlets, bomOutlets,
        'The design places ' + fromOutlets + ' outlets and the BOM buys ' + bomOutlets + '.');
    }
    return null;
  });

  // ── 6. ZONES: ANALYSIS, DAMPERS AND THE BOM ─────────────────────────────
  //
  // A DAMPER PER ZONE WOULD BE A DEFECT, NOT A RECONCILIATION.
  //
  // The constant zone — usually the main living area — has no damper, on
  // purpose: with every zone closable the fan has nowhere to push air when
  // they all shut. zones.mjs marks it `alwaysOpen`, and zoning-safety.mjs
  // refuses a design that has not nominated one. So the number to check
  // against is the number of CLOSABLE zones, and this check was wrong before
  // the engine was.
  check(() => {
    const zoneCount = n(d.zones && d.zones.zoneCount);
    if (zoneCount === null) return unknown('ZONE_COUNT_UNKNOWN', 'zone count',
      'No zone analysis is on the design.');
    const zoneRows = rows(d.zones && d.zones.zones);
    const closable = zoneRows.length
      ? zoneRows.filter(z => z.alwaysOpen !== true).length : null;
    const dampers = rows(d.zoneDampers).length;
    if (closable === null) {
      return unknown('ZONE_KINDS_UNKNOWN', 'which zones close',
        'The zone analysis does not say which zones are always open, so the damper '
        + 'count cannot be checked against it.');
    }
    if (dampers > 0 && dampers !== closable) {
      return mismatch('ZONE_DAMPER_MISMATCH', 'closable zones', closable, dampers,
        'The design has ' + zoneCount + ' zones, ' + closable + ' of them closable, and '
        + dampers + ' zone dampers.');
    }
    const bomDampers = items.filter(i => /zone_damper|damper/i.test(String(i.key || '')))
      .reduce((t, i) => t + (n(i.quantity) ?? 0), 0);
    if (bomDampers > 0 && dampers > 0 && bomDampers !== dampers) {
      return mismatch('BOM_DAMPER_MISMATCH', 'zone dampers', dampers, bomDampers,
        'The drawing shows ' + dampers + ' dampers and the BOM buys ' + bomDampers + '.');
    }
    return null;
  });

  // ── 7. BTOs: THE MODEL, THE NETWORK AND THE BOM ─────────────────────────
  //
  // `network.btoCount` IS NOT A COUNT OF BTOs. It counts TAKE-OFF POINTS — one
  // per branch and one per final leaving a BTO — which is why it equals
  // componentCounts.supplyBtoPortTotal and not supplyBtos. Four physical BTOs
  // with 2, 2, 2 and 3 ports is nine take-offs and four fittings, and the two
  // numbers are both right about different things.
  //
  // The number that gets fabricated, priced and hung in a roof is
  // componentCounts.supplyBtos, so that is what the model is checked against.
  // Reading network.btoCount as a fitting count is the mistake this comment
  // exists to stop somebody making twice.
  check(() => {
    const modelled = rows(d.btos).length;
    const counted = n(d.componentCounts && d.componentCounts.supplyBtos);
    if (counted !== null && modelled !== counted) {
      return mismatch('BTO_COUNT_MISMATCH', 'physical BTOs', modelled, counted,
        'The design models ' + modelled + ' BTO fittings and the component count says '
        + counted + '.');
    }
    // And the take-off count must agree with the ports on those fittings.
    const ports = rows(d.btos).reduce((t, b) => t + rows(b.ports).length, 0);
    const takeOffs = n(net.btoCount);
    if (takeOffs !== null && ports > 0 && takeOffs !== ports) {
      return mismatch('BTO_PORT_MISMATCH', 'BTO take-off points', ports, takeOffs,
        'The modelled BTOs have ' + ports + ' ports and the network records '
        + takeOffs + ' take-offs.');
    }
    const bomBtos = items.filter(i => /bto/i.test(String(i.key || '')))
      .reduce((t, i) => t + (n(i.quantity) ?? 0), 0);
    if (bomBtos > 0 && modelled > 0 && bomBtos !== modelled) {
      return mismatch('BOM_BTO_MISMATCH', 'BTOs', modelled, bomBtos,
        'The drawing shows ' + modelled + ' BTOs and the BOM buys ' + bomBtos + '.');
    }
    return null;
  });

  // ── 8. THE AIR ADDS UP: OUTLETS AGAINST THE SYSTEM ──────────────────────
  check(() => {
    const allocated = n(d.airflow && d.airflow.allocatedAirflowLs);
    if (allocated === null) return unknown('AIRFLOW_UNKNOWN', 'allocated airflow',
      'No airflow allocation is on the design.');
    const mains = supply.filter(s => s.role === 'main');
    if (!mains.length) return unknown('MAIN_AIRFLOW_UNKNOWN', 'airflow through the mains',
      'No main run exists to carry the air.');
    const carried = mains.reduce((t, s) => t + (n(s.airflowLs) || 0), 0);
    // Within 2%: the mains are sized on rounded per-area figures.
    return Math.abs(carried - allocated) <= Math.max(8, allocated * 0.02) ? null
      : mismatch('MAIN_AIRFLOW_MISMATCH', 'L/s', allocated, carried,
          'The system allocates ' + allocated + ' L/s and the mains together carry '
          + carried + ' L/s.');
  });

  // ── 9. THE PRESSURE FIGURE IS BUILT FROM RUNS THAT EXIST ────────────────
  check(() => {
    if (!pressure) return unknown('PRESSURE_UNKNOWN', 'static pressure',
      'No pressure estimate is on the design.');
    const path = rows(pressure.indexRun && pressure.indexRun.path);
    if (!path.length) {
      return pressure.checkCompleted === false ? null
        : mismatch('PRESSURE_NO_PATH', 'index run', 0, supply.length,
            'The pressure check completed with no index run behind it.');
    }
    const ids = new Set(supply.map(s => s.id));
    const orphan = path.filter(s => s.id && !ids.has(s.id));
    if (orphan.length) {
      return mismatch('PRESSURE_PATH_ORPHAN', 'index-run sections in the network',
        path.length - orphan.length, path.length,
        'The pressure figure is built through runs the network does not contain: '
        + orphan.map(s => s.id).join(', '));
    }
    // And each segment's length must be the length the network holds for it.
    const byId = new Map(supply.map(s => [s.id, s]));
    for (const seg of path) {
      const real = byId.get(seg.id);
      if (!real) continue;
      if (!close(n(seg.lengthM) ?? 0, n(real.lengthM) ?? 0)) {
        return mismatch('PRESSURE_LENGTH_MISMATCH', seg.id + ' length',
          n(seg.lengthM), n(real.lengthM),
          'The pressure calculation used a different length to the one on the run.');
      }
    }
    return null;
  });

  // ── 10. A PASS MUST HAVE EVIDENCE BEHIND IT ─────────────────────────────
  check(() => {
    if (!pressure) return null;
    if (pressure.status !== 'pass') return null;
    const ev = pressure.lengthEvidence;
    if (!ev) return unknown('PRESSURE_EVIDENCE_UNKNOWN', 'what the pressure figure is made of',
      'The pressure result records no length evidence.');
    return ev.ok ? null
      : mismatch('PRESSURE_PASS_WITHOUT_EVIDENCE', 'a pass with measured length behind it',
          'pass', ev.code, ev.reason);
  });

  // ── 11. THE SCHEDULE DESCRIBES THE SAME ROOMS ───────────────────────────
  check(() => {
    if (!sched) return unknown('SCHEDULE_UNKNOWN', 'the NAC schedule',
      'No schedule was produced.');
    const schedRooms = rows(sched.rooms).length;
    const conditioned = rows(d.rooms).filter(r => r.conditioned).length;
    return schedRooms === conditioned ? null
      : mismatch('SCHEDULE_ROOM_MISMATCH', 'conditioned rooms', conditioned, schedRooms,
          'The design conditions ' + conditioned + ' rooms and the schedule lists '
          + schedRooms + '.');
  });

  const facts = {
    sections: supply.length,
    mains: supply.filter(s => s.role === 'main').length,
    totalDuctLengthM: n(net.totalDuctLengthM),
    outlets: n(d.outlets && d.outlets.totals && d.outlets.totals.total),
    zones: n(d.zones && d.zones.zoneCount),
    dampers: rows(d.zoneDampers).length,
    btos: rows(d.btos).length,
    btoPorts: rows(d.btos).reduce((t, b) => t + rows(b.ports).length, 0),
    allocatedAirflowLs: n(d.airflow && d.airflow.allocatedAirflowLs),
    pressureStatus: pressure ? pressure.status : null,
    bomLines: n(bom.lineCount) ?? items.length
  };

  const mismatches = findings.filter(f => f.level === 'MISMATCH');
  return {
    ok: mismatches.length === 0,
    checked,
    findings,
    mismatches: mismatches.length,
    unknowns: findings.filter(f => f.level === 'UNKNOWN').length,
    facts
  };
}

export default { reconcileDesign };
