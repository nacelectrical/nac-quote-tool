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
  // Duct ink, stamped into a coarse grid rather than bounded by a rectangle.
  const CELL = 5;
  const gridSupply = new Set(), gridReturn = new Set();
  return {
    boxes,
    reset() { boxes.length = 0; gridSupply.clear(); gridReturn.clear(); },
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

    // ── THE DUCTS THEMSELVES ────────────────────────────────────────────
    //
    // A rectangle is the wrong shape for a duct: the bounding box of one
    // diagonal run covers a quarter of the house, so runs were never booked
    // and labels sat straight across them. Nick: "prevent labels from covering
    // ducts or equipment."
    //
    // So a run is stamped into a coarse occupancy grid instead — one grid for
    // supply, one for return. A label then pays for the fraction of itself
    // that lands on ink, and pays THREE TIMES over for landing on the other
    // system's ink, which is what keeps `BTO-C · 400-350-350` off the two
    // return drops and return text on the return side.
    route(points, halfWidth = 4, role = 'supply') {
      if (!points || points.length < 2) return;
      const grid = role === 'return' ? gridReturn : gridSupply;
      const reach = Math.max(0, Math.ceil((halfWidth + CELL / 2) / CELL));
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(len / CELL));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const cx = Math.floor((a.x + (b.x - a.x) * t) / CELL);
          const cy = Math.floor((a.y + (b.y - a.y) * t) / CELL);
          for (let ox = -reach; ox <= reach; ox++) {
            for (let oy = -reach; oy <= reach; oy++) grid.add((cx + ox) + ',' + (cy + oy));
          }
        }
      }
    },
    /** 0..1 — how much of this box is over duct ink, own system counted once. */
    ductCover(b, role = 'supply') {
      if (!gridSupply.size && !gridReturn.size) return 0;
      const own = role === 'return' ? gridReturn : gridSupply;
      const other = role === 'return' ? gridSupply : gridReturn;
      const x0 = Math.floor(b.x0 / CELL), x1 = Math.floor(b.x1 / CELL);
      const y0 = Math.floor(b.y0 / CELL), y1 = Math.floor(b.y1 / CELL);
      let n = 0, hit = 0;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          n++;
          const k = cx + ',' + cy;
          if (other.has(k)) hit += 3;              // the wrong side of the system
          else if (own.has(k)) hit += 1;
        }
      }
      return n ? hit / n : 0;
    },
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

/** What covering a duct completely is worth, in pixels of extra leader. */
const DUCT_COVER_PX = 400;

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
          anchor = null,
          // WHICH SYSTEM THIS LABEL BELONGS TO. A supply label pays triple for
          // sitting on return ink and a return label pays triple for sitting on
          // supply ink, which is how the two stay on their own sides of the
          // equipment instead of swapping over in the one crowded patch of
          // plan where it matters. Nick: "keep return labels on the return
          // side; keep supply labels on the supply side."
          role = 'supply' } = opts;
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
      // THREE TIERS, IN ORDER, AND THEY NEVER TRADE AGAINST EACH OTHER.
      //
      // Covering a SYMBOL is worst: a fitting you cannot see is a fitting that
      // does not get installed. Covering DUCT INK is next — the line is still
      // followable around a label, but not through a stack of them. DISTANCE
      // only breaks ties, so the shortest leader that is genuinely clear wins.
      //
      // Adding them in one currency is what used to go wrong: a clear spot
      // forty pixels further away lost to one that clipped an outlet by twelve
      // square pixels.
      // DUCT_COVER_PX is what a fully covered duct is worth in pixels of
      // leader. Set too high, labels bought a clear patch with a leader half
      // the width of the house — BTO-A's spec ended up outside the building.
      // Landing on the OTHER system's ink counts triple, so crossing sides
      // still costs more than any leader worth drawing.
      const cover = ledger.ductCover ? ledger.ductCover(b, role) : 0;
      const total = score * 10000 + cover * DUCT_COVER_PX + dist;
      if (total < best.score) best = { x: at.x + dx, y: at.y + dy, score: total,
                                       dist, box: b, raw: score, cover };
      if (score === 0 && cover === 0) break;      // nothing better than clear
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
                                      colour = METAL_DARK, bead = true } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  const h = width / 2;
  // Light metal behind the neck, so a duct line ends ON it rather than behind
  // it, and the plan underneath does not show through the fitting.
  ctx.beginPath();
  ctx.rect(0, -h, length, width);
  ctx.fillStyle = '#E9ECF0';
  ctx.fill();
  // TWO PARALLEL WALLS, OPEN AT THE BODY END. A filled rectangle rotated to an
  // arbitrary duct bearing reads as a DIAMOND — Nick, on the fitting it was
  // stuck to: "no diamond". A neck drawn as two walls and an open throat reads
  // as a spigot at any angle, because the two long lines are parallel to the
  // duct that plugs into it.
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(0, -h); ctx.lineTo(length, -h);
  ctx.moveTo(0, h);  ctx.lineTo(length, h);
  ctx.stroke();
  // The bead at the open end, where the flex clamps on.
  if (bead) {
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(length, -h); ctx.lineTo(length, h);
    ctx.stroke();
  }
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
  /** How far the fabricated transition runs before the collar face. */
  taperDepth: 11,
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
  // A PLENUM THAT HAS TO TAKE MORE COLLAR THAN THE UNIT IS WIDE IS A TRANSITION.
  //
  // The design already warns about it in words: "3 × ø400 collars need 1320 mm
  // across a 1152 mm discharge. The plenum must be fabricated WIDER than the
  // unit, or the collars split across two faces." Drawing three collars crammed
  // into the unit's own width contradicts that warning on the same sheet.
  //
  // So when the collar row does not fit the discharge, the body is drawn as
  // what the sheet metal shop actually makes: a THROAT the size of the
  // discharge flange, a TAPER out to the width the collars need, and a HEAD
  // carrying the collars. It still bolts flat to the discharge face — the
  // throat IS that face.
  const widened = sH > fcuH + 0.5;
  const sD = widened ? ASSEMBLY.supplyDepth + ASSEMBLY.taperDepth : ASSEMBLY.supplyDepth;
  const taper = widened ? ASSEMBLY.taperDepth : 0;
  const rD = ASSEMBLY.returnDepth;

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
      /** How the metal is made: flush to the flange, or a widened transition. */
      widened, throatH: fcuH, taperDepth: taper, headDepth: sD - taper,
      // The face the mains leave from, and the face bolted to the unit.
      outerFace: move(fcuW / 2 + sD, 0), innerFace: move(fcuW / 2, 0),
      /** The outline, in order, for drawing and for testing the shape. */
      outline: widened
        ? [move(fcuW / 2, -fcuH / 2), move(fcuW / 2 + taper, -sH / 2),
           move(fcuW / 2 + sD, -sH / 2), move(fcuW / 2 + sD, sH / 2),
           move(fcuW / 2 + taper, sH / 2), move(fcuW / 2, fcuH / 2)]
        : [move(fcuW / 2, -sH / 2), move(fcuW / 2 + sD, -sH / 2),
           move(fcuW / 2 + sD, sH / 2), move(fcuW / 2, sH / 2)],
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
    // Drawn from its own outline, so a widened transition looks like the piece
    // of metal it is rather than a rectangle with a caption.
    const o = geom.supply.outline;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(o[0].x, o[0].y);
    for (let i = 1; i < o.length; i++) ctx.lineTo(o[i].x, o[i].y);
    ctx.closePath();
    ctx.fillStyle = metalFill(ctx, geom.supply.x - geom.supply.w / 2,
                              geom.supply.y - geom.supply.h / 2,
                              geom.supply.w, geom.supply.h);
    ctx.fill();
    ctx.lineWidth = selectedId === 'supplyPlenum' ? 2.4 : 1.8;
    ctx.strokeStyle = selectedId === 'supplyPlenum' ? SELECTION_COLOUR : METAL_DARK;
    ctx.stroke();
    // The fold line where the taper meets the head — what makes it read as
    // fabricated sheet rather than a shape.
    if (geom.supply.widened) {
      ctx.beginPath();
      ctx.moveTo(o[1].x, o[1].y); ctx.lineTo(o[4].x, o[4].y);
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(40,44,52,0.45)';
      ctx.stroke();
    }
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
                { size: 7, colour: '#3C4250', weight: 700, ledger, role: 'return',
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

/**
 * HOW BIG THE METAL IS, BEFORE THE NECKS.
 *
 * `minW/maxW` is the DEPTH, along the flow. `minH/maxH` is the COLLAR FACE,
 * across it. They are deliberately far apart, and that is the whole point:
 * the old body worked out at 21 x 21 for BTO-A — a square, with a second
 * rectangle drawn inside it. Nick, twice: "The current BTO still resembles a
 * small electrical junction box." A square with a concentric inner rectangle IS
 * the plan symbol for a junction box. A branch take-off is a SHALLOW box with a
 * WIDE collar face, so the face grows with the collar count and the depth stays
 * modest, and the result cannot be mistaken for a square at any rotation.
 */
export const BTO_BODY = Object.freeze({
  minW: 11, maxW: 19,                   // depth, along the flow
  minH: 17, maxH: 34,                   // collar face, across it
  collarLength: 9.5, inletWidth: 9, outletWidth: 6,
  /** Where the folded end flanges are drawn, in from each short edge. */
  seamInset: 2.8,
  /** The collar ring: how far behind the open face the crimp line sits. */
  crimpInset: 2.6
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
                              inletMm = null, outletMm = [], scale = 1,
                              // WHEN THE DRAWING KNOWS ITS SCALE, EVERY NECK IS
                              // THE WIDTH OF THE DUCT THAT PLUGS INTO IT.
                              // Sized off body units instead, a ø400 main at
                              // plan scale is drawn wider than the ø400 spigot
                              // it lands on — the duct swallows the collar and
                              // there is nothing left to count.
                              pxPerMm = 0 } = {}) {
  const ports = outletAngles.length;
  // Along the flow, sized off the inlet; across it, sized off how many collars
  // have to fit on the faces without touching.
  //
  // THE CLAMP IS ON THE BODY'S OWN SIZE, NOT ON THE SCALED RESULT. Clamping
  // afterwards meant that at 3× the body hit its ceiling while the collars kept
  // growing, and the fitting came out as a small box with enormous diamonds
  // stuck to it. The limits say how big the metal is; the scale says how big
  // the drawing is, and they are different questions.
  //
  // DEPTH FROM THE INLET, FACE FROM THE COLLAR COUNT. Nick: "Scale the manifold
  // body according to its collar count" and "The installer must be able to
  // count the collars without reading the label." A two-port fitting and a
  // three-port fitting are now different pieces of metal by the width of a
  // whole collar, and neither is square.
  const w = clamp(10 + ((inletMm || 350) / 400) * 7, BTO_BODY.minW, BTO_BODY.maxW) * scale;
  const h = clamp(11 + ports * 6.5, BTO_BODY.minH, BTO_BODY.maxH) * scale;
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
  // A spigot is a sleeve the flex clamps OVER, so it is drawn a shade proud of
  // the duct that lands on it. With no scale to work from — a legend tile, a
  // symbol sheet — it falls back to body units in proportion to the diameter.
  const neckWidth = (mm, role, fallback) => (pxPerMm
    ? ductWidthPx(mm || 250, pxPerMm, { role, scale }) + 1.6 * scale
    : fallback * scale);
  // THE INLET IS DRAWN WIDER THAN THE OUTLETS. It carries all the air the
  // outlets share, and on this job it is a ø400 into four ø250s — a drawing
  // where every collar is the same width says the fitting is something it isn't.
  const inlet = inletAngle === null ? null
    : collar(inletAngle, neckWidth(inletMm, 'main', BTO_BODY.inletWidth), cl + 1);
  // EACH COLLAR IS THE WIDTH OF THE DUCT IT TAKES. A row of identical collars
  // says the fitting steps every outlet to the same size, which on BTO-B —
  // 400-300-250 — would be describing a fitting nobody is ordering.
  const outlets = outletAngles.map((a, i) => ({
    // ø250 → 6.0, ø300 → 7.2, ø350 → 8.4, against a ø400 inlet at 9.0. Nick:
    // "different collar widths for Ø250, Ø300 and Ø350 where practical". On
    // BTO-B — 400-300-250 — the two outlets must not be the same neck, because
    // a fitting with two identical necks is a different fitting to order.
    ...collar(a, neckWidth(outletMm[i], 'final',
                clamp(BTO_BODY.outletWidth * ((outletMm[i] || 250) / 250),
                      BTO_BODY.outletWidth * 0.8, BTO_BODY.inletWidth * 0.95)), cl),
    index: i,
    diameterMm: outletMm[i] ?? null
  }));

  const reach = w / 2 + h / 2 + cl;
  return {
    at: { x: at.x, y: at.y }, angle, w, h, inlet, outlets, scale,
    inletMm: inletMm ?? null,
    /** How far a duct must be trimmed back so it stops at the collar face. */
    clearPx: Math.max(w, h) / 2 + cl,
    bounds: { x: at.x - reach / 2 - w / 2, y: at.y - reach / 2 - h / 2, w: reach, h: reach,
              cx: at.x, cy: at.y }
  };
}

/**
 * ONE NECK, WITH ITS COLLAR.
 *
 * Nick: "one inlet neck entering the body; the correct number of outlet necks
 * leaving it; a short circular collar line on every neck; connected ducts
 * ending at the collar face."
 *
 * A collar is a round ring of spiral clamped to the end of the spigot. Seen
 * from above on a plan it is a LINE ACROSS THE NECK — so it is drawn as two:
 * the heavy bead at the open face, where the flex lands, and a lighter crimp
 * line just behind it. Those two lines at the end of every neck are what make
 * the count readable without the label: five necks, five collars.
 *
 * The neck itself is two parallel walls with the throat left open at the body
 * end. That matters at an angle — two long lines parallel to the duct read as a
 * spigot at any bearing, where a closed rectangle turned off-axis reads as a
 * diamond.
 */
function btoNeck(ctx, c, stroke, z) {
  const h = c.width / 2, L = c.length;
  ctx.save();
  ctx.translate(c.root.x, c.root.y);
  ctx.rotate(c.angle);
  // Light metal behind it, starting slightly inside the body so there is no
  // hairline of plan showing between the neck and the box it comes out of.
  ctx.beginPath();
  ctx.rect(-1.5, -h, L + 1.5, c.width);
  ctx.fillStyle = '#E4E8ED';
  ctx.fill();
  ctx.lineCap = 'butt';
  ctx.lineWidth = Math.max(1, 1.25 * Math.min(2, z));
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.moveTo(0, -h); ctx.lineTo(L, -h);
  ctx.moveTo(0, h);  ctx.lineTo(L, h);
  ctx.stroke();
  // THE COLLAR RING. Heavy at the face — this is where the duct stops — with
  // the crimp behind it.
  ctx.lineWidth = Math.max(1.5, 2.1 * Math.min(2, z));
  ctx.beginPath();
  ctx.moveTo(L, -h); ctx.lineTo(L, h);
  ctx.stroke();
  const crimp = Math.min(L - 1, BTO_BODY.crimpInset * Math.min(2.2, z));
  if (crimp > 1) {
    ctx.lineWidth = Math.max(0.7, 0.95 * Math.min(2, z));
    ctx.strokeStyle = 'rgba(40,44,52,0.6)';
    ctx.beginPath();
    ctx.moveTo(L - crimp, -h); ctx.lineTo(L - crimp, h);
    ctx.stroke();
  }
  ctx.restore();
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

  const z = g.scale || 1;
  // NECKS FIRST, so the body sits over their roots and each one reads as a
  // spigot punched through the metal rather than a stick laid beside it.
  for (const c of g.outlets) btoNeck(ctx, c, stroke, z);
  if (g.inlet) btoNeck(ctx, g.inlet, stroke, z);

  ctx.save();
  ctx.translate(g.at.x, g.at.y);
  ctx.rotate(g.angle);
  // ── THE BODY: A PLAIN RECTANGLE OF GALVANISED SHEET ─────────────────────
  //
  // Square corners, the same metal fill as the fan coil and the two plenums —
  // because it is the same material, made in the same shop, and the sheet is
  // what an installer is looking for.
  //
  // What is NOT here matters as much. No rounded corners, no concentric inner
  // rectangle, no fill of flat white: those three together are the plan symbol
  // for an electrical junction box, and they are what Nick kept seeing. The
  // only lines inside the outline are the two end flanges, which run ACROSS the
  // box parallel to the collar face — the folded returns of a fabricated
  // take-off, not the lid of a box.
  ctx.beginPath();
  ctx.rect(-g.w / 2, -g.h / 2, g.w, g.h);
  ctx.fillStyle = metalFill(ctx, -g.w / 2, -g.h / 2, g.w, g.h);
  ctx.fill();
  ctx.lineWidth = (selected ? 2.4 : 1.7) * Math.min(2, Math.max(1, z * 0.6));
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  const seam = Math.min(g.w / 2 - 0.6, BTO_BODY.seamInset * Math.min(2.2, z));
  if (seam > 0.8) {
    ctx.lineWidth = Math.max(0.7, 0.9 * Math.min(2, z));
    ctx.strokeStyle = warning ? WARNING_COLOUR : 'rgba(40,44,52,0.55)';
    ctx.beginPath();
    ctx.moveTo(-g.w / 2 + seam, -g.h / 2); ctx.lineTo(-g.w / 2 + seam, g.h / 2);
    ctx.moveTo(g.w / 2 - seam, -g.h / 2);  ctx.lineTo(g.w / 2 - seam, g.h / 2);
    ctx.stroke();
  }
  ctx.restore();

  // NOTHING IS DRAWN INSIDE THE BODY.
  //
  // No arrow, no route point, no centre dot, no mark of any kind. A rectangle
  // with something in the middle of it is a schematic for a device; this is a
  // piece of metal. What it carries is written beside it and counted off the
  // necks.

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
  if (label) { drawLabel(ctx, label, { x: at.x, y }, { size: 7.5, colour: '#3C4250', ledger, anchor: at, role: 'return' }); y += 10; }
  if (duct) drawLabel(ctx, duct, { x: at.x, y }, { size: 7, colour: '#4A5160', weight: 600, ledger, role: 'return' });
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
  bodyLength: 13,          // along the duct
  minBodyWidth: 9, maxBodyWidth: 22,
  actuatorW: 8, actuatorH: 6.5,
  /** How far the end flange marks stand proud of the casing, each side. */
  flangeProud: 1.6,
  shaft: 0,                // the actuator sits ON the wall; the shaft is inside
  /**
   * HOW MUCH LONGER THAN WIDE THE CASING IS.
   *
   * A casing the same length as its width is a SQUARE, and a square rotated to
   * follow a duct is a diamond — which is exactly what Nick saw: "The zone
   * damper still looks like a diamond across the duct." A real inline damper
   * sleeve is visibly longer than the duct is wide, and a long rectangle turned
   * to any angle still reads as a rectangle because its two long sides are
   * parallel to the run it sits in.
   */
  lengthRatio: 2.1
});

/** The width the duct itself is stroked at — the same call the renderer makes. */
const ductWidthPx0 = (mm, pxPerMm, scale) =>
  ductWidthPx(mm || 250, pxPerMm || 0, { role: 'final', scale: scale || 1 });

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
  // THE CASING IS NEVER WIDER THAN THE DUCT IT IS FITTED IN.
  //
  // It used to be the duct plus 2.5, which on a ø250 final made a sleeve
  // visibly fatter than the run — a box sitting ON the duct rather than a
  // fitting IN it, and at plan zoom a fat short box with a diagonal through it
  // is a diamond. The casing now takes the duct's own width, with a floor only
  // so it does not vanish at a whole-house zoom.
  // THE CASING IS THE WIDTH OF THE DUCT AS DRAWN, and that last clause is the
  // one that matters. It used to be computed from the raw diameter, while the
  // duct beside it is stroked at `ductWidthPx` — which applies the final run's
  // lighter line weight — so the sleeve came out half as wide again as the run
  // it was fitted in. A box sitting ON the duct rather than a fitting IN it,
  // and at plan zoom a fat short box with a diagonal through it is a diamond.
  //
  // Taking the drawn width makes the casing a white break in the coloured run,
  // which is what an inline damper looks like on a mechanical sheet.
  const drawn = ductWidthPx ?? ductWidthPx0(diameterMm, pxPerMm, scale);
  const width = Math.max(5.5, Math.min(DAMPER.maxBodyWidth * scale, drawn));
  // AND IT IS LONGER THAN IT IS WIDE. A casing as long as it is wide is a
  // square, and a square turned to follow a duct is a diamond.
  // AND IT IS TWICE AS LONG AS IT IS WIDE. Nick, twice: "the zone damper still
  // looks like a diamond" / "a diagonal route marker". At 1.55x the casing was
  // still stubby enough that, turned to a duct bearing with a blade across it,
  // the eye read one diagonal lozenge. At 2.1x the two long walls are
  // unmistakably parallel to the run they sit in, at every angle.
  const len = Math.max(DAMPER.bodyLength * scale, width * DAMPER.lengthRatio);
  return { at: { x: at.x, y: at.y }, angle, w: len, h: width, scale,
           actuator: { w: DAMPER.actuatorW * scale, h: DAMPER.actuatorH * scale,
                       // TOUCHING THE CASING WALL, with no gap at all. Nick:
                       // "small actuator box physically touching one side;
                       // short actuator shaft connected to the blade." So the
                       // shaft is not a stub out in the open between two
                       // objects — it is INSIDE the casing, running from the
                       // blade's spindle out to the wall the motor is bolted
                       // to, which is where the shaft of a real damper is.
                       offset: width / 2 + (DAMPER.actuatorH * scale) / 2 },
           reach: Math.max(len, width + DAMPER.actuatorH * scale * 2) };
}

export function drawZoneDamper(ctx, at, { angle = 0, ductWidthPx = null, diameterMm = null,
                                          pxPerMm = 0, scale = 1,
                                          label = null, constant = false,
                                          geometry = null,
                                          ledger = null } = {}) {
  const g = geometry || damperGeometry({ at, angle, ductWidthPx, diameterMm, pxPerMm, scale });
  ctx.save();
  ctx.translate(g.at.x, g.at.y);
  ctx.rotate(g.angle);

  // ── THE CASING: A SHORT SLEEVE IN THE LINE OF THE DUCT ──────────────────
  //
  // Square corners, white inside, twice as long as the duct is wide. The duct
  // runs into one end and out of the other: the sleeve is a break in the
  // coloured run, not a box parked on top of it.
  const z = g.scale || 1;
  ctx.beginPath();
  ctx.rect(-g.w / 2, -g.h / 2, g.w, g.h);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = Math.max(1.3, 1.7 * Math.min(2, z));
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.stroke();

  // ── THE TWO BOUNDARY LINES ACROSS THE DUCT ──────────────────────────────
  //
  // Nick: "two short casing boundary lines across the duct". They stand a
  // little proud of the sleeve on both sides, which is what a flanged fitting
  // clamped into a run looks like on a mechanical sheet — and it is the detail
  // that stops a plain rectangle reading as a marker laid on the line.
  const proud = DAMPER.flangeProud * Math.min(2.2, z);
  ctx.lineWidth = Math.max(1.4, 1.9 * Math.min(2, z));
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-g.w / 2, -g.h / 2 - proud); ctx.lineTo(-g.w / 2, g.h / 2 + proud);
  ctx.moveTo(g.w / 2, -g.h / 2 - proud);  ctx.lineTo(g.w / 2, g.h / 2 + proud);
  ctx.stroke();

  // ── THE BLADE, one line on its spindle, well inside the sleeve ──────────
  //
  // Set at a fixed lean rather than drawn corner to corner. Corner to corner in
  // a short casing IS the diagonal Nick kept reading as a route marker; a blade
  // that spans the duct and stops short of both walls is a damper blade part
  // way open, which is the thing being drawn.
  const half = Math.min(g.h / 2 - 1.2, g.w / 2 - 1.6);
  const lean = 0.52;                              // ~30° off across the duct
  ctx.beginPath();
  ctx.moveTo(-half * Math.sin(lean), half * Math.cos(lean));
  ctx.lineTo(half * Math.sin(lean), -half * Math.cos(lean));
  ctx.lineWidth = Math.max(1.4, 1.9 * Math.min(2, z));
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.stroke();

  // ── THE ACTUATOR, mounted ON the body, joined by its shaft ──────────────
  //
  // A constant zone gets NO actuator: Nick, "Do not show a motor actuator
  // unless one physically exists." A permanently open duct is not closed by
  // anything, and a motor drawn there is a motor somebody orders.
  if (!constant) {
    const oy = -g.actuator.offset;
    // THE SHAFT, INSIDE THE CASING, FROM THE BLADE TO THE WALL. This is the
    // piece that says the motor turns THIS blade. It used to be drawn in the
    // gap outside the sleeve, between two things that were not touching.
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -g.h / 2);
    ctx.lineWidth = Math.max(1.2, 1.5 * Math.min(2, z));
    ctx.strokeStyle = INK;
    ctx.lineCap = 'butt';
    ctx.stroke();
    // THE ACTUATOR, BOLTED FLAT TO THAT WALL. Nick: "remove the separate green
    // `M` marker." A coloured chip with a letter in it beside the duct is an
    // annotation; a small motor can sitting hard on the casing is the fitting.
    // It is in the damper's own frame, so it turns with the duct and stays
    // upright relative to the body.
    ctx.beginPath();
    ctx.rect(-g.actuator.w / 2, oy - g.actuator.h / 2, g.actuator.w, g.actuator.h);
    ctx.fillStyle = '#5B6270';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.2 * Math.min(2, z));
    ctx.strokeStyle = INK;
    ctx.stroke();
    // A ribbed face, so it reads as a motor body rather than a filled block.
    ctx.lineWidth = Math.max(0.6, 0.8 * Math.min(2, z));
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const x = i * g.actuator.w * 0.24;
      ctx.moveTo(x, oy - g.actuator.h / 2 + g.actuator.h * 0.22);
      ctx.lineTo(x, oy + g.actuator.h / 2 - g.actuator.h * 0.22);
    }
    ctx.stroke();
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
  // THE KEY SHOWS THE FITTING, NOT A BOX. `{ w, h }` are not arguments drawBto
  // takes, so the legend drew a body with no necks at all — a plain rectangle,
  // which is the one thing the symbol must never look like. It now draws a real
  // one-in, three-out manifold, from the same geometry the sheet uses.
  row((cx, cy) => drawBto(ctx, { x: cx, y: cy },
        { inletAngle: Math.PI, outletAngles: [0.5, 0, -0.5],
          inletMm: 400, outletMm: [250, 250, 250], scale: 0.62 }), 'BTO FITTING');
  row((cx, cy) => drawReturnGrilleSymbol(ctx, { x: cx, y: cy }, { w: 18, h: 12 }),
      'RETURN GRILLE');
  row((cx, cy) => drawZoneDamper(ctx, { x: cx, y: cy },
        { angle: 0, ductWidthPx: 8, scale: 1 }), 'ZONE DAMPER');
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
      // Each break may size its own gap: a return crossing a ø400 main needs a
      // wider gap than the same return crossing a ø250 final, and one gap for
      // the whole run is either too mean for the big one or a hole under the
      // small one.
      const half = (o.k.gapPx ?? gapPx) / segLen / 2;
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

/**
 * THE HOP OVER A CROSSING.
 *
 * Nick: "Show a clear bridge/gap at that exact crossing. It must not resemble a
 * connection." Two ducts that meet at a point on a drawing mean a JOINT, and a
 * return joined to a supply is the one thing this system must never look like.
 *
 * So the return is cut with a gap wide enough to clear the run passing through
 * it, and this arc carries it over the top: the return's own colour, its own
 * weight, on a white casing so it reads above the duct it steps across. A tick
 * a couple of pixels high under a ten-pixel duct is invisible, which is what
 * the first version of this was.
 */
export function drawCrossingBridge(ctx, at, { angle = 0, r = 6, width = 2.4,
                                              colour = RETURN_COLOUR } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0);
  ctx.lineWidth = width + 3.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0);
  ctx.lineWidth = width;
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

// ═══════════════════════════════════════════════════════════════════════════
// THE BTO FABRICATION DETAIL — WHAT THE SHOP MARKS OUT
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick: "Add a BTO fabrication detail or diagram showing: inlet face; outlet
// faces; collar sizes; collar locations; body dimensions."
//
// The plan symbol shows the fitting where it sits in the roof with its necks
// pointing at the ducts they feed. That is the right drawing for an installer
// and the wrong one for a fabricator, who needs each FACE flat, square on, with
// the collar centres dimensioned off it. So this is a development: the inlet
// end, then every face carrying collars, laid out side by side at one scale.
//
// It is drawn from the SAME face-layout object the schedule, the order and the
// site editor read. Nothing here decides anything; if the layout says a collar
// is 225 mm along Side A, that is where the circle goes.

/** Colours for the detail: sheet metal, a red circle for a collar that failed. */
export const DETAIL = Object.freeze({
  panelFill: '#FFFFFF',
  panelEdge: '#4A4F57',
  seam: '#A9AEB6',
  collar: '#1D7A48',
  collarBad: WARNING_COLOUR,
  dim: '#6C7280',
  ink: INK
});

/**
 * Draw the fabrication development of one fitting into `box`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} layout  a `faceLayout` from `bto-faces.mjs`
 * @param {object} box     { x, y, w, h }
 * @param {object} opts    { title, subtitle, status }
 */
export function drawBtoFabricationDetail(ctx, layout, box, opts = {}) {
  if (!layout) return null;
  const pad = 14;
  const headH = opts.title ? 34 : 0;
  const footH = 30;                       // room for the per-face dimension text
  const gap = 26;

  // One panel per face that carries metal the shop has to punch.
  const panels = [
    { key: 'inlet', label: 'INLET END', uMm: layout.inlet.availableWidthMm,
      vMm: layout.inlet.availableHeightMm, uAxis: 'body width', vAxis: 'body height',
      collars: [{ nominalDiameterMm: layout.inlet.nominalDiameterMm,
                  outsideDiameterMm: layout.inlet.outsideDiameterMm,
                  centreUmm: layout.inlet.centreUmm, centreVmm: layout.inlet.centreVmm,
                  destination: 'INLET', fits: layout.inlet.fits }],
      fits: layout.inlet.fits },
    ...layout.faces.map(f => ({
      key: f.face, label: f.faceLabel.toUpperCase(), uMm: f.availableWidthMm,
      vMm: f.availableHeightMm, uAxis: f.widthAxis, vAxis: f.heightAxis,
      collars: f.collars.map(c => ({ ...c, fits: f.fits })), fits: f.fits,
      requiredWidthMm: f.requiredWidthMm, requiredHeightMm: f.requiredHeightMm }))
  ];

  const totalUmm = panels.reduce((n, p) => n + p.uMm, 0);
  const maxVmm = Math.max(...panels.map(p => p.vMm));
  const availW = box.w - pad * 2 - gap * (panels.length - 1);
  const availH = box.h - pad * 2 - headH - footH;
  const scale = Math.min(availW / totalUmm, availH / maxVmm);

  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(box.x, box.y, box.w, box.h);

  if (opts.title) {
    ctx.font = '800 15px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = DETAIL.ink;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.title, box.x + pad, box.y + 20);
    ctx.font = '600 10.5px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = layout.pass ? DETAIL.dim : DETAIL.collarBad;
    ctx.fillText(opts.subtitle || (layout.bodyText + '  ·  ' + layout.status),
      box.x + pad, box.y + 34);
  }

  let x = box.x + pad;
  const baseY = box.y + pad + headH;
  for (const p of panels) {
    const w = p.uMm * scale, hh = p.vMm * scale;
    const y = baseY + (availH - hh) / 2;

    // The face itself, with its lock seams shown at the edges it folds on.
    ctx.fillStyle = DETAIL.panelFill;
    ctx.strokeStyle = p.fits ? DETAIL.panelEdge : DETAIL.collarBad;
    ctx.lineWidth = p.fits ? 1.6 : 2.4;
    ctx.beginPath(); ctx.rect(x, y, w, hh); ctx.fill(); ctx.stroke();
    const seam = (layout.allowances.seamAllowanceMm || 0) * scale;
    if (seam > 0.6) {
      ctx.strokeStyle = DETAIL.seam;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.rect(x + seam, y + seam, Math.max(1, w - seam * 2), Math.max(1, hh - seam * 2));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Every collar, at the centre the layout put it at.
    for (const c of p.collars) {
      const cx = x + (c.centreUmm || 0) * scale;
      const cy = y + hh - (c.centreVmm || 0) * scale;      // v measured up the face
      const r = ((c.outsideDiameterMm || 0) / 2) * scale;
      ctx.strokeStyle = c.fits ? DETAIL.collar : DETAIL.collarBad;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2); ctx.stroke();
      // Centre lines — a fabricator marks off these, not off the circle.
      ctx.strokeStyle = DETAIL.dim; ctx.lineWidth = 0.7;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, y); ctx.lineTo(cx, y + hh);
      ctx.moveTo(x, cy); ctx.lineTo(x + w, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 9.5px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = c.fits ? DETAIL.ink : DETAIL.collarBad;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ø' + c.nominalDiameterMm, cx, cy);
      if (c.destination && c.destination !== 'INLET') {
        ctx.font = '600 8.5px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = DETAIL.dim;
        ctx.fillText(String(c.destination).slice(0, 16), cx, cy + Math.max(2, r) + 8);
      }
      // The collar centre, dimensioned off the face edge.
      ctx.font = '600 8px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = DETAIL.dim;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(Math.round(c.centreUmm) + '', cx, y - 4);
    }

    // Face name, its size, and what it needed if that is different.
    ctx.textAlign = 'center';
    ctx.font = '800 9.5px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = p.fits ? DETAIL.ink : DETAIL.collarBad;
    ctx.textBaseline = 'top';
    ctx.fillText(p.label, x + w / 2, y + hh + 6);
    ctx.font = '600 8.5px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = DETAIL.dim;
    ctx.fillText(Math.round(p.uMm) + ' × ' + Math.round(p.vMm) + ' mm', x + w / 2, y + hh + 17);
    if (!p.fits && p.requiredWidthMm) {
      ctx.fillStyle = DETAIL.collarBad;
      ctx.fillText('needs ' + Math.round(p.requiredWidthMm) + ' × ' +
        Math.round(p.requiredHeightMm) + ' mm', x + w / 2, y + hh + 27);
    }
    x += w + gap;
  }

  // Anything that had no face at all is named rather than silently missing.
  if ((layout.unplacedCollars || []).length) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = '800 10px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = DETAIL.collarBad;
    ctx.fillText('NO FACE: ' + layout.unplacedCollars
      .map(u => 'ø' + u.nominalDiameterMm).join(', '),
      box.x + pad, box.y + box.h - 6);
  }
  ctx.restore();
  return { panels: panels.length, scale };
}
