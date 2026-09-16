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
  flow: (ls) => Math.round(ls) + ' L/s'
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
    reserve(x, y, w, h) { boxes.push({ x0: x - w / 2, x1: x + w / 2,
                                       y0: y - h / 2, y1: y + h / 2 }); },
    hits(b) {
      return boxes.some(o => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
    },
    add(b) { boxes.push(b); }
  };
}

/** Where a label may step to, in order of preference, as [dx, dy] screen px. */
const LABEL_OFFSETS = [
  [0, 0], [0, -13], [0, 13], [0, -26], [0, 26],
  [-34, 0], [34, 0], [-34, -13], [34, -13], [-34, 13], [34, 13],
  [0, -39], [0, 39], [-62, 0], [62, 0],
  // A WIDER RING, because a label that finds nowhere is a label nobody reads.
  // The first pass ran out of room in the fan-coil cluster and BTO-C's spec was
  // left at the origin, where the unit was then drawn straight over the top of
  // it. Better a label further from its symbol than no label at all.
  [-62, -26], [62, -26], [-62, 26], [62, 26],
  [0, -54], [0, 54], [-92, 0], [92, 0],
  [-92, -34], [92, -34], [-92, 34], [92, 34],
  [0, -70], [0, 70]
];

/**
 * A label with a translucent backing, offset clear of anything already placed.
 *
 * `avoidPlanText` is why the backing exists: a builder's floor plan already has
 * its own room names printed on it, and Nick was explicit that a design label
 * must never be dropped on top of one. The backing makes the label readable
 * over whatever is underneath, and the ledger keeps design labels off each
 * other and off every symbol.
 */
export function drawLabel(ctx, text, at, opts = {}) {
  const { size = 11, colour = INK, ledger = null, weight = 700,
          backing = 'rgba(255,255,255,0.93)', align = 'center' } = opts;
  if (!text) return null;
  ctx.save();
  ctx.font = weight + ' ' + size + 'px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8;
  const h = size + 6;

  let px = at.x, py = at.y;
  if (ledger) {
    for (const [dx, dy] of LABEL_OFFSETS) {
      const b = { x0: at.x + dx - w / 2, x1: at.x + dx + w / 2,
                  y0: at.y + dy - h / 2, y1: at.y + dy + h / 2 };
      if (!ledger.hits(b)) { px = at.x + dx; py = at.y + dy; ledger.add(b); break; }
    }
  }
  if (backing) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px - w / 2, py - h / 2, w, h, 3);
    else ctx.rect(px - w / 2, py - h / 2, w, h);
    ctx.fillStyle = backing;
    ctx.fill();
  }
  ctx.fillStyle = colour;
  ctx.fillText(text, px, py);
  ctx.restore();
  return { x: px, y: py, w, h };
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
  drawLabel(ctx, label, { x: at.x, y: at.y + h / 2 + 11 }, { size: 10.5, ledger });
  if (model) drawLabel(ctx, model, { x: at.x, y: at.y + h / 2 + 24 },
                       { size: 8.5, colour: '#4A5160', weight: 600, ledger });
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
                       { size: 8.5, colour: '#4A5160', weight: 700, ledger });
}

/**
 * 6. THE BTO — A FABRICATED MULTI-COLLAR MANIFOLD.
 *
 * Nick, twice: "A BTO is the actual physical metal branch take-off/manifold
 * fitting", and "Do not represent it as an unexplained grey circle."
 *
 * So it is a metal box with ONE inlet collar and one outlet collar per port,
 * each drawn in the direction the duct actually leaves. The collar count and
 * their directions come from the topology, which means a five-port BTO looks
 * like a five-port BTO and you can count the ports off the drawing.
 *
 * A primary BTO and a local BTO are the SAME symbol with their own inlet and
 * outlet specification — there is no visual hierarchy between them, because
 * they are the same kind of object.
 */
export function drawBto(ctx, at, { inletAngle = null, outletAngles = [],
                                   w = 17, h = 12, angle = 0,
                                   label = null, spec = null, flow = null,
                                   ledger = null, selected = false,
                                   warning = false } = {}) {
  // Collars first, so the body sits over their roots and they read as sockets
  // in the metal rather than as loose sticks.
  if (inletAngle !== null) {
    drawCollar(ctx, at, { angle: inletAngle, length: 9, width: 8 });
  }
  for (const a of outletAngles) drawCollar(ctx, at, { angle: a, length: 8, width: 6.5 });

  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  box(ctx, 0, 0, w, h, 2.5);
  ctx.fillStyle = metalFill(ctx, -w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.lineWidth = selected ? 2.6 : 1.6;
  ctx.strokeStyle = warning ? WARNING_COLOUR : selected ? SELECTION_COLOUR : METAL_DARK;
  ctx.stroke();
  // The seam, so it reads as sheet metal rather than a chip.
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2, 0); ctx.lineTo(w / 2 - 2, 0);
  ctx.strokeStyle = 'rgba(40,44,52,0.42)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (ledger) ledger.reserve(at.x, at.y, w + 22, h + 22);
  // Three lines, stacked: which fitting, what it is made of, what it carries.
  let y = at.y - h / 2 - 12;
  if (label) { drawLabel(ctx, label, { x: at.x, y }, { size: 10.5, ledger }); y -= 12; }
  if (spec) { drawLabel(ctx, spec, { x: at.x, y }, { size: 9, colour: '#4A5160', ledger }); y -= 11; }
  if (flow) drawLabel(ctx, flow, { x: at.x, y }, { size: 9, colour: '#4A5160', ledger });
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
  if (label) { drawLabel(ctx, label, { x: at.x, y }, { size: 9.5, colour: '#3C4250', ledger }); y += 11; }
  if (duct) drawLabel(ctx, duct, { x: at.x, y }, { size: 9, colour: '#4A5160', weight: 600, ledger });
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
                       { size: 8.5, colour: '#3C4250', ledger });
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONING AND CONTROLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 18. ZONE DAMPER AND MOTOR.
 *
 * The blade goes ACROSS the duct — a blade drawn along the duct is not a damper,
 * it is a decoration — and the motor is a small box on the side of it, because
 * that is a separate item somebody buys, fits and wires.
 *
 * Never on a return. A damper there does not balance a room, it starves the fan
 * coil, so the drawing must not even suggest one.
 */
export function drawZoneDamper(ctx, at, { angle = 0, r = 7, colour = '#1D7A48',
                                          label = null, constant = false,
                                          ledger = null } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  // The blade, across the run.
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, r * 0.6); ctx.lineTo(r * 0.75, -r * 0.6);
  ctx.stroke();
  // The motor, a small square on the side of the duct.
  ctx.beginPath();
  ctx.rect(-4, -r - 9, 8, 8);
  ctx.fillStyle = constant ? '#E9EBEE' : colour;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = constant ? '#8A8F9A' : '#12532F';
  ctx.stroke();
  ctx.restore();
  if (ledger) ledger.reserve(at.x, at.y, r * 2 + 10, r * 2 + 18);
  if (label) drawLabel(ctx, label, { x: at.x + 20, y: at.y }, { size: 9, ledger });
  // 19. A constant/spill zone is annotated, never implied by a motor that is
  //     not there. A permanently open duct does not get closed by anything.
  if (constant) {
    drawLabel(ctx, 'CONSTANT ZONE', { x: at.x + 20, y: at.y + 12 },
              { size: 8.5, colour: '#4A5160', weight: 600, ledger });
  }
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
