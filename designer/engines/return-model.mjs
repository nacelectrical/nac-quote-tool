// ═══════════════════════════════════════════════════════════════════════════
// RETURN AIR — ITS OWN ENTITIES, NEVER A BRANCH TAKE-OFF
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick, after seeing a take-off symbol land on a return path:
//
//   "Critical correction: return air must never be represented or counted as a
//    BTO. A BTO is a supply-air distribution fitting only."
//
// The mistake was structural, not cosmetic. Anything that derives fittings by
// looking for ducts leaving other ducts will find the two return runs meeting
// at the fan coil and call that junction a manifold — because geometrically it
// looks exactly like one. It is not one. Air is going the other way, there is no
// take-off, there is no damper, and nobody orders a BTO for it. So the return
// side gets its OWN entity types here, and `deriveBtos` drops return sections
// before it looks at anything.
//
// THE RETURN HIERARCHY, which is two independent paths and not a tree:
//
//   RETURN GRILLE R1 -> ø400 RETURN DUCT ┐
//                                        ├-> FAN-COIL RETURN-AIR PLENUM / BOX
//   RETURN GRILLE R2 -> ø400 RETURN DUCT ┘
//
// Each grille has its own duct. Both ducts land on the return side of the fan
// coil. Neither passes through a supply fitting, neither gets a zone damper —
// a damper on a return would starve the unit rather than balance a room — and
// neither appears in any supply count.
//
// Nothing here knows about any particular house.

/** The only component kinds that exist on the return side. */
export const RETURN_COMPONENT = Object.freeze({
  GRILLE: 'return_grille',
  DUCT: 'return_duct',
  PLENUM: 'return_plenum',
  /** Where two return ducts physically meet before the unit, if a job needs it. */
  JUNCTION: 'return_junction'
});

/** Every return kind, for callers that need to test membership. */
export const RETURN_KINDS = Object.freeze(Object.values(RETURN_COMPONENT));

/**
 * The return side as a set of typed objects, built from the designed return air
 * and the routed return ducts.
 *
 * Deliberately returns plain records rather than reusing the supply section
 * shape: a return duct that looks like a supply section is a return duct that
 * will eventually be treated as one.
 */
export function buildReturnComponents({ returnDesign, returnRoutes = [], layout = {} } = {}) {
  const returns = returnDesign?.returns || [];
  const duct = returnDesign?.duct || {};
  const unit = layout.plenum || layout.indoorUnit || null;

  const plenum = {
    id: 'return_plenum',
    kind: RETURN_COMPONENT.PLENUM,
    airSide: 'return',
    label: 'Fan-coil return-air plenum',
    x: unit?.x ?? null,
    y: unit?.y ?? null,
    airflowLs: returns.reduce((n, r) => n + (r.airflowLs || 0), 0),
    /** How many return ducts land on it. */
    inletCount: returns.length,
    inletDiameterMm: duct.diameterMm ?? null,
    unitModel: duct.unitModel || null,
    unitReturnFlangeText: duct.unitReturnFlangeText || null,
    fromUnitSpec: !!duct.fromUnitSpec
  };

  const grilles = returns.map((r, i) => {
    const route = returnRoutes[i] || null;
    const at = route?.points?.[0] || null;
    return {
      id: r.id || ('R' + (i + 1)),
      kind: RETURN_COMPONENT.GRILLE,
      airSide: 'return',
      index: i + 1,
      label: 'Return grille ' + (r.id || ('R' + (i + 1))),
      grilleSize: r.grilleSize || null,
      widthMm: r.widthMm ?? null,
      heightMm: r.heightMm ?? null,
      airflowLs: r.airflowLs ?? null,
      grossFaceVelocityMs: r.grossFaceVelocityMs ?? null,
      effectiveFreeAreaVelocityMs: r.effectiveFreeAreaVelocityMs ?? null,
      freeAreaVerified: !!r.freeAreaVerified,
      x: at?.x ?? null,
      y: at?.y ?? null,
      // Stated rather than implied. A grille is not a take-off and has no ports.
      isBto: false,
      zoneDamper: false,
      feedsBtoId: null
    };
  });

  const ducts = returns.map((r, i) => {
    const route = returnRoutes[i] || null;
    return {
      id: route?.id || ('return_duct_' + (i + 1)),
      kind: RETURN_COMPONENT.DUCT,
      airSide: 'return',
      index: i + 1,
      label: 'Return duct ' + (i + 1),
      fromGrilleId: grilles[i]?.id || null,
      /** Every return duct ends at the return plenum. Never at a supply fitting. */
      terminatesAt: plenum.id,
      diameterMm: route?.diameterMm ?? duct.diameterMm ?? null,
      airflowLs: r.airflowLs ?? null,
      lengthMm: route?.lengthMm ?? null,
      velocityMs: duct.velocityMs ?? null,
      points: route?.points || null,
      isBto: false,
      zoneDamper: false,
      parentBtoId: null
    };
  });

  return { plenum, grilles, ducts, junctions: [] };
}

/**
 * THE SEPARATION CHECK.
 *
 * Every way the supply and return sides could get confused, asserted in one
 * place so a future change to the router or the drawing cannot quietly
 * reintroduce a return BTO. These are FAILURES, not notes: a return grille
 * counted as a take-off is wrong on the drawing, wrong in the schedule and
 * wrong on the order.
 */
export function validateReturnSeparation({ returnComponents, btos = [], network = null } = {}) {
  const failures = [];
  const rc = returnComponents;
  if (!rc) return { ok: true, failures, checked: false };

  const returnIds = new Set([
    rc.plenum?.id,
    ...rc.grilles.map(g => g.id),
    ...rc.ducts.map(d => d.id)
  ].filter(Boolean));

  // 1. No BTO may sit on, be fed by, or feed anything on the return side.
  for (const b of btos) {
    if (returnIds.has(b.id) || returnIds.has(b.fedBy)) {
      failures.push({ code: 'BTO_ON_RETURN_PATH',
        message: b.id + ' is a supply take-off sitting on the return path.' });
    }
    for (const p of b.ports) {
      if (returnIds.has(p.sectionId)) {
        failures.push({ code: 'BTO_PORT_ON_RETURN_DUCT',
          message: b.id + ' port ' + p.index + ' is a return duct.' });
      }
    }
  }

  // 2. A grille is never assigned to a fitting.
  for (const g of rc.grilles) {
    if (g.isBto || g.feedsBtoId) {
      failures.push({ code: 'RETURN_GRILLE_ASSIGNED_TO_BTO',
        message: g.id + ' is marked as, or attached to, a BTO.' });
    }
  }

  // 3. Every return duct ends at the return plenum, not at a supply fitting.
  for (const d of rc.ducts) {
    if (d.terminatesAt !== rc.plenum?.id) {
      failures.push({ code: 'RETURN_DUCT_DOES_NOT_END_AT_PLENUM',
        message: d.id + ' terminates at ' + d.terminatesAt + '.' });
    }
    if (d.parentBtoId) {
      failures.push({ code: 'RETURN_DUCT_ON_A_BTO',
        message: d.id + ' is hung off ' + d.parentBtoId + '.' });
    }
  }

  // 4. NOTHING ON THE RETURN GETS A ZONE DAMPER. A damper here does not balance
  //    a room, it starves the fan coil.
  for (const item of [...rc.grilles, ...rc.ducts]) {
    if (item.zoneDamper) {
      failures.push({ code: 'ZONE_DAMPER_ON_RETURN',
        message: item.id + ' has a zone damper on the return side.' });
    }
  }
  for (const s of (network?.sections || [])) {
    if ((s.role === 'return' || returnIds.has(s.id)) && s.zone) {
      failures.push({ code: 'ZONE_DAMPER_ON_RETURN',
        message: s.id + ' is a return duct carrying zone "' + s.zone + '".' });
    }
  }

  return {
    ok: failures.length === 0,
    checked: true,
    failures,
    counts: returnComponentCounts(rc)
  };
}

/**
 * WHERE THE SUPPLY AND THE RETURN CROSS IN PLAN.
 *
 * Nick listed "supply and return clashes" among the things a layout must not
 * cause. Some crossing is unavoidable and is not a fault: every main leaves the
 * fan coil and every return arrives at it, so they necessarily meet there. What
 * matters is a crossing OUT IN THE ROOF, away from the unit, where two ducts
 * want the same space and somebody has to drop one under the other.
 *
 * This does not pretend such crossings do not happen. It finds them and says
 * where, so the estimator and the installer both know before the flex is on the
 * truck — which is worth more than a drawing that quietly overlaps two ducts.
 */
export function findSupplyReturnClashes({ network, returnRoutes = [], plenum = null,
                                          plenumRadiusPx = 40 } = {}) {
  const toSegs = (runs) => (runs || [])
    .filter(r => r.points?.length >= 2)
    .flatMap(r => r.points.slice(0, -1).map((a, i) => ({ id: r.id, a, b: r.points[i + 1] })));
  const supply = toSegs((network?.sections || []).filter(s => s.role !== 'return'));
  const ret = toSegs(returnRoutes);
  const side = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const crosses = (p, q, r, t) =>
    ((side(p, q, r) > 0) !== (side(p, q, t) > 0)) &&
    ((side(r, t, p) > 0) !== (side(r, t, q) > 0));
  const atPlenum = (p) => plenum &&
    Math.hypot(p.x - plenum.x, p.y - plenum.y) < plenumRadiusPx;

  const clashes = [];
  const seen = new Set();
  for (const A of supply) {
    for (const B of ret) {
      if (!crosses(A.a, A.b, B.a, B.b)) continue;
      // At the unit itself is the plenum, not a clash.
      if ([A.a, A.b, B.a, B.b].some(atPlenum)) continue;
      const key = A.id + '|' + B.id;
      if (seen.has(key)) continue;
      seen.add(key);
      clashes.push({
        supplyId: A.id, returnId: B.id,
        at: { x: Math.round((A.a.x + A.b.x) / 2), y: Math.round((A.a.y + A.b.y) / 2) },
        message: A.id + ' crosses return duct ' + B.id +
                 ' away from the fan coil — one duct has to pass under the other.'
      });
    }
  }
  return { count: clashes.length, clashes, checked: !!(supply.length && ret.length) };
}

/** The return side's own counts, which never mix with the supply side's. */
export function returnComponentCounts(rc) {
  return {
    returnGrilles: rc?.grilles?.length || 0,
    returnDucts: rc?.ducts?.length || 0,
    returnPlenums: rc?.plenum ? 1 : 0,
    returnJunctions: rc?.junctions?.length || 0,
    /** Stated explicitly because the whole point is that it is always zero. */
    returnBtos: 0
  };
}

/**
 * What the order carries for the return side — its own lines, its own category.
 *
 * Kept apart from `btoBomLines` so a return box can never be totalled into the
 * supply fittings on a quote.
 */
export function returnBomLines(rc) {
  if (!rc) return [];
  const lines = [];
  const bySize = new Map();
  for (const g of rc.grilles) {
    const key = g.grilleSize || 'unsized';
    const row = bySize.get(key) || {
      key: 'return_grille', category: 'return_air', airSide: 'return',
      quantity: 0, unit: 'each',
      label: 'Return air grille and filter ' + key
    };
    row.quantity += 1;
    bySize.set(key, row);
  }
  lines.push(...bySize.values());

  const byDuct = new Map();
  for (const d of rc.ducts) {
    const key = d.diameterMm || 'unsized';
    const row = byDuct.get(key) || {
      key: 'return_duct', category: 'return_air', airSide: 'return',
      quantity: 0, unit: 'each',
      label: 'Return air duct ø' + key + ' — grille to fan-coil return plenum'
    };
    row.quantity += 1;
    byDuct.set(key, row);
  }
  lines.push(...byDuct.values());

  if (rc.plenum) {
    lines.push({
      key: 'return_plenum', category: 'return_air', airSide: 'return',
      quantity: 1, unit: 'each',
      label: 'Fan-coil return-air plenum / box — ' + rc.plenum.inletCount +
             ' × ø' + (rc.plenum.inletDiameterMm || '?') + ' inlet'
    });
  }
  return lines;
}

export default {
  RETURN_COMPONENT, RETURN_KINDS, buildReturnComponents,
  validateReturnSeparation, returnComponentCounts, returnBomLines,
  findSupplyReturnClashes
};
