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

/** Screen width of a duct, from its real diameter. */
export function tubeWidthPx(diameterMm, pxPerMm, opts = {}) {
  const min = opts.minPx ?? 3.5;
  const max = opts.maxPx ?? 26;
  if (!diameterMm) return min;
  // True to scale where the scale allows it, so a 400 reads as twice a 200.
  const real = pxPerMm ? diameterMm * pxPerMm : 0;
  if (real >= min && real <= max) return real;
  // Zoomed too far out (or in) for true scale: keep the RATIO between sizes
  // rather than collapsing every duct to the same stroke.
  const t = Math.min(1, Math.max(0, (diameterMm - 150) / (450 - 150)));
  return min + t * (max - min);
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

/** Trace a run as a smooth curve. Flex does not turn corners. */
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
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

  ctx.strokeStyle = 'rgba(12,12,30,0.30)';
  ctx.lineWidth = widthPx + 3.5;
  tracePath(ctx, screenPts);
  ctx.stroke();

  ctx.strokeStyle = colour;
  ctx.lineWidth = widthPx;
  tracePath(ctx, screenPts);
  ctx.stroke();

  // A RETURN IS STILL A DUCT. Dashing the whole tube turned it into a row of
  // grey blobs lying across the house. It keeps the tube and takes a broken
  // centreline instead — the convention for "this one goes the other way" —
  // and still reads as something somebody pulls through a roof.
  if (isReturn) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.4, widthPx * 0.2);
    ctx.setLineDash([widthPx * 0.85, widthPx * 0.7]);
    tracePath(ctx, screenPts);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  // The core highlight is what makes it read as a tube rather than a fat line.
  if (widthPx >= 7) {
    ctx.strokeStyle = lighten(colour, 0.5);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1.2, widthPx * 0.26);
    tracePath(ctx, screenPts);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A size written on the duct.
 *
 * Dark text with a white halo, turned to lie along the run. No box: a box is a
 * label sitting ON a drawing, text is a label that is PART of one.
 */
export function drawDuctLabel(ctx, text, at, { angle = 0, size = 11 } = {}) {
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
  ctx.fillStyle = '#16162e';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A ceiling diffuser. */
export function drawOutlet(ctx, at, { colour = '#3b4358', r = 7 } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 2.2; ctx.strokeStyle = colour; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(at.x - r * 0.48, at.y); ctx.lineTo(at.x + r * 0.48, at.y);
  ctx.moveTo(at.x, at.y - r * 0.48); ctx.lineTo(at.x, at.y + r * 0.48);
  ctx.lineWidth = 1.3; ctx.stroke();
  ctx.restore();
}

/**
 * A branch take-off: the collar where a final leaves its main.
 *
 * Small and solid. Twelve of them must not swamp a house, but an installer
 * counting collars for the van has to be able to.
 */
export function drawTakeOff(ctx, at, { colour = '#0c0c1e', r = 4 } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = colour; ctx.stroke();
  ctx.restore();
}

/** The fan coil and its supply plenum, as one object. */
export function drawUnit(ctx, at, { w = 34, h = 24 } = {}) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.fillStyle = 'rgba(38,42,58,0.95)';
  ctx.strokeStyle = '#0c0c1e';
  ctx.lineWidth = 2;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill(); ctx.stroke(); }
  else { ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h); }
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.6;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, i * 5.5);
    ctx.lineTo(w * 0.28, i * 5.5);
    ctx.stroke();
  }
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
export function drawFlexDesign(ctx, view) {
  const { routes, outlets, markers, plenum, zoneFillByRoomId, rooms,
          toScreen, pxPerMm, labelDetail } = view;

  // ── 1. Zone wash ────────────────────────────────────────────────────────
  for (const room of (rooms || [])) {
    if (!room.boundaryPx) continue;
    const z = zoneFillByRoomId?.[room.id];
    if (!z) continue;
    const p = toScreen(room.boundaryPx);
    ctx.save();
    ctx.globalAlpha = room.boundaryDerived ? 0.42 : 0.7;
    ctx.fillStyle = z.fill;
    ctx.fillRect(p.x, p.y, room.boundaryPx.w * view.scale, room.boundaryPx.h * view.scale);
    ctx.restore();
  }

  // ── 2. The ducts ────────────────────────────────────────────────────────
  const runs = Object.values(routes || {})
    .filter(r => r.points && r.points.length >= 2)
    .map(r => ({ ...r, screen: r.points.map(toScreen),
                 widthPx: tubeWidthPx(r.diameterMm, pxPerMm) }))
    .sort((a, b) => b.widthPx - a.widthPx);

  for (const run of runs) {
    drawTube(ctx, run.screen, {
      colour: run.colour || '#5fa8ff',
      widthPx: run.widthPx,
      // A return is the other system, and must never be read as a supply run
      // whatever colour the palette gives it.
      isReturn: run.role === 'return'
    });
  }

  // ── 3. Fittings ─────────────────────────────────────────────────────────
  for (const m of (markers || [])) {
    if (m.type !== 'bto' && !(m.type === 'junction' && m.bto)) continue;
    drawTakeOff(ctx, toScreen(m));
  }
  for (const o of (outlets || [])) {
    const z = o.roomId ? zoneFillByRoomId?.[o.roomId] : null;
    drawOutlet(ctx, toScreen(o), { colour: z?.colour || '#3b4358' });
  }
  if (plenum && plenum.x !== undefined) drawUnit(ctx, toScreen(plenum));

  // ── 4. Sizes, written on the ducts ──────────────────────────────────────
  // A main always carries its size — it is the spine, and it changes along its
  // length. A final carries one only where it is not already obvious: one per
  // SIZE per main, not one per run, or twelve bedrooms all say ø200.
  if (labelDetail !== 'hide') {
    // Every SYMBOL already on the drawing books its patch before a single size
    // is written. Sizes were landing on the fan coil and on diffusers because
    // only other sizes were being avoided.
    const placed = [];
    const reserve = (pt, w, h) => {
      const c = toScreen(pt);
      placed.push({ x: c.x - w / 2, y: c.y - h / 2, w, h });
    };
    for (const o of (outlets || [])) reserve(o, 18, 18);
    for (const m of (markers || [])) {
      if (m.type === 'bto' || (m.type === 'junction' && m.bto)) reserve(m, 12, 12);
    }
    if (plenum && plenum.x !== undefined) reserve(plenum, 40, 30);

    const clear = (x, y, w, h) => {
      const box = { x: x - w / 2, y: y - h / 2, w, h };
      const hit = placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x &&
                                   box.y < b.y + b.h && box.y + box.h > b.y);
      if (!hit) placed.push(box);
      return !hit;
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
      const width = ((isReturn ? 'RETURN 2 × ø000' : 'ø' + run.diameterMm).length) * 7 + 6;
      let at = null;
      for (const f of (isMain ? [0.55, 0.38, 0.72, 0.25, 0.85] : [0.6, 0.42, 0.78])) {
        const p = alongPath(run.screen, f);
        if (p && clear(p.x, p.y, width, 15)) { at = p; break; }
      }
      if (!at) continue;
      // Too short to write on without the text overhanging both ends.
      const text = isReturn
        ? 'RETURN ' + (returns.length > 1 ? returns.length + ' × ' : '') +
          'ø' + run.diameterMm
        : 'ø' + run.diameterMm;
      if (at.totalPx < width * 0.8) continue;
      drawDuctLabel(ctx, text, at, { angle: at.angle, size: isMain ? 12 : 10.5 });
    }
  }
}

export default drawFlexDesign;
