// ═══════════════════════════════════════════════════════════════════════════
// THE NAC FLEX DUCT DRAWING
// ═══════════════════════════════════════════════════════════════════════════
//
// STAGE 2. A renderer built for flexible duct, replacing the design-view path
// of the general plan viewer rather than patching it.
//
// The old one drew a GRAPH: thin lines, a node wherever two met, a boxed label
// on every run, room rectangles underneath. Every pass made it a tidier graph.
// Nothing NAC installs looks like that.
//
// WHAT A FLEX DUCT DRAWING LOOKS LIKE, AND WHAT THIS DOES ABOUT IT
//
// 1. A DUCT IS A TUBE, NOT A LINE. Each run is drawn as a casing, a coloured
//    body and a lighter core, its width set by the real diameter at the real
//    scale. A 400 main is visibly fatter than a 200 final because it IS, and
//    that alone tells an installer more than any label.
//
// 2. IT IS PULLED, NOT ROUTED. Every run is a curve. There are no corners in
//    here to round off later.
//
// 3. LABELS ARE TEXT ON THE DRAWING, not chips floating over it. Dark text
//    with a white halo, laid along the duct, the way a size is written on a
//    real sheet. Mains always; a final only where its size is not obvious.
//
// 4. THE FIGURES LIVE OFF THE PLAN. One zone schedule in the margin and a
//    numbered badge in each zone. Nothing writes four lines of kW across a
//    bedroom.
//
// It draws from the SIZED network — the same sections the schedule, the BOM
// and the pressure calculation read — so the picture cannot show a system the
// numbers do not.

import { DRAWING } from '../engines/nac-standard.mjs';
import * as SYM from './symbols.mjs';

/**
 * The colour of a duct: its SIZE.
 *
 * A return keeps grey, because it is the other system and must never be read
 * as a supply run whatever size it happens to be.
 */
export function sizeColour(diameterMm, role) {
  if (role === 'return') return DRAWING.returnColour;
  return DRAWING.sizeColours[diameterMm] || DRAWING.sizeColourFallback;
}

/** Every size on this drawing, in order, for the key. */
export function sizeKey(routes) {
  const seen = new Map();
  for (const r of Object.values(routes || {})) {
    if (!r.diameterMm || r.role === 'return') continue;
    seen.set(r.diameterMm, sizeColour(r.diameterMm, r.role));
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0])
    .map(([mm, colour]) => ({ diameterMm: mm, colour }));
}

/**
 * The WEIGHT of a duct on the drawing.
 *
 * Not its diameter at scale. Drawing a 400 main thirty pixels wide was true to
 * the roof and useless on paper: the house disappeared under its own ductwork
 * and every run read as a swollen tube.
 *
 * Nick's hierarchy is: size from COLOUR, hierarchy from LINE WEIGHT. So the
 * weight says what a run IS — main, branch, final, return — with a small nudge
 * for size so a 400 main still sits a touch heavier than a 300 one.
 */
export function tubeWidthPx(diameterMm, pxPerMm, opts = {}) {
  const role = opts.role || 'final';
  const base = DRAWING.lineWeightPx[role] ?? DRAWING.lineWeightPx.final;
  const t = Math.min(1, Math.max(0, ((diameterMm || 200) - 200) / 200));
  return base + t * DRAWING.lineWeightSizeNudgePx;
}

/** A soft, readable version of a colour for the tube's core highlight. */
function lighten(hex, amount = 0.45) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 'rgba(255,255,255,0.5)';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
}

/** Distance along a polyline, and the point/angle at a fraction of it. */
function alongPath(pts, fraction) {
  if (!pts || pts.length < 2) return null;
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(d); total += d;
  }
  if (!total) return null;
  let want = total * Math.min(1, Math.max(0, fraction));
  for (let i = 0; i < segs.length; i++) {
    if (want <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? want / segs[i] : 0;
      const a = pts[i], b = pts[i + 1];
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        totalPx: total
      };
    }
    want -= segs[i];
  }
  return null;
}

/**
 * Trace a run as a smooth curve. Flex does not turn corners.
 *
 * A Catmull-Rom spline THROUGH the points rather than a chain of quadratics
 * near them: the old version cut every corner slightly, which on a long run
 * read as a series of small kinks — the "rigid CAD line" look. This passes
 * through each point and leaves the run a single continuous sweep.
 */
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y);
  }
}

/**
 * One duct, drawn as a tube.
 *
 * Casing, body, core. The casing is what keeps a pale duct legible over a pale
 * floor plan without having to shout with colour.
 */
export function drawTube(ctx, screenPts, { colour, widthPx, isReturn = false }) {
  if (!screenPts || screenPts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // FLEX DUCT, NOT A ROAD. Nick: no lane-like outlines, no heavy graphical
  // edging — light and natural. So there is no casing and no core highlight:
  // one stroke, the colour of its size, with a faint white underlay only
  // where the printed plan behind it would otherwise swallow it.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = widthPx + 1.6;
  tracePath(ctx, screenPts);
  ctx.stroke();

  // THE RETURN IS SECONDARY. It is the other system, and it must not compete
  // with the supply for the eye.
  if (isReturn) {
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = colour;
    ctx.lineWidth = widthPx;
    ctx.setLineDash([10, 7]);
    tracePath(ctx, screenPts);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  ctx.strokeStyle = colour;
  ctx.lineWidth = widthPx;
  tracePath(ctx, screenPts);
  ctx.stroke();
  ctx.restore();
}

/**
 * A size written on the duct.
 *
 * Dark text with a white halo, turned to lie along the run. No box: a box is a
 * label sitting ON a drawing, text is a label that is PART of one.
 */
export function drawDuctLabel(ctx, text, at, { angle = 0, size = 11, colour = '#16162e' } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  // Lie along the duct ONLY where the duct is roughly horizontal. A size turned
  // to follow a vertical run is a size read by tilting your head, and half the
  // runs in a house are vertical on the page. Past 35 degrees it stays level.
  let a = angle;
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  if (Math.abs(a) > 0.61) a = 0;
  ctx.rotate(a);
  ctx.font = '700 ' + size + 'px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 3.5;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = colour;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A ceiling diffuser. */
export function drawOutlet(ctx, at, { colour = '#2a3040', r = 6 } = {}) {
  // A CEILING DIFFUSER, drawn as one: the square of the face with its diagonals
  // — the symbol on every mechanical sheet — not a ringed circle with a plus in
  // it, which read as a widget.
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(-r, -r, r * 2, r * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-r, -r); ctx.lineTo(r, r);
  ctx.moveTo(r, -r); ctx.lineTo(-r, r);
  ctx.stroke();
  ctx.restore();
}

/**
 * A branch take-off: the collar where a final leaves its main.
 *
 * Small and solid. Twelve of them must not swamp a house, but an installer
 * counting collars for the van has to be able to.
 */
export function drawTakeOff(ctx, at, { colour = '#2a3040', angle = 0, r = 3,
                                       fitting = false, ports = 0 } = {}) {
  // TWO DIFFERENT THINGS, DRAWN DIFFERENTLY.
  //
  // A plain take-off is a collar on a main: a short bar across the duct where
  // it leaves. Nick: "no big diamonds, no debug nodes, no multiple overlapping
  // symbols — small, simple, professional."
  //
  // A BTO is not that. It is the fabricated multi-collar distribution box an
  // installer lifts into the roof, and on the approved drawing it is one of the
  // five things the job is built around — so it gets a body you can see. It was
  // drawn with the same 6-pixel tick as a collar, which on a whole-house view
  // meant the fittings were effectively invisible.
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  if (fitting) {
    const w = 15, hgt = 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -hgt / 2, w, hgt, 2.5);
    else ctx.rect(-w / 2, -hgt / 2, w, hgt);
    const g = ctx.createLinearGradient(-w / 2, -hgt / 2, w / 2, hgt / 2);
    g.addColorStop(0, '#FBFBFC'); g.addColorStop(0.5, '#C9CCD1'); g.addColorStop(1, '#93979E');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#4A4F57'; ctx.lineWidth = 1.5; ctx.stroke();
    // The seam across the body, so it reads as sheet metal rather than a chip.
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 2, 0); ctx.lineTo(w / 2 - 2, 0);
    ctx.strokeStyle = 'rgba(40,44,52,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  } else {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(0, r);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A ZONE DAMPER, drawn the way one is drawn on a duct layout: a short barrel
 * across the run with the blade on its spindle through it.
 *
 * Turned to sit across the duct, because a damper lying along the duct is not
 * a damper, it is a decoration.
 */
export function drawDamper(ctx, at, angle = 0, { colour = '#1d7a48', label = null } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.save();
  ctx.rotate(angle);
  const w = 6, h = 12;   // w along the duct, h across it
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  // The blade, on the slant, the way a damper is shown part open.
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 1, h / 2 - 1.5);
  ctx.lineTo(w / 2 - 1, -h / 2 + 1.5);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // WHICH ZONE THIS DAMPER IS. Nick: zoning is not shown by colouring the duct
  // network — it is shown by the damper and its label. An unlabelled damper
  // says a motor goes here; a labelled one says which zone it closes, which is
  // the thing an installer and an estimator both need.
  if (label) {
    ctx.font = '800 9px -apple-system, system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const bw = tw + 8, bh = 13;
    const bx = 8, by = -bh / 2;
    ctx.fillStyle = colour;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill(); }
    else ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
  }
  ctx.restore();
}

/**
 * THE FAN COIL AND ITS SUPPLY PLENUM, as a mechanical plan symbol.
 *
 * Nick: "Replace the current app-style box icon. Use a simple mechanical plan
 * symbol. It should look like part of an HVAC drawing, not a UI button." So it
 * is line work, not a filled dark chip: the unit outlined, the fan drawn as the
 * diagonal cross a fan is always drawn as, and the plenum as the short bar
 * across the face the mains leave from.
 */
export function drawUnit(ctx, at, { w = 30, h = 20, angle = 0 } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = '#2a3040';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();

  // The fan: the diagonal cross.
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2);
  ctx.moveTo(w / 2, -h / 2); ctx.lineTo(-w / 2, h / 2);
  ctx.stroke();

  // The supply plenum: the bar across the face the mains leave from.
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2 + 2.5); ctx.lineTo(w / 2, h / 2 + 2.5);
  ctx.stroke();
  ctx.restore();
}

/**
 * A RETURN AIR GRILLE.
 *
 * The return has to end in something or it is a line that stops in a hallway.
 * A plain rectangle with a hatch, which is what a return grille is drawn as,
 * and kept light so it stays secondary to the supply.
 */
export function drawReturnGrille(ctx, at, { colour = '#6E7486', w = 17, h = 13 } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let y = -h / 2 + 3; y < h / 2; y += 3) {
    ctx.moveTo(-w / 2 + 1.5, y); ctx.lineTo(w / 2 - 1.5, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** The numbered badge tying a space on the plan back to the zone schedule. */
export function drawZoneBadge(ctx, at, { index, colour }) {
  ctx.save();
  ctx.beginPath(); ctx.arc(at.x, at.y, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = colour; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
  ctx.font = '800 11px -apple-system, system-ui, sans-serif';
  ctx.fillStyle = '#0c0c1e';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(index ?? ''), at.x, at.y + 0.5);
  ctx.restore();
}

/**
 * THE WHOLE INSTALLER DRAWING.
 *
 * Order matters and is the order a draughtsman works in: zone wash, then the
 * ducts heaviest first so a main never paints over the final beside it, then
 * the fittings, then the text on top of all of it.
 */
/**
 * The clear gap the drawing keeps between two parallel return ducts, on top of
 * their own width. Two runs that touch read as one run.
 */
const RETURN_SEPARATION_PX = 14;

export function drawFlexDesign(ctx, view) {
  const { routes, outlets, markers, plenum, zoneFillByRoomId, rooms, dampers,
          toScreen, pxPerMm, labelDetail } = view;
  // EVERY SYMBOL ON THIS DRAWING COMES OUT OF THE SHARED LIBRARY.
  //
  // The plan editor, Clean View, the internal report and the PDF all render
  // through this function, and this function draws nothing itself — it asks
  // symbols.mjs. That is what stops a BTO being a metal box on one surface and
  // a grey circle on another.
  const ledger = SYM.createLabelLedger();

  // ── 1. NO ZONE WASH ─────────────────────────────────────────────────────
  //
  // Nick's drawing rule: "ZONES MUST NOT BE SHOWN BY COLOURING THE ENTIRE DUCT
  // NETWORK. Instead, show ZONING by zone dampers clearly shown on the drawing,
  // each damper labelled with its zone." Colouring the ROOMS instead was the
  // same idea wearing a different coat, and it was worse: these boundaries are
  // rectangles derived from a printed room size, so on a brochure plan the
  // colour sat NEXT TO the rooms rather than on them. Pastel blocks that do not
  // line up with any wall is the opposite of a professional sheet.
  //
  // Zoning is on the drawing, on the dampers, where the motor goes.
  if (view.zoneWash && rooms) {
    for (const room of rooms) {
      const z = room.boundaryPx && zoneFillByRoomId?.[room.id];
      if (!z) continue;
      const p = toScreen(room.boundaryPx);
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = z.fill;
      ctx.fillRect(p.x, p.y, room.boundaryPx.w * view.scale, room.boundaryPx.h * view.scale);
      ctx.restore();
    }
  }

  // ── 2. The ducts ────────────────────────────────────────────────────────
  const runs = Object.values(routes || {})
    .filter(r => r.points && r.points.length >= 2)
    .map(r => {
      const role = SYM.ductRole(r);
      return { ...r, symbolRole: role, screen: r.points.map(toScreen),
               widthPx: SYM.ductWidthPx(r.diameterMm, pxPerMm,
                                        { role, scale: view.scale || 1 }) };
    })
    .sort((a, b) => b.widthPx - a.widthPx);

  // ── THE EQUIPMENT ASSEMBLY ──────────────────────────────────────────────
  //
  // SUPPLY AND RETURN ARE TWO SEPARATE AIR PATHS AND THE DRAWING HAS TO SAY SO.
  //
  // The router gives every main and every return the fan coil's own centre as
  // an endpoint, because that is where the unit is. Drawn literally, all five
  // ducts met at one point and the return looked plumbed into the supply — Nick:
  // "That is unacceptable even if the underlying data model is separate."
  //
  // So the drawing builds the real arrangement — RETURN PLENUM → FCU → SUPPLY
  // PLENUM, three boxes bolted together — and anchors each duct to ITS OWN
  // COLLAR on the right box. Three mains leave three separate ø400 supply
  // collars; two returns land on two separate ø400 return collars. No duct
  // shares an endpoint with another and no return endpoint exists anywhere on
  // the supply side of the unit.
  //
  // The sides are not hardcoded: the assembly axis comes from the mean bearing
  // of the mains, snapped to a quarter turn so the unit sits square on the
  // sheet, and the return plenum is the opposite face by construction.
  //
  // THIS IS GEOMETRY FOR THE EYE ONLY. Lengths, pressure, airflow and the
  // schedule all come from the engine and are untouched — the last few pixels of
  // a run are moved so the picture stops lying about what is connected to what.
  const equip = (() => {
    if (!plenum || plenum.x === undefined) return null;
    const u = toScreen(plenum);
    const meanBearing = (angles) => {
      if (!angles.length) return null;
      const x = angles.reduce((n, a) => n + Math.cos(a), 0) / angles.length;
      const y = angles.reduce((n, a) => n + Math.sin(a), 0) / angles.length;
      return (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) ? angles[0] : Math.atan2(y, x);
    };
    const atUnit = (pt) => Math.hypot(pt.x - u.x, pt.y - u.y) < 26;
    const supplyRuns = runs.filter(r => r.symbolRole === 'main' && atUnit(r.screen[0]));
    const retRuns = runs.filter(r => r.symbolRole === 'return' &&
      (atUnit(r.screen[r.screen.length - 1]) || atUnit(r.screen[0])));
    if (!supplyRuns.length && !retRuns.length) return null;

    const outward = (run) => {
      const a = atUnit(run.screen[0]) ? run.screen : run.screen.slice().reverse();
      const q = a.find(pt => Math.hypot(pt.x - u.x, pt.y - u.y) > 18) || a[a.length - 1];
      return Math.atan2(q.y - u.y, q.x - u.x);
    };
    const supplyBearing = meanBearing(supplyRuns.map(outward));
    const returnBearing = meanBearing(retRuns.map(outward));
    // THE UNIT IS DRAWN AT THE SIZE IT IS.
    //
    // A fixed 46 px body was two thirds of a metre at one zoom and three and a
    // half at another, and at whole-house zoom the assembly swallowed Main C's
    // fitting whole. A ducted fan coil is about 1.25 m long and 0.6 m deep, so
    // where the plan has a scale the symbol is drawn to it — clamped at both
    // ends, because a symbol too small to read is no more use than one that
    // covers the house.
    const ppm = (pxPerMm || 0) * (view.scale || 1);
    const sized = (mm, lo, hi) => ppm ? Math.max(lo, Math.min(hi, mm * ppm)) : (lo + hi) / 2;
    const widest = (list) => list.reduce((n, r) => Math.max(n, r.widthPx || 0), 8);
    const geom = SYM.equipmentAssembly({
      at: u,
      supplyBearing: supplyBearing !== null ? supplyBearing
        : (returnBearing !== null ? returnBearing + Math.PI : 0),
      supplyCollars: supplyRuns.length,
      returnCollars: retRuns.length,
      fcuW: sized(1250, 28, 58),
      // THE DISCHARGE FACE IS THE REAL ONE WHERE THE DESIGN KNOWS IT. The
      // plenum's throat is that face, so a flange the design has on file is
      // what the taper starts from rather than a nominal unit depth.
      fcuH: sized(view.supplyPlenum?.flangeWidthMm || 600, 15, 32),
      // Pitch and collar width from the ducts that actually land on each face.
      // The RETURN pitch is deliberately wider than the ducts. Two ø400 returns
      // pitched a whisker apart ran down the same corridor overlapping each
      // other and read as one dashed spine — Nick: "The PDF still makes R1 and
      // R2 appear to merge into one dashed central return spine." A clear gap
      // between them is what makes two ducts look like two ducts.
      supplyPitch: widest(supplyRuns) + 1,
      returnPitch: widest(retRuns) + RETURN_SEPARATION_PX,
      supplyCollarWidth: Math.max(7, widest(supplyRuns) + 1.5),
      returnCollarWidth: Math.max(7, widest(retRuns) + 1.5)
    });

    // ONE DUCT, ONE COLLAR, AND THEY DO NOT CROSS EACH OTHER GETTING THERE.
    //
    // Each run is ranked by how far ACROSS the assembly axis it leaves, and the
    // collars are ranked the same way along the face. Pairing the two in order
    // means the duct heading furthest one way takes the collar furthest that
    // way — which is what stops three mains leaving one plenum and immediately
    // swapping over each other.
    const assign = (list, collars) => {
      const acr = (run) => {
        const b = outward(run);
        return Math.cos(b) * geom.across.x + Math.sin(b) * geom.across.y;
      };
      const order = list.map((r, i) => ({ r, i, k: acr(r) }))
        .sort((a, b) => a.k - b.k || a.i - b.i);
      const seats = collars.slice().sort((a, b) => a.across - b.across);
      // KEYED ON THE RUN OBJECT, NOT ON ITS id. The route overlay does not give
      // every run an id, so three mains keyed by `undefined` collapsed into one
      // entry and all three came out of the same collar — which is exactly the
      // single shared endpoint this whole arrangement exists to abolish.
      const out = new Map();
      order.forEach((entry, n) => { if (seats[n]) out.set(entry.r, seats[n]); });
      return out;
    };
    const supplySeat = assign(supplyRuns, geom.supply.collars);
    const returnSeat = assign(retRuns, geom.return.collars);

    // Anything inside the assembly's own footprint is a point the router put at
    // the unit's centre. Dropping those before re-anchoring is what keeps a
    // re-anchored run from doubling back through the fan coil to reach a collar.
    const insideAssembly = (pt) => {
      const b = geom.bounds;
      return pt.x >= b.x - 2 && pt.x <= b.x + b.w + 2
          && pt.y >= b.y - 2 && pt.y <= b.y + b.h + 2;
    };

    return { u, geom, supplyRuns, retRuns, supplySeat, returnSeat, atUnit,
             insideAssembly, supplyBearing, returnBearing,
             supplyAt: { x: geom.supply.x, y: geom.supply.y },
             returnAt: { x: geom.return.x, y: geom.return.y } };
  })();

  // Re-anchor: a main starts at its own supply collar, a return ends at its own
  // return collar. Nothing else moves.
  if (equip) {
    const tipOf = (seat) => ({
      x: seat.x + Math.cos(seat.angle) * SYM.ASSEMBLY.collarLength,
      y: seat.y + Math.sin(seat.angle) * SYM.ASSEMBLY.collarLength });
    for (const r of equip.supplyRuns) {
      const seat = equip.supplySeat.get(r);
      if (!seat) continue;
      const tip = tipOf(seat);
      const rest = r.screen.filter(pt => !equip.insideAssembly(pt));
      let tail = rest.length ? rest : r.screen.slice(1);
      const lead = SYM.routeOutOfAssembly(equip.geom, tip, seat.angle, tail[0], 12, r.widthPx);
      // WHEN THE RUN HAD TO GO ROUND, IT DOES NOT DOUBLE BACK.
      //
      // The router's own sweep still approaches from the fan coil's centre. Kept
      // after a diversion, the run went out round the unit and then turned back
      // along that sweep — which put Main C's inlet collar on the north-west
      // face of BTO-C, seven pixels from a RETURN collar, reading as the two
      // being plumbed together. Once the route has gone round, it goes straight
      // to the fitting from where it got to.
      if (lead.length > 1) tail = [tail[tail.length - 1]];
      r.screen = [tip, ...lead, ...tail];
      r.collar = seat;
    }
    // ── R1 AND R2 STAY TWO DUCTS THE WHOLE WAY ──────────────────────────
    //
    // The router sends both returns to the fan coil's own centre, so their
    // approaches lie on top of one another and the drawing showed one wide
    // dashed run with a second hiding under it. Re-anchoring the last point to
    // separate collars fixed the ENDS and nothing else.
    //
    // So each return is shifted sideways onto its own collar's line for the
    // whole of its approach, and eased back onto the router's route as it
    // nears its grille — which is where it has to be, because the grille is a
    // real hole in a real ceiling. Two ø400 flexes run side by side in a
    // hallway in exactly this way; the offset is about 350 mm on this plan.
    const easeFrom = SYM.ASSEMBLY.collarLength * 3 + 40;
    for (const r of equip.retRuns) {
      const seat = equip.returnSeat.get(r);
      if (!seat) continue;
      const tip = tipOf(seat);
      const toUnitEnd = Math.hypot(r.screen[r.screen.length - 1].x - equip.u.x,
                                   r.screen[r.screen.length - 1].y - equip.u.y)
                      < Math.hypot(r.screen[0].x - equip.u.x, r.screen[0].y - equip.u.y);
      const rest = r.screen.filter(pt => !equip.insideAssembly(pt));
      const tail = rest.length ? rest
        : (toUnitEnd ? r.screen.slice(0, -1) : r.screen.slice(1));
      const lead = SYM.routeOutOfAssembly(equip.geom, tip, seat.angle,
                                          toUnitEnd ? tail[tail.length - 1] : tail[0],
                                          12, r.widthPx);
      // The grille end is fixed; everything between it and the collar slides
      // across onto this duct's own line, easing off over the last stretch.
      const grille = toUnitEnd ? tail[0] : tail[tail.length - 1];
      const across = equip.geom.across;
      const shifted = tail.map(pt => {
        const d = Math.hypot(pt.x - grille.x, pt.y - grille.y);
        const f = Math.max(0, Math.min(1, (d - easeFrom * 0.35) / easeFrom));
        return { x: pt.x + across.x * seat.across * f,
                 y: pt.y + across.y * seat.across * f };
      });
      r.screen = toUnitEnd
        ? [...shifted, ...lead.slice().reverse(), tip]
        : [tip, ...lead, ...shifted];
      r.collar = seat;
    }
  }

  // ── THE BTO BODIES, BEFORE A SINGLE DUCT IS DRAWN ───────────────────────
  //
  // Nick: "Duct lines must stop at the collar face, not run through the body."
  // That cannot be done after the fact — the run has to be trimmed BEFORE it is
  // stroked, so the fitting geometry is worked out here and the ducts are cut
  // back to their collar tips. It also means the collar count and directions
  // come off the topology rather than off a guess: a five-port BTO ends up with
  // five outlet collars pointing where its five ducts go, and they can be
  // counted off the sheet.
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 14;
  const btoDraws = [];
  for (const m of (markers || [])) {
    if (m.type !== 'bto' && !(m.type === 'junction' && m.bto)) continue;
    // A TAKE-OFF SYMBOL IS SUPPLY-ONLY. Two return ducts meeting at the fan coil
    // look, geometrically, exactly like a manifold, and a marker that drifted
    // onto the return path used to get a BTO symbol drawn over the grille. It is
    // not a take-off: air goes the other way, there is no spigot and nobody
    // orders one. Anything flagged as return is skipped here whatever its type.
    if (m.airSide === 'return' || m.isReturn || m.role === 'return') continue;
    const at = toScreen(m);
    const outs = [], outRuns = [];
    let inletAngle = null, inletMm = null, inletRun = null;
    for (const run of runs) {
      if (run.symbolRole === 'return') continue;
      const a = run.screen[0], z = run.screen[run.screen.length - 1];
      if (near(a, at)) {
        const q = run.screen[1] || z;
        outs.push(Math.atan2(q.y - a.y, q.x - a.x));
        outRuns.push(run);
      } else if (near(z, at)) {
        const q = run.screen[run.screen.length - 2] || a;
        inletAngle = Math.atan2(q.y - z.y, q.x - z.x);
        inletMm = run.diameterMm ?? null;
        inletRun = run;
      }
    }
    if (!outs.length && inletAngle === null) continue;
    const g = SYM.btoGeometry({ at, inletAngle, outletAngles: outs,
                                inletMm, outletMm: outRuns.map(r => r.diameterMm ?? null),
                                scale: Math.max(0.85, Math.min(1.35, view.scale || 1)) });
    // Cut each duct back to the collar face it lands on.
    outRuns.forEach((run, i) => {
      const c = g.outlets[i];
      if (c) run.screen = [c.tip, ...run.screen.slice(1)];
    });
    if (inletRun && g.inlet) {
      inletRun.screen = [...inletRun.screen.slice(0, -1), g.inlet.tip];
    }
    btoDraws.push({ marker: m, geometry: g });
  }

  // ── WHERE THE TWO SYSTEMS CROSS ─────────────────────────────────────────
  // A gap in the return with the supply passing over it. Never a junction dot:
  // a dot is what a JOINT looks like, and the whole point is that these do not
  // join. The return is drawn first and broken; the supply runs over it whole.
  const supplyRuns = runs.filter(r => r.symbolRole !== 'return');
  const crossings = [];
  for (const r of runs) {
    if (r.symbolRole !== 'return') continue;
    // EACH CROSSING CARRIES THE SIZE OF WHAT IT HAS TO CLEAR. The gap used to be
    // cut to the RETURN's own width, so a return crossing a ø400 main was cut
    // too narrow to see and the two read as touching.
    r.crossings = supplyRuns.flatMap(s => SYM.findCrossings(r.screen, s.screen).map(c => {
      const hop = (s.widthPx || 8) / 2 + (r.widthPx || 8) / 2 + 2;
      return { ...c, hopR: hop, gapPx: hop * 2, width: Math.max(2, (r.widthPx || 8) * 0.42) };
    }));
    crossings.push(...r.crossings);
  }

  // Widest first, so a main is never drawn over the top of a final that crosses
  // it — the heavier run should sit under, the way it does in a real ceiling.
  // Returns go down first, so the supply can bridge over them.
  for (const run of runs.filter(r => r.symbolRole === 'return')) {
    const gap = run.widthPx + 10;      // the fallback; each break sizes its own
    for (const piece of SYM.breakAround(run.screen, run.crossings || [], gap)) {
      SYM.drawDuctRun(ctx, piece, {
        diameterMm: run.diameterMm, role: 'return', widthPx: run.widthPx,
        selected: view.selectedId === run.id, warning: !!run.warning
      });
    }
    // Which way the air is going — toward the unit, the opposite of everything
    // else on the sheet.
    if (view.flowArrows !== false) {
      // WHICH END IS THE UNIT, AFTER RE-ANCHORING. `atUnit` tested a 26 px
      // radius around the fan coil's centre, which was true when every return
      // ended there — it now ends on a collar 35 px out, so the test came back
      // false and every arrow on the sheet pointed the wrong way. The honest
      // question is which END is nearer the assembly, and that stays true
      // however far the collars sit from the centre.
      const toUnit = equip
        ? Math.hypot(run.screen[run.screen.length - 1].x - equip.u.x,
                     run.screen[run.screen.length - 1].y - equip.u.y)
          < Math.hypot(run.screen[0].x - equip.u.x, run.screen[0].y - equip.u.y)
        : true;
      SYM.drawFlowArrow(ctx, run.screen, { fraction: 0.55, reverse: !toUnit,
                                           colour: SYM.RETURN_COLOUR, size: 6 });
      SYM.drawFlowArrow(ctx, run.screen, { fraction: 0.85, reverse: !toUnit,
                                           colour: SYM.RETURN_COLOUR, size: 6 });
    }
  }
  for (const run of runs.filter(r => r.symbolRole !== 'return')) {
    SYM.drawDuctRun(ctx, run.screen, {
      diameterMm: run.diameterMm,          // SIZE is the colour, never the zone
      role: run.symbolRole,
      widthPx: run.widthPx,
      selected: view.selectedId === run.id,
      warning: !!run.warning
    });
  }
  for (const c of crossings) {
    SYM.drawCrossingBridge(ctx, c, { angle: c.angle, r: c.hopR ?? 6, width: c.width ?? 2.4 });
  }

  // ── EVERY SYMBOL BOOKS ITS GROUND BEFORE ANY LABEL IS PLACED ────────────
  //
  // Nick: "Treat all of these as reserved obstacles: fan coil symbol; supply
  // plenum; return box; BTO symbols; outlet symbols; other labels; important
  // plan text; walls where practical."
  //
  // Reserving as each symbol is drawn is not enough, and this is the subtle
  // part: a symbol drawn LATE has not booked its ground when an EARLY label is
  // placed, so the label picks a spot that is clear at the time and is then
  // drawn over. BTO-C's spec landed on the fan coil for exactly that reason.
  // One pass up front, before a single label exists, is what makes the
  // least-overlap scoring mean anything.
  // EACH BOX MUST BE AT LEAST AS BIG AS THE ONE ITS SYMBOL WILL BOOK LATER.
  //
  // The sizes below are deliberately a shade larger than what the symbol
  // functions reserve for themselves. Reserving LESS here leaves an unclaimed
  // ring around each symbol at the moment labels are placed, and a label will
  // happily sit in it — which is how a size label came to clip an outlet by a
  // pixel and a half even with the placer working correctly.
  // THE RUNS BOOK THEIR INK FIRST OF ALL.
  //
  // A duct is a line, not a rectangle: the bounding box of one diagonal run
  // covers a quarter of the house, so runs were never in the ledger at all and
  // labels sat straight across them. Stamped into the ledger's occupancy grid
  // they cost what they actually cover — and supply and return are stamped
  // apart, so a label pays extra for crossing to the other system's side.
  for (const r of runs) {
    if (!r.screen || r.screen.length < 2) continue;
    ledger.route(r.screen, (r.widthPx || 4) / 2 + 1,
                 (r.role === 'return' || r.symbolRole === 'return') ? 'return' : 'supply');
  }

  if (equip) {
    // THE WHOLE ASSEMBLY, IN ONE BOX, WITH ROOM FOR ITS OWN LABELS. Nick:
    // "Reserve enough space around the assembly for labels before routing
    // ducts." Three separate reservations for three boxes left the seams
    // between them unclaimed, and a duct size settled in one of them.
    const b = equip.geom.bounds;
    ledger.reserve(b.cx, b.cy, b.w + 26, b.h + 26);
  } else if (plenum && plenum.x !== undefined) {
    const u0 = toScreen(plenum);
    ledger.reserve(u0.x, u0.y, 70, 38);
  }
  // The BTO bodies book exactly what they occupy — body plus the longest collar
  // in every direction — rather than a guessed rectangle. The geometry is
  // already worked out, so there is nothing left to estimate.
  for (const { geometry } of btoDraws) {
    ledger.reserve(geometry.at.x, geometry.at.y,
                   geometry.clearPx * 2 + 6, geometry.clearPx * 2 + 6);
  }
  for (const o of (outlets || [])) {
    const at0 = toScreen(o);
    ledger.reserve(at0.x, at0.y, 26, 26);                              // diffuser
  }
  for (const d of (dampers || [])) {
    if (d.airSide === 'return' || d.isReturn || d.role === 'return') continue;
    const at0 = toScreen(d);
    // BODY + ACTUATOR + SHAFT. It must be at least as big as what the symbol
    // books for itself later (`reach` + 6, up to 46 px) — reserving less leaves
    // an unclaimed ring at the moment labels are placed, and a label sits in it.
    ledger.reserve(at0.x, at0.y, 46, 46);
  }
  // Return grilles sit at the far end of each return run.
  for (const r of runs.filter(x => x.symbolRole === 'return')) {
    const far = r.screen[r.screen.length - 1], first = r.screen[0];
    const anchor = equip ? equip.u : null;
    const g = (anchor && Math.hypot(far.x - anchor.x, far.y - anchor.y) >
                         Math.hypot(first.x - anchor.x, first.y - anchor.y)) ? far : first;
    ledger.reserve(g.x, g.y, 34, 28);
  }

  // ── 3. Fittings ─────────────────────────────────────────────────────────
  //
  // The bodies and their collars were worked out before the ducts were stroked,
  // so every run already stops at the collar face it lands on. All that is left
  // is to put the metal on top of those roots and label it.
  for (const { marker: m, geometry } of btoDraws) {
    SYM.drawBto(ctx, geometry.at, {
      geometry,
      // ONE LINE, NOT THREE. `BTO-C · 400-350-350` is the brief's own format
      // and says what the fitting is and what it is made of in a single strip.
      // Stacking the identity, the spec and the airflow put fifteen labels on a
      // five-fitting drawing. The airflow joins it only at full detail, because
      // the schedule carries it anyway.
      label: view.labelFittings === false ? null
        : (m.btoLabel && m.btoSpec ? m.btoLabel + ' · ' + m.btoSpec
           : (m.btoLabel || null)),
      spec: null,
      flow: view.labelFittings === false || view.labelDetail !== 'full' ? null
        : (m.inletAirflowLs ? SYM.LABEL.flow(m.inletAirflowLs) : null),
      // CLOSE-ZOOM DETAIL, per collar: the size it is, the air it carries and
      // the zone it feeds. Only at full detail — at whole-house zoom five
      // fittings' worth of this would bury the plan.
      detail: view.labelFittings === false || view.labelDetail !== 'full' ? null
        : geometry.outlets.map((c, i) => {
            const port = (m.btoPorts || [])[i] || null;
            const bits = [c.diameterMm ? SYM.LABEL.size(c.diameterMm) : null,
                          port?.airflowLs != null ? SYM.LABEL.flow(port.airflowLs) : null,
                          port?.zone || null].filter(Boolean);
            return bits.length ? { index: i, text: bits.join(' · ') } : null;
          }).filter(Boolean),
      selected: view.selectedId === m.id,
      warning: !!m.warning,
      ledger
    });
  }

  // Each outlet as the TYPE the design actually selected, with its own number,
  // room and airflow beside it rather than repeated along the duct.
  (outlets || []).forEach((o, i) => {
    const at = toScreen(o);
    SYM.drawOutletSymbol(ctx, at, {
      type: o.outletType || view.outletType || 'square',
      angle: o.angle ?? 0,
      selected: view.selectedId === o.sectionId,
      ledger
    });
    if (view.labelOutlets !== false && (o.label || o.airflowLs != null)) {
      // THE ROOM NAME IS ALREADY PRINTED ON THE PLAN.
      //
      // Nick's label rules ask for `O3 · FAMILY · 121 L/s`, and his drawing
      // conventions say "Do not duplicate room names already printed on the
      // floor plan." Both are right, for different surfaces: the SCHEDULE has
      // no plan underneath it and wants the room, the DRAWING sits on a builder's
      // sheet that already says FAMILY in 14pt. Repeating it doubled the width
      // of ten labels and buried the middle of the house.
      //
      // So the drawing says `O3 · 121 L/s` and the schedule says the rest. The
      // full form is still one press away on the detail control.
      const full = view.labelDetail === 'full';
      SYM.drawLabel(ctx,
        full ? SYM.LABEL.outlet(o.number ?? (i + 1), o.label, o.airflowLs)
             : SYM.LABEL.outlet(o.number ?? (i + 1), null, o.airflowLs),
        { x: at.x, y: at.y + 17 }, { size: 9.5, ledger });
    }
  });

  // ZONE DAMPERS, in the ductwork. One per closable zone, on the run that feeds
  // that zone and nothing else — a motor somebody buys, fits and wires, so it
  // belongs on the drawing at the place they fit it.
  (dampers || []).forEach((d, i) => {
    // NEVER ON A RETURN. A zone damper on the return does not balance a room,
    // it starves the fan coil, and one drawn there would be one fitted there.
    if (d.airSide === 'return' || d.isReturn || d.role === 'return') return;
    const at = toScreen(d);
    // THE SYMBOL SITS IN THE DUCT, SO IT TAKES THE DUCT'S OWN DIRECTION AND
    // WIDTH — measured off the run it is actually fitted in, at the point it is
    // fitted, rather than trusting an angle stored when the damper was placed.
    // On a swept ø250 final that angle is only right at one point on the curve.
    const host = runs.find(r => r.id === d.sectionId && r.symbolRole !== 'return')
      || runs.filter(r => r.symbolRole !== 'return')
             .map(r => ({ r, k: Math.min(...r.screen.map(p => Math.hypot(p.x - at.x, p.y - at.y))) }))
             .sort((a, b) => a.k - b.k)[0]?.r || null;
    const tangent = (() => {
      if (!host) return d.angle ?? 0;
      let bi = 0, bk = Infinity;
      host.screen.forEach((p, n) => {
        const k = Math.hypot(p.x - at.x, p.y - at.y);
        if (k < bk) { bk = k; bi = n; }
      });
      const a = host.screen[Math.max(0, bi - 1)];
      const z = host.screen[Math.min(host.screen.length - 1, bi + 1)];
      return (a === z) ? (d.angle ?? 0) : Math.atan2(z.y - a.y, z.x - a.x);
    })();
    SYM.drawZoneDamper(ctx, at, {
      angle: tangent,
      ductWidthPx: host?.widthPx ?? null,
      diameterMm: d.diameterMm ?? host?.diameterMm ?? null,
      pxPerMm: pxPerMm || 0,
      scale: Math.max(0.85, Math.min(1.35, view.scale || 1)),
      colour: d.colour || '#1D7A48',
      // `ZM-3 · BEDROOMS` — the motor's own number and the zone it closes.
      label: view.labelDampers === false ? null
        : SYM.LABEL.zoneMotor(d.motorNumber ?? (i + 1), d.zoneLabel || d.label || null),
      // A permanently open zone is ANNOTATED, never given a motor it has not got.
      constant: !!d.constant || !!d.alwaysOpen,
      ledger
    });
  });
  // A RETURN ENDS IN A GRILLE. Without one the return was a dashed line that
  // stopped in the middle of a hallway for no visible reason.
  const returnRuns = runs.filter(r => r.symbolRole === 'return');
  returnRuns.forEach((run, i) => {
    const far = run.screen[run.screen.length - 1];
    const first = run.screen[0];
    // The grille is the end AWAY from the unit; the other end is the return box.
    const anchor = equip ? equip.u : (plenum ? toScreen(plenum) : null);
    const grille = (anchor && Math.hypot(far.x - anchor.x, far.y - anchor.y) >
                              Math.hypot(first.x - anchor.x, first.y - anchor.y)) ? far : first;
    const g = (view.returnGrilles || [])[i] || null;
    SYM.drawReturnGrilleSymbol(ctx, grille, {
      // Real proportions where the design knows them.
      w: g?.widthMm ? Math.max(16, Math.min(34, g.widthMm / 26)) : 22,
      h: g?.heightMm ? Math.max(10, Math.min(24, g.heightMm / 26)) : 15,
      label: view.labelReturns === false ? null
        : SYM.LABEL.returnGrille(g?.id || ('R' + (i + 1)), g?.widthMm, g?.heightMm,
                                 run.diameterMm),
      duct: view.labelReturns === false || view.labelDetail !== 'full'
        || g?.airflowLs == null ? null : SYM.LABEL.flow(g.airflowLs),
      selected: view.selectedId === (g?.id || null),
      ledger
    });
  });

  // ── THE EQUIPMENT, AS ONE ASSEMBLED ARRANGEMENT ─────────────────────────
  //
  // RETURN PLENUM → FCU → SUPPLY PLENUM, drawn from the geometry that already
  // anchored every duct. Three separate things, bolted together, each with the
  // collars of the ducts that really land on it — so the supply plenum shows one
  // ø400 spigot per main and the return plenum shows one ø400 inlet per return
  // duct, and neither can show the other's.
  if (equip) {
    SYM.drawEquipmentAssembly(ctx, equip.geom, {
      unitModel: view.labelEquipment === false ? null : (view.unitModel || null),
      labels: view.labelEquipment !== false,
      returnLabel: view.showReturnBox === false ? null : 'RETURN PLENUM',
      selectedId: view.selectedId,
      ledger
    });
  }

  // ── 4. Sizes, written on the ducts ──────────────────────────────────────
  // A main always carries its size — it is the spine, and it changes along its
  // length. A final carries one only where it is not already obvious: one per
  // SIZE per main, not one per run, or twelve bedrooms all say ø200.
  if (labelDetail !== 'hide') {
    // Every SYMBOL already on the drawing books its patch before a single size
    // is written. Sizes were landing on the fan coil and on diffusers because
    // only other sizes were being avoided.
    // ONE LEDGER FOR THE WHOLE SHEET.
    //
    // Every symbol already booked its patch through the shared library as it was
    // drawn, and so did every symbol label. Seeding from that record is what
    // stops a duct size being written across a diffuser, a BTO spec or the fan
    // coil — the sizes were only avoiding OTHER SIZES before, which is why they
    // kept landing on the equipment.
    // THE SIZES GO IN THE SAME LEDGER AS EVERYTHING ELSE.
    //
    // They used to keep a private `placed` list, seeded from the ledger but
    // never written back — so a duct size avoided every symbol and then the NEXT
    // label, placed through the library, could not see it and sat on top. The
    // return size and BTO-C's spec ended up written over one another for exactly
    // that reason, and the collision test could not see it either because only
    // ledger entries are measured. One list, one test, no blind spot.
    const clear = (x, y, w, h) => {
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      return ledger.overlap(box) === 0;
    };

    const seenFinal = new Set();
    // Two identical returns do not need saying twice. One label, carrying the
    // count, on the longer of them.
    const returns = runs.filter(r => r.role === 'return');
    const lengthOf = (r) => alongPath(r.screen, 1)?.totalPx || 0;
    const labelledReturn = returns.length
      ? returns.reduce((a, b) => (lengthOf(b) > lengthOf(a) ? b : a))
      : null;

    for (const run of runs) {
      if (!run.diameterMm) continue;
      const isMain = run.role === 'main' || run.role === 'trunk';
      const isReturn = run.role === 'return';
      if (isReturn && run !== labelledReturn) continue;
      if (!isMain && !isReturn) {
        const key = (run.mainKey || '') + ':' + run.diameterMm;
        if (seenFinal.has(key)) continue;
        seenFinal.add(key);
      }
      // Try a few points along the run before giving up: a size dropped because
      // one spot was busy is a size nobody can read anywhere.
      const width = ((isReturn ? 'RETURN 2 × ø000' : 'ø' + run.diameterMm).length) * 6 + 4;
      let at = null;
      // Try harder before giving up. A size dropped because one spot was busy
      // is a size nobody can read anywhere, and half the runs on this drawing
      // came out unlabelled for the sake of one collision.
      //
      // First along the duct, where a size belongs. Then, only if every point
      // along it is taken, STEPPED OFF the duct — the way a draughtsman moves a
      // dimension clear rather than dropping it. The size still sits against
      // its own run, just beside it instead of on it.
      const offsets = [0, run.widthPx / 2 + 8, -(run.widthPx / 2 + 8),
                       run.widthPx / 2 + 16, -(run.widthPx / 2 + 16)];
      const spots = isReturn ? [0.75, 0.86, 0.62, 0.5, 0.35]
                   : isMain ? [0.55, 0.38, 0.72, 0.25, 0.85, 0.48, 0.65, 0.3]
                            : [0.6, 0.42, 0.78, 0.5, 0.68, 0.34, 0.88];
      for (const off of (isReturn ? [0, 14, -14, 22, -22] : offsets)) {
        for (const f of spots) {
          const p = alongPath(run.screen, f);
          if (!p) continue;
          const nx = -Math.sin(p.angle) * off;
          const ny = Math.cos(p.angle) * off;
          if (clear(p.x + nx, p.y + ny, width, 12)) {
            at = { ...p, x: p.x + nx, y: p.y + ny };
            break;
          }
        }
        if (at) break;
      }
      // THE RETURN SIZE IS NOT OPTIONAL. Two short hallway drops beside the fan
      // coil have nowhere clear to put a label, and the drawing came out with
      // no return size on it at all. It is set beside the run and takes its
      // chances with the crowding, because a size that is missing is worse than
      // a size that is close to something else.
      if (!at && isReturn) {
        const p = alongPath(run.screen, 0.8);
        if (p) at = { ...p, x: p.x - Math.sin(p.angle) * 16, y: p.y + Math.cos(p.angle) * 16 };
      }
      if (!at) continue;
      // Too short to write on without the text overhanging both ends.
      // `RETURN ø400` — the brief's own format. It used to carry a count
      // ("RETURN 2 × ø400"), which described the system rather than the run it
      // was written on, and made the widest label on the sheet the return.
      const text = isReturn ? SYM.LABEL.returnDuct(run.diameterMm)
                            : 'ø' + run.diameterMm;
      // A RETURN ALWAYS CARRIES ITS SIZE, however short its run. Two short
      // hallway drops are exactly the right answer, and they left the drawing
      // with no return size on it at all.
      if (!isReturn && at.totalPx < width * 0.7) continue;
      // THE RETURN DOES NOT SHOUT. Nick: "Do not let return text dominate the
      // drawing." It was set in the same weight as a main and sat across the
      // middle of the house.
      // Placed through the library so it books its ground like every other
      // label, at the smaller type the whole sheet now uses.
      SYM.drawLabel(ctx, text, at, {
        ledger,
        size: isReturn ? 7 : isMain ? 8.5 : 7.5,
        colour: isReturn ? SYM.RETURN_COLOUR : SYM.INK,
        // It has already been fitted to a clear stretch of its own duct; a
        // leader from a duct to its own size label would be noise.
        leader: false,
        role: isReturn ? 'return' : 'supply'
      });
    }
  }

  // ── WHAT WAS ACTUALLY DRAWN ─────────────────────────────────────────────
  //
  // Returned so the drawing can be TESTED rather than only looked at. The
  // re-anchoring happens in here, on a local copy of the geometry, so a test
  // reading the design model would see the router's endpoints and not the ones
  // on screen — which is precisely the thing that has to be checked: that no
  // return duct ends where a supply duct begins.
  return {
    // ── WHAT THE DRAWING ACTUALLY PUT ON THE SHEET ──────────────────────
    //
    // The model has always been right about the supply and the return being
    // separate; the DRAWING is what had to be proved. So the renderer hands
    // back the arrangement it built — face positions, collar points, body
    // sizes — and the regression tests assert against that rather than against
    // the engine, which would have passed either way.
    equipment: equip ? (() => {
      const g = equip.geom;
      const pt = (p) => ({ x: p.x, y: p.y });
      return {
        angle: g.angle,
        fanCoil: { ...pt(g.fcu), w: g.fcu.w, h: g.fcu.h },
        supplyPlenum: { ...pt(g.supply), w: g.supply.w, h: g.supply.h,
                        innerFace: pt(g.supply.innerFace), outerFace: pt(g.supply.outerFace),
                        collars: g.supply.collars.map(c => ({ ...pt(c), angle: c.angle })) },
        returnPlenum: { ...pt(g.return), w: g.return.w, h: g.return.h,
                        innerFace: pt(g.return.innerFace), outerFace: pt(g.return.outerFace),
                        collars: g.return.collars.map(c => ({ ...pt(c), angle: c.angle })) },
        // Kept under its old name so the earlier separation tests still read.
        returnBox: pt(g.return),
        separationPx: Math.hypot(g.supply.x - g.return.x, g.supply.y - g.return.y),
        // The gap between the two plenum bodies along the assembly axis: the
        // FCU's own width, because they are bolted to opposite faces of it.
        plenumGapPx: Math.hypot(g.supply.innerFace.x - g.return.innerFace.x,
                                g.supply.innerFace.y - g.return.innerFace.y),
        bounds: { ...g.bounds }
      };
    })() : null,
    /** Every run exactly as it was stroked, so a test can prove a duct never
     *  crosses the equipment rather than only checking its two endpoints. */
    paths: runs.map(r => ({ role: r.symbolRole, diameterMm: r.diameterMm ?? null,
                            destination: r.destination || null,
                            points: r.screen.map(pt => ({ x: pt.x, y: pt.y })) })),
    /** Every BTO body the drawing put down, with its collars. */
    btos: btoDraws.map(({ marker, geometry }) => ({
      id: marker.id || null, label: marker.btoLabel || marker.label || null,
      x: geometry.at.x, y: geometry.at.y, w: geometry.w, h: geometry.h,
      angle: geometry.angle, clearPx: geometry.clearPx,
      inlet: geometry.inlet ? { x: geometry.inlet.root.x, y: geometry.inlet.root.y,
                                tip: { x: geometry.inlet.tip.x, y: geometry.inlet.tip.y },
                                angle: geometry.inlet.angle } : null,
      collars: geometry.outlets.map(c => ({ x: c.root.x, y: c.root.y,
                                            tip: { x: c.tip.x, y: c.tip.y },
                                            angle: c.angle, diameterMm: c.diameterMm }))
    })),
    supplyEnds: runs.filter(r => r.symbolRole !== 'return')
      .map(r => ({ id: r.id, role: r.symbolRole,
                   a: { x: r.screen[0].x, y: r.screen[0].y },
                   z: { x: r.screen.at(-1).x, y: r.screen.at(-1).y } })),
    returnEnds: runs.filter(r => r.symbolRole === 'return')
      .map(r => ({ id: r.id,
                   a: { x: r.screen[0].x, y: r.screen[0].y },
                   z: { x: r.screen.at(-1).x, y: r.screen.at(-1).y },
                   crossings: (r.crossings || []).length })),
    // The hop is handed back with the point, so a test can check the bridge
    // clears the run it crosses rather than only that a crossing was found.
    crossings: crossings.map(c => ({ x: c.x, y: c.y, hopR: c.hopR, gapPx: c.gapPx })),
    /** Every box on the sheet: symbols first, then the labels placed around them. */
    boxes: ledger.all().map(bx => ({ x0: bx.x0, y0: bx.y0, x1: bx.x1, y1: bx.y1,
                                     symbol: !!bx.symbol }))
  };
}

export default drawFlexDesign;
