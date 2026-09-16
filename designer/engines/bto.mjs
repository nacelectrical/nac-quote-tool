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
  const gap = opts.collarGapMm ?? BTO_RULES.collarGapMm ?? 60;
  const wall = opts.wallAllowanceMm ?? BTO_RULES.bodyWallAllowanceMm ?? 25;
  const faces = Math.max(1, opts.collarFaces ?? BTO_RULES.collarFaces ?? 3);
  const collars = bto.ports.map(p => p.diameterMm).filter(Boolean);
  const inlet = bto.inletDiameterMm || 0;

  // Depth has to swallow the inlet and the biggest collar, plus the metal.
  // A CONFIGURED BODY IS CHECKED AGAINST; A DERIVED ONE IS ONLY DESCRIBED.
  // Deriving the depth from the collars and then testing the collars against it
  // is circular — it can never fail, so it would be a check in name only. Where
  // a job configures a real body size, that size is what the collars have to fit.
  const maxCollar = collars.length ? Math.max(...collars) : 0;
  const derivedDepthMm = Math.max(inlet, maxCollar) + wall * 2;
  const configuredDepthMm = opts.bodyDepthMm ?? null;
  const bodyDepthMm = configuredDepthMm ?? derivedDepthMm;

  // Every collar needs its own diameter plus a clamp gap along a face.
  const requiredCollarRunMm = collars.reduce((n, d) => n + d + gap, 0);
  // Split across the faces that can take collars; the long sides are the body
  // length, the end is the body depth, so length is what has to grow.
  const longSides = Math.max(1, faces - 1);
  const endFaceRunMm = faces > 1 ? bodyDepthMm : 0;
  const runOnSidesMm = Math.max(0, requiredCollarRunMm - endFaceRunMm);
  const derivedLengthMm = Math.max(inlet + wall * 2,
    Math.ceil((runOnSidesMm / longSides) / 10) * 10);
  const configuredLengthMm = opts.bodyLengthMm ?? null;
  const bodyLengthMm = configuredLengthMm ?? derivedLengthMm;

  const availableCollarSpaceMm = bodyLengthMm * longSides + endFaceRunMm;
  const maxBodyLengthMm = opts.maxBodyLengthMm ?? null;

  const issues = [];
  // A COLLAR BIGGER THAN THE DUCT FEEDING IT. Physically the spigot would be
  // wider than the inlet it takes air from — you cannot pull 300 out of a 250.
  if (inlet && maxCollar > inlet) {
    issues.push({ code: 'COLLAR_LARGER_THAN_INLET',
      message: 'A ø' + maxCollar + ' collar comes off a ø' + inlet + ' inlet.' });
  }
  // Against a body the job actually configured, not one derived from the answer.
  if (configuredDepthMm && maxCollar > configuredDepthMm) {
    issues.push({ code: 'COLLAR_EXCEEDS_BODY_DEPTH',
      message: 'A ø' + maxCollar + ' collar will not fit the configured ' +
               configuredDepthMm + ' mm body depth.' });
  }
  if (configuredLengthMm && requiredCollarRunMm > availableCollarSpaceMm) {
    issues.push({ code: 'COLLARS_EXCEED_AVAILABLE_SPACE',
      message: bto.label + ' needs ' + requiredCollarRunMm + ' mm of collar run on a body ' +
               'offering ' + availableCollarSpaceMm + ' mm.' });
  }
  if (maxBodyLengthMm && bodyLengthMm > maxBodyLengthMm) {
    issues.push({ code: 'BODY_LONGER_THAN_CONFIGURED_MAXIMUM',
      message: bto.label + ' needs a ' + bodyLengthMm + ' mm body; the configured ' +
               'maximum is ' + maxBodyLengthMm + ' mm.' });
  }
  return {
    portCount: bto.ports.length,
    collarDiametersMm: collars,
    collarAirflowsLs: bto.ports.map(p => p.airflowLs),
    totalOutletAirflowLs: bto.ports.reduce((n, p) => n + (p.airflowLs || 0), 0),
    inletDiameterMm: inlet || null,
    inletAirflowLs: bto.inletAirflowLs,
    bodyLengthMm, bodyDepthMm,
    bodyText: bodyLengthMm + ' × ' + bodyDepthMm + ' × ' + bodyDepthMm + ' mm',
    collarGapMm: gap,
    collarFaces: faces,
    requiredCollarRunMm,
    availableCollarSpaceMm,
    spareCollarSpaceMm: availableCollarSpaceMm - requiredCollarRunMm,
    fits: issues.length === 0,
    issues,
    dimensionsSource: (configuredLengthMm || configuredDepthMm)
      ? 'configured' : 'derived_from_collars',
    verified: !!(configuredLengthMm && configuredDepthMm),
    bomDescription: 'BTO distribution box ø' + (inlet || '?') + ' inlet — ' +
      bto.ports.length + ' × collar (' + collars.map(d => 'ø' + d).join(', ') +
      '), body ' + bodyLengthMm + ' × ' + bodyDepthMm + ' mm'
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

/** The fitting with its fabrication record attached. */
export function withBody(bto, opts = {}) {
  return { ...bto, body: btoBodyGeometry(bto, opts) };
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
    bodyDepthMm: body?.bodyDepthMm ?? null,
    bodyText: body?.bodyText || null,
    dimensionsSource: body?.dimensionsSource || 'derived_from_collars',
    // NEVER CALLED VERIFIED UNLESS SOMEBODY VERIFIED IT. Nick: "do not describe
    // it as verified; do not invent a fabricator-approved dimension."
    dimensionsVerified: !derived,
    fabricationStatus: derived ? 'DERIVED — FABRICATION REVIEW REQUIRED' : 'CONFIGURED',
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
                 btoBodyGeometry, withBody, isReturnSection, labelBtos,
                 btoConfigKey, btoGroupKey, btoShapeText, btoSpec };
