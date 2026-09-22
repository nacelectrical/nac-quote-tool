// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS JOB IS ALLOWED TO DO YET
//
// Two separate questions, and the Kauri report got both wrong:
//
//   IS THE SCALE REAL?        The plan scale was derived from the length of a
//                             car drawn on a marketing floor plan. That moved
//                             the load from 13.33 kW to 17.16 kW across the
//                             plausible range and changed the equipment three
//                             times — and the job still selected a unit, priced
//                             it, and called the rooms "Verified".
//
//   HAS DESIGN STARTED?       The job was explicitly proposal-stage with duct
//                             design deferred. The pipeline nevertheless
//                             invented ten supply mains, a 4,660 mm plenum,
//                             BTOs, Y-pieces, duct sizes, a duct bill of
//                             materials and a static pressure.
//
// Nick: "A vehicle drawn on a marketing floor plan is not an acceptable
// calibration reference for a fixed-price client proposal." And: "Prevent the
// detailed duct pipeline from running until the design stage is deliberately
// started."
//
// So capability is asked for rather than assumed. Every stage of the pipeline
// checks what it is permitted to do, and a permission that is absent produces a
// stated reason rather than a plausible-looking number.
// ─────────────────────────────────────────────────────────────────────────────

export const DESIGN_STAGE = Object.freeze({
  /** Room sizes and a load. No routing, no fittings, no measured quantities. */
  PROPOSAL: 'proposal',
  /** Routing has been deliberately started. The duct pipeline may run. */
  DESIGN: 'design'
});

/** How a plan's scale came to be known. Only some of these are good enough. */
export const SCALE_SOURCE = Object.freeze({
  /** A dimension printed on the plan and read from it. */
  PRINTED_DIMENSION: 'printed_dimension',
  /** A real distance the estimator measured and entered. */
  MEASURED: 'measured',
  /** A scale bar or ratio note on the drawing. */
  SCALE_BAR: 'scale_bar',
  /** Guessed from the size of something drawn on the plan. NEVER sufficient. */
  DRAWN_OBJECT: 'drawn_object',
  /** Nothing. */
  NONE: 'none'
});

/**
 * The sources that may stand behind a fixed price.
 *
 * `drawn_object` is deliberately absent. A car, a bed, a sofa and a kitchen
 * bench on a builder's marketing plan are illustrations at whatever size the
 * renderer liked; they are not survey control.
 */
export const VERIFIED_SCALE_SOURCES = Object.freeze([
  SCALE_SOURCE.PRINTED_DIMENSION, SCALE_SOURCE.MEASURED, SCALE_SOURCE.SCALE_BAR
]);

export const ROOM_STATUS_PROVISIONAL = 'PROVISIONAL — SCALE REQUIRED';

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a scale the estimator established from one known distance.
 *
 * Everything needed to defend the number later is stored with it: the two
 * points clicked, the real distance typed, the derived scale, who did it, when,
 * and where the measurement came from. A calibration nobody can trace is a
 * calibration nobody can check.
 */
export function recordCalibration({ points, realDistanceMm, source, measuredBy,
                                    note = '', at = null, imageWidthPx = null,
                                    imageHeightPx = null } = {}) {
  const p = Array.isArray(points) ? points : [];
  const reasons = [];

  if (p.length !== 2 || ![p[0], p[1]].every(q => q && num(q.x) !== null && num(q.y) !== null)) {
    reasons.push('Two calibration points are required.');
  }
  const real = num(realDistanceMm);
  if (real === null || real <= 0) reasons.push('A real distance is required.');
  if (!VERIFIED_SCALE_SOURCES.includes(source)) {
    reasons.push(source === SCALE_SOURCE.DRAWN_OBJECT
      ? 'A distance scaled off something drawn on the plan is not a measurement. Enter a '
        + 'dimension printed on the drawing, a scale bar, or a distance measured on site.'
      : 'A measurement source is required.');
  }
  if (!str(measuredBy).trim()) reasons.push('Record who took the measurement.');

  if (reasons.length) return { ok: false, reasons, calibration: null };

  const dx = num(p[1].x) - num(p[0].x);
  const dy = num(p[1].y) - num(p[0].y);
  const pixels = Math.sqrt(dx * dx + dy * dy);
  if (!(pixels > 0)) {
    return { ok: false, reasons: ['The two calibration points are the same point.'],
             calibration: null };
  }

  const pixelsPerMm = pixels / real;
  return {
    ok: true,
    reasons: [],
    calibration: {
      pixelsPerMm,
      mmPerPixel: 1 / pixelsPerMm,
      pixelsPerMetre: Math.round(pixelsPerMm * 1000 * 100) / 100,
      verified: true,
      source,
      points: [{ x: num(p[0].x), y: num(p[0].y) }, { x: num(p[1].x), y: num(p[1].y) }],
      pixelDistance: Math.round(pixels * 100) / 100,
      realDistanceMm: real,
      measuredBy: str(measuredBy).trim(),
      measuredAt: at || new Date().toISOString(),
      note: str(note).trim() || null,
      imageWidthPx: num(imageWidthPx),
      imageHeightPx: num(imageHeightPx)
    }
  };
}

/**
 * Is this design's scale good enough to price from?
 *
 * A declared scale with `verified !== true`, or one whose source is a drawn
 * object, is explicitly NOT.
 */
/**
 * Room measurements that do NOT depend on the plan scale.
 *
 * A room sized from a dimension printed on the drawing, reconstructed from a
 * dimension chain, or typed in by the estimator is a real measurement. When a
 * job's conditioned rooms are measured this way, the scale is corroborated by
 * the drawing itself and needs no separate declaration — which is how every
 * existing job in the system was already working before scale had to be stated.
 */
const SCALE_INDEPENDENT_SOURCES = new Set([
  'verified_architectural', 'dimension_chain', 'chain_plus_wall_geometry', 'manual'
]);

function corroboratedByPrintedDimensions(design) {
  const rooms = (design?.rooms || []).filter(r => r && r.conditioned);
  if (!rooms.length) return false;
  const measured = rooms.filter(r => !r.measurement?.incomplete
    && SCALE_INDEPENDENT_SOURCES.has(r.measurement?.source));
  // A majority, so one hand-typed room on an otherwise unscaled plan does not
  // quietly promote the whole job.
  return measured.length >= Math.ceil(rooms.length / 2);
}

export function scaleStatus(design) {
  const c = design?.calibration || null;
  if (!c || !num(c.pixelsPerMm)) {
    return { verified: false, source: SCALE_SOURCE.NONE,
             reason: 'No plan scale has been established.' };
  }
  const source = str(c.source) || SCALE_SOURCE.NONE;

  // An explicit verified source stands on its own.
  if (c.verified === true && VERIFIED_SCALE_SOURCES.includes(source)) {
    return { verified: true, source, reason: null };
  }
  // So does a plan whose rooms came off printed dimensions: the drawing has
  // already told us the scale, and a declaration would add nothing.
  if (source !== SCALE_SOURCE.DRAWN_OBJECT && !/object|vehicle|car/i.test(source)
      && corroboratedByPrintedDimensions(design)) {
    return { verified: true, source: SCALE_SOURCE.PRINTED_DIMENSION, reason: null,
             corroborated: true };
  }
  {
    return {
      verified: false,
      source,
      reason: source === SCALE_SOURCE.DRAWN_OBJECT || /object|vehicle|car/i.test(source)
        ? 'The plan scale was estimated from an object drawn on the plan. A vehicle or a piece '
          + 'of furniture on a marketing floor plan is an illustration, not survey control, and '
          + 'cannot stand behind a fixed price. Enter one genuine measured dimension.'
        : 'The plan scale has not been verified against a printed dimension, a scale bar or a '
          + 'measurement taken on site.'
    };
  }
  return { verified: true, source, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What this design may do, and for anything it may not, exactly why.
 *
 * Every consumer asks this rather than inferring from whatever data happens to
 * be lying around, which is how a job with no routes ended up with a static
 * pressure and a job with no scale ended up with an equipment selection.
 */
/**
 * Has duct design actually been started on this job?
 *
 * An explicit stage on the job always wins — that is how an estimator says
 * "quote this, design it later", which is exactly what 34 Kauri was.
 *
 * With nothing stated, the stage follows the SCALE. Routing produces measured
 * duct lengths, fitting positions and fabricated plenum dimensions; every one
 * of those is a distance, and a distance off an unverified plan is not a
 * measurement. So a job that cannot be measured is a proposal whether anybody
 * said so or not, and a job whose scale is real carries on into design the way
 * the tool has always worked.
 */
/**
 * Can this job's room AREAS be trusted?
 *
 * This is a different question from whether the plan has a pixel scale, and
 * conflating the two was wrong in both directions.
 *
 * A room sized from a dimension printed on the drawing, reconstructed from a
 * dimension chain, or typed in by the estimator is measured — with or without
 * a scale, on a sheet with no image at all. A room sized by measuring PIXELS
 * and multiplying by a scale is only as good as that scale.
 *
 * The load, and therefore the equipment and the price, rest on areas. Duct
 * lengths rest on the pixel scale. So they are gated separately.
 */
export function areaStatus(design) {
  const rooms = (design?.rooms || []).filter(r => r && r.conditioned);
  if (!rooms.length) {
    return { verified: false, reason: 'No conditioned rooms have been measured.' };
  }
  const scale = scaleStatus(design);
  // A room with no size yet is not a SCALE problem — it is already excluded
  // from sizing and already raises its own warning. The question here is
  // narrower: of the rooms that do feed the load, is any of them sized by
  // measuring pixels against a scale nobody verified?
  // "Contributes to the load" means it has an area. A room the plan labels but
  // prints no size for has neither an area nor a source worth judging — it is
  // already excluded from sizing and already raises its own warning.
  const contributing = rooms.filter(r =>
    !r.measurement?.incomplete && Number(r.areaSqM) > 0);
  if (!contributing.length) {
    return { verified: false, reason: 'No conditioned room has a usable measurement yet.' };
  }
  const suspect = contributing.filter(r =>
    !SCALE_INDEPENDENT_SOURCES.has(r.measurement?.source) && !scale.verified);
  if (!suspect.length) return { verified: true, reason: null };

  return {
    verified: false,
    suspectCount: suspect.length,
    roomCount: contributing.length,
    reason: suspect.length + ' of ' + contributing.length + ' conditioned room(s) are sized from the '
      + 'plan rather than from a measurement. ' + (scale.reason || '')
  };
}

/**
 * Is this job at proposal stage or design stage?
 *
 * An explicit stage on the design wins — that is the estimator saying so, and
 * it is what a "proposal only" control sets. Absent that, it is design stage,
 * because NAC's own workflow is that uploading a plan produces a complete
 * design with no extra step, and a default of proposal would stop that dead.
 *
 * The stage is NOT what kept ductwork off 34 Kauri. See `mayRouteDucts`.
 */
export function inferDesignStage(design) {
  const d = design || {};
  if (d.designStage === DESIGN_STAGE.PROPOSAL) return DESIGN_STAGE.PROPOSAL;
  return DESIGN_STAGE.DESIGN;
}

export function capabilities(design, opts = {}) {
  const stage = inferDesignStage(design);
  const scale = scaleStatus(design);
  const areas = areaStatus(design);
  const blocks = [];

  const deny = (key, reason) => { blocks.push({ key, reason }); return false; };

  const mayMeasureRooms = areas.verified
    || deny('measureRooms', areas.reason);

  const maySelectEquipment = areas.verified
    || deny('selectEquipment', 'Equipment cannot be selected from areas taken off an unverified '
        + 'plan — the load, and with it the model, moves with the scale. ' + areas.reason);

  // ── WHAT ACTUALLY KEEPS DUCTWORK OFF A PROPOSAL ─────────────────────────
  //
  // Nick asked for two things that look like they contradict each other:
  //
  //   "Uploading the plan produces a complete design with no advanced step."
  //   "Prevent the detailed duct pipeline from running until the design stage
  //    is deliberately started."
  //
  // They do not contradict. What went wrong on 34 Kauri was never that routing
  // ran on an upload — it is that routing ran on a job with NO VERIFIED SCALE.
  // Every duct length, every fitting position and every plenum dimension it
  // produced was a pixel measurement multiplied by a number taken off a car
  // somebody drew. That is not a short duct design; it is a duct design of
  // nothing.
  //
  // So routing is gated on the SCALE, which is the thing it actually needs,
  // and on an explicit proposal stage, which is the estimator saying not yet.
  // A plan with a real scale designs itself on upload, exactly as before.
  const mayRouteDucts = (stage === DESIGN_STAGE.DESIGN && scale.verified)
    || deny('routeDucts', stage !== DESIGN_STAGE.DESIGN
        ? 'This job is at proposal stage. Detailed duct design — routes, fittings, plenums, '
          + 'duct sizes, static pressure and measured quantities — does not run until the '
          + 'design stage is deliberately started.'
        : 'Duct design cannot run on an unverified scale. Every duct length, fitting '
          + 'position and plenum dimension would be a pixel measurement multiplied by a '
          + 'number nobody has stood behind. ' + (scale.reason || ''));

  const mayPrice = (areas.verified && stage === DESIGN_STAGE.DESIGN)
    || deny('price', !areas.verified
        ? 'A fixed price cannot be built on areas taken off an unverified plan. ' + areas.reason
        : 'A fixed price needs a completed duct design. Use the proposal allowance instead.');

  return {
    stage,
    scale,
    areas,
    mayMeasureRooms,
    maySelectEquipment,
    mayRouteDucts,
    mayCalculatePressure: mayRouteDucts,
    mayBuildDuctBom: mayRouteDucts,
    mayPrice,
    blocks,
    reasonFor(key) {
      const b = blocks.find(x => x.key === key);
      return b ? b.reason : null;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPOSAL ALLOWANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the ductwork is worth before anybody has routed it.
 *
 * Nick: "At proposal stage, use either a configurable standard installation
 * allowance; or a clearly identified provisional allowance based on outlet and
 * zone counts."
 *
 * This is NOT a duct bill of materials. It produces one clearly-labelled line
 * with the basis printed on it, and it will not invent a rate: with nothing
 * configured it returns `null` and says so, rather than reaching for a number
 * that would look like a price.
 */
export function proposalAllowance({ outletCount = 0, zoneCount = 0, settings = null } = {}) {
  const a = settings?.commercial?.proposalAllowance || null;
  if (!a) {
    return { ok: false, amount: null, basis: null,
      reason: 'No proposal ductwork allowance is configured. Set one in HVAC Design Settings '
            + '→ Commercial before quoting at proposal stage.' };
  }
  const flat = num(a.flat);
  const perOutlet = num(a.perOutlet);
  const perZone = num(a.perZone);

  if (flat !== null && perOutlet === null && perZone === null) {
    return { ok: true, amount: flat, basis: 'Standard installation allowance',
             detail: 'A flat NAC allowance for ductwork and installation at proposal stage.',
             provisional: true, reason: null };
  }
  if (perOutlet === null && perZone === null && flat === null) {
    // The block exists but every field is null, which is how it ships. Same
    // answer as no block at all, and the same instruction: a blocker that does
    // not name the screen leaves somebody hunting for it.
    return { ok: false, amount: null, basis: null,
      reason: 'No proposal ductwork allowance has been set. Enter a flat allowance, or a '
            + 'per-outlet and per-zone rate, in HVAC Design Settings → Commercial before '
            + 'quoting at proposal stage.' };
  }
  const amount = (flat ?? 0) + (perOutlet ?? 0) * outletCount + (perZone ?? 0) * zoneCount;
  const parts = [];
  if (flat) parts.push('base ' + flat);
  if (perOutlet) parts.push(outletCount + ' outlet(s) × ' + perOutlet);
  if (perZone) parts.push(zoneCount + ' zone(s) × ' + perZone);
  return {
    ok: true, amount, provisional: true,
    basis: 'Provisional allowance from outlet and zone count',
    detail: parts.join(' + ') + '. Replaced by measured quantities once the duct design is done.',
    reason: null
  };
}
