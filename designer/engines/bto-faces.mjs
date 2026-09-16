// ═══════════════════════════════════════════════════════════════════════════
// WHERE EVERY COLLAR PHYSICALLY SITS ON THE BOX
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick: "A body dimension cannot be derived only from the largest collar or
// inlet ... For example, three Ø250 collars cannot be declared to fit across a
// 400 mm or 450 mm face. Two Ø350 collars cannot be declared to fit across a
// 450 mm face."
//
// He is right, and the old arithmetic could not have caught it. It added up a
// total "collar run", compared it with a total "available space" and never
// asked which face anything was on — so three ø250 collars needing 756 mm of
// metal side by side passed against a 450 mm box because the total was spread
// notionally over three faces at once.
//
// This module lays the collars out for real. Each one is put on a NAMED FACE at
// a MEASURED CENTRE, and the face is then asked whether it is wide enough and
// tall enough for what has been put on it, including the lock seams at its
// corners and the clamp gaps between neighbours. The answer is per face, and
// the whole fitting passes only if every face does.
//
// ── WHAT IS MEASURED AND WHAT IS NOT ───────────────────────────────────────
//
// The allowances below are FABRICATION ALLOWANCES, not manufacturer data. NAC
// has not supplied a fabricator's standard-body table, so none is invented: a
// body worked out in here is a PROPOSAL carrying the layout it would need, and
// it is never reported as validated. Validation happens against a body somebody
// gave us — configured in settings, or the fabricator's own confirmed
// dimensions entered on site — and it can fail.
//
// ── THE BOX ────────────────────────────────────────────────────────────────
//
//        far_end                     L  body length, along the inlet axis
//     ┌───────────┐                  W  body width
//     │           │                  H  body height
//  side_a      side_b
//     │           │      inlet_end : W × H      far_end : W × H
//     └───────────┘      side_a/b  : L × H      top/bottom : L × W
//       inlet_end
//
// `u` is the axis a face spreads collars along, `v` is the other one.

import { BTO as BTO_RULES } from './nac-standard.mjs';

/** The six faces of a rectangular distribution box. */
export const FACE = Object.freeze({
  INLET_END: 'inlet_end',
  FAR_END: 'far_end',
  SIDE_A: 'side_a',
  SIDE_B: 'side_b',
  TOP: 'top',
  BOTTOM: 'bottom'
});

export const FACE_LABEL = Object.freeze({
  [FACE.INLET_END]: 'Inlet end',
  [FACE.FAR_END]: 'Far end',
  [FACE.SIDE_A]: 'Side A',
  [FACE.SIDE_B]: 'Side B',
  [FACE.TOP]: 'Top',
  [FACE.BOTTOM]: 'Bottom'
});

/**
 * The faces a collar may be put on, in the order they are filled.
 *
 * The inlet end is not on the list: the main lands there and a collar beside a
 * ø400 inlet is a collar in the way of the person connecting it. Top and bottom
 * are not on it either by default — a box in a roof is worked on from the
 * sides — but a job may pass its own list.
 */
export const DEFAULT_COLLAR_FACES = Object.freeze([FACE.FAR_END, FACE.SIDE_A, FACE.SIDE_B]);

/**
 * FABRICATION ALLOWANCES. Geometry, not a catalogue.
 *
 * Every one of these is a distance the metal needs and none of them is a
 * manufacturer specification. They are overridable per job, and the numbers a
 * layout used are carried on its result so nobody has to guess which were in
 * force when it was worked out.
 */
export const DEFAULT_ALLOWANCES = Object.freeze({
  /** Spiral collar wall, twice over: the hole is nominal, the metal is not. */
  collarWallMm: BTO_RULES.collarWallMm ?? 0.8,
  /** Bare metal between a collar's outside edge and the edge of its face. */
  edgeClearanceMm: BTO_RULES.collarEdgeClearanceMm ?? 25,
  /** Bare metal between two neighbouring collars — the clamp has to go on. */
  collarClearanceMm: BTO_RULES.collarClearanceMm ?? 40,
  /** The lock seam folded at each corner. It eats face width at both ends. */
  seamAllowanceMm: BTO_RULES.seamAllowanceMm ?? 15,
  /** Bodies are made in steps, so a proposal is rounded up to one. */
  bodyIncrementMm: BTO_RULES.bodyIncrementMm ?? 50,
  /** The longest body worth fabricating and lifting into a roof, if set. */
  maxBodyLengthMm: BTO_RULES.maxBodyLengthMm ?? null
});

const ceilTo = (n, step) => step > 0 ? Math.ceil(n / step) * step : Math.ceil(n);
const r1 = (n) => Math.round(n * 10) / 10;

/** A nominal duct size as a piece of metal: the hole is nominal, the collar is not. */
export function collarOutsideDiameterMm(nominalMm, allowances = DEFAULT_ALLOWANCES) {
  if (!nominalMm) return 0;
  return Math.ceil(nominalMm + 2 * (allowances.collarWallMm ?? 0.8));
}

/** The dimensions of one face of a body. */
export function faceSize(face, body) {
  const { lengthMm: L, widthMm: W, heightMm: H } = body;
  switch (face) {
    case FACE.INLET_END:
    case FACE.FAR_END: return { uMm: W, vMm: H, uAxis: 'body width', vAxis: 'body height' };
    case FACE.SIDE_A:
    case FACE.SIDE_B: return { uMm: L, vMm: H, uAxis: 'body length', vAxis: 'body height' };
    case FACE.TOP:
    case FACE.BOTTOM: return { uMm: L, vMm: W, uAxis: 'body length', vAxis: 'body width' };
    default: return { uMm: 0, vMm: 0, uAxis: '?', vAxis: '?' };
  }
}

/**
 * Lay a row of collars along one face and measure it.
 *
 * The row is centred, so the clearance left at each end is equal and is a real
 * measurement rather than an assumption. Everything the fabricator would want
 * to mark out is on the result.
 */
export function layoutFace(face, collars, body, allowances = DEFAULT_ALLOWANCES) {
  const size = faceSize(face, body);
  const edge = allowances.edgeClearanceMm;
  const seam = allowances.seamAllowanceMm;
  const gap = allowances.collarClearanceMm;
  const ods = collars.map(c => collarOutsideDiameterMm(c.diameterMm, allowances));

  const runMm = ods.reduce((n, d) => n + d, 0) + Math.max(0, ods.length - 1) * gap;
  const requiredUMm = collars.length ? runMm + 2 * (edge + seam) : 0;
  const requiredVMm = collars.length
    ? Math.max(...ods) + 2 * (edge + seam) : 0;

  // Centre the row; the leftover at each end is what the edge clearance
  // actually comes out at, which is what gets checked and reported.
  const start = (size.uMm - runMm) / 2;
  let cursor = start;
  const placed = collars.map((c, i) => {
    const od = ods[i];
    const centreU = cursor + od / 2;
    cursor += od + gap;
    return {
      portIndex: c.portIndex ?? i + 1,
      nominalDiameterMm: c.diameterMm,
      outsideDiameterMm: od,
      face,
      faceLabel: FACE_LABEL[face],
      centreUmm: r1(centreU),
      centreVmm: r1(size.vMm / 2),
      uAxis: size.uAxis,
      vAxis: size.vAxis,
      /** Metal from this collar's edge to the nearest face edge, past the seam. */
      edgeClearanceUmm: r1(Math.min(centreU - od / 2, size.uMm - (centreU + od / 2)) - seam),
      edgeClearanceVmm: r1((size.vMm - od) / 2 - seam),
      clearanceToPreviousMm: i === 0 ? null : gap,
      destination: c.destination ?? null,
      airflowLs: c.airflowLs ?? null,
      seamAllowanceMm: seam
    };
  });

  const issues = [];
  if (collars.length && requiredUMm > size.uMm) {
    issues.push({
      code: 'FACE_TOO_NARROW',
      face,
      message: collars.length + ' collar(s) (' + collars.map(c => 'ø' + c.diameterMm).join(', ') +
        ') need ' + requiredUMm + ' mm across ' + FACE_LABEL[face].toLowerCase() + '; the ' +
        size.uAxis + ' is ' + size.uMm + ' mm.'
    });
  }
  if (collars.length && requiredVMm > size.vMm) {
    issues.push({
      code: 'FACE_TOO_SHORT',
      face,
      message: 'A ø' + Math.max(...collars.map(c => c.diameterMm)) + ' collar needs ' +
        requiredVMm + ' mm of ' + size.vAxis + ' on ' + FACE_LABEL[face].toLowerCase() +
        '; it is ' + size.vMm + ' mm.'
    });
  }

  return {
    face,
    faceLabel: FACE_LABEL[face],
    availableWidthMm: size.uMm,
    availableHeightMm: size.vMm,
    widthAxis: size.uAxis,
    heightAxis: size.vAxis,
    collarCount: collars.length,
    collarRunMm: r1(runMm),
    requiredWidthMm: requiredUMm,
    requiredHeightMm: requiredVMm,
    spareWidthMm: r1(size.uMm - requiredUMm),
    edgeClearanceMm: edge,
    collarClearanceMm: gap,
    seamAllowanceMm: seam,
    collars: placed,
    fits: issues.length === 0,
    issues
  };
}

/**
 * Put every collar on a face, or report the ones that will not go anywhere.
 *
 * Each collar goes to whichever allowed face has the most metal left once it is
 * added, which spreads them instead of crowding one side, and keeps the port
 * order within a face. A collar that fits nowhere is reported as UNPLACED
 * rather than quietly squeezed onto a face that cannot take it.
 */
export function assignCollars(collars, body, allowances = DEFAULT_ALLOWANCES,
                              faces = DEFAULT_COLLAR_FACES) {
  const buckets = new Map(faces.map(f => [f, []]));
  const unplaced = [];
  for (const c of collars) {
    let best = null;
    for (const f of faces) {
      const trial = [...buckets.get(f), c];
      const l = layoutFace(f, trial, body, allowances);
      if (!l.fits) continue;
      const slack = l.spareWidthMm;
      if (!best || slack > best.slack) best = { face: f, slack };
    }
    if (!best) { unplaced.push(c); continue; }
    buckets.get(best.face).push(c);
  }
  return { buckets, unplaced };
}

/**
 * THE SMALLEST BOX THIS SET OF COLLARS PHYSICALLY GOES ON.
 *
 * A PROPOSAL, and labelled as one. The cross-section has to swallow the inlet
 * and the tallest collar; the length then grows in fabrication steps until
 * every collar has a face to sit on. It is never returned as validated — see
 * the note at the top of the file.
 */
export function proposeBody(inletDiameterMm, collars, allowances = DEFAULT_ALLOWANCES,
                            faces = DEFAULT_COLLAR_FACES) {
  const step = allowances.bodyIncrementMm || 10;
  const frame = 2 * (allowances.edgeClearanceMm + allowances.seamAllowanceMm);
  const inletOd = collarOutsideDiameterMm(inletDiameterMm, allowances);
  const collarOds = collars.map(c => collarOutsideDiameterMm(c.diameterMm, allowances));
  const biggest = collarOds.length ? Math.max(...collarOds) : 0;

  // The end faces carry the inlet, so the cross-section is set by whichever is
  // larger: the inlet with its clearances, or the tallest collar with its own.
  const cross = ceilTo(Math.max(inletOd + frame, biggest + frame, 1), step);
  // A box has to be at least as long as the duct entering it is wide, or the
  // air has nowhere to turn. Geometry, not a rule of thumb about pressure.
  let length = ceilTo(Math.max(biggest + frame, inletOd), step);

  const cap = allowances.maxBodyLengthMm || (cross * 8);
  for (let guard = 0; guard < 200; guard++) {
    const body = { lengthMm: length, widthMm: cross, heightMm: cross };
    const { unplaced } = assignCollars(collars, body, allowances, faces);
    if (!unplaced.length) return { ...body, achievable: true };
    if (length + step > cap) break;
    length += step;
  }
  return { lengthMm: length, widthMm: cross, heightMm: cross, achievable: false };
}

/**
 * THE WHOLE FABRICATION RECORD FOR ONE FITTING.
 *
 * @param {object} bto           the fitting, with `ports`
 * @param {object} opts.body     a body somebody gave us: `{ lengthMm, widthMm,
 *                               heightMm }`. Present means VALIDATE against it.
 *                               Absent means PROPOSE one.
 * @param {string} opts.bodySource 'confirmed' (the fabricator's own) or
 *                               'configured' (a job setting).
 */
export function btoFaceLayout(bto, opts = {}) {
  const allowances = { ...DEFAULT_ALLOWANCES, ...(opts.allowances || {}) };
  const faces = opts.collarFaces || DEFAULT_COLLAR_FACES;
  const collars = (bto.ports || []).map(p => ({
    portIndex: p.index,
    diameterMm: p.diameterMm,
    destination: p.servesLabel || p.destination ||
      (p.feedsBtoId ? p.feedsBtoId + ' (distribution arm)' : null),
    airflowLs: p.airflowLs ?? null
  })).filter(c => c.diameterMm);

  const given = opts.body && opts.body.lengthMm ? {
    lengthMm: opts.body.lengthMm,
    widthMm: opts.body.widthMm || opts.body.depthMm || opts.body.lengthMm,
    heightMm: opts.body.heightMm || opts.body.depthMm || opts.body.widthMm || opts.body.lengthMm
  } : null;

  const proposal = proposeBody(bto.inletDiameterMm, collars, allowances, faces);
  const body = given || { lengthMm: proposal.lengthMm, widthMm: proposal.widthMm,
                          heightMm: proposal.heightMm };

  // ── The inlet, on its own face, in the middle of it ────────────────────
  const inlet = layoutFace(FACE.INLET_END,
    [{ portIndex: 0, diameterMm: bto.inletDiameterMm, destination: bto.fedBy || 'main duct',
       airflowLs: bto.inletAirflowLs ?? null }],
    body, allowances);

  // ── Every outlet collar, on a named face ──────────────────────────────
  const { buckets, unplaced } = assignCollars(collars, body, allowances, faces);
  const faceRows = faces
    .map(f => layoutFace(f, buckets.get(f) || [], body, allowances))
    .filter(r => r.collarCount > 0);

  // A collar that could not be placed still has to be measured and shown, so
  // the reason it does not fit is on the sheet rather than an empty space.
  const unplacedRows = unplaced.map(c => {
    const worst = faces.map(f => layoutFace(f, [c], body, allowances))
      .sort((a, b) => b.spareWidthMm - a.spareWidthMm)[0];
    return {
      portIndex: c.portIndex,
      nominalDiameterMm: c.diameterMm,
      outsideDiameterMm: collarOutsideDiameterMm(c.diameterMm, allowances),
      destination: c.destination,
      airflowLs: c.airflowLs,
      reason: 'No face on a ' + body.lengthMm + ' × ' + body.widthMm + ' × ' + body.heightMm +
        ' mm body has room for it beside the collars already on this fitting. The best fit, ' +
        (worst?.faceLabel || '—').toLowerCase() + ', is short by ' +
        Math.max(0, r1(-(worst?.spareWidthMm ?? 0))) + ' mm.'
    };
  });

  const issues = [...inlet.issues, ...faceRows.flatMap(r => r.issues)];
  if (unplacedRows.length) {
    issues.push({
      code: 'COLLAR_HAS_NO_FACE',
      message: unplacedRows.length + ' collar(s) will not fit on any face of a ' +
        body.lengthMm + ' × ' + body.widthMm + ' × ' + body.heightMm + ' mm body: ' +
        unplacedRows.map(u => 'ø' + u.nominalDiameterMm).join(', ') + '.'
    });
  }
  // A collar cannot be wider than the duct that feeds it, whatever the box is.
  const maxCollar = collars.length ? Math.max(...collars.map(c => c.diameterMm)) : 0;
  if (bto.inletDiameterMm && maxCollar > bto.inletDiameterMm) {
    issues.push({
      code: 'COLLAR_LARGER_THAN_INLET',
      message: 'A ø' + maxCollar + ' collar comes off a ø' + bto.inletDiameterMm + ' inlet.'
    });
  }

  const pass = issues.length === 0;
  const bodySource = given ? (opts.bodySource || 'configured') : 'proposed';
  const usedFaces = [...new Set(faceRows.map(r => r.face))];

  return {
    btoId: bto.id,
    label: bto.label || bto.id,
    bodyLengthMm: body.lengthMm,
    bodyWidthMm: body.widthMm,
    bodyHeightMm: body.heightMm,
    bodyText: body.lengthMm + ' × ' + body.widthMm + ' × ' + body.heightMm + ' mm',
    bodySource,
    allowances,
    collarFaces: faces,
    /** The proposal is carried even when validating, so the two can be compared. */
    proposedBody: {
      lengthMm: proposal.lengthMm, widthMm: proposal.widthMm, heightMm: proposal.heightMm,
      bodyText: proposal.lengthMm + ' × ' + proposal.widthMm + ' × ' + proposal.heightMm + ' mm',
      achievable: proposal.achievable
    },
    inlet: {
      face: FACE.INLET_END,
      faceLabel: FACE_LABEL[FACE.INLET_END],
      nominalDiameterMm: bto.inletDiameterMm ?? null,
      outsideDiameterMm: collarOutsideDiameterMm(bto.inletDiameterMm, allowances),
      centreUmm: inlet.collars[0]?.centreUmm ?? null,
      centreVmm: inlet.collars[0]?.centreVmm ?? null,
      edgeClearanceMm: inlet.collars[0]?.edgeClearanceUmm ?? null,
      requiredWidthMm: inlet.requiredWidthMm,
      requiredHeightMm: inlet.requiredHeightMm,
      availableWidthMm: inlet.availableWidthMm,
      availableHeightMm: inlet.availableHeightMm,
      fits: inlet.fits,
      issues: inlet.issues
    },
    faces: faceRows,
    /** One flat list of every outlet collar with the face it is on. */
    collars: faceRows.flatMap(r => r.collars),
    unplacedCollars: unplacedRows,
    /** More than one face in use — the arrangement has to be drawn to be read. */
    multiFace: usedFaces.length > 1,
    facesUsed: usedFaces,
    totalCollarRunMm: r1(faceRows.reduce((n, r) => n + r.collarRunMm, 0)),
    pass,
    issues,
    /**
     * VALIDATED means somebody gave us a body and the collars physically go on
     * it. A proposal is never validated, however carefully it was worked out.
     */
    validated: pass && bodySource !== 'proposed',
    status: bodySource === 'proposed'
      ? (proposal.achievable && pass
          ? 'PROPOSED — FABRICATION REVIEW REQUIRED'
          : 'FABRICATION REVIEW REQUIRED — NO VALID COLLAR ARRANGEMENT')
      : (pass ? 'VALIDATED — COLLAR LAYOUT FITS'
              : 'FABRICATION REVIEW REQUIRED — COLLAR LAYOUT DOES NOT FIT')
  };
}

/** The layout as lines a schedule or a PDF prints without reformatting. */
export function faceLayoutLines(layout) {
  if (!layout) return [];
  const lines = [
    'Inlet ø' + layout.inlet.nominalDiameterMm + ' (OD ' + layout.inlet.outsideDiameterMm +
    ') on ' + layout.inlet.faceLabel.toLowerCase() + ' — centre ' + layout.inlet.centreUmm +
    ' × ' + layout.inlet.centreVmm + ' mm, edge clearance ' + layout.inlet.edgeClearanceMm +
    ' mm, face needs ' + layout.inlet.requiredWidthMm + ' × ' + layout.inlet.requiredHeightMm +
    ' mm of ' + layout.inlet.availableWidthMm + ' × ' + layout.inlet.availableHeightMm + ' mm' +
    (layout.inlet.fits ? '' : ' — DOES NOT FIT')
  ];
  for (const f of layout.faces) {
    lines.push(f.faceLabel + ' (' + f.availableWidthMm + ' × ' + f.availableHeightMm +
      ' mm): ' + f.collarCount + ' collar(s), needs ' + f.requiredWidthMm + ' × ' +
      f.requiredHeightMm + ' mm' + (f.fits ? '' : ' — DOES NOT FIT'));
    for (const c of f.collars) {
      lines.push('    ø' + c.nominalDiameterMm + ' (OD ' + c.outsideDiameterMm + ') centre ' +
        c.centreUmm + ' mm along ' + c.uAxis + ', ' + c.centreVmm + ' mm up — ' +
        (c.destination || 'NOT CONNECTED') +
        (c.airflowLs == null ? '' : ' ' + c.airflowLs + ' L/s'));
    }
  }
  for (const u of layout.unplacedCollars) {
    lines.push('ø' + u.nominalDiameterMm + ' → ' + (u.destination || 'NOT CONNECTED') +
      ': NO FACE. ' + u.reason);
  }
  return lines;
}

export default { FACE, FACE_LABEL, DEFAULT_COLLAR_FACES, DEFAULT_ALLOWANCES,
                 collarOutsideDiameterMm, faceSize, layoutFace, assignCollars,
                 proposeBody, btoFaceLayout, faceLayoutLines };
