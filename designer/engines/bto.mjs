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
import { btoFaceLayout, faceSize, DEFAULT_ALLOWANCES, DEFAULT_COLLAR_FACES,
         faceLayoutLines } from './bto-faces.mjs';

/**
 * NO UNIVERSAL PORT MAXIMUM.
 *
 * This was `MAX_PORTS_PER_BTO = 3`, taken from the Dungannon sheet because the
 * largest fitting on it had three collars. That was an inference from one
 * example, not a rule, and it was wrong. Nick: "Dungannon happened to use
 * fittings with up to three connected outlets; that does not establish three as
 * a universal maximum."
 *
 * The damage it did was not cosmetic. A hard three forced a five-outlet bedroom
 * wing to be served by BTO feeding BTO, which invented secondary fittings,
 * "main onward" ports and long serial routes. A BTO now carries as many collars
 * as its installer area needs; what limits it is whether the metal can be made,
 * which `btoBodyGeometry` measures and reports for installer review.
 *
 * Null means no cap. A job may set one where an installer has a real reason.
 */
export const DEFAULT_PORT_CAPACITY = BTO_RULES.portCapacity ?? null;

/** Take-offs closer together than this on the same parent are ONE fitting. */
export const BTO_MERGE_PX = 26;

const dist = (a, b) => Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0));
const round0 = (n) => Math.round(n || 0);

/**
 * IS THIS RETURN AIR? If so it can never become, feed, or be counted as a BTO.
 *
 * Deliberately generous about how a return identifies itself — role, NAC role,
 * an explicit flag, or an id that names one — because the cost of missing one is
 * a return grille drawn with a take-off symbol over it, and the cost of a false
 * positive is a supply run that simply does not get a fitting.
 */
export function isReturnSection(s) {
  if (!s) return false;
  if (s.isReturn === true || s.supplyAir === false) return true;
  if (s.role === 'return' || s.nacRole === 'RETURN') return true;
  if (typeof s.airSide === 'string' && s.airSide.toLowerCase() === 'return') return true;
  return /^return(_|$)/.test(String(s.id || ''));
}

/**
 * THE PHYSICAL FITTING — what the sheet metal shop has to make.
 *
 * A distribution box is a rectangular plenum: the main lands on one end, and
 * the outlet collars come off the two long sides and the far end. So the thing
 * that actually limits collar count is not a number someone chose, it is
 * whether the collars and their clamp gaps fit along the faces available, and
 * whether each collar fits within the body depth.
 *
 * WHAT IS MEASURED HERE AND WHAT IS NOT. The arithmetic below is geometry from
 * the collar sizes this design chose — it is not a fabricator's catalogue. NAC
 * has not given me a table of standard bodies, so none is invented: the result
 * carries `dimensionsSource: 'derived_from_collars'` and `verified: false`, and
 * says what size the box needs to be rather than claiming a part exists. Set
 * real bodies in settings and this reports against them instead.
 */
export function btoBodyGeometry(bto, opts = {}) {
  const allowances = {
    ...DEFAULT_ALLOWANCES,
    ...(opts.collarGapMm != null ? { collarClearanceMm: opts.collarGapMm } : {}),
    ...(opts.maxBodyLengthMm != null ? { maxBodyLengthMm: opts.maxBodyLengthMm } : {}),
    ...(opts.allowances || {})
  };
  const faces = opts.collarFaces && Array.isArray(opts.collarFaces)
    ? opts.collarFaces : DEFAULT_COLLAR_FACES;

  // A body somebody GAVE us — a job setting, or the fabricator's own confirmed
  // dimensions. Only against one of these can a layout be said to pass.
  const givenLength = opts.bodyLengthMm ?? null;
  const givenWidth = opts.bodyWidthMm ?? opts.bodyDepthMm ?? null;
  const givenHeight = opts.bodyHeightMm ?? opts.bodyDepthMm ?? givenWidth;
  const given = (givenLength || givenWidth)
    ? { lengthMm: givenLength || givenWidth, widthMm: givenWidth || givenLength,
        heightMm: givenHeight || givenWidth || givenLength }
    : null;

  const layout = btoFaceLayout(bto, {
    body: given,
    bodySource: given ? (opts.bodySource || 'configured') : undefined,
    allowances, collarFaces: faces
  });

  const collars = bto.ports.map(p => p.diameterMm).filter(Boolean);
  const inlet = bto.inletDiameterMm || 0;
  const maxCollar = collars.length ? Math.max(...collars) : 0;
  const frame = 2 * (allowances.edgeClearanceMm + allowances.seamAllowanceMm);

  // Collar run and the room for it, now measured PER FACE rather than pooled.
  // The old totals let three ø250 collars pass against a 450 mm box because
  // 930 mm was compared with three faces added together; they are not one face.
  const requiredCollarRunMm = Math.round(
    layout.faces.reduce((n, f) => n + f.requiredWidthMm, 0) +
    layout.unplacedCollars.reduce((n, u) => n + u.outsideDiameterMm + frame, 0));
  const availableCollarSpaceMm = Math.round(faces
    .map(f => faceSize(f, { lengthMm: layout.bodyLengthMm, widthMm: layout.bodyWidthMm,
                            heightMm: layout.bodyHeightMm }).uMm)
    .reduce((n, u) => n + u, 0));

  const issues = layout.issues.map(i => ({ ...i }));
  // The pooled code the rest of the program already knows, kept alongside the
  // exact one so an existing report or check does not go quiet.
  if (layout.unplacedCollars.length) {
    issues.push({
      code: 'COLLARS_EXCEED_AVAILABLE_SPACE',
      message: (bto.label || bto.id) + ' needs ' + requiredCollarRunMm + ' mm of collar run ' +
               'laid out face by face; the ' + layout.bodyText + ' body offers ' +
               availableCollarSpaceMm + ' mm across its collar faces, and no single face ' +
               'has room for ' + layout.unplacedCollars.length + ' of the collars.'
    });
  }
  if (allowances.maxBodyLengthMm && layout.bodyLengthMm > allowances.maxBodyLengthMm) {
    issues.push({
      code: 'BODY_LONGER_THAN_CONFIGURED_MAXIMUM',
      message: (bto.label || bto.id) + ' needs a ' + layout.bodyLengthMm + ' mm body; the ' +
               'configured maximum is ' + allowances.maxBodyLengthMm + ' mm.'
    });
  }

  const configured = !!given;
  return {
    portCount: bto.ports.length,
    collarDiametersMm: collars,
    collarAirflowsLs: bto.ports.map(p => p.airflowLs),
    totalOutletAirflowLs: bto.ports.reduce((n, p) => n + (p.airflowLs || 0), 0),
    inletDiameterMm: inlet || null,
    inletAirflowLs: bto.inletAirflowLs,
    bodyLengthMm: layout.bodyLengthMm,
    bodyWidthMm: layout.bodyWidthMm,
    bodyHeightMm: layout.bodyHeightMm,
    /** Kept for every caller that knew a box as length × depth × depth. */
    bodyDepthMm: layout.bodyWidthMm,
    bodyText: layout.bodyText,
    collarGapMm: allowances.collarClearanceMm,
    collarFaces: faces,
    requiredCollarRunMm,
    availableCollarSpaceMm,
    spareCollarSpaceMm: availableCollarSpaceMm - requiredCollarRunMm,
    fits: issues.length === 0,
    issues,
    dimensionsSource: configured ? 'configured' : 'derived_from_collars',
    verified: configured,
    /** THE PHYSICAL PROOF: which face, which centre, what clearance, pass/fail. */
    faceLayout: layout,
    /** A proposal is never validated, however carefully it was worked out. */
    layoutValidated: layout.validated,
    layoutStatus: layout.status,
    proposedBodyText: layout.proposedBody.bodyText,
    bomDescription: 'BTO distribution box \u00f8' + (inlet || '?') + ' inlet \u2014 ' +
      bto.ports.length + ' \u00d7 collar (' + collars.map(d => '\u00f8' + d).join(', ') +
      '), body ' + layout.bodyText +
      (layout.multiFace ? ', collars on ' + layout.facesUsed.length + ' faces' : '')
  };
}

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
      // A deliberate distribution arm is allowed to feed a local BTO. It is
      // distinct from an arbitrary serial chain created to dodge a port cap.
      intentionalDistribution: !!p.intentionalDistribution,
      feedsSectionId: p.feedsSectionId || null,
      zone: p.zone || null,
      damper: !!p.damper
    })),
    portCount: ports.length,
    /** Ports that end at a room outlet — the number an installer counts. */
    outletPortCount: ports.filter(p => p.servesOutletId).length,
    zone
  };
}

/**
 * WHAT THE INSTALLER CHANGED ABOUT A FITTING, APPLIED TO THE DERIVED ONE.
 *
 * BTOs are derived from the routed network every time the pipeline runs, so a
 * site edit cannot be written onto the object — the next recalculation would
 * throw it away. It is recorded as an OVERRIDE against the fitting's id and
 * re-applied here, after the derivation and before the body geometry, which is
 * why undo is a cursor on a list rather than an inverse operation.
 *
 * An ADDED fitting is a real one the installer put on a duct that the router
 * did not put one on. It is created here with the inlet of the duct it was
 * tapped onto, and its collars start unconnected — the route is NOT silently
 * redrawn, because Nick asked for the opposite of that. It shows up on the
 * plan, the schedule and the order immediately, carrying its own configuration
 * key and therefore its own PRICE REQUIRED.
 */
export function applyBtoOverrides(btos, overrides = {}, network = null) {
  const sections = new Map((network?.sections || []).map(s => [s.id, s]));
  const out = [];

  for (const b of btos) {
    const o = overrides[b.id];
    if (o?.removed) continue;
    out.push(applyOne(b, o));
  }

  // Fittings the installer added, in the order they were added.
  for (const [id, o] of Object.entries(overrides)) {
    if (!o?.added || o.removed) continue;
    if (out.some(b => b.id === id)) continue;
    const sec = o.sectionId ? sections.get(o.sectionId) : null;
    const base = makeBto({
      id, index: out.length + 1,
      position: { x: o.x ?? sec?.points?.[0]?.x ?? null, y: o.y ?? sec?.points?.[0]?.y ?? null },
      inletDiameterMm: o.inletDiameterMm ?? sec?.diameterMm ?? null,
      inletAirflowLs: o.inletAirflowLs ?? sec?.airflowLs ?? 0,
      fedBy: o.sectionId || null,
      label: o.label || id,
      ports: []
    });
    base.addedOnSite = true;
    out.push(applyOne(base, o));
  }
  return out;

  function applyOne(b, o) {
    if (!o) return b;
    let ports = b.ports.map(p => ({ ...p }));

    // Collars the installer took off, by the index they were shown under.
    const removed = new Set((o.removedPortIndexes || []).map(Number));
    if (removed.size) ports = ports.filter(p => !removed.has(p.index));

    // Collars the installer added. A new collar is honestly unconnected and
    // carries no air until it is pointed at an outlet.
    for (const add of (o.addedPorts || [])) {
      ports.push({
        index: 0, sectionId: add.sectionId || null,
        diameterMm: add.diameterMm ?? null, airflowLs: 0,
        servesOutletId: add.servesOutletId || null, servesRoomId: add.servesRoomId || null,
        servesLabel: add.servesLabel || null, feedsBtoId: null,
        intentionalDistribution: false, feedsSectionId: null,
        zone: add.zone || null, damper: false, addedOnSite: true
      });
    }

    // Re-number after add/remove so the sheet, the plan and the site editor all
    // count the collars the same way.
    ports = ports.map((p, i) => ({ ...p, index: i + 1 }));
    for (const [idx, mm] of Object.entries(o.portDiametersMm || {})) {
      const p = ports.find(x => x.index === Number(idx));
      if (p && mm) p.diameterMm = Number(mm);
    }
    for (const [idx, dest] of Object.entries(o.portDestinations || {})) {
      const p = ports.find(x => x.index === Number(idx));
      if (!p) continue;
      p.servesOutletId = dest;
      p.servesRoomId = dest;
      p.servesLabel = (o.portDestinationLabels || {})[idx] || dest;
      p.reconnectedOnSite = true;
    }

    return {
      ...b,
      x: o.x ?? b.x,
      y: o.y ?? b.y,
      movedOnSite: o.x !== undefined && o.x !== null,
      inletDiameterMm: o.inletDiameterMm ?? b.inletDiameterMm,
      ports,
      portCount: ports.length,
      outletPortCount: ports.filter(p => p.servesOutletId).length,
      /** Dimensions the FABRICATOR confirmed. They replace the proposal. */
      confirmedBody: (o.bodyLengthMm || o.bodyWidthMm || o.bodyDepthMm) ? {
        lengthMm: o.bodyLengthMm ?? null,
        widthMm: o.bodyWidthMm ?? o.bodyDepthMm ?? null,
        heightMm: o.bodyHeightMm ?? o.bodyDepthMm ?? null,
        by: o.bodyConfirmedBy || null, at: o.bodyConfirmedAt || null
      } : (b.confirmedBody || null)
    };
  }
}

/** The fitting with its fabrication record attached. */
export function withBody(bto, opts = {}) {
  // A fabricator's confirmed dimensions REPLACE the derived proposal, and the
  // collars are then laid out against the real box rather than a suggested one.
  const c = bto.confirmedBody;
  const o = c ? { ...opts, bodyLengthMm: c.lengthMm ?? opts.bodyLengthMm,
                  bodyWidthMm: c.widthMm ?? opts.bodyWidthMm,
                  bodyHeightMm: c.heightMm ?? opts.bodyHeightMm,
                  bodySource: 'confirmed' } : opts;
  return { ...bto, body: btoBodyGeometry(bto, o) };
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
export function validateBtos(btos, opts = {}) {
  const maxPorts = opts.maxPorts ?? DEFAULT_PORT_CAPACITY;
  const failures = [];
  const warnings = [];
  const ids = new Set(btos.map(b => b.id));
  for (const b of btos) {
    if (!b.inletDiameterMm) {
      failures.push({ btoId: b.id, code: 'NO_INLET', message: b.id + ' has no inlet duct.' });
    }
    if (!b.ports.length) {
      failures.push({ btoId: b.id, code: 'NO_PORTS',
        message: b.id + ' has no outlet ports — a fitting with nothing on it is not a fitting.' });
    }
    // A PORT COUNT IS NOT A FAILURE. It used to be: more than three ports failed
    // validation, which is what drove the router to chain fittings. A cap now
    // only exists if a job set one, and even then it is a fabrication matter for
    // the installer to look at, not a reason to invent a second fitting.
    if (maxPorts && b.ports.length > maxPorts) {
      warnings.push({ btoId: b.id, code: 'PORT_COUNT_ABOVE_CONFIGURED_CAPACITY',
        message: b.id + ' has ' + b.ports.length + ' ports against a configured capacity of ' +
                 maxPorts + '. Installer review required — do NOT chain a second fitting.' });
    }
    const body = b.body || btoBodyGeometry(b, opts);
    if (!body.fits) {
      for (const issue of body.issues) {
        warnings.push({ btoId: b.id, code: 'BTO_FABRICATION_FIT', detail: issue.code,
          message: b.id + ': ' + issue.message + ' Installer review required.' });
      }
    }
    // Report accidental serial chains, but allow a configured 400-350-350
    // distribution fitting to feed geographical local BTOs.
    for (const p of b.ports) {
      if (p.feedsBtoId && !p.intentionalDistribution) {
        warnings.push({ btoId: b.id, code: 'BTO_FEEDS_BTO',
          message: b.id + ' port ' + p.index + ' feeds ' + p.feedsBtoId +
                   ' rather than an outlet — a chained fitting.' });
      }
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
  const chainPorts = btos.reduce((n, b) => n + b.ports.filter(p => p.feedsBtoId).length, 0);
  const intentionalDistributionPorts = btos.reduce((n, b) => n +
    b.ports.filter(p => p.feedsBtoId && p.intentionalDistribution).length, 0);
  const arbitraryChainPorts = chainPorts - intentionalDistributionPorts;
  return {
    ok: failures.length === 0,
    failures,
    warnings,
    count: btos.length,
    maxPortsUsed: btos.length ? Math.max(...btos.map(b => b.ports.length)) : 0,
    portCounts: btos.map(b => b.ports.length),
    outletPorts: btos.reduce((n, b) => n + b.ports.filter(p => p.servesOutletId).length, 0),
    chainPorts,
    intentionalDistributionPorts,
    arbitraryChainPorts,
    chained: arbitraryChainPorts > 0,
    bodies: btos.map(b => b.body || btoBodyGeometry(b, opts)),
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
 * A CLUSTER IS ONE FITTING, HOWEVER MANY RUNS LEAVE IT. This used to split a
 * cluster across chained bodies once it passed three ports. It no longer does,
 * at all: the collars go on one body and `btoBodyGeometry` says whether that
 * body can be made. Nick: "Do not silently create chained BTOs as a workaround."
 *
 * SUPPLY ONLY. A BTO is a supply-air distribution fitting and nothing else. A
 * return grille, a return duct and a return box are not take-offs and must
 * never be counted, drawn or priced as one, so return sections are dropped here
 * before anything is derived — the one place that guarantees it for every
 * caller.
 */
export function deriveBtos(network, opts = {}) {
  const maxPorts = opts.maxPorts ?? DEFAULT_PORT_CAPACITY;
  const mergePx = opts.mergePx ?? BTO_MERGE_PX;
  const sections = (network?.sections || [])
    .filter(s => s.points?.length >= 2)
    .filter(s => !isReturnSection(s));
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
      // ONE CLUSTER, ONE BODY. However many runs leave here, they leave from the
      // same piece of metal. Splitting them across chained bodies at an
      // arbitrary port count is what produced the serial routes Nick rejected.
      n += 1;
      const id = 'bto_' + n;
      const inletMm = parent?.diameterMm ?? null;
      const ports = cluster.runs.map(r => ({
        sectionId: r.id,
        diameterMm: r.diameterMm ?? null,
        airflowLs: r.airflowLs ?? 0,
        servesOutletId: r.outletId || null,
        servesRoomId: r.roomId || null,
        servesLabel: r.destination || outletRoom.get(r.roomId) || null,
        // A run that is not a final carries on to whatever is downstream of it;
        // the second pass below turns that into the fitting it reaches.
        feedsSectionId: r.outletId ? null : r.id,
        intentionalDistribution: !!r.distributionArm,
        zone: r.zone || null,
        damper: !!r.zone
      }));
      btos.push(makeBto({
        id, index: n,
        position: cluster.at,
        inletDiameterMm: inletMm,
        inletAirflowLs: ports.reduce((t, p) => t + (p.airflowLs || 0), 0),
        fedBy: parentId,
        ports,
        label: 'BTO-' + n
      }));
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

/**
 * BTO-A, BTO-B, BTO-C, BTO-C1, BTO-C2 — THE NAME EVERYTHING USES.
 *
 * The letter is the main the fitting hangs off; the suffix is the distribution
 * arm it sits on. It used to be worked out in the drawing layer, which meant
 * the plan said BTO-C1 and the schedule, the order and the price all said
 * `bto_4`. Nick: "The plan drawing, component model, schedules, BOM, pricing
 * and reports must all use the same underlying component objects. Do not
 * maintain separate hardcoded versions that can disagree." So the name is put
 * on the COMPONENT, once, and every surface reads it.
 */
export function labelBtos(btos, network) {
  const sections = new Map((network?.sections || []).map(s => [s.id, s]));
  // A fitting bolted to the MAIN is the main's letter. A fitting out on a
  // DISTRIBUTION ARM takes the arm's own key — `branch_C1` is BTO-C1 — so the
  // three fittings on Main C are BTO-C, BTO-C1 and BTO-C2 rather than three
  // things all called BTO-C.
  const armOf = (sec) => {
    if (!sec || sec.role === 'main') return '';
    const m = /_([A-Z]\d+)$/.exec(sec.id || '');
    if (m) return m[1].slice(1);                 // `branch_C1` → `1`
    return sec.armKey || '';
  };
  return (btos || []).map(b => {
    const sec = b.fedBy ? sections.get(b.fedBy) : null;
    const letter = sec?.mainKey || null;
    if (!letter) return b;
    return { ...b, label: 'BTO-' + letter + (b.armKey || armOf(sec)) };
  });
}

/**
 * THE EXACT CONFIGURATION, AS A PRICE-BOOK KEY.
 *
 * `bto_400_250_250_250`. Inlet first, then every outlet collar, largest first.
 * This is what a fabricator quotes against: not "a ø400 three-port", which
 * could be three 250s or a 350 and two 200s and is a different piece of metal
 * at a different price.
 */
export function btoConfigKey(bto) {
  const outs = bto.ports.map(p => p.diameterMm).filter(Boolean)
    .sort((a, b) => b - a);
  return 'bto_' + (bto.inletDiameterMm || 0) + (outs.length ? '_' + outs.join('_') : '');
}

/**
 * THE KEY TWO FITTINGS MUST MATCH ON TO SHARE A BOM LINE.
 *
 * `400|250,250,250`. Nick: "Do not group BTOs using only inlet diameter and
 * port count ... BTO-A and BTO-C2 must never be grouped merely because both
 * have three outlet ports." They do not: BTO-A is `400|250,250,250` and BTO-C2
 * is `350|250,250,250`, and those are two different orders.
 *
 * A configured body joins the key, because two fittings with the same collars
 * built to different boxes are also two different orders.
 */
export function btoGroupKey(bto) {
  const outs = bto.ports.map(p => p.diameterMm).filter(Boolean)
    .sort((a, b) => a - b);
  const body = bto.body && bto.body.dimensionsSource === 'configured'
    ? '|' + bto.body.bodyLengthMm + 'x' + bto.body.bodyDepthMm : '';
  return (bto.inletDiameterMm || 0) + '|' + outs.join(',') + body;
}

/** `ø400 inlet / 3 × ø250 outlets` — the shape of the fitting, in words. */
export function btoShapeText(bto) {
  const outs = bto.ports.map(p => p.diameterMm).filter(Boolean).sort((a, b) => b - a);
  const groups = [];
  for (const d of outs) {
    const last = groups[groups.length - 1];
    if (last && last.d === d) last.n += 1; else groups.push({ d, n: 1 });
  }
  const outText = groups.map(g => (g.n > 1 ? g.n + ' × ø' + g.d : 'ø' + g.d)).join(' + ');
  return 'ø' + (bto.inletDiameterMm || '?') + ' inlet / ' + outText + ' outlet' +
         (outs.length === 1 ? '' : 's');
}

/**
 * EVERYTHING ABOUT ONE FITTING, IN ONE OBJECT.
 *
 * The plan, the site editor, the fabrication schedule, the BOM, the pricing and
 * both reports all read THIS. Nick: "Use the same BTO and damper component
 * objects for plan, site editor, schedules, BOM, pricing, internal report and
 * customer quote. These outputs must not be able to disagree."
 */
export function btoSpec(bto, { price = null } = {}) {
  const body = bto.body || null;
  const derived = !body || body.dimensionsSource !== 'configured';
  return {
    id: bto.id,
    label: bto.label || bto.id,
    kind: 'bto_fitting',
    airSide: 'supply',
    configKey: btoConfigKey(bto),
    groupKey: btoGroupKey(bto),
    shapeText: btoShapeText(bto),
    inletDiameterMm: bto.inletDiameterMm ?? null,
    inletAirflowLs: bto.inletAirflowLs ?? null,
    fedBy: bto.fedBy || null,
    outletCollarCount: bto.ports.length,
    ports: bto.ports.map(p => ({
      index: p.index,
      diameterMm: p.diameterMm ?? null,
      airflowLs: p.airflowLs ?? null,
      // WHERE THE AIR GOES. A collar with no destination is a collar nobody
      // can install, so it is carried on the schedule as a gap rather than
      // quietly omitted.
      destination: p.servesLabel || (p.feedsBtoId ? p.feedsBtoId + ' (distribution arm)' : null),
      servesOutletId: p.servesOutletId || null,
      servesRoomId: p.servesRoomId || null,
      feedsBtoId: p.feedsBtoId || null,
      zone: p.zone || null
    })),
    bodyLengthMm: body?.bodyLengthMm ?? null,
    bodyWidthMm: body?.bodyWidthMm ?? body?.bodyDepthMm ?? null,
    bodyHeightMm: body?.bodyHeightMm ?? body?.bodyDepthMm ?? null,
    bodyDepthMm: body?.bodyDepthMm ?? null,
    bodyText: body?.bodyText || null,
    dimensionsSource: body?.dimensionsSource || 'derived_from_collars',
    // NEVER CALLED VERIFIED UNLESS SOMEBODY VERIFIED IT. Nick: "do not describe
    // it as verified; do not invent a fabricator-approved dimension."
    dimensionsVerified: !derived,
    // ── THE PHYSICAL PROOF ────────────────────────────────────────────────
    // Which face every collar is on, where its centre is, what clearance it
    // leaves, and whether the face is actually big enough. Nick: "Do not label
    // a derived body as physically validated unless the face-layout
    // calculation passes." A proposal never is, however well it was worked out.
    faceLayout: body?.faceLayout || null,
    layoutValidated: !!body?.layoutValidated,
    layoutStatus: body?.layoutStatus || null,
    layoutPass: body?.faceLayout ? body.faceLayout.pass : null,
    collarFaceLines: faceLayoutLines(body?.faceLayout || null),
    multiFace: !!body?.faceLayout?.multiFace,
    facesUsed: body?.faceLayout?.facesUsed || [],
    proposedBodyText: body?.proposedBodyText || null,
    unplacedCollars: body?.faceLayout?.unplacedCollars || [],
    fabricationStatus: derived
      ? (body?.faceLayout && !body.faceLayout.pass
          ? 'FABRICATION REVIEW REQUIRED — NO VALID COLLAR ARRANGEMENT'
          : 'DERIVED — FABRICATION REVIEW REQUIRED')
      : (body?.layoutValidated
          ? 'CONFIRMED — COLLAR LAYOUT VALIDATED'
          : 'FABRICATION REVIEW REQUIRED — COLLAR LAYOUT DOES NOT FIT'),
    /** Fabrication-ready means a real body whose collars have been laid out on it. */
    fabricationReady: !derived && !!body?.layoutValidated,
    fits: body ? body.fits : true,
    fitIssues: body?.issues || [],
    requiredCollarRunMm: body?.requiredCollarRunMm ?? null,
    availableCollarSpaceMm: body?.availableCollarSpaceMm ?? null,
    // Filled in by the pricing layer; carried here so one object answers
    // everything a schedule or a quote gate needs to ask.
    price: price || null,
    priceStatus: price?.status || 'PRICE REQUIRED'
  };
}

/**
 * What the order has to carry for these fittings.
 *
 * One line per EXACT physical specification, never per inlet-and-port-count,
 * and every individual fitting ID stays on the line it was counted into.
 */
export function btoBomLines(btos) {
  const bySpec = new Map();
  for (const b of btos) {
    const key = btoGroupKey(b);
    const row = bySpec.get(key) || {
      key: 'bto_fitting',
      groupKey: key,
      configKey: btoConfigKey(b),
      inletDiameterMm: b.inletDiameterMm,
      portCount: b.ports.length,
      outletDiametersMm: b.ports.map(p => p.diameterMm).filter(Boolean).sort((x, y) => y - x),
      quantity: 0,
      unit: 'each',
      shapeText: btoShapeText(b),
      label: 'Fabricated BTO branch take-off — ' + btoShapeText(b),
      fittings: []
    };
    row.quantity += 1;
    row.fittings.push(b.id);
    bySpec.set(key, row);
  }
  return [...bySpec.values()].sort((a, b) =>
    b.inletDiameterMm - a.inletDiameterMm || b.portCount - a.portCount ||
    (a.groupKey < b.groupKey ? -1 : 1));
}

export const BTO_MODEL = Object.freeze({
  DEFAULT_PORT_CAPACITY, BTO_MERGE_PX,
  minRoomsForMajorBranch: BTO_RULES.minRoomsForMajorBranch,
  /** A BTO is a supply-air fitting. There is no such thing as a return BTO. */
  airSide: 'supply'
});

export default { makeBto, deriveBtos, validateBtos, reconcileBto, btoBomLines,
                 applyBtoOverrides,
                 btoBodyGeometry, withBody, isReturnSection, labelBtos,
                 btoConfigKey, btoGroupKey, btoShapeText, btoSpec };
