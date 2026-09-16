// ═══════════════════════════════════════════════════════════════════════════
// WHERE THE EQUIPMENT ACTUALLY GOES — AND WHO SAID SO
// ═══════════════════════════════════════════════════════════════════════════
//
// The fan coil decides every duct length in the job. Route from a guess and the
// lengths, the pressure, the bill of materials and the price are all a guess.
//
// So the engine is not allowed to quietly commit one. It may ASSUME a position
// to show a preview, and it must say it has; the design cannot reach approved
// status until an installer has put the unit where it really goes. Same for the
// return grilles, which come back to wherever the unit ends up.
//
// Nick: "Do not allow the design engine to guess or automatically commit a
// fan-coil location."

/** Status a placed object can be in. */
export const PLACEMENT = Object.freeze({
  ASSUMED: 'assumed',        // the engine's guess — preview only
  ESTIMATOR: 'estimator',    // a person put it there
  APPROVED: 'approved'       // a person has signed it off
});

/** How a room's outlet position came to be, for the audit trail. */
export const OUTLET_SOURCE = Object.freeze({
  DETECTED: 'plan_detected',   // read off a mark on the uploaded sheet
  MANUAL: 'estimator_placed',  // a person placed or approved it
  DERIVED: 'auto_derived'      // the engine worked it out from the room
});

/** Closer than this and two ceiling fittings are fighting for the same hole. */
export const MIN_CLEARANCE_MM = 900;
/** A fan coil needs this much clear to get a filter and a board out of it. */
export const SERVICE_ACCESS_MM = 600;

const mmBetween = (a, b, cal) => {
  if (!a || !b || !cal?.mmPerPixel) return null;
  return Math.round(Math.hypot((b.x - a.x), (b.y - a.y)) * cal.mmPerPixel);
};

/**
 * Read the placement state of a design and decide whether it may be finalised.
 *
 * Returns the status of each placed thing, the proximity checks between the fan
 * coil, the return grilles and the supply outlets, and — the point of the whole
 * module — a list of reasons the design is not final yet.
 */
export function assessPlacement(design) {
  const cal = design?.calibration || null;
  const unitStatus = design?.fanCoilStatus
    || (design?.layout?.indoorUnit || design?.layout?.plenum
          ? PLACEMENT.ESTIMATOR : PLACEMENT.ASSUMED);
  const unit = design?.layout?.indoorUnit || design?.layout?.plenum
    || design?.autoRoute?.plenum || null;

  const returns = (design?.returnRoutes || []).map((r, i) => ({
    id: r.id || ('return_' + (i + 1)),
    index: i + 1,
    at: r.points?.[0] || null,
    from: r.from || null,
    inHallway: !!r.hallway,
    status: r.assumed === false ? PLACEMENT.ESTIMATOR : PLACEMENT.ASSUMED
  }));

  const outlets = (design?.outlets?.rows || []).map(o => ({
    roomId: o.roomId, label: o.label,
    source: o.positionSource || OUTLET_SOURCE.DERIVED
  }));

  // ── proximity: the unit, the grilles it breathes through, the outlets ────
  const clearances = [];
  const outletPoints = (design?.network?.sections || [])
    .filter(s => s.role === 'final' && s.points?.length)
    .map(s => ({ label: s.destination, at: s.points[s.points.length - 1] }));
  for (const r of returns) {
    const d = mmBetween(unit, r.at, cal);
    if (d !== null) {
      clearances.push({ between: 'fan coil', and: r.id, mm: d,
        ok: d >= MIN_CLEARANCE_MM,
        note: d < MIN_CLEARANCE_MM
          ? 'The return grille is ' + d + ' mm from the unit — too close to pull air evenly.'
          : null });
    }
  }
  for (const o of outletPoints) {
    const d = mmBetween(unit, o.at, cal);
    if (d !== null && d < MIN_CLEARANCE_MM) {
      clearances.push({ between: 'fan coil', and: o.label, mm: d, ok: false,
        note: 'Supply outlet ' + o.label + ' is ' + d + ' mm from the unit — the duct has ' +
              'nowhere to go and the outlet will short-circuit the return.' });
    }
  }
  for (let i = 0; i < returns.length; i++) {
    for (let j = i + 1; j < returns.length; j++) {
      const d = mmBetween(returns[i].at, returns[j].at, cal);
      if (d !== null) {
        clearances.push({ between: returns[i].id, and: returns[j].id, mm: d,
          ok: d >= MIN_CLEARANCE_MM * 2,
          note: d < MIN_CLEARANCE_MM * 2
            ? 'Both return grilles are within ' + d + ' mm of each other — they will draw ' +
              'from the same patch of ceiling instead of the whole circulation.'
            : null });
      }
    }
  }

  // ── what stops this being a final drawing ───────────────────────────────
  const blockers = [];
  if (unitStatus !== PLACEMENT.APPROVED) {
    blockers.push({ code: 'FAN_COIL_NOT_APPROVED', severity: 'BLOCKING',
      message: unitStatus === PLACEMENT.ASSUMED
        ? 'The fan-coil position is ASSUMED by the engine. Place it on the plan and approve ' +
          'it — every duct length, the static pressure and the price follow from where it sits.'
        : 'The fan-coil position has been placed but not approved. Approve it to finalise.' });
  }
  for (const r of returns) {
    if (r.status !== PLACEMENT.ESTIMATOR && unitStatus !== PLACEMENT.APPROVED) {
      blockers.push({ code: 'RETURN_NOT_APPROVED', severity: 'BLOCKING',
        message: r.id + ' is provisional: it comes back to a fan coil that has not been ' +
                 'approved, so its position cannot be either.' });
    }
  }
  for (const c of clearances) {
    if (!c.ok) blockers.push({ code: 'PLACEMENT_CLEARANCE', severity: 'CHECK', message: c.note });
  }

  return {
    fanCoil: { status: unitStatus, at: unit ? { x: unit.x, y: unit.y } : null,
               provisional: unitStatus !== PLACEMENT.APPROVED,
               serviceAccessMm: SERVICE_ACCESS_MM,
               source: design?.autoRoute?.plenum?.source || null },
    returns,
    outlets,
    clearances,
    blockers,
    canPreview: true,
    canFinalise: blockers.filter(b => b.severity === 'BLOCKING').length === 0
  };
}

export default { assessPlacement, PLACEMENT, OUTLET_SOURCE };
