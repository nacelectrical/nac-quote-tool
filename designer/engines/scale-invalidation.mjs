// ─────────────────────────────────────────────────────────────────────────────
// WHEN THE SCALE CHANGES, EVERYTHING MEASURED THROUGH IT IS WRONG
//
// A plan scale is not one number among many. It is the multiplier under every
// length in the job: room areas, duct runs, fitting positions, the plenum, the
// index run, the bill of materials and the price.
//
// Re-calibrating used to remeasure the rooms and leave the rest standing. So a
// job could carry routes drawn at 44.5 px/m, duct lengths measured at 44.5, a
// plenum sized for those lengths and a static pressure added up from them —
// beside rooms measured at 39.0, and a scale record saying 39.0. Every one of
// those numbers looked current.
//
// Nick: "Invalidate every calculation derived from the previous scale."
//
// So this module knows what was measured THROUGH the scale, and clears it. It
// does not clear what an estimator DECIDED — which rooms are conditioned, how
// many outlets a room gets, which brand to use — because those survive a
// remeasure. And it says what it cleared, so nothing disappears silently.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Below this the scale has not meaningfully moved and nothing is thrown away. */
export const SCALE_CHANGE_TOLERANCE = 0.001;   // 0.1%

export function scaleChanged(before, after) {
  const a = num(before?.pixelsPerMm);
  const b = num(after?.pixelsPerMm);
  if (a === null || b === null) return a !== b;
  if (a === 0) return b !== 0;
  return Math.abs(b - a) / a > SCALE_CHANGE_TOLERANCE;
}

/**
 * Everything a plan scale is underneath, and what it is called on the design.
 *
 * Kept as a list rather than as scattered `delete` statements so that adding a
 * new derived artefact means adding one row here, and so the estimator can be
 * told exactly what a recalibration threw away.
 */
export const SCALE_DERIVED = Object.freeze([
  { key: 'network',        label: 'Duct network, lengths and diameters' },
  { key: 'autoRoute',      label: 'Automatic route' },
  { key: 'topology',       label: 'Main topology' },
  { key: 'routeEdits',     label: 'Dragged route geometry', empty: () => ({}) },
  { key: 'lockedRoutes',   label: 'Locked route geometry', empty: () => ({}) },
  { key: 'ductRoutes',     label: 'Measured duct routes', empty: () => ({}) },
  { key: 'mainRoute',      label: 'Main duct route' },
  { key: 'returnRoute',    label: 'Return air route' },
  { key: 'btos',           label: 'Branch take-off schedule' },
  { key: 'supplyPlenum',   label: 'Fabricated supply plenum' },
  { key: 'zoneDampers',    label: 'Zone damper schedule' },
  { key: 'pressure',       label: 'Static pressure calculation' },
  { key: 'spigotSelection', label: 'Supply spigot arrangement' },
  { key: 'bom',            label: 'Bill of materials' },
  { key: 'commercials',    label: 'Price' },
  { key: 'quoteLineItems', label: 'Quote lines', empty: () => [] }
]);

/**
 * What an estimator DECIDED, which a remeasure must not touch.
 *
 * Listed explicitly so the distinction is a stated rule rather than an
 * accident of which keys the loop above happens to mention.
 */
export const ESTIMATOR_DECISIONS = Object.freeze([
  'outletOverrides', 'outletPositionSources', 'spillRoomIds', 'spillIntoRoomIds',
  'zoneDefinitions', 'brandPreference', 'phase', 'sitePhase', 'selectedUnitKey',
  'supplyMainConfig', 'installerAreas', 'demolishedWalls', 'extraMaterials',
  'extraLabour', 'bomEdits', 'statedLoad', 'capacityDecision', 'customer', 'job'
]);

/**
 * Clear everything measured through the old scale.
 *
 * @returns {{design, cleared:Array<string>, changed:boolean}}
 */
export function invalidateForNewScale(design, beforeCalibration, afterCalibration) {
  const changed = scaleChanged(beforeCalibration, afterCalibration);
  if (!changed) return { design, cleared: [], changed: false };

  const next = { ...design };
  const cleared = [];

  for (const d of SCALE_DERIVED) {
    const had = next[d.key];
    const isEmpty = had === null || had === undefined
      || (Array.isArray(had) && had.length === 0)
      || (typeof had === 'object' && !Array.isArray(had) && Object.keys(had).length === 0);
    if (isEmpty) continue;
    next[d.key] = d.empty ? d.empty() : null;
    cleared.push(d.label);
  }

  // A fan coil somebody APPROVED was approved at a position on the plan. The
  // position is still where they put it; what is no longer true is the
  // distance from it to anything. So the placement stands and its approval
  // does not — re-confirming is one tap, and a silently-approved position
  // measured at the wrong scale is a design nobody checked.
  if (next.fanCoilStatus === 'approved') {
    next.fanCoilStatus = 'proposed';
    next.fanCoilApprovedBy = null;
    cleared.push('Fan-coil position approval');
  }

  // An approved DESIGN was approved against numbers that have just changed.
  if (next.approvedAt || next.approvedBy) {
    next.approvedAt = null;
    next.approvedBy = null;
    next.approved = false;
    cleared.push('Design approval');
  }

  next.scaleInvalidation = {
    at: new Date().toISOString(),
    fromPixelsPerMm: num(beforeCalibration?.pixelsPerMm),
    toPixelsPerMm: num(afterCalibration?.pixelsPerMm),
    cleared
  };

  return { design: next, cleared, changed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// §11 — WHAT A PROPOSAL MAY NOT CONTAIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Things the Kauri proposal-stage report invented, each named.
 *
 * This is an audit rather than a gate: the gate is `capabilities.mayRouteDucts`,
 * which stops them being produced. This proves they were not, which is a
 * different and more useful thing to be able to assert.
 */
export function proposalStageAudit(design) {
  const violations = [];
  const add = (what, detail) => violations.push({ what, detail });

  const sections = design?.network?.sections || [];
  if (sections.length) {
    add('routed duct lengths', sections.length + ' duct section(s) exist');
  }
  if (num(design?.network?.totalDuctLengthM)) {
    add('routed duct lengths', design.network.totalDuctLengthM + ' m of duct');
  }
  if ((design?.btos || []).length) {
    add('BTO schedule', design.btos.length + ' fabricated take-off(s)');
  }
  if (design?.supplyPlenum) {
    add('fabricated plenum dimensions',
        (design.supplyPlenum.bodyWidthMm || '?') + ' mm plenum');
  }
  if (design?.pressure && design.pressure.calculated !== false
      && num(design.pressure.estimatedRequirementPa)) {
    add('index-run static pressure', design.pressure.estimatedRequirementPa + ' Pa');
  }
  const ductBom = (design?.bom?.items || []).filter(i =>
    i && i.category === 'ductwork' && i.key !== 'proposal_ductwork_allowance');
  if (ductBom.length) {
    add('detailed ductwork BOM', ductBom.length + ' duct line(s)');
  }
  const finals = sections.filter(s => s.role === 'final' && num(s.diameterMm));
  if (finals.length) {
    add('final duct diameters', finals.length + ' final(s) sized');
  }

  return {
    ok: violations.length === 0,
    violations,
    failures: violations.length ? [{
      code: 'PROPOSAL_STAGE_INVENTED_DUCTWORK',
      severity: 'CRITICAL',
      message: 'This job is at proposal stage but carries '
        + violations.map(v => v.what).join(', ')
        + '. None of it can be real: the ductwork has not been designed.'
    }] : []
  };
}

export default { SCALE_CHANGE_TOLERANCE, scaleChanged, SCALE_DERIVED, ESTIMATOR_DECISIONS,
                 invalidateForNewScale, proposalStageAudit };
