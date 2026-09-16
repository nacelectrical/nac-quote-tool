// ═══════════════════════════════════════════════════════════════════════════
// THE BRANCH TAKE-OFF — A PHYSICAL FITTING
// ═══════════════════════════════════════════════════════════════════════════
//
// WHAT A BTO IS. It is the galvanised multi-spigot manifold an installer lifts
// into the roof: one inlet from the duct feeding it, a small number of outlet
// spigots, a damper blade on the spigots that close a zone. It is a thing on
// the order with a price and a part number.
//
// WHAT A BTO IS NOT, and what this module exists to stop:
//
//   every outlet            every room           every duct branch
//   every connection along a main                a number stuck on an outlet
//   a dot wherever a line starts
//
// The old model incremented a counter once per emitted segment and called each
// tick a BTO, so a thirteen-outlet house reported fifteen BTOs and drew fifteen
// collars. Nick: "A BTO is the actual physical metal branch take-off/manifold
// fitting." So a BTO is now an OBJECT with an inlet, ports and an airflow that
// has to add up, and the drawing, the schedule and the bill of materials all
// read the same object.
//
// THE HIERARCHY, which this module is the fourth line of:
//
//   FAN COIL -> SUPPLY PLENUM -> MAIN FLEX -> **BTO FITTING** -> RUNS -> OUTLETS
//
// Nothing here knows about any particular house. Fittings are DERIVED from a
// sized network by looking at where ducts actually leave other ducts, so the
// same code serves any plan.

import { BTO as BTO_RULES } from './nac-standard.mjs';

/** How many spigots a fabricated fitting carries before it needs a second one. */
export const MAX_PORTS_PER_BTO = 3;

/** Take-offs closer together than this on the same parent are ONE fitting. */
export const BTO_MERGE_PX = 26;

const dist = (a, b) => Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0));
const round0 = (n) => Math.round(n || 0);

/**
 * A single fitting.
 *
 * `ports` are what LEAVES it. A port either reaches an outlet or carries on to
 * another fitting; both are real spigots on the same piece of metal, which is
 * why the port count rule counts them together.
 */
export function makeBto({ id, index, position, inletDiameterMm, inletAirflowLs,
                          fedBy, ports = [], zone = null, label = null }) {
  return {
    id,
    index,
    kind: 'bto_fitting',
    label: label || id,
    x: position?.x ?? null,
    y: position?.y ?? null,
    fedBy: fedBy || null,
    inletDiameterMm: inletDiameterMm ?? null,
    inletAirflowLs: round0(inletAirflowLs),
    ports: ports.map((p, i) => ({
      index: i + 1,
      sectionId: p.sectionId,
      diameterMm: p.diameterMm ?? null,
      airflowLs: round0(p.airflowLs),
      // What is on the end of it: a room's outlet, or the next fitting.
      servesOutletId: p.servesOutletId || null,
      servesRoomId: p.servesRoomId || null,
      servesLabel: p.servesLabel || null,
      feedsBtoId: p.feedsBtoId || null,
    // A port may also feed a duct that simply carries on — a reduced main, a
    // major branch. That is a valid part of the hierarchy, not a dead end.
    feedsSectionId: p.feedsSectionId || null,
      zone: p.zone || null,
      damper: !!p.damper
    })),
    portCount: ports.length,
    zone
  };
}

/** Everything downstream of a fitting adds up to what goes into it. */
export function reconcileBto(bto) {
  const sum = bto.ports.reduce((n, p) => n + (p.airflowLs || 0), 0);
  const diff = sum - (bto.inletAirflowLs || 0);
  return {
    btoId: bto.id,
    inletAirflowLs: bto.inletAirflowLs,
    downstreamSumLs: sum,
    differenceLs: diff,
    // One or two litres across a dozen divisions is the per-room split being
    // rounded, not air appearing from nowhere. Anything bigger is a fault.
    rounding: Math.abs(diff) > 0 && Math.abs(diff) <= 2,
    ok: Math.abs(diff) <= 2
  };
}

/**
 * Is this set of fittings a legal one?
 *
 * The checks are the ones that separate a real fitting from the counter it
 * used to be: it has an inlet, it has ports, it does not have more ports than
 * a fabricated body carries, every port goes somewhere, and the air adds up.
 */
export function validateBtos(btos, { maxPorts = MAX_PORTS_PER_BTO } = {}) {
  const failures = [];
  const ids = new Set(btos.map(b => b.id));
  for (const b of btos) {
    if (!b.inletDiameterMm) {
      failures.push({ btoId: b.id, code: 'NO_INLET', message: b.id + ' has no inlet duct.' });
    }
    if (!b.ports.length) {
      failures.push({ btoId: b.id, code: 'NO_PORTS',
        message: b.id + ' has no outlet ports — a fitting with nothing on it is not a fitting.' });
    }
    if (b.ports.length > maxPorts) {
      failures.push({ btoId: b.id, code: 'TOO_MANY_PORTS',
        message: b.id + ' has ' + b.ports.length + ' ports; a fabricated BTO carries at most ' +
                 maxPorts + '. Chain a second fitting instead.' });
    }
    for (const p of b.ports) {
      if (!p.servesOutletId && !p.feedsBtoId && !p.feedsSectionId) {
        failures.push({ btoId: b.id, code: 'PORT_GOES_NOWHERE',
          message: b.id + ' port ' + p.index + ' is not connected to an outlet, another '
                   + 'fitting, or a duct that carries on.' });
      }
      if (p.feedsBtoId && !ids.has(p.feedsBtoId)) {
        failures.push({ btoId: b.id, code: 'PORT_FEEDS_UNKNOWN_BTO',
          message: b.id + ' port ' + p.index + ' feeds ' + p.feedsBtoId + ', which does not exist.' });
      }
      if (!p.diameterMm) {
        failures.push({ btoId: b.id, code: 'PORT_NO_SIZE',
          message: b.id + ' port ' + p.index + ' has no diameter.' });
      }
    }
    const r = reconcileBto(b);
    if (!r.ok) {
      failures.push({ btoId: b.id, code: 'AIRFLOW_DOES_NOT_RECONCILE',
        message: b.id + ' takes ' + r.inletAirflowLs + ' L/s in and sends ' +
                 r.downstreamSumLs + ' L/s out.' });
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    count: btos.length,
    maxPortsUsed: btos.length ? Math.max(...btos.map(b => b.ports.length)) : 0,
    outletPorts: btos.reduce((n, b) => n + b.ports.filter(p => p.servesOutletId).length, 0),
    chainPorts: btos.reduce((n, b) => n + b.ports.filter(p => p.feedsBtoId).length, 0),
    reconciliations: btos.map(reconcileBto)
  };
}

/**
 * DERIVE THE PHYSICAL FITTINGS FROM A SIZED NETWORK.
 *
 * The router lays out ducts. This reads the result and works out where the
 * metal goes: wherever two or more runs leave the same parent at the same
 * PLACE, that is one manifold, not two saddles. A run that leaves a parent on
 * its own is a plain take-off collar and gets no fitting.
 *
 * Where a cluster would need more spigots than a body carries, the extra runs
 * are CHAINED onto a second fitting rather than crammed onto the first — which
 * is how Dungannon reaches its far bedrooms.
 */
export function deriveBtos(network, opts = {}) {
  const maxPorts = opts.maxPorts ?? MAX_PORTS_PER_BTO;
  const mergePx = opts.mergePx ?? BTO_MERGE_PX;
  const sections = (network?.sections || []).filter(s => s.points?.length >= 2);
  const byId = new Map(sections.map(s => [s.id, s]));
  const outletRoom = opts.roomLabelById || new Map();

  // Children of each parent, grouped by where they actually leave it.
  const childrenOf = new Map();
  for (const s of sections) {
    if (!s.parentId || !byId.has(s.parentId)) continue;
    if (!childrenOf.has(s.parentId)) childrenOf.set(s.parentId, []);
    childrenOf.get(s.parentId).push(s);
  }

  const btos = [];
  let n = 0;
  for (const [parentId, kids] of childrenOf) {
    const parent = byId.get(parentId);
    const clusters = [];
    for (const k of kids.slice().sort((a, b) =>
      (a.points[0].x - b.points[0].x) || (a.points[0].y - b.points[0].y))) {
      const at = k.points[0];
      const near = clusters.find(c => dist(c.at, at) <= mergePx);
      if (near) near.runs.push(k); else clusters.push({ at: { ...at }, runs: [k] });
    }
    for (const cluster of clusters) {
      // ONE duct leaving a main is a collar, not a manifold. Calling it a
      // fitting is exactly the mistake this module was written to end.
      if (cluster.runs.length < 2) continue;
      // Split across chained bodies where a single body would not carry it.
      const groups = [];
      const runs = cluster.runs.slice();
      while (runs.length) {
        const take = runs.length <= maxPorts ? maxPorts : maxPorts - 1;
        groups.push(runs.splice(0, take));
      }
      let fedBy = parentId;
      let inletMm = parent?.diameterMm ?? null;
      groups.forEach((group, gi) => {
        n += 1;
        const id = 'bto_' + n;
        const nextId = gi < groups.length - 1 ? 'bto_' + (n + 1) : null;
        const ports = group.map(r => ({
          sectionId: r.id,
          diameterMm: r.diameterMm ?? null,
          airflowLs: r.airflowLs ?? 0,
          servesOutletId: r.outletId || null,
          servesRoomId: r.roomId || null,
          servesLabel: r.destination || outletRoom.get(r.roomId) || null,
          // A run that is not a final carries on to whatever is downstream of it;
          // the second pass below turns that into the fitting it reaches.
          feedsSectionId: r.outletId ? null : r.id,
          zone: r.zone || null,
          damper: !!r.zone
        }));
        const carriedOn = nextId
          ? runs.concat(groups.slice(gi + 1).flat())
              .reduce((t, r) => t + (r.airflowLs || 0), 0)
          : 0;
        if (nextId) {
          ports.push({ sectionId: null, diameterMm: inletMm, airflowLs: carriedOn,
                       feedsBtoId: nextId, damper: false });
        }
        btos.push(makeBto({
          id, index: n,
          position: cluster.at,
          inletDiameterMm: inletMm,
          inletAirflowLs: ports.reduce((t, p) => t + (p.airflowLs || 0), 0),
          fedBy,
          ports,
          label: 'BTO-' + n
        }));
        fedBy = id;
      });
    }
  }
  // SECOND PASS: a port feeding a duct that itself ends at a manifold is a port
  // feeding THAT MANIFOLD. Only now, with every fitting named, can the chain be
  // written down.
  const byParentSection = new Map();
  for (const b of btos) {
    if (b.fedBy && !byParentSection.has(b.fedBy)) byParentSection.set(b.fedBy, b.id);
  }
  for (const b of btos) {
    for (const p of b.ports) {
      if (!p.feedsSectionId || p.feedsBtoId) continue;
      const downstream = byParentSection.get(p.feedsSectionId);
      if (downstream && downstream !== b.id) p.feedsBtoId = downstream;
    }
  }
  return btos;
}

/** What the order has to carry for these fittings. */
export function btoBomLines(btos) {
  const bySpec = new Map();
  for (const b of btos) {
    const key = b.inletDiameterMm + ':' + b.ports.length;
    const row = bySpec.get(key) || {
      key: 'bto_fitting',
      inletDiameterMm: b.inletDiameterMm,
      portCount: b.ports.length,
      quantity: 0,
      unit: 'each',
      label: 'BTO branch take-off ø' + b.inletDiameterMm + ' — ' +
             b.ports.length + ' port',
      fittings: []
    };
    row.quantity += 1;
    row.fittings.push(b.id);
    bySpec.set(key, row);
  }
  return [...bySpec.values()].sort((a, b) =>
    b.inletDiameterMm - a.inletDiameterMm || b.portCount - a.portCount);
}

export const BTO_MODEL = Object.freeze({
  MAX_PORTS_PER_BTO, BTO_MERGE_PX, minRoomsForMajorBranch: BTO_RULES.minRoomsForMajorBranch
});

export default { makeBto, deriveBtos, validateBtos, reconcileBto, btoBomLines };
