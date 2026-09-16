// ═══════════════════════════════════════════════════════════════════════════
// THE NAC HVAC SYMBOL LIBRARY
// ═══════════════════════════════════════════════════════════════════════════
//
// ONE set of symbols, drawn by ONE set of functions, used by the plan editor,
// Clean View, the internal report and the PDF. That is the whole point of the
// file: those four surfaces used to draw their own versions of the same thing,
// so a BTO could be a grey circle in one place and a tick in another, and a
// drawing could disagree with the report about what was being installed.
//
// Nick's brief: "Build the icons as reusable SVG or canvas drawing functions
// from one shared symbol library. The Plan editor, Clean View, internal report
// and PDF must use the same symbols so they cannot visually disagree."
//
// CANVAS, NOT SVG. Every surface here already draws to a 2D context — the plan
// viewer, the flex renderer and the PDF snapshot all go through canvas — so a
// canvas function can serve all four. An SVG set would need a second renderer
// for the PDF path and the two would drift.
//
// EVERYTHING IS IN SCREEN SPACE. A symbol is handed a point that has already
// been through the viewer's transform, so it draws at a constant on-screen size
// and stays legible on an iPad at any zoom. Ducts are the exception: their width
// IS the duct's real diameter, which is the one thing that should scale.
//
// AUSTRALIAN RESIDENTIAL DUCTED CONVENTION. Square and round ceiling diffusers,
// linear slots, sidewall grilles, fabricated BTO manifolds, a supply plenum off
// the fan coil, and return grilles back to a return box. Not a commercial VAV
// sheet.

import { DRAWING } from '../engines/nac-standard.mjs';

// ── Palette ────────────────────────────────────────────────────────────────
//
// Size is the colour, and the colour is never the only cue: every important
// duct carries its diameter as text as well, because a printed greyscale copy
// and a colour-blind reader both have to be able to size a run.

/** Duct colour by diameter. The same table the schedule and the key read. */
export const DUCT_COLOUR = Object.freeze({ ...DRAWING.sizeColours });
export const DUCT_COLOUR_FALLBACK = DRAWING.sizeColourFallback;

/** Return air is its own system and gets its own neutral colour, never a size. */
export const RETURN_COLOUR = '#6E7486';
/** The item under the finger. */
export const SELECTION_COLOUR = '#13C7DC';
/** Only ever on the affected item — never a whole-drawing wash. */
export const WARNING_COLOUR = '#D7263D';
/** Room boxes: pale green, and only in Edit rooms. */
export const ROOM_COLOUR = '#4CC38A';
/** Sheet metal. Fittings, plenums and boxes are all made of it. */
export const METAL_DARK = '#4A4F57';
export const METAL_MID = '#C9CCD1';
export const METAL_LIGHT = '#FBFBFC';
export const INK = '#1D2230';

export function ductColour(diameterMm) {
  return DUCT_COLOUR[diameterMm] || DUCT_COLOUR_FALLBACK;
}

// ── Line hierarchy ─────────────────────────────────────────────────────────
//
// A drawing is read by line weight before it is read by colour or label, so the
// order below is the order of importance and must not be flattened: a final
// outlet duct that looks as heavy as a supply main makes the drawing lie about
// what carries the air.

export const LINE_WEIGHT = Object.freeze({
  main: 1.0,        // thickest — scaled by real diameter on top of this
  arm: 0.82,        // distribution arm, medium-heavy
  final: 0.66,      // final outlet duct, medium
  return: 0.9,      // heavy, and dashed, so it can never read as supply
  control: 0.28,    // zone wiring — must stay lighter than any duct
  drain: 0.3,
  room: 0.22        // translucent, edit mode only
});

/** Dash pattern for the runs that are not supply air. */
export const DASH = Object.freeze({
  return: [9, 7],
  control: [4, 4],
  drain: [5, 4],
  room: [6, 5]
});

// ── Label formats ──────────────────────────────────────────────────────────
//
// One place, so the plan, the schedule, the report and the PDF cannot format
// the same fact two ways. The separator is a middle dot throughout.

const D = (mm) => 'ø' + mm;

export const LABEL = Object.freeze({
  /** `ø350 · 138 L/s` — or just the size when the airflow is shown elsewhere. */
  duct: (mm, ls) => ls == null ? D(mm) : D(mm) + ' · ' + Math.round(ls) + ' L/s',
  /** `O7 · MASTER · 50 L/s` */
  outlet: (n, room, ls) =>
    ['O' + n, room, ls == null ? null : Math.round(ls) + ' L/s'].filter(Boolean).join(' · '),
  /** `BTO-C2 · 350-250-250-250` — the inlet then every outlet collar. */
  bto: (id, inletMm, collarsMm = []) =>
    [id, [inletMm, ...collarsMm].filter(Boolean).join('-')].filter(Boolean).join(' · '),
  /** `R1 · 600×400 · ø400` */
  returnGrille: (id, w, h, ductMm) =>
    [id, (w && h) ? w + '×' + h : null, ductMm ? D(ductMm) : null]
      .filter(Boolean).join(' · '),
  /** `RETURN Ø400` */
  returnDuct: (mm) => 'RETURN ' + D(mm),
  /** `ZM-3 · BEDROOMS` */
  zoneMotor: (n, zone) => ['ZM-' + n, zone].filter(Boolean).join(' · '),
  /** `Ø400→Ø350` — both sizes, always. */
  reducer: (fromMm, toMm) => D(fromMm) + '→' + D(toMm),
  /** Airflow on its own, for the figure beside an outlet. */
  flow: (ls) => Math.round(ls) + ' L/s',
  /** A bare diameter, for close-zoom detail beside a single collar. */
  size: (mm) => D(mm)
});

// ── Label placement ────────────────────────────────────────────────────────
//
// A label ledger. Labels book the patch of screen they occupy so the next one
// can step aside rather than land on top — and symbols book theirs FIRST, so a
// duct size never ends up written across a diffuser or a fan coil.

export function createLabelLedger() {
  const boxes = [];
  return {
    boxes,
    reset() { boxes.length = 0; },
    /** Reserve a rectangle a symbol occupies, so no label can be put on it. */
    reserve(x, y, w, h, weight = 3) { boxes.push({ x0: x - w / 2, x1: x + w / 2,
                                                   y0: y - h / 2, y1: y + h / 2,
                                                   weight, symbol: true }); },
    hits(b) {
      return boxes.some(o => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
    },
    /**
     * TOTAL area this box would cover, in square px — the score a label is
     * placed by. A boolean "does it hit anything" cannot choose between a
     * candidate that clips one corner and one that sits squarely on the fan
     * coil, and on a crowded sheet every candidate hits something.
     */
    overlap(b) {
      let n = 0;
      for (const o of boxes) {
        const w = Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0);
        const h = Math.min(b.y1, o.y1) - Math.max(b.y0, o.y0);
        // A reserved SYMBOL costs more to cover than another label: a label can
        // be read around, a fitting drawn over is a fitting you cannot see.
        if (w > 0 && h > 0) n += w * h * (o.weight || 1);
      }
      return n;
    },
    add(b) { boxes.push(b); },
    /** Everything already on the sheet, for a caller that wants to measure. */
    all() { return boxes.slice(); }
  };
}

/**
 * Where a label may step to, nearest first.
 *
 * Generated rather than listed so the ring widens evenly: a label that cannot
 * sit beside its symbol keeps looking outwards in rings rather than jumping to
 * an arbitrary far corner. Nearest-first matters because the chosen position is
 * scored on overlap and ties are broken by distance — a label should end up as
 * close to the thing it names as the crowding allows.
 */
const LABEL_OFFSETS = (() => {
  const out = [[0, 0]];
  for (const r of [14, 22, 30, 40, 52, 66, 82, 100, 122, 148, 178]) {
    // Twenty bearings per ring rather than twelve. A coarse ring leaves gaps
    // that a label cannot reach, and on a crowded sheet the best it could do
    // was clip the corner of an outlet by a pixel and a half. Resolution is
    // cheap here — this is a few hundred rectangle tests per frame.
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      out.push([Math.round(Math.cos(a) * r * 1.35), Math.round(Math.sin(a) * r * 0.78)]);
    }
  }
  return out;
})();

/**
 * How far a label may sit from its symbol before it needs a leader line.
 *
 * Beyond this the tie between a label and the thing it names stops being
 * obvious, and a reader has to guess which fitting `BTO-C · 400-350-350`
 * belongs to. A thin leader removes the guess.
 */
export const LEADER_THRESHOLD_PX = 26;

/** Overlap area between two boxes, in square px. Zero when they miss. */
function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return (w > 0 && h > 0) ? w * h : 0;
}

/**
 * A label, placed where it covers least, with a leader when it has to go far.
 *
 * THE CHANGE FROM "FIRST FREE SPOT" TO "LEAST OVERLAP". The old placer took the
 * first candidate that hit nothing, and if every candidate hit something it gave
 * up and dropped the label at the origin — on top of the symbol. On a crowded
 * sheet that is exactly when a label matters most. Scoring every candidate and
 * taking the smallest overlap means the worst case is a label that clips a
 * corner of something, not one written across a fan coil.
 *
 * Obstacles are everything already on the sheet: the fan coil, the plenum, the
 * return box, every BTO, every outlet, every other label, and the plan's own
 * printed room names where they have been registered.
 */
export function drawLabel(ctx, text, at, opts = {}) {
  const { size = 8.5, colour = INK, ledger = null, weight = 700,
          backing = 'rgba(255,255,255,0.9)', leader = true,
          padX = 5, padY = 3,
          // WHERE THE LEADER POINTS, which is not always where the search
          // starts. A plenum label begins its search beside the box so it does
          // not have to walk far — but the leader must point at the BOX, or it
          // ends up indicating a patch of empty ceiling and the reader has to
          // guess which component the label belongs to. Nick, on exactly this:
          // "Move the RETURN BOX label so it points directly to the actual
          // return box — not to BTO-A or a nearby duct."
          anchor = null } = opts;
  if (!text) return null;
  ctx.save();
  ctx.font = weight + ' ' + size + 'px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + padX * 2;
  const h = size + padY * 2;

  let best = { x: at.x, y: at.y, score: Infinity, dist: 0 };
  if (ledger) {
    for (const [dx, dy] of LABEL_OFFSETS) {
      const b = { x0: at.x + dx - w / 2, x1: at.x + dx + w / 2,
                  y0: at.y + dy - h / 2, y1: at.y + dy + h / 2 };
      const score = ledger.overlap(b);
      const dist = Math.hypot(dx, dy);
      // OVERLAP DOMINATES ABSOLUTELY; DISTANCE ONLY BREAKS TIES.
      //
      // Adding the two put them in the same currency, so a clear spot forty
      // pixels further away lost to one that clipped an outlet by twelve square
      // pixels. Any overlap at all must be worse than any distance, or the
      // placer will keep buying a shorter leader with somebody else's symbol.
      const total = score * 10000 + dist;
      if (total < best.score) best = { x: at.x + dx, y: at.y + dy, score: total,
                                       dist, box: b, raw: score };
      if (score === 0) break;                     // nothing better than clear
    }
    if (best.box) ledger.add(best.box);
  }
  const px = best.x, py = best.y;

  // A LEADER, when the label had to go looking for room.
  const tip = anchor || at;
  const leaderLen = Math.hypot(px - tip.x, py - tip.y);
  if (leader && leaderLen > LEADER_THRESHOLD_PX) {
    ctx.save();
    ctx.strokeStyle = 'rgba(40,46,60,0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    // Stop at the edge of the label box rather than under it.
    const ang = Math.atan2(py - tip.y, px - tip.x);
    ctx.lineTo(px - Math.cos(ang) * (w / 2 + 1), py - Math.sin(ang) * (h / 2 + 1));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40,46,60,0.75)';
    ctx.fill();
    ctx.restore();
  }

  if (backing) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px - w / 2, py - h / 2, w, h, 2.5);
    else ctx.rect(px - w / 2, py - h / 2, w, h);
    ctx.fillStyle = backing;
    ctx.fill();
  }
  ctx.fillStyle = colour;
  ctx.fillText(text, px, py);
  ctx.restore();
  return { x: px, y: py, w, h, overlap: best.raw ?? 0, leader: leaderLen > LEADER_THRESHOLD_PX };
}

// ── Shared metal fill ──────────────────────────────────────────────────────
//
// Every fabricated item — fan coil, plenum, BTO, return box — is the same
// galvanised steel, so it gets the same fill. That is what makes them read as a
// family of physical things rather than as unrelated shapes.

function metalFill(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, METAL_LIGHT);
  g.addColorStop(0.5, METAL_MID);
  g.addColorStop(1, '#93979E');
  return g;
}

/** Keep a number inside a range. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function box(ctx, cx, cy, w, h, r = 2) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r);
  else ctx.rect(cx - w / 2, cy - h / 2, w, h);
}

/**
 * A collar: the short spigot where a duct leaves a piece of metal.
 *
 * Deliberately its own function and deliberately NOT a fitting. Nick: "Do not
 * count or label it as a separate BTO." It is drawn wherever a duct meets a
 * face, and it never gets a label or a number of its own.
 */
export function drawCollar(ctx, at, { angle = 0, length = 7, width = 7,
                                      colour = METAL_DARK } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.rect(0, -width / 2, length, width);
  ctx.fillStyle = '#DDE0E4';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLY AIR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 1. THE INDOOR FAN COIL.
 *
 * A horizontal rectangular unit with the coil hatched across it, the RETURN
 * side open and the SUPPLY side tapering into the plenum. The two sides are
 * drawn differently on purpose: an installer glancing at the sheet has to be
 * able to tell which end the air comes back to, and a symmetrical box cannot
 * tell them. Never the same shape as a BTO or a plenum.
 */
export function drawFanCoil(ctx, at, { angle = 0, w = 46, h = 26,
                                       label = 'FCU', model = null,
                                       ledger = null, selected = false } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  box(ctx, 0, 0, w, h, 2.5);
  ctx.fillStyle = metalFill(ctx, -w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.lineWidth = selected ? 2.6 : 1.9;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : METAL_DARK;
  ctx.stroke();
  // The coil: hatching across the body, the way a coil is drawn.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(40,44,52,0.42)';
  ctx.lineWidth = 1;
  for (let x = -w / 2; x < w / 2 + h; x += 5) {
    ctx.beginPath(); ctx.moveTo(x, -h / 2); ctx.lineTo(x - h, h / 2); ctx.stroke();
  }
  ctx.restore();
  // RETURN side — open face, drawn as a gap in the outline on the left.
  ctx.strokeStyle = RETURN_COLOUR;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2 + 3); ctx.lineTo(-w / 2, h / 2 - 3);
  ctx.stroke();
  // SUPPLY side — a short taper out to the plenum on the right.
  ctx.strokeStyle = METAL_DARK;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(w / 2, -h / 2 + 2); ctx.lineTo(w / 2 + 6, -h / 2 + 6);
  ctx.lineTo(w / 2 + 6, h / 2 - 6); ctx.lineTo(w / 2, h / 2 - 2);
  ctx.stroke();
  ctx.restore();

  if (ledger) ledger.reserve(at.x, at.y, w + 22, h + 8);
  drawLabel(ctx, label, { x: at.x, y: at.y + h / 2 + 10 }, { size: 8.5, ledger, anchor: at });
  if (model) drawLabel(ctx, model, { x: at.x, y: at.y + h / 2 + 21 },
                       { size: 7, colour: '#4A5160', weight: 600, ledger });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE EQUIPMENT ASSEMBLY — RETURN PLENUM → FCU → SUPPLY PLENUM
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick: "The supply and return plenums must fit neatly and realistically onto
// the FCU. Show the equipment as one clean assembled arrangement."
//
// Three boxes bolted together in a line, which is what the thing in the roof
// actually is. Everything about the arrangement follows from one axis:
//
//   • the FCU sits square on the sheet, so the axis snaps to the nearest
//     quarter turn. A fan coil drawn at 37° reads as a diamond, and equipment
//     on a mechanical sheet is drawn orthogonal;
//   • the supply plenum's inner face is EXACTLY the FCU's discharge face and
//     the return plenum's inner face is EXACTLY its return face — the centres
//     are half a body apart, so there is no gap to explain and no overlap;
//   • the two plenums are 180° apart by construction. They cannot end up on
//     the same side, whatever the ducts do;
//   • each plenum's height follows the FCU face and the number of collars it
//     has to carry, so a three-collar plenum is drawn able to take three
//     collars rather than having them drawn on top of one another;
//   • the collars sit on the OUTER face, evenly across it, one per duct.
//
// It returns geometry and draws nothing. The renderer needs the collar points
// to anchor its ducts, the report needs the bounds to frame its inset, and the
// tests need both to prove the arrangement without reading pixels.
export const ASSEMBLY = Object.freeze({
  fcuW: 46, fcuH: 26,
  supplyDepth: 15, returnDepth: 13,
  collarPitch: 10, collarWidth: 8, collarLength: 9,
  maxPlenumHeightFactor: 2.4
});

/** Snap a bearing to the nearest quarter turn. */
export function snapToQuadrant(angle) {
  return Math.round((angle || 0) / (Math.PI / 2)) * (Math.PI / 2);
}

export function equipmentAssembly({ at, supplyBearing = 0, returnBearing = null,
                                    supplyCollars = 0, returnCollars = 0,
                                    fcuW = ASSEMBLY.fcuW, fcuH = ASSEMBLY.fcuH,
                                    // THE COLLARS MUST BE AT LEAST AS FAR APART AS THE
                                    // DUCTS ARE WIDE. Three ø400 mains drawn 9 px apart
                                    // merged into one magenta slab across the unit — the
                                    // drawing showed a plenum with one enormous spigot.
                                    // So the pitch comes from the widest duct that lands
                                    // on the face, and the plenum grows to carry them.
                                    supplyPitch = ASSEMBLY.collarPitch,
                                    returnPitch = ASSEMBLY.collarPitch,
                                    supplyCollarWidth = ASSEMBLY.collarWidth,
                                    returnCollarWidth = ASSEMBLY.collarWidth } = {}) {
  if (!at || at.x === undefined) return null;
  // The discharge direction decides the whole arrangement. If the returns say
  // otherwise and the two would land on the same side, the SUPPLY wins and the
  // return goes opposite — separation is not negotiable.
  let angle = snapToQuadrant(supplyBearing ?? 0);
  if (returnBearing !== null && supplyBearing === null) angle = snapToQuadrant(returnBearing + Math.PI);
  const ax = { x: Math.cos(angle), y: Math.sin(angle) };          // along, toward supply
  const cr = { x: -Math.sin(angle), y: Math.cos(angle) };         // across the faces

  // A fabricated plenum taking three ø400 spigots IS deeper than the unit face
  // it bolts to, so the cap only applies while the collars still fit inside it.
  const plenumHeight = (n, pitch) => Math.max(fcuH,
    Math.min(fcuH * ASSEMBLY.maxPlenumHeightFactor, n * pitch + 8), n * pitch + 6);
  const sH = plenumHeight(Math.max(1, supplyCollars), supplyPitch);
  const rH = plenumHeight(Math.max(1, returnCollars), returnPitch);
  const sD = ASSEMBLY.supplyDepth, rD = ASSEMBLY.returnDepth;

  const move = (along, across) => ({
    x: at.x + ax.x * along + cr.x * across,
    y: at.y + ax.y * along + cr.y * across
  });

  // Centres exactly half a body beyond the FCU face: touching, never overlapping.
  const supplyAt = move(fcuW / 2 + sD / 2, 0);
  const returnAt = move(-(fcuW / 2 + rD / 2), 0);

  const collarsOn = (n, alongFace, sign, h, width) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const across = n === 1 ? 0 : -h / 2 + (h * (i + 1)) / (n + 1);
      out.push({ ...move(alongFace, across), angle: sign > 0 ? angle : angle + Math.PI,
                 index: i, across, width });
    }
    return out;
  };

  return {
    angle, axis: ax, across: cr,
    fcu: { x: at.x, y: at.y, w: fcuW, h: fcuH, angle },
    supply: {
      x: supplyAt.x, y: supplyAt.y, w: sD, h: sH, angle,
      // The face the mains leave from, and the face bolted to the unit.
      outerFace: move(fcuW / 2 + sD, 0), innerFace: move(fcuW / 2, 0),
      collars: collarsOn(supplyCollars, fcuW / 2 + sD, +1, sH, supplyCollarWidth)
    },
    return: {
      x: returnAt.x, y: returnAt.y, w: rD, h: rH, angle,
      outerFace: move(-(fcuW / 2 + rD), 0), innerFace: move(-fcuW / 2, 0),
      collars: collarsOn(returnCollars, -(fcuW / 2 + rD), -1, rH, returnCollarWidth)
    },
    /** Everything the assembly occupies, for reserving label space around it. */
    bounds: (() => {
      const pts = [];
      const corners = (cx, cy, w, h) => {
        for (const sa of [-w / 2, w / 2]) for (const sc of [-h / 2, h / 2]) {
          pts.push({ x: cx + ax.x * sa + cr.x * sc, y: cy + ax.y * sa + cr.y * sc });
        }
      };
      corners(at.x, at.y, fcuW, fcuH);
      corners(supplyAt.x, supplyAt.y, sD + ASSEMBLY.collarLength * 2, sH);
      corners(returnAt.x, returnAt.y, rD + ASSEMBLY.collarLength * 2, rH);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0,
               cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    })()
  };
}

/** A point in the assembly's own frame: how far ALONG the axis, how far ACROSS. */
export function assemblyLocal(geom, p) {
  const dx = p.x - geom.fcu.x, dy = p.y - geom.fcu.y;
  return { along: dx * geom.axis.x + dy * geom.axis.y,
           across: dx * geom.across.x + dy * geom.across.y };
}

/**
 * The solid band the three bodies occupy, in that frame, plus a clearance.
 *
 * The margin is not decoration. Without it Main C left its collar and ran down
 * the sheet 1.2 px clear of the fan coil's corner — which passes a strict
 * intersection test and reads, to anyone looking at the drawing, as a duct
 * scraping along the side of the unit.
 */
export const ASSEMBLY_CLEARANCE = 4;

export function assemblyBand(geom, margin = ASSEMBLY_CLEARANCE) {
  return {
    a0: -(geom.fcu.w / 2 + geom.return.w) - margin,
    a1: geom.fcu.w / 2 + geom.supply.w + margin,
    c: Math.max(geom.fcu.h, geom.supply.h, geom.return.h) / 2 + margin
  };
}

/**
 * Does a straight leg pass over the metal?
 *
 * Liang–Barsky against the band, which is an axis-aligned rectangle once the
 * segment is in the assembly's own frame. Written in the textbook p/q form on
 * purpose: the first attempt folded the sign convention into the caller and got
 * one of the four boundaries backwards, so Main C ran through the fan coil and
 * the test said it did not.
 */
export function assemblyBlocks(geom, p, q, margin = ASSEMBLY_CLEARANCE) {
  const b = assemblyBand(geom, margin);
  const A = assemblyLocal(geom, p), B = assemblyLocal(geom, q);
  const dA = B.along - A.along, dC = B.across - A.across;
  const ps = [-dA, dA, -dC, dC];
  const qs = [A.along - b.a0, b.a1 - A.along, A.across + b.c, b.c - A.across];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(ps[i]) < 1e-9) { if (qs[i] < 0) return false; continue; }
    const t = qs[i] / ps[i];
    if (ps[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/** Back from the assembly's frame to the sheet. */
export function assemblyPoint(geom, along, across) {
  return { x: geom.fcu.x + geom.axis.x * along + geom.across.x * across,
           y: geom.fcu.y + geom.axis.y * along + geom.across.y * across };
}

/**
 * HOW A DUCT LEAVES ITS COLLAR WITHOUT CUTTING THROUGH THE UNIT.
 *
 * Every duct comes straight off its spigot for a short lead before it turns —
 * which is how one is actually fitted, and it is also what makes the collar
 * read as the duct's origin rather than as a mark the line happens to pass.
 *
 * Then the awkward case, and it is a real one on this job: Main C's fitting
 * sits BEHIND the unit, on the return side. Drawn straight from the supply
 * collar it went through the fan coil and past the return plenum, which says
 * the main is plumbed into the return. So when the straight leg would cross the
 * metal the run steps ACROSS to a clear line first, and — where that is still
 * not enough, because the fitting is behind the far end — runs ALONG that clear
 * line until it is past the assembly before turning in. Around the unit, the
 * way an installer pulls it.
 *
 * It never adds a third turn. If two do not clear it, the fitting is inside the
 * equipment's own footprint and no amount of drawing will make that look right;
 * the run is left direct and the geometry is what needs fixing.
 */
export function routeOutOfAssembly(geom, tip, collarAngle, next, lead = 7, ductWidthPx = 0) {
  const out = [{ x: tip.x + Math.cos(collarAngle) * lead,
                 y: tip.y + Math.sin(collarAngle) * lead }];
  if (!next || !assemblyBlocks(geom, out[0], next)) return out;

  const band = assemblyBand(geom);
  const here = assemblyLocal(geom, out[0]);
  const there = assemblyLocal(geom, next);
  const side = Math.sign(there.across) || 1;
  // THE DUCT'S OWN WIDTH COUNTS. The band is where the metal is; a ø400 main
  // routed to within 4 px of it still overlaps the plenum by half its own
  // width, which on the sheet reads as the main running along the side of the
  // box. Clear the band by the duct's half-width as well as the margin.
  const clearAcross = side * (band.c + 8 + ductWidthPx / 2);
  const cornerA = assemblyPoint(geom, here.along, clearAcross);
  out.push(cornerA);
  if (!assemblyBlocks(geom, cornerA, next)) return out;

  // The second turn is only for a fitting BEHIND one end of the assembly. A
  // target that merely grazes the side is already handled by the step across,
  // and adding a turn for it put a right-angled kink in Main A over a third of
  // a pixel of overlap.
  if (there.along >= band.a0 && there.along <= band.a1) return out;
  out.push(assemblyPoint(geom, there.along, clearAcross));
  return out;
}

/**
 * Draw the assembly as one arrangement: return plenum, unit, supply plenum.
 *
 * The two plenums use DIFFERENT symbols and different colours — the supply is
 * galvanised metal fill in the metal outline, the return is the flat return
 * grey — because Nick's rule is that a reader must never take one for the
 * other, and colour alone is not enough to carry that. Each shows its interface
 * line against the unit, so the drawing says these three are bolted together
 * rather than merely near one another.
 */
export function drawEquipmentAssembly(ctx, geom, { unitModel = null, labels = true,
                                                   supplyLabel = 'SUPPLY PLENUM',
                                                   returnLabel = 'RETURN PLENUM',
                                                   fcuLabel = 'FCU',
                                                   selectedId = null,
                                                   ledger = null } = {}) {
  if (!geom) return null;
  const { fcu, angle } = geom;
  // Space for the whole arrangement AND its labels is booked before anything
  // else on the sheet asks for room. Nick: "Reserve enough space around the
  // assembly for labels before routing ducts."
  if (ledger) ledger.reserve(geom.bounds.cx, geom.bounds.cy,
                             geom.bounds.w + 16, geom.bounds.h + 16);

  // ── RETURN PLENUM: return grey, flat fill, its own outline weight ────────
  if (geom.return.collars.length) {
    for (const c of geom.return.collars) {
      drawCollar(ctx, c, { angle: c.angle, length: ASSEMBLY.collarLength,
                           width: c.width ?? ASSEMBLY.collarWidth, colour: RETURN_COLOUR });
    }
    ctx.save();
    ctx.translate(geom.return.x, geom.return.y);
    ctx.rotate(angle);
    box(ctx, 0, 0, geom.return.w, geom.return.h, 1.5);
    ctx.fillStyle = '#E7EAEE';
    ctx.fill();
    ctx.lineWidth = selectedId === 'returnBox' ? 2.4 : 1.9;
    ctx.strokeStyle = selectedId === 'returnBox' ? SELECTION_COLOUR : RETURN_COLOUR;
    ctx.stroke();
    ctx.restore();
  }

  // ── SUPPLY PLENUM: galvanised metal, metal outline ──────────────────────
  if (geom.supply.collars.length) {
    for (const c of geom.supply.collars) {
      drawCollar(ctx, c, { angle: c.angle, length: ASSEMBLY.collarLength,
                           width: c.width ?? ASSEMBLY.collarWidth });
    }
    ctx.save();
    ctx.translate(geom.supply.x, geom.supply.y);
    ctx.rotate(angle);
    box(ctx, 0, 0, geom.supply.w, geom.supply.h, 1.5);
    ctx.fillStyle = metalFill(ctx, -geom.supply.w / 2, -geom.supply.h / 2,
                              geom.supply.w, geom.supply.h);
    ctx.fill();
    ctx.lineWidth = selectedId === 'supplyPlenum' ? 2.4 : 1.8;
    ctx.strokeStyle = selectedId === 'supplyPlenum' ? SELECTION_COLOUR : METAL_DARK;
    ctx.stroke();
    ctx.restore();
  }

  // ── THE UNIT ────────────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(fcu.x, fcu.y);
  ctx.rotate(angle);
  box(ctx, 0, 0, fcu.w, fcu.h, 2.5);
  ctx.fillStyle = metalFill(ctx, -fcu.w / 2, -fcu.h / 2, fcu.w, fcu.h);
  ctx.fill();
  ctx.lineWidth = selectedId === 'plenum' ? 2.6 : 1.9;
  ctx.strokeStyle = selectedId === 'plenum' ? SELECTION_COLOUR : METAL_DARK;
  ctx.stroke();
  // The coil, hatched across the body.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-fcu.w / 2 + 2, -fcu.h / 2 + 2, fcu.w - 4, fcu.h - 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(40,44,52,0.42)';
  ctx.lineWidth = 1;
  for (let x = -fcu.w / 2; x < fcu.w / 2 + fcu.h; x += 5) {
    ctx.beginPath(); ctx.moveTo(x, -fcu.h / 2); ctx.lineTo(x - fcu.h, fcu.h / 2); ctx.stroke();
  }
  ctx.restore();
  // THE INTERFACE LINES. Return face in return grey, discharge face in metal —
  // the joint where each plenum bolts on, so the three read as one assembly.
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = RETURN_COLOUR;
  ctx.beginPath();
  ctx.moveTo(-fcu.w / 2, -fcu.h / 2 + 2); ctx.lineTo(-fcu.w / 2, fcu.h / 2 - 2);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = METAL_DARK;
  ctx.beginPath();
  ctx.moveTo(fcu.w / 2, -fcu.h / 2 + 2); ctx.lineTo(fcu.w / 2, fcu.h / 2 - 2);
  ctx.stroke();
  // Which way the air goes THROUGH the unit: in at the return face, out at the
  // discharge. Two small arrows inside the body, on the axis.
  ctx.restore();
  drawArrow(ctx, { x: fcu.x - Math.cos(angle) * (fcu.w * 0.22) - Math.sin(angle) * 0,
                   y: fcu.y - Math.sin(angle) * (fcu.w * 0.22) + Math.cos(angle) * 0 },
            angle, { colour: RETURN_COLOUR, size: 6 });
  drawArrow(ctx, { x: fcu.x + Math.cos(angle) * (fcu.w * 0.30),
                   y: fcu.y + Math.sin(angle) * (fcu.w * 0.30) },
            angle, { colour: METAL_DARK, size: 6 });

  // ── LABELS, ALL OUTSIDE THE BODIES, EACH ON ITS OWN LEADER ──────────────
  //
  // Nick: "Keep all labels outside the equipment bodies with short leader
  // lines." They are placed ACROSS the assembly axis rather than along it, so
  // three labels on three boxes in a row cannot stack on one another.
  if (labels) {
    const cr = geom.across;
    const outward = (p, d) => ({ x: p.x + cr.x * d, y: p.y + cr.y * d });
    if (geom.return.collars.length && returnLabel) {
      drawLabel(ctx, returnLabel, outward({ x: geom.return.x, y: geom.return.y },
                                          -(geom.return.h / 2 + 16)),
                { size: 7, colour: '#3C4250', weight: 700, ledger,
                  anchor: { x: geom.return.x, y: geom.return.y } });
    }
    if (geom.supply.collars.length && supplyLabel) {
      drawLabel(ctx, supplyLabel, outward({ x: geom.supply.x, y: geom.supply.y },
                                          geom.supply.h / 2 + 16),
                { size: 7, colour: '#4A5160', weight: 700, ledger,
                  anchor: { x: geom.supply.x, y: geom.supply.y } });
    }
    if (fcuLabel) {
      drawLabel(ctx, fcuLabel, outward(fcu, fcu.h / 2 + 15),
                { size: 8.5, ledger, anchor: fcu });
    }
    if (unitModel) {
      drawLabel(ctx, unitModel, outward(fcu, -(fcu.h / 2 + 15)),
                { size: 7, colour: '#4A5160', weight: 600, ledger, anchor: fcu });
    }
  }
  return geom;
}

/**
 * 2. THE SUPPLY-AIR PLENUM.
 *
 * A short box on the discharge face of the fan coil, with one visible collar
 * per outgoing main on the face those mains actually leave from. The collars
 * are drawn from the real spigot directions, so a three-main job shows three
 * collars and a two-main job shows two — the drawing cannot claim a spigot
 * count the design does not have.
 */
export function drawSupplyPlenum(ctx, at, { angle = 0, w = 16, h = 30,
                                            spigotAngles = [], label = 'SUPPLY PLENUM',
                                            labelSide = 'right',
                                            ledger = null, selected = false } = {}) {
  for (const a of spigotAngles) drawCollar(ctx, at, { angle: a, length: 8, width: 8 });
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  box(ctx, 0, 0, w, h, 2);
  ctx.fillStyle = metalFill(ctx, -w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.lineWidth = selected ? 2.4 : 1.8;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : METAL_DARK;
  ctx.stroke();
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, w + 18, h + 18);
  // The label goes OUTWARD from the unit, not under it. The fan coil, its
  // plenum and the return box sit within a few centimetres of each other, so
  // three labels stacked below the unit land on top of one another.
  if (label) drawLabel(ctx, label, { x: at.x + (labelSide === 'left' ? -1 : 1) * (w / 2 + 44),
                                     y: at.y - h / 2 - 4 },
                       { size: 7, colour: '#4A5160', weight: 700, ledger, anchor: at });
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. THE BTO — A FABRICATED SHEET-METAL MANIFOLD
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick, on the symbol that came before this one: "The current rounded grey BTO
// symbol does not resemble a professional fabricated fitting… Do not draw the
// BTO as a circle, pill, blob or generic route node."
//
// So it is drawn as the thing itself: a compact rectangular metal body with a
// dark double-line outline, ONE inlet collar and one outlet collar per ACTUAL
// port, each collar sitting on the body face where its duct leaves and pointing
// the way that duct goes. The ducts stop at the collar faces; nothing runs
// through the body. At whole-house zoom an installer can count the collars and
// see which duct lands on each.
//
// THE GEOMETRY IS SEPARATE FROM THE DRAWING, on purpose. The renderer has to
// trim each duct back to its collar face before it draws anything, the report's
// inset has to frame the body, and the tests have to prove the collar count and
// the trimming without reading pixels — all three need the numbers, not the ink.

/** How big the metal is, before the collars. */
export const BTO_BODY = Object.freeze({
  minW: 15, maxW: 26, minH: 13, maxH: 30,
  collarLength: 8, inletWidth: 9, outletWidth: 6.5,
  cornerRadius: 1.2
});

/**
 * Where a ray leaving the centre of a rotated rectangle crosses its perimeter.
 * This is what puts a collar on the FACE its duct leaves from rather than at an
 * arbitrary point on a circle around the fitting.
 */
function rectPerimeterPoint(bearing, angle, w, h) {
  const local = bearing - angle;
  const dx = Math.cos(local), dy = Math.sin(local);
  const tx = Math.abs(dx) > 1e-6 ? (w / 2) / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? (h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const lx = dx * t, ly = dy * t;
  return { x: Math.cos(angle) * lx - Math.sin(angle) * ly,
           y: Math.sin(angle) * lx + Math.cos(angle) * ly };
}

/**
 * THE FITTING'S REAL DIMENSIONS AND COLLAR POSITIONS.
 *
 * The body is scaled by what it has to carry — Nick: "Scale its body according
 * to the number and sizes of collars" — so a two-port ø350 fitting and a
 * four-port ø250 fitting are visibly different pieces of metal. It runs ALONG
 * the flow: the inlet enters one end, the collars come off the faces.
 *
 * @returns {{angle, w, h, inlet, outlets, clearPx, bounds}}
 *   `inlet` and every entry of `outlets` carry `root` (the collar on the body
 *   face), `tip` (the far end of the collar, where the duct begins) and the
 *   `angle` the collar points.
 */
export function btoGeometry({ at, inletAngle = null, outletAngles = [],
                              inletMm = null, outletMm = [], scale = 1 } = {}) {
  const ports = outletAngles.length;
  // Along the flow, sized off the inlet; across it, sized off how many collars
  // have to fit on the faces without touching.
  //
  // THE CLAMP IS ON THE BODY'S OWN SIZE, NOT ON THE SCALED RESULT. Clamping
  // afterwards meant that at 3× the body hit its ceiling while the collars kept
  // growing, and the fitting came out as a small box with enormous diamonds
  // stuck to it. The limits say how big the metal is; the scale says how big
  // the drawing is, and they are different questions.
  const w = clamp(13 + ((inletMm || 350) / 400) * 8, BTO_BODY.minW, BTO_BODY.maxW) * scale;
  const h = clamp(10 + Math.max(0, ports - 1) * 5.5, BTO_BODY.minH, BTO_BODY.maxH) * scale;
  // The body lies along the inlet duct. `inletAngle` points back up the duct it
  // is fed by, so that line IS the flow line.
  const angle = inletAngle !== null ? inletAngle
    : (outletAngles.length ? outletAngles[0] + Math.PI : 0);

  const collar = (bearing, width, len) => {
    const root = rectPerimeterPoint(bearing, angle, w, h);
    return {
      angle: bearing, width, length: len,
      root: { x: at.x + root.x, y: at.y + root.y },
      tip: { x: at.x + root.x + Math.cos(bearing) * len,
             y: at.y + root.y + Math.sin(bearing) * len }
    };
  };
  const cl = BTO_BODY.collarLength * scale;
  // THE INLET IS DRAWN WIDER THAN THE OUTLETS. It carries all the air the
  // outlets share, and on this job it is a ø400 into four ø250s — a drawing
  // where every collar is the same width says the fitting is something it isn't.
  const inlet = inletAngle === null ? null
    : collar(inletAngle, BTO_BODY.inletWidth * scale, cl + 1);
  // EACH COLLAR IS THE WIDTH OF THE DUCT IT TAKES. A row of identical collars
  // says the fitting steps every outlet to the same size, which on BTO-B —
  // 400-300-250 — would be describing a fitting nobody is ordering.
  const outlets = outletAngles.map((a, i) => ({
    ...collar(a, clamp(BTO_BODY.outletWidth * ((outletMm[i] || 250) / 250),
                       BTO_BODY.outletWidth * 0.8, BTO_BODY.inletWidth * 0.9) * scale, cl),
    index: i,
    diameterMm: outletMm[i] ?? null
  }));

  const reach = w / 2 + h / 2 + cl;
  return {
    at: { x: at.x, y: at.y }, angle, w, h, inlet, outlets,
    inletMm: inletMm ?? null,
    /** How far a duct must be trimmed back so it stops at the collar face. */
    clearPx: Math.max(w, h) / 2 + cl,
    bounds: { x: at.x - reach / 2 - w / 2, y: at.y - reach / 2 - h / 2, w: reach, h: reach,
              cx: at.x, cy: at.y }
  };
}

/**
 * Draw the manifold from that geometry.
 *
 * A PRIMARY AND A LOCAL BTO ARE THE SAME SYMBOL. There is no visual hierarchy
 * between them because they are the same kind of object — a body with an inlet
 * and a row of collars — and drawing one as a smaller version of the other
 * would invent a distinction the order does not have.
 */
export function drawBto(ctx, at, { inletAngle = null, outletAngles = [],
                                   inletMm = null, outletMm = [], scale = 1,
                                   geometry = null,
                                   label = null, spec = null, flow = null,
                                   detail = null,
                                   ledger = null, selected = false,
                                   warning = false } = {}) {
  const g = geometry || btoGeometry({ at, inletAngle, outletAngles, inletMm, outletMm, scale });
  const stroke = warning ? WARNING_COLOUR : selected ? SELECTION_COLOUR : METAL_DARK;

  // Collars first, so the body sits over their roots and they read as sockets
  // punched into the metal rather than as loose sticks laid beside it.
  for (const c of g.outlets) {
    drawCollar(ctx, c.root, { angle: c.angle, length: c.length, width: c.width });
  }
  if (g.inlet) {
    drawCollar(ctx, g.inlet.root, { angle: g.inlet.angle, length: g.inlet.length,
                                    width: g.inlet.width });
  }

  ctx.save();
  ctx.translate(g.at.x, g.at.y);
  ctx.rotate(g.angle);
  // WHITE METAL, DARK DOUBLE LINE. The double line is what makes a small
  // rectangle read as folded sheet rather than as a filled block, and it is the
  // single clearest difference between this and a route node.
  box(ctx, 0, 0, g.w, g.h, BTO_BODY.cornerRadius);
  ctx.fillStyle = '#F7F8FA';
  ctx.fill();
  ctx.lineWidth = selected ? 2.4 : 1.7;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  box(ctx, 0, 0, g.w - 3.4, g.h - 3.4, BTO_BODY.cornerRadius);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = warning ? WARNING_COLOUR : 'rgba(40,44,52,0.55)';
  ctx.stroke();
  ctx.restore();

  // The air, through the body, along the flow line — only where the body is big
  // enough for the arrow to be legible rather than a smudge.
  if (g.w >= 17 && g.h >= 14) {
    drawArrow(ctx, { x: g.at.x - Math.cos(g.angle) * (g.w * 0.16),
                     y: g.at.y - Math.sin(g.angle) * (g.w * 0.16) },
              g.angle + Math.PI, { colour: 'rgba(40,44,52,0.5)', size: 5 });
  }

  if (ledger) ledger.reserve(g.at.x, g.at.y, g.w + 20, g.h + 20);
  // ONE LINE BESIDE THE BODY, ON A LEADER. `BTO-C · 400-350-350` says which
  // fitting and what it is made of; the airflow and the per-collar detail join
  // it only at full detail, because the schedule carries them anyway.
  let y = g.at.y - g.h / 2 - 13;
  if (label) {
    drawLabel(ctx, label, { x: g.at.x, y },
              { size: 8.5, ledger, anchor: g.at, leader: true }); y -= 11;
  }
  if (spec) { drawLabel(ctx, spec, { x: g.at.x, y }, { size: 7.5, colour: '#4A5160', ledger, anchor: g.at }); y -= 10; }
  if (flow) { drawLabel(ctx, flow, { x: g.at.x, y }, { size: 7.5, colour: '#4A5160', ledger, anchor: g.at }); y -= 10; }
  // CLOSE-ZOOM DETAIL: inlet size, each collar's size, airflow and zone. Off by
  // default — at whole-house zoom it would bury the plan — and drawn at the
  // collar it describes so there is no question which port it belongs to.
  for (const line of (detail || [])) {
    const c = g.outlets[line.index];
    if (!c) continue;
    drawLabel(ctx, line.text,
      { x: c.tip.x + Math.cos(c.angle) * 10, y: c.tip.y + Math.sin(c.angle) * 10 },
      { size: 6.5, colour: '#4A5160', weight: 600, ledger, anchor: c.tip, leader: true });
  }
  return g;
}

/**
 * 7. A REDUCER.
 *
 * A tapered duct, labelled with BOTH sizes. Drawn only where the network
 * actually records a reduction — Nick: "A BTO changing outlet sizes is not
 * automatically a separate reducer", which is exactly the mistake that would
 * put a fitting on the order that nobody installs.
 */
export function drawReducer(ctx, at, { angle = 0, fromMm = null, toMm = null,
                                       lengthPx = 14, ledger = null } = {}) {
  const a = Math.max(5, (fromMm || 400) / 42);
  const b = Math.max(4, (toMm || 300) / 42);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-lengthPx / 2, -a); ctx.lineTo(lengthPx / 2, -b);
  ctx.lineTo(lengthPx / 2, b); ctx.lineTo(-lengthPx / 2, a);
  ctx.closePath();
  ctx.fillStyle = '#E4E6EA';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = METAL_DARK;
  ctx.stroke();
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, lengthPx + 8, a * 2 + 8);
  if (fromMm && toMm) {
    drawLabel(ctx, LABEL.reducer(fromMm, toMm), { x: at.x, y: at.y - a - 10 },
              { size: 9, colour: '#4A5160', ledger });
  }
}

/**
 * 8. A Y-PIECE OR TEE.
 *
 * A real branch fitting, for where the design genuinely has one. Nick: "Do not
 * use it in place of a fabricated BTO" — a tee splits a run in two, a BTO is a
 * manifold with a body and a row of collars, and drawing one as the other
 * misdescribes what is being ordered.
 */
export function drawTee(ctx, at, { angle = 0, kind = 'tee', armPx = 9,
                                   inletMm = null, outletMm = null,
                                   ledger = null } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = METAL_DARK;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-armPx, 0); ctx.lineTo(0, 0);
  if (kind === 'y') {
    ctx.lineTo(armPx * 0.8, -armPx * 0.7);
    ctx.moveTo(0, 0); ctx.lineTo(armPx * 0.8, armPx * 0.7);
  } else {
    ctx.lineTo(armPx, 0);
    ctx.moveTo(0, 0); ctx.lineTo(0, -armPx);
  }
  ctx.stroke();
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, armPx * 2 + 6, armPx * 2 + 6);
  if (inletMm && outletMm) {
    drawLabel(ctx, D(inletMm) + '/' + D(outletMm), { x: at.x, y: at.y - armPx - 9 },
              { size: 9, colour: '#4A5160', ledger });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AIR OUTLETS
// ═══════════════════════════════════════════════════════════════════════════
//
// The TYPE drawn is the type the design selected — a round diffuser is drawn as
// a circle only when the outlet is round. Drawing every outlet the same shape
// would make the sheet say something the order does not.

/** 10. Square ceiling diffuser — square outline, corner-to-corner X. */
export function drawSquareDiffuser(ctx, at, { r = 7, colour = INK,
                                              selected = false } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.lineWidth = selected ? 2.6 : 1.9;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : colour;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.rect(-r, -r, r * 2, r * 2);
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-r, -r); ctx.lineTo(r, r);
  ctx.moveTo(r, -r); ctx.lineTo(-r, r);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
  ctx.fillStyle = colour; ctx.fill();
  ctx.restore();
}

/** 11. Round ceiling diffuser — circle with a four-way pattern. */
export function drawRoundDiffuser(ctx, at, { r = 7, colour = INK,
                                             selected = false } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.lineWidth = selected ? 2.6 : 1.9;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : colour;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (const a of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
  ctx.fillStyle = colour; ctx.fill();
  ctx.restore();
}

/** 12. Linear slot diffuser — drawn at its real orientation, with its slots. */
export function drawLinearSlotDiffuser(ctx, at, { angle = 0, length = 26, width = 8,
                                                  slots = 3, colour = INK,
                                                  selected = false } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.lineWidth = selected ? 2.4 : 1.8;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : colour;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.rect(-length / 2, -width / 2, length, width);
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(29,34,48,0.65)';
  for (let i = 1; i <= slots; i++) {
    const y = -width / 2 + (width * i) / (slots + 1);
    ctx.beginPath();
    ctx.moveTo(-length / 2 + 2, y); ctx.lineTo(length / 2 - 2, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** 13. Sidewall grille — horizontal rectangle with louvre lines. */
export function drawSidewallGrille(ctx, at, { angle = 0, w = 20, h = 11,
                                              colour = INK, selected = false } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.lineWidth = selected ? 2.4 : 1.8;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : colour;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(29,34,48,0.6)';
  for (let i = 1; i <= 3; i++) {
    const y = -h / 2 + (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 2, y); ctx.lineTo(w / 2 - 2, y); ctx.stroke();
  }
  ctx.restore();
}

/** Every outlet type, picked by what the design actually selected. */
export const OUTLET_SYMBOL = Object.freeze({
  square: drawSquareDiffuser,
  round: drawRoundDiffuser,
  slot: drawLinearSlotDiffuser,
  linear: drawLinearSlotDiffuser,
  sidewall: drawSidewallGrille,
  wall: drawSidewallGrille
});

export function drawOutletSymbol(ctx, at, opts = {}) {
  const fn = OUTLET_SYMBOL[String(opts.type || 'square').toLowerCase()] || drawSquareDiffuser;
  fn(ctx, at, opts);
  if (opts.ledger) opts.ledger.reserve(at.x, at.y, 22, 22);
}

/**
 * 14. AN EDITING HANDLE — ADDED TO A SYMBOL, NEVER INSTEAD OF ONE.
 *
 * Nick: "Editing handles must not replace the outlet symbol." The old plan tab
 * drew a big yellow rectangle where the diffuser should have been, so in edit
 * mode you could no longer see what you were moving. This is a small grab point
 * that sits beside the symbol, and it is drawn only while its edit mode is on.
 */
export function drawEditHandle(ctx, at, { r = 5, colour = SELECTION_COLOUR,
                                          locked = false } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = locked ? 'rgba(150,155,165,0.9)' : 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = locked ? '#8A8F9A' : colour;
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// RETURN AIR — ITS OWN SYSTEM, ITS OWN SYMBOLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 15. RETURN-AIR GRILLE.
 *
 * A rectangle with evenly spaced grille lines, in the neutral return colour,
 * drawn at its real proportions where they are known. Never a BTO symbol —
 * that is the mistake the whole return-air separation exists to prevent.
 */
export function drawReturnGrilleSymbol(ctx, at, { w = 22, h = 15, angle = 0,
                                                  colour = RETURN_COLOUR,
                                                  label = null, duct = null,
                                                  ledger = null, selected = false } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = 'rgba(248,249,250,0.95)';
  ctx.fill();
  ctx.lineWidth = selected ? 2.6 : 1.9;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : colour;
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = colour;
  const lines = Math.max(3, Math.round(h / 4));
  for (let i = 1; i < lines; i++) {
    const y = -h / 2 + (h * i) / lines;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 2.5, y); ctx.lineTo(w / 2 - 2.5, y); ctx.stroke();
  }
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, w + 8, h + 8);
  let y = at.y + h / 2 + 11;
  if (label) { drawLabel(ctx, label, { x: at.x, y }, { size: 7.5, colour: '#3C4250', ledger, anchor: at }); y += 10; }
  if (duct) drawLabel(ctx, duct, { x: at.x, y }, { size: 7, colour: '#4A5160', weight: 600, ledger });
}

/**
 * 17. THE FAN-COIL RETURN BOX.
 *
 * One box on the return side of the fan coil, showing each return inlet as its
 * own collar. Nick: "This is not a BTO and must never be counted as one." It is
 * drawn in the return colour for exactly that reason — a reader should be able
 * to tell at a glance which side of the system a box belongs to.
 */
export function drawReturnBox(ctx, at, { angle = 0, w = 18, h = 30,
                                         inletAngles = [], label = 'RETURN BOX',
                                         labelSide = 'left',
                                         ledger = null, selected = false } = {}) {
  for (const a of inletAngles) {
    drawCollar(ctx, at, { angle: a, length: 8, width: 8, colour: RETURN_COLOUR });
  }
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  box(ctx, 0, 0, w, h, 2);
  ctx.fillStyle = '#EDEFF2';
  ctx.fill();
  ctx.lineWidth = selected ? 2.4 : 1.9;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : RETURN_COLOUR;
  ctx.stroke();
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, w + 18, h + 16);
  if (label) drawLabel(ctx, label, { x: at.x + (labelSide === 'right' ? 1 : -1) * (w / 2 + 38),
                                     y: at.y - h / 2 - 4 },
                       { size: 7, colour: '#3C4250', ledger, anchor: at });
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONING AND CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 18. ZONE DAMPER AND ACTUATOR — AN INLINE MOTORISED DAMPER.
 *
 * Nick: "The current zone-damper line and floating motor square look
 * unprofessional… Do not use a floating square or a long slash extending
 * outside the duct."
 *
 * He is right about what was wrong with it. A blade drawn as a bare slash
 * across the duct and a motor square hovering nine pixels above it are two
 * marks that do not belong to each other — nothing said the motor drove that
 * blade, and at whole-house zoom the slash read as a crossing.
 *
 * So it is drawn as the item: a short rectangular damper BODY sitting inline in
 * the duct, its width taken from the duct it is fitted in, one clean diagonal
 * blade inside the body, and the actuator box mounted directly ON the side of
 * the body with a short shaft to the blade spindle. The whole thing rotates
 * with the duct and stays centred on it, so it reads as a fitting in the run
 * rather than an annotation beside it.
 *
 * NEVER ON A RETURN. A damper there does not balance a room, it starves the fan
 * coil, so the drawing must not even suggest one — the renderer refuses return
 * runs before it gets here, and this says so again for anyone reading it.
 */
export const DAMPER = Object.freeze({
  bodyLength: 11,          // along the duct
  minBodyWidth: 9, maxBodyWidth: 22,
  actuatorW: 8.5, actuatorH: 7,
  shaft: 1.4
});

/** The body a damper of this duct size occupies, in plan pixels. */
export function damperGeometry({ at, angle = 0, ductWidthPx = null, diameterMm = null,
                                 pxPerMm = 0, scale = 1 } = {}) {
  // WIDTH FOLLOWS THE DUCT. A damper is a sleeve the duct clamps onto, so a
  // ø350 body is visibly fatter than a ø250 one — measured where the drawing
  // knows the scale, taken from the drawn line weight where it does not.
  // Measured UNSCALED, clamped, then scaled — same reason as the BTO body: the
  // limits are about how big a damper is, the scale is about how big the
  // drawing is. Clamping the scaled figure gave a ø250 damper twice the width
  // of the ø250 duct it was fitted in.
  const measured = (diameterMm && pxPerMm) ? diameterMm * pxPerMm : null;
  const raw = measured ?? ((ductWidthPx ?? 10) / Math.max(0.001, scale));
  const width = clamp(raw + 2.5, DAMPER.minBodyWidth, DAMPER.maxBodyWidth) * scale;
  // A DAMPER SLEEVE IS LONGER THAN IT IS WIDE. A fixed 11 px length made a ø250
  // body wider across the duct than along it, which reads as a box sitting ON
  // the run rather than a fitting IN it — the very thing the redesign is for.
  const len = Math.max(DAMPER.bodyLength * scale, width * 1.12);
  return { at: { x: at.x, y: at.y }, angle, w: len, h: width,
           actuator: { w: DAMPER.actuatorW * scale, h: DAMPER.actuatorH * scale,
                       // Mounted on the side, its inner edge ON the body wall.
                       offset: width / 2 + (DAMPER.actuatorH * scale) / 2 + DAMPER.shaft * scale },
           reach: Math.max(len, width + DAMPER.actuatorH * 2 + DAMPER.shaft * 2) };
}

export function drawZoneDamper(ctx, at, { angle = 0, ductWidthPx = null, diameterMm = null,
                                          pxPerMm = 0, scale = 1,
                                          colour = '#1D7A48',
                                          label = null, constant = false,
                                          geometry = null,
                                          ledger = null } = {}) {
  const g = geometry || damperGeometry({ at, angle, ductWidthPx, diameterMm, pxPerMm, scale });
  ctx.save();
  ctx.translate(g.at.x, g.at.y);
  ctx.rotate(g.angle);

  // ── THE BODY, inline and centred on the duct ────────────────────────────
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-g.w / 2, -g.h / 2, g.w, g.h, 1);
  else ctx.rect(-g.w / 2, -g.h / 2, g.w, g.h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // ── THE BLADE, one clean diagonal, entirely INSIDE the body ─────────────
  const bx = g.w / 2 - 1.6, by = g.h / 2 - 1.6;
  ctx.beginPath();
  ctx.moveTo(-bx, by); ctx.lineTo(bx, -by);
  ctx.lineWidth = 1.9;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.stroke();
  // The spindle it turns on, at the centre of the body.
  ctx.beginPath();
  ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();

  // ── THE ACTUATOR, mounted ON the body, joined by its shaft ──────────────
  //
  // A constant zone gets NO actuator: Nick, "Do not show a motor actuator
  // unless one physically exists." A permanently open duct is not closed by
  // anything, and a motor drawn there is a motor somebody orders.
  if (!constant) {
    const oy = -g.actuator.offset;
    ctx.beginPath();
    ctx.moveTo(0, -g.h / 2); ctx.lineTo(0, oy + g.actuator.h / 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#12532F';
    ctx.stroke();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-g.actuator.w / 2, oy - g.actuator.h / 2,
                                     g.actuator.w, g.actuator.h, 1);
    else ctx.rect(-g.actuator.w / 2, oy - g.actuator.h / 2, g.actuator.w, g.actuator.h);
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#12532F';
    ctx.stroke();
    // An M, so it is an actuator rather than a chip of colour.
    ctx.font = '800 5px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('M', 0, oy + 0.3);
  }
  ctx.restore();

  if (ledger) ledger.reserve(g.at.x, g.at.y, g.reach + 6, g.reach + 6);
  // THE TEXT NEVER SITS ON THE DUCT. It goes out on a leader, placed by the
  // same least-overlap search as every other label on the sheet.
  const out = { x: g.at.x - Math.sin(g.angle) * (g.reach / 2 + 10),
                y: g.at.y + Math.cos(g.angle) * (g.reach / 2 + 10) };
  if (label) drawLabel(ctx, label, out, { size: 7.5, ledger, anchor: g.at, leader: true });
  if (constant) {
    drawLabel(ctx, 'CONSTANT – LOCKED OPEN',
              { x: out.x, y: out.y + 11 },
              { size: 7, colour: '#4A5160', weight: 600, ledger, anchor: g.at, leader: true });
  }
  return g;
}

/** 20. Wall controller / thermostat. */
export function drawThermostat(ctx, at, { r = 7, mark = 'T', model = null,
                                          ledger = null } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.font = '800 9px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = INK;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(mark, at.x, at.y + 0.5);
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, r * 2 + 6, r * 2 + 6);
  if (model) drawLabel(ctx, model, { x: at.x, y: at.y + r + 10 },
                       { size: 8.5, colour: '#4A5160', weight: 600, ledger });
}

/** 21. Zone controller panel. */
export function drawZoneControllerPanel(ctx, at, { w = 18, h = 13, model = null,
                                                   ledger = null } = {}) {
  ctx.save();
  box(ctx, at.x, at.y, w, h, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.font = '800 9px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = INK;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ZC', at.x, at.y + 0.5);
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, w + 6, h + 6);
  if (model) drawLabel(ctx, model, { x: at.x, y: at.y + h / 2 + 10 },
                       { size: 8.5, colour: '#4A5160', weight: 600, ledger });
}

// ═══════════════════════════════════════════════════════════════════════════
// OTHER SERVICES — an installation drawing, not the basic duct layout
// ═══════════════════════════════════════════════════════════════════════════

/** A thin run of something that is not air: control wiring, drain, refrigerant. */
export function drawServiceLine(ctx, pts, { colour = '#7A8090', width = 1.2,
                                            dash = DASH.control } = {}) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

/** 22. Condensate drain — thin blue dashed, with the direction of fall. */
export function drawDrainLine(ctx, pts, { sizeLabel = null, ledger = null } = {}) {
  drawServiceLine(ctx, pts, { colour: '#3E7BD4', width: 1.3, dash: DASH.drain });
  if (!pts || pts.length < 2) return;
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  drawArrow(ctx, b, Math.atan2(b.y - a.y, b.x - a.x), { colour: '#3E7BD4', size: 6 });
  if (sizeLabel) {
    const m = pts[Math.floor(pts.length / 2)];
    drawLabel(ctx, sizeLabel, { x: m.x, y: m.y - 9 },
              { size: 8.5, colour: '#3E7BD4', weight: 600, ledger });
  }
}

/** 23. Refrigerant pair — two thin parallel lines, kept off the duct legend. */
export function drawRefrigerantPair(ctx, pts, { gap = 2.4, label = null,
                                                ledger = null } = {}) {
  if (!pts || pts.length < 2) return;
  for (const off of [-gap / 2, gap / 2]) {
    const shifted = pts.map((p, i) => {
      const q = pts[Math.min(i + 1, pts.length - 1)];
      const r = pts[Math.max(i - 1, 0)];
      const dx = q.x - r.x, dy = q.y - r.y;
      const L = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dy / L) * off, y: p.y - (dx / L) * off };
    });
    drawServiceLine(ctx, shifted, { colour: '#8A6A3E', width: 1.1, dash: [] });
  }
  if (label) {
    const m = pts[Math.floor(pts.length / 2)];
    drawLabel(ctx, label, { x: m.x, y: m.y - 9 },
              { size: 8.5, colour: '#8A6A3E', weight: 600, ledger });
  }
}

/** 24. Electrical isolator. */
export function drawIsolator(ctx, at, { w = 15, h = 11, ledger = null } = {}) {
  ctx.save();
  box(ctx, at.x, at.y, w, h, 1.5);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.font = '800 7.5px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = INK;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('ISO', at.x, at.y + 0.5);
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, w + 6, h + 6);
}

/** 3. A direction arrow, for the start of a main. */
export function drawArrow(ctx, at, angle, { colour = INK, size = 7 } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.5);
  ctx.lineTo(-size, size * 0.5);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// DUCT RUNS — the line hierarchy
// ═══════════════════════════════════════════════════════════════════════════
//
// A duct's WIDTH is its real diameter through the calibration, so a ø400 looks
// like a ø400 beside a ø250 at any zoom. The role multiplier on top of that is
// what separates a supply main from a distribution arm from a final at a glance
// when the plan is too small for the sizes alone to carry it.

/** Role from a routed section, in the vocabulary this library draws. */
export function ductRole(section) {
  if (!section) return 'final';
  if (section.role === 'return' || section.isReturn || section.airSide === 'return') return 'return';
  if (section.role === 'main' || section.role === 'trunk') return 'main';
  if (section.role === 'branch' || section.distributionArm) return 'arm';
  return 'final';
}

/**
 * How wide to draw a duct, in screen px.
 *
 * Real millimetres where the plan is calibrated; otherwise the RATIO between
 * sizes is kept so the hierarchy survives even on an uncalibrated sheet.
 */
export function ductWidthPx(diameterMm, pxPerMm, { role = 'final', scale = 1,
                                                   min = 2.5, max = 26 } = {}) {
  const mm = diameterMm || 250;
  const raw = pxPerMm ? mm * pxPerMm * scale : (mm / 250) * 6 * scale;
  return Math.max(min, Math.min(max, raw * (LINE_WEIGHT[role] ?? 1)));
}

/**
 * One run of duct: a dark casing, the size colour inside it, and a spiral hint.
 *
 * The casing is what makes flex read as a tube rather than a stroke, and it is
 * also what keeps a pale size colour legible over a dark or busy floor plan.
 */
export function drawDuctRun(ctx, pts, { diameterMm, role = 'final', widthPx,
                                        selected = false, warning = false } = {}) {
  if (!pts || pts.length < 2) return;
  const w = widthPx ?? 8;
  const isReturn = role === 'return';
  const colour = isReturn ? RETURN_COLOUR : ductColour(diameterMm);

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Casing.
  ctx.strokeStyle = warning ? WARNING_COLOUR
    : selected ? SELECTION_COLOUR : 'rgba(25,25,35,0.55)';
  ctx.lineWidth = w + (selected || warning ? 5 : 3);
  trace(); ctx.stroke();
  // Body.
  ctx.strokeStyle = colour;
  ctx.lineWidth = w;
  trace(); ctx.stroke();
  // A return is dashed ON TOP, so it can never be mistaken for supply however
  // busy the sheet gets.
  if (isReturn) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, w * 0.3);
    ctx.setLineDash(DASH.return);
    trace(); ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Spiral hint — the ribs of flex duct.
    ctx.strokeStyle = 'rgba(20,20,28,0.35)';
    ctx.lineWidth = 1.2;
    const step = Math.max(3, Math.round(pts.length / 40));
    for (let i = step; i < pts.length - 1; i += step) {
      const dx = pts[i + 1].x - pts[i - 1].x, dy = pts[i + 1].y - pts[i - 1].y;
      const L = Math.hypot(dx, dy) || 1;
      ctx.beginPath();
      ctx.moveTo(pts[i].x + (dy / L) * w * 0.42, pts[i].y - (dx / L) * w * 0.42);
      ctx.lineTo(pts[i].x - (dy / L) * w * 0.42, pts[i].y + (dx / L) * w * 0.42);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A room boundary: thin, translucent, pale green — Edit rooms only. */
export function drawRoomBoundary(ctx, rect, { selected = false } = {}) {
  ctx.save();
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.strokeStyle = selected ? SELECTION_COLOUR : ROOM_COLOUR;
  ctx.globalAlpha = selected ? 0.95 : 0.65;
  ctx.setLineDash(selected ? [] : DASH.room);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// THE LEGEND
// ═══════════════════════════════════════════════════════════════════════════
//
// Compact, and drawn from the SAME functions as the drawing, so a symbol in the
// key is by construction the symbol on the sheet. A hand-drawn key is a key that
// eventually describes a drawing that has moved on.

/**
 * @param sizes  which diameters this design actually uses, so the key never
 *               lists a size the job does not contain.
 */
export function drawLegend(ctx, at, { sizes = [], hasReturn = true,
                                      outletType = 'square',
                                      width = 178, title = 'LEGEND' } = {}) {
  const pad = 10;
  const rows = sizes.length + (hasReturn ? 1 : 0);
  const height = 26 + rows * 17 + 4 * 21 + pad;
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(at.x, at.y, width, height, 5);
  else ctx.rect(at.x, at.y, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(30,34,48,0.25)';
  ctx.stroke();

  let y = at.y + 16;
  const x = at.x + pad;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = '800 10px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = INK;
  ctx.fillText(title, x, y);
  y += 15;

  ctx.font = '700 9.5px -apple-system, system-ui, sans-serif';
  for (const mm of sizes) {
    drawDuctRun(ctx, [{ x, y }, { x: x + 26, y }],
                { diameterMm: mm, role: 'main', widthPx: Math.max(3, mm / 55) });
    ctx.fillStyle = INK;
    ctx.fillText('ø' + mm, x + 34, y);
    y += 17;
  }
  if (hasReturn) {
    drawDuctRun(ctx, [{ x, y }, { x: x + 26, y }],
                { diameterMm: 400, role: 'return', widthPx: 6 });
    ctx.fillStyle = INK;
    ctx.fillText('RETURN', x + 34, y);
    y += 17;
  }

  y += 6;
  const row = (draw, text) => {
    draw(x + 11, y);
    ctx.fillStyle = INK;
    ctx.font = '700 9.5px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 34, y);
    y += 21;
  };
  row((cx, cy) => drawOutletSymbol(ctx, { x: cx, y: cy }, { type: outletType, r: 6 }),
      'SUPPLY OUTLET');
  row((cx, cy) => drawBto(ctx, { x: cx, y: cy }, { w: 15, h: 10 }), 'BTO FITTING');
  row((cx, cy) => drawReturnGrilleSymbol(ctx, { x: cx, y: cy }, { w: 18, h: 12 }),
      'RETURN GRILLE');
  row((cx, cy) => drawZoneDamper(ctx, { x: cx, y: cy }, { r: 6 }), 'ZONE DAMPER');
  ctx.restore();
  return { width, height };
}

/** Every symbol in the library, by the number it carries in the NAC brief. */
export const SYMBOLS = Object.freeze({
  fanCoil: drawFanCoil,
  supplyPlenum: drawSupplyPlenum,
  equipmentAssembly: drawEquipmentAssembly,
  bto: drawBto,
  reducer: drawReducer,
  tee: drawTee,
  collar: drawCollar,
  squareDiffuser: drawSquareDiffuser,
  roundDiffuser: drawRoundDiffuser,
  linearSlotDiffuser: drawLinearSlotDiffuser,
  sidewallGrille: drawSidewallGrille,
  editHandle: drawEditHandle,
  returnGrille: drawReturnGrilleSymbol,
  returnBox: drawReturnBox,
  zoneDamper: drawZoneDamper,
  thermostat: drawThermostat,
  zoneControllerPanel: drawZoneControllerPanel,
  drainLine: drawDrainLine,
  refrigerantPair: drawRefrigerantPair,
  isolator: drawIsolator,
  arrow: drawArrow,
  ductRun: drawDuctRun,
  roomBoundary: drawRoomBoundary,
  legend: drawLegend
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLY AND RETURN CROSSING — A BRIDGE, NEVER A JOINT
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick: "If a supply and return route cross on the plan: show a proper
// crossing/bridge symbol; create a visible gap in the lower duct; do not draw a
// junction dot."
//
// This matters more than it looks. Two ducts crossing in plan and two ducts
// joined look identical if the lines simply overlap, and the one thing this
// drawing must never suggest is that return air enters the supply system. A gap
// in the lower run is the drafting convention that says "these pass, they do not
// meet", and it costs nothing to draw.

/** Where two polylines cross, in screen space. */
export function findCrossings(aPts, bPts) {
  const hits = [];
  if (!aPts || !bPts || aPts.length < 2 || bPts.length < 2) return hits;
  const side = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  for (let i = 1; i < aPts.length; i++) {
    const a0 = aPts[i - 1], a1 = aPts[i];
    for (let j = 1; j < bPts.length; j++) {
      const b0 = bPts[j - 1], b1 = bPts[j];
      const d1 = side(a0, a1, b0), d2 = side(a0, a1, b1);
      const d3 = side(b0, b1, a0), d4 = side(b0, b1, a1);
      if (((d1 > 0) === (d2 > 0)) || ((d3 > 0) === (d4 > 0))) continue;
      const t = d3 / (d3 - d4);
      hits.push({ x: a0.x + (a1.x - a0.x) * t, y: a0.y + (a1.y - a0.y) * t,
                  angle: Math.atan2(a1.y - a0.y, a1.x - a0.x) });
    }
  }
  return hits;
}

/**
 * Break a polyline around a set of points, returning the pieces to draw.
 *
 * The gap is what makes the crossing readable, so it is cut out of the LOWER
 * duct — the one drawn first — and the upper run passes over it unbroken.
 */
export function breakAround(pts, breaks, gapPx) {
  if (!pts || pts.length < 2 || !breaks?.length) return [pts];
  const pieces = [];
  let current = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Any break that falls on this segment, in order along it.
    const onSeg = breaks
      .map(k => ({ k, t: ((k.x - a.x) * (b.x - a.x) + (k.y - a.y) * (b.y - a.y)) / (segLen * segLen) }))
      .filter(o => o.t > 0 && o.t < 1 &&
        Math.hypot(a.x + (b.x - a.x) * o.t - o.k.x, a.y + (b.y - a.y) * o.t - o.k.y) < 2)
      .sort((x, y) => x.t - y.t);
    for (const o of onSeg) {
      const half = gapPx / segLen / 2;
      const t0 = Math.max(0, o.t - half), t1 = Math.min(1, o.t + half);
      current.push({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
      pieces.push(current);
      current = [{ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }];
    }
    current.push(b);
  }
  pieces.push(current);
  return pieces.filter(pc => pc.length >= 2);
}

/** The little hop over a crossing, drawn on the upper run. */
export function drawCrossingBridge(ctx, at, { angle = 0, r = 6,
                                              colour = 'rgba(30,34,48,0.8)' } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.restore();
}

/**
 * An airflow arrow on a duct — which way the air is actually going.
 *
 * Return air travels TOWARD the fan coil, which is the opposite of everything
 * else on the sheet, and an arrow is the only thing that says so without a
 * sentence. `fraction` is how far along the run to put it.
 */
export function drawFlowArrow(ctx, pts, { fraction = 0.5, colour = RETURN_COLOUR,
                                          size = 6, reverse = false } = {}) {
  if (!pts || pts.length < 2) return null;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  let want = total * fraction, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + L >= want) {
      const t = L ? (want - run) / L : 0;
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (reverse) ang += Math.PI;
      drawArrow(ctx, at, ang, { colour, size });
      return at;
    }
    run += L;
  }
  return null;
}
