// NAC AI HVAC DESIGNER — PART 2, 6, 7, 17, 18: the interactive plan viewer.
//
// One canvas-backed viewer serves every job the plan geometry has to do:
//   • view the uploaded plan with zoom and pan (mouse, trackpad and pinch)
//   • CALIBRATE PLAN — two points and a known distance
//   • draw and edit room boundaries
//   • draw duct routes, measured through the calibration
//   • place and drag the HVAC layout (indoor unit, plenum, outlets, return)
//
// It is deliberately not a CAD package. Everything it produces is a number the
// estimator can see, edit or replace by hand.

import { drawFlexDesign } from './flex-renderer.mjs';
import { h } from './dom.mjs';
import { ROUTING, DRAWING } from '../engines/nac-standard.mjs';

export const MODES = {
  VIEW: 'view',
  CALIBRATE: 'calibrate',
  ROOM: 'room',
  ROUTE: 'route',
  LAYOUT: 'layout',
  EDIT_ROUTE: 'edit_route'
};

/**
 * How big a target a handle is, in SCREEN pixels.
 *
 * An estimator is doing this on an iPad with a finger, standing in a roof
 * space. A 4 px dot is unusable — Apple's own guidance is 44 px and duct nodes
 * sit close together, so the drawn handle is modest and the TOUCH TARGET around
 * it is large. The two are deliberately different sizes.
 */
export const HANDLE_DRAW_R = 7;
export const HANDLE_TOUCH_R = 22;

const LAYOUT_ICONS = {
  indoorUnit:   { label: 'Indoor unit',   glyph: 'IDU', fill: '#2B6CB8' },
  plenum:       { label: 'Supply plenum', glyph: 'SP',  fill: '#3B2D8F' },
  returnGrille: { label: 'Return',        glyph: 'RA',  fill: '#8a5a00' },
  outlet:       { label: 'Outlet',        glyph: '',    fill: '#F5C200' }
};

export function createPlanViewer(container, opts = {}) {
  const state = {
    image: null,
    scale: 1,
    minScale: 0.05,
    maxScale: 12,
    offsetX: 0,
    offsetY: 0,
    mode: MODES.VIEW,
    calibrationPoints: [],
    calibration: null,
    rooms: [],
    selectedRoomId: null,
    routes: {},            // key -> { points: [{x,y}], label }
    markers: [],           // junctions, reducers and zone dampers, drawn as symbols
    handles: [],           // draggable nodes, only while EDIT_ROUTE is on
    activeHandleId: null,
    hoverHandleId: null,
    activeRouteKey: null,
    draftRoute: [],
    layout: {},            // key -> { x, y, label, type }
    dragging: null,
    showRooms: true,
    showRoutes: true,
    showLayout: true,
    // DESIGN PRESENTATION.
    // `analysis` is the setup workings — room boxes, confidence colours,
    // calibration marks. Useful while measuring, clutter once the design is
    // being reviewed, so it is off in design view behind a toggle.
    showAnalysis: true,
    designView: false,
    zoneChips: [],           // { index, title, rooms, kw, airflowLs, areaSqM, colour, anchorPx }
    zoneFillByRoomId: {},    // roomId -> { colour, fill, shortName }
    outlets: [],             // { x, y, roomId, neckMm, index }
    labelBoxes: [],          // collision bookkeeping, rebuilt every frame
    plenum: null,            // indoor unit / supply plenum
    // Real millimetres per screen pixel, so a duct can be drawn the size
    // it actually is rather than at a drawing-convention stroke width.
    pxPerMm: null,
    labelDetail: null
  };

  const canvas = h('canvas', { class: 'plan-canvas' });
  const wrap = h('div', { class: 'plan-wrap' }, canvas);
  container.appendChild(wrap);
  const ctx = canvas.getContext('2d');

  // ── Coordinate conversion ─────────────────────────────────────────────────
  const toImage = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - state.offsetX) / state.scale,
             y: (clientY - r.top - state.offsetY) / state.scale };
  };
  const toScreen = (p) => ({ x: p.x * state.scale + state.offsetX, y: p.y * state.scale + state.offsetY });

  let pendingFit = false;

  function resize() {
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The plan tab lays out after the image loads, so the first fit can happen
    // while the canvas is still collapsed. Re-fit until it has a real size.
    if (pendingFit && r.width > 80 && r.height > 80) { fit(); return; }
    draw();
  }

  function fit() {
    if (!state.image) return;
    const r = wrap.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) { pendingFit = true; return; }
    pendingFit = false;
    const s = Math.min(r.width / state.image.width, r.height / state.image.height) * 0.94;
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, s));
    state.offsetX = (r.width - state.image.width * state.scale) / 2;
    state.offsetY = (r.height - state.image.height * state.scale) / 2;
    draw();
  }

  function zoomBy(factor, centre) {
    const r = wrap.getBoundingClientRect();
    const cx = centre ? centre.x - r.left : r.width / 2;
    const cy = centre ? centre.y - r.top : r.height / 2;
    const before = { x: (cx - state.offsetX) / state.scale, y: (cy - state.offsetY) / state.scale };
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * factor));
    state.offsetX = cx - before.x * state.scale;
    state.offsetY = cy - before.y * state.scale;
    draw();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  function draw() {
    const r = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = '#0a0a1c';
    ctx.fillRect(0, 0, r.width, r.height);

    if (!state.image) {
      ctx.fillStyle = '#8080b0';
      ctx.font = '600 15px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Upload a floor plan to begin', r.width / 2, r.height / 2 - 10);
      ctx.fillStyle = '#5a5a80';
      ctx.font = '12px -apple-system, system-ui, sans-serif';
      ctx.fillText('PDF, JPG, JPEG or PNG — or load the sample builder plan', r.width / 2, r.height / 2 + 14);
      return;
    }

    ctx.save();
    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);
    ctx.imageSmoothingEnabled = state.scale < 2;
    ctx.drawImage(state.image, 0, 0);
    ctx.restore();

    // Every frame starts with an empty label ledger — a label placed last frame
    // must not push this frame's labels around.
    state.labelBoxes = [];

    // ── THE INSTALLER DRAWING ────────────────────────────────────────────
    //
    // Design view is rendered by the FLEX RENDERER, not by the general plan
    // viewer's own linework. It is a different drawing: tubes to scale, swept,
    // sizes written on the duct, figures off the plan. The code below this is
    // the SETUP view — room boxes, handles, calibration marks — which is a
    // different job and stays as it is.
    if (state.designView && !state.showAnalysis) {
      drawFlexDesign(ctx, {
        routes: state.routes,
        outlets: state.outlets,
        markers: state.markers,
        plenum: state.plenum,
        zoneFillByRoomId: state.zoneFillByRoomId,
        rooms: state.rooms,
        toScreen,
        scale: state.scale,
        pxPerMm: state.pxPerMm || null,
        labelDetail: state.labelDetail || null
      });
      drawZoneSchedule();
      drawZoneBadges();
      if (state.mode === MODES.EDIT_ROUTE) drawHandles();
      return;
    }

    // Zone shading sits under the linework, the way it does on a real design
    // sheet: the colour tells you which damper controls the space, the lines
    // tell you how the air gets there.
    if (state.designView) drawZoneFills();
    if (state.showRooms && (!state.designView || state.showAnalysis)) drawRooms();
    // The zone schedule is claimed BEFORE any duct label, not after. A drawing
    // whose legend has been shoved into the middle of the house by the labels
    // is the wrong way round: the schedule has a home, the labels move.
    if (state.designView) { drawZoneSchedule(); }
    // Every SYMBOL on the drawing — diffuser, take-off, damper, the unit itself
    // and the zone badges — books its patch of plan BEFORE a single duct label
    // is placed. Labels were landing on top of outlets and on the fan coil
    // because only other labels were being avoided.
    if (state.showRoutes) reserveSymbolBoxes();
    if (state.showRoutes) { drawRoutes(); drawMarkers(); drawOutlets(); }
    drawUnit();
    if (state.designView) drawZoneBadges();
    if (state.showLayout && (!state.designView || state.showAnalysis)) drawLayout();
    if (state.mode === MODES.EDIT_ROUTE) drawHandles();
    if (!state.designView || state.showAnalysis) drawCalibration();
  }

  /**
   * Zone shading. One soft wash per zone, under the ducts.
   *
   * This is the thing that makes a duct drawing readable at arm's length: you
   * see which rooms move together before you have read a single number.
   */
  function drawZoneFills() {
    for (const room of state.rooms) {
      if (!room.boundaryPx) continue;
      const z = state.zoneFillByRoomId[room.id];
      if (!z) continue;
      const p = toScreen(room.boundaryPx);
      const w = room.boundaryPx.w * state.scale;
      const hh = room.boundaryPx.h * state.scale;
      // A boundary the tool placed from a printed size is an approximation,
      // not a survey. It is washed lighter and left unoutlined, so it reads as
      // "this zone is around here" rather than as a measured room edge.
      const approx = !!room.boundaryDerived;
      ctx.save();
      ctx.globalAlpha = approx ? 0.55 : 1;
      ctx.fillStyle = z.fill;
      ctx.fillRect(p.x, p.y, w, hh);
      if (!approx) {
        ctx.strokeStyle = z.colour;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x, p.y, w, hh);
      }
      ctx.restore();
    }
  }

  /**
   * Book the space every symbol occupies, before any label is placed.
   *
   * A size printed on top of a diffuser is a size nobody can read, and that is
   * exactly what was happening: the label placer only knew about other labels.
   */
  function reserveSymbolBoxes() {
    const put = (pt, w, h, kind) => {
      const s2 = toScreen(pt);
      state.labelBoxes.push({ x: s2.x - w / 2, y: s2.y - h / 2, w, h, kind });
    };
    for (const o of state.outlets) put(o, 16, 16, 'outlet');
    for (const m of state.markers) {
      if (state.designView && m.type === 'reducer') continue;
      if (state.designView && m.type === 'junction' && !m.bto) continue;
      put(m, 15, 15, 'fitting');
    }
    if (state.plenum && state.plenum.x !== undefined) put(state.plenum, 38, 28, 'unit');
    if (state.designView) {
      for (const chip of state.zoneChips) {
        if (!chip.anchorPx) continue;
        const b = chip.anchorPx;
        put({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, 22, 22, 'badge');
      }
    }
  }

  /**
   * THE ZONE SCHEDULE.
   *
   * A real design sheet does not write four lines of figures across the middle
   * of every room — it carries one schedule off to the side and a numbered
   * badge in each space. That is what this is. Six blocks of text sitting on
   * the rooms was the single biggest thing making this drawing unreadable.
   *
   * It is drawn into the margin beside the plan when there is one, and into the
   * top corner of the plan when there is not, so it works zoomed in as well as
   * fitted.
   */
  function drawZoneSchedule() {
    const chips = state.zoneChips;
    if (!chips.length) return;
    const r = wrap.getBoundingClientRect();

    const titleFont = '800 11px -apple-system, system-ui, sans-serif';
    const headFont = '700 8.5px -apple-system, system-ui, sans-serif';
    const rowFont = '600 10px -apple-system, system-ui, sans-serif';
    const numFont = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';

    ctx.save();
    ctx.font = rowFont;
    const nameW = Math.min(108, Math.max(58,
      Math.ceil(Math.max(...chips.map(c => ctx.measureText(zoneShortName(c)).width))) + 4));
    const pad = 9, rowH = 15, headH = 30;
    // Columns are measured from where the NAME starts (past the swatch), not
    // from the panel edge — measuring from the edge is what let a long room
    // name run straight through the kW figure beside it.
    const nameX = pad + 16;
    const colKw = nameX + nameW + 12, colLs = colKw + 44, colM2 = colLs + 44;
    const w = colM2 + 46 + pad;
    const h = headH + chips.length * rowH + pad;

    // The margin left of the image is the natural home for it. Failing that,
    // the margin on the right; failing both, the top-left of the plan itself.
    const imgL = state.offsetX, imgR = state.offsetX + state.image.width * state.scale;
    const box = imgL > w + 24 ? { x: imgL - w - 12, y: 12 }
      : (r.width - imgR) > w + 24 ? { x: imgR + 12, y: 12 }
      : { x: 12, y: 12 };
    box.x = Math.max(6, Math.min(box.x, r.width - w - 6));
    box.y = Math.max(6, Math.min(box.y, r.height - h - 6));

    ctx.fillStyle = 'rgba(10,10,28,0.92)';
    ctx.strokeStyle = 'rgba(160,172,210,0.45)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(box.x, box.y, w, h, 5); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(box.x, box.y, w, h); ctx.strokeRect(box.x, box.y, w, h); }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = titleFont;
    ctx.fillStyle = '#F5C200';
    ctx.fillText('ZONE SCHEDULE', box.x + pad, box.y + 8);

    ctx.font = headFont;
    ctx.fillStyle = '#8f98b5';
    ctx.fillText('ZONE', box.x + nameX, box.y + 22);
    ctx.textAlign = 'right';
    ctx.fillText('kW', box.x + colKw + 22, box.y + 22);
    ctx.fillText('L/s', box.x + colLs + 22, box.y + 22);
    ctx.fillText('m\u00b2', box.x + colM2 + 22, box.y + 22);

    chips.forEach((c, i) => {
      const y = box.y + headH + i * rowH;
      // The swatch is the link back to the plan: the same colour fills the
      // rooms and the same number is on the badge in them.
      ctx.fillStyle = c.colour;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box.x + pad, y + 2, 11, 11, 2);
      else ctx.rect(box.x + pad, y + 2, 11, 11);
      ctx.fill();
      ctx.font = '800 8px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#0a0a1c';
      ctx.textAlign = 'center';
      ctx.fillText(String(c.index ?? i + 1), box.x + pad + 5.5, y + 4);

      ctx.textAlign = 'left';
      ctx.font = rowFont;
      ctx.fillStyle = '#e9ecf7';
      // Clipped to its own column. A room name running through the kW figure
      // beside it is how a schedule stops being a schedule.
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x + nameX, y, nameW, rowH); ctx.clip();
      ctx.fillText(zoneShortName(c), box.x + nameX, y + 3);
      ctx.restore();

      ctx.textAlign = 'right';
      ctx.font = numFont;
      ctx.fillStyle = '#cfd6e8';
      ctx.fillText((c.kw ?? 0).toFixed(2), box.x + colKw + 22, y + 3);
      ctx.fillText(String(Math.round(c.airflowLs || 0)), box.x + colLs + 22, y + 3);
      ctx.fillText((c.areaSqM ?? 0).toFixed(1), box.x + colM2 + 22, y + 3);
    });
    ctx.restore();
    state.labelBoxes.push({ x: box.x, y: box.y, w, h, kind: 'schedule' });
  }

  // A zone's name on the schedule is the room it covers when it covers one, and
  // what the zone IS when it covers several. "Zone 3" alone tells an installer
  // nothing; "BED 2" tells them which door to walk through, and "OPEN PLAN x6"
  // tells them the living area moves together.
  //
  // Names are abbreviated the way a schedule abbreviates them, so the column
  // holds a real room name instead of clipping it.
  function zoneShortName(chip) {
    const rooms = chip.rooms || [];
    if (!rooms.length) return abbreviateRoom(chip.fullName || chip.title);
    if (rooms.length === 1) return abbreviateRoom(rooms[0]);
    return abbreviateRoom(chip.fullName || chip.title) + ' \u00d7' + rooms.length;
  }

  function abbreviateRoom(name) {
    return String(name || '').toUpperCase()
      .replace(/MASTER BEDROOM/, 'MASTER BED')
      .replace(/BEDROOM/, 'BED')
      .replace(/^OPEN.PLAN.*/, 'OPEN PLAN');
  }

  /**
   * The numbered badge that ties a room on the plan back to the schedule.
   *
   * One small disc, in the zone's colour, in the middle of the zone. Nothing
   * else — the figures are in the schedule.
   */
  function drawZoneBadges() {
    for (const chip of state.zoneChips) {
      if (!chip.anchorPx) continue;
      const b = chip.anchorPx;
      const c = toScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      ctx.save();
      ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = chip.colour;
      ctx.globalAlpha = 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(10,10,28,0.7)'; ctx.stroke();
      ctx.font = '800 11px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#0a0a1c';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(chip.index ?? ''), c.x, c.y + 0.5);
      ctx.restore();
    }
  }

  const boxesOverlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /**
   * Find somewhere this label fits.
   *
   * Tries where it was asked to go, then steps outward in a ring — right, left,
   * below, above, then further — and gives up rather than stacking. A label the
   * estimator cannot read is worse than a label that is not there, and a
   * drawing where everything is drawn but nothing is legible is the failure
   * this avoids.
   */
  function findFreeSpot(x, y, w, h, spread) {
    const tries = [[0, 0]];
    for (let ring = 1; ring <= 4 * spread; ring++) {
      const d = ring * 13;
      tries.push([d, 0], [-d - w, 0], [0, d], [0, -d], [d, d], [-d - w, d], [d, -d], [-d - w, -d]);
    }
    const r = wrap.getBoundingClientRect();
    for (const [dx, dy] of tries) {
      const cand = { x: x + dx, y: y + dy, w, h };
      // A label half off the canvas is not a label. Pull it back inside before
      // testing it, so the search does not "succeed" somewhere invisible.
      cand.x = Math.max(2, Math.min(cand.x, r.width - w - 2));
      cand.y = Math.max(2, Math.min(cand.y, r.height - h - 2));
      if (!state.labelBoxes.some(b => boxesOverlap(cand, b))) return cand;
    }
    return null;   // nowhere free — drop it rather than pile it on
  }

  function drawRooms() {
    for (const room of state.rooms) {
      if (!room.boundaryPx) continue;
      const p = toScreen(room.boundaryPx);
      const w = room.boundaryPx.w * state.scale;
      const hh = room.boundaryPx.h * state.scale;
      const selected = room.id === state.selectedRoomId;
      const band = room.confidenceBand;
      // RULE 1 — a room NAC does not condition is still DRAWN, so the estimator
      // can see it was detected and not silently dropped. It is drawn faintly,
      // dashed and unlabelled by confidence, because its dimensions do not
      // matter and a coloured confidence border would invite a second look at
      // something already settled.
      const excluded = room.conditioningStatus === 'NON_CONDITIONED' ||
                       (room.conditioningStatus === undefined && room.conditioned === false);
      const review = room.conditioningStatus === 'REVIEW_REQUIRED';
      const stroke = excluded ? '#555577'
        : review ? '#9a7fd0'
        : band === 'HIGH' ? '#3fbf6f' : band === 'MEDIUM' ? '#F5C200' : '#ff5f5f';

      ctx.save();
      ctx.globalAlpha = excluded && !selected ? 0.45 : 1;
      ctx.lineWidth = selected ? 3 : excluded ? 1 : 2;
      ctx.strokeStyle = stroke;
      ctx.fillStyle = selected ? 'rgba(245,194,0,0.16)'
        : excluded ? 'rgba(85,85,119,0.10)'
        : review ? 'rgba(154,127,208,0.12)' : 'rgba(43,108,184,0.10)';
      ctx.setLineDash(excluded ? [6, 4] : review ? [3, 3] : []);
      ctx.fillRect(p.x, p.y, w, hh);
      ctx.strokeRect(p.x, p.y, w, hh);
      ctx.setLineDash([]);

      if (w > 54 && hh > 26) {
        ctx.fillStyle = excluded ? 'rgba(255,255,255,0.62)' : '#ffffff';
        ctx.font = '600 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(room.label, p.x + w / 2, p.y + hh / 2 - 3);
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        if (excluded) {
          // Nick's wording, on the drawing, so there is never any doubt about
          // why a room has no outlet and no duct going to it.
          ctx.fillStyle = 'rgba(255,255,255,0.58)';
          ctx.fillText(w > 150 ? 'EXCLUDED FROM AIR CONDITIONING' : 'EXCLUDED',
            p.x + w / 2, p.y + hh / 2 + 11);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          const sub = review ? 'CONDITIONED?'
            : room.areaSqM ? room.areaSqM.toFixed(2) + ' m²' : 'no dimension';
          ctx.fillText(sub, p.x + w / 2, p.y + hh / 2 + 11);
        }
      }

      if (selected) {
        ctx.fillStyle = '#F5C200';
        for (const c of [[p.x, p.y], [p.x + w, p.y], [p.x, p.y + hh], [p.x + w, p.y + hh]]) {
          ctx.fillRect(c[0] - 4, c[1] - 4, 8, 8);
        }
      }
      ctx.restore();
    }
  }

  /**
   * Draw a run with its corners rounded.
   *
   * Flex duct does not turn a square corner — it sweeps — and a drawing made of
   * right angles reads as a schematic rather than something somebody is going
   * to install. Each bend is replaced by a quadratic curve tucked inside the
   * corner, with the radius kept below half the shorter leg so a short segment
   * cannot swallow its own neighbours.
   */
  function smoothPath(screenPts, radius) {
    if (screenPts.length < 3 || radius <= 0) {
      ctx.moveTo(screenPts[0].x, screenPts[0].y);
      for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
      return;
    }
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length - 1; i++) {
      const prev = screenPts[i - 1], cur = screenPts[i], next = screenPts[i + 1];
      const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
      const r = Math.min(radius, d1 / 2, d2 / 2);
      if (!(r > 0.5)) { ctx.lineTo(cur.x, cur.y); continue; }
      const a = { x: cur.x + (prev.x - cur.x) * (r / d1), y: cur.y + (prev.y - cur.y) * (r / d1) };
      const b = { x: cur.x + (next.x - cur.x) * (r / d2), y: cur.y + (next.y - cur.y) * (r / d2) };
      ctx.lineTo(a.x, a.y);
      ctx.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
    }
    const last = screenPts[screenPts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function drawPolyline(points, colour, width, dash, opts = {}) {
    if (points.length < 2) return;
    const screenPts = points.map(toScreen);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // A soft dark casing under every run. It is what keeps a pale duct legible
    // over a pale floor plan without having to shout with colour.
    if (opts.casing !== false && !dash) {
      ctx.strokeStyle = 'rgba(10,10,26,0.34)';
      ctx.lineWidth = width + 3;
      ctx.beginPath();
      smoothPath(screenPts, opts.radius ?? Math.max(ROUTING.bendRadiusPx / 2, width * 2));
      ctx.stroke();
    }

    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    smoothPath(screenPts, opts.radius ?? Math.max(ROUTING.bendRadiusPx / 2, width * 2));
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A duct label has to be readable over a busy floor plan, so it is drawn on
   * its own backing rather than straight onto the linework. A size the
   * estimator cannot read is the same as no size at all.
   */
  function drawRouteLabel(text, at, colour) {
    const lines = String(text).split('\n');
    ctx.save();
    ctx.font = '700 10px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const pad = 3;
    const lh = 12;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
    const h = lines.length * lh + pad * 2 - 2;

    // Every duct label competes for the same few clear patches of plan, so it
    // goes through the same placement as everything else: nudged off anything
    // already drawn, and dropped rather than stacked if there is nowhere free.
    const spot = findFreeSpot(at.x + 9, at.y - h / 2, w, h, 2);
    if (!spot) { ctx.restore(); return; }
    const { x, y } = spot;

    // A leader line back to the run, so a label that had to move still says
    // which duct it belongs to.
    if (Math.hypot(x - at.x, y + h / 2 - at.y) > 16) {
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(x + (x > at.x ? 0 : w), y + h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(10,10,26,0.86)';
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
    ctx.fillStyle = '#eef1ff';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lh));
    ctx.restore();
    state.labelBoxes.push({ x, y, w, h, kind: 'label' });
  }

  /**
   * Outlets, drawn the way a design sheet draws them: a small ring at the end
   * of the run, not a labelled node.
   *
   * The neck size is already on the final duct beside it, so the symbol itself
   * carries no text — repeating it would be the clutter this is replacing.
   */
  function drawOutlets() {
    for (const o of state.outlets) {
      const s = toScreen(o);
      const z = o.roomId ? state.zoneFillByRoomId[o.roomId] : null;
      const colour = z?.colour || '#cfd6e8';
      ctx.save();
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = colour; ctx.stroke();
      // The cross inside is the diffuser, the way it is drawn on a ceiling plan.
      ctx.beginPath();
      ctx.moveTo(s.x - 3.2, s.y); ctx.lineTo(s.x + 3.2, s.y);
      ctx.moveTo(s.x, s.y - 3.2); ctx.lineTo(s.x, s.y + 3.2);
      ctx.lineWidth = 1.2; ctx.strokeStyle = colour; ctx.stroke();
      ctx.restore();
    }
  }

  function drawRoutes() {
    // Sizes go on LAST, once every run is drawn. See pendingLabels below.
    const pendingLabels = [];
    // Heaviest ducts first, so a 400 trunk never paints over the 150 branch
    // that has to be read beside it.
    const entries = Object.entries(state.routes)
      .sort((a, b) => (b[1].width || 0) - (a[1].width || 0));

    for (const [key, route] of entries) {
      const active = key === state.activeRouteKey;
      // Colour and weight come from the SIZED section (designer/engines/router.mjs),
      // so the drawing always shows the design rather than a drawing convention.
      const colour = active ? '#F5C200' : (route.colour || '#5fa8ff');
      const width = route.width || (active ? 3.5 : 2.5);
      // A locked route is drawn solid; an unlocked auto route is dashed, so the
      // estimator can see at a glance what the next re-route will overwrite.
      const dash = route.auto && !route.locked ? [9, 5] : null;
      drawPolyline(route.points, colour, active ? width + 1.5 : width, dash);

      // Nodes are the handles. On an auto route they are only worth showing
      // when this is the route being worked on, or the plan turns into confetti.
      // In design view they are never shown — an installer is reading the
      // layout, not editing it.
      const showNodes = !state.designView && (active || !route.auto);
      if (showNodes) {
        route.points.forEach((pt, i) => {
          const s = toScreen(pt);
          const end = i === 0 || i === route.points.length - 1;
          ctx.fillStyle = active ? '#F5C200' : colour;
          ctx.beginPath(); ctx.arc(s.x, s.y, end ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();
          if (route.locked) {
            ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 1.5; ctx.stroke();
          }
        });
      }

      // INSTALLER VIEW shows the sizes that decide what gets pulled off the
      // van: the trunk, each take-off, and the return. A size repeated on every
      // short run into a bedroom is the clutter, not the information.
      const labelHere = state.designView
        ? (route.labelPriority ?? 2) >= 2 || route.role === 'return'
        : true;
      if (route.label && labelHere && route.points.length) {
        // Against the middle of the run, not the end: the end of a branch is
        // where the outlet already is, and two things fight for it.
        const mid = route.points[Math.floor((route.points.length - 1) / 2)];
        const next = route.points[Math.floor((route.points.length - 1) / 2) + 1] || mid;
        const at = toScreen({ x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 });
        // Held back until every run is on the plan. A label drawn inside this
        // loop gets painted over by the next duct — which is how "RETURN ø350"
        // ended up with a duct through the middle of it.
        pendingLabels.push({ text: route.label, at, colour });
      }
      // A dashed auto route is drawn without a casing, so it still reads as
      // provisional rather than as something already installed.
    }
    if (state.draftRoute.length) {
      drawPolyline(state.draftRoute, '#F5C200', 3, [7, 5]);
      state.draftRoute.forEach(pt => {
        const s = toScreen(pt);
        ctx.fillStyle = '#F5C200';
        ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
      });
    }
    for (const l of pendingLabels) drawRouteLabel(l.text, l.at, l.colour);
  }

  /**
   * Junctions, reducers and zone dampers.
   *
   * Each of these is something somebody buys and fits — a Y piece nobody drew
   * is a Y piece nobody ordered — so they are drawn as symbols rather than left
   * implied by two lines meeting.
   */
  function drawMarkers() {
    for (const marker of state.markers) {
      // In design view a marker is a SYMBOL. Its text belongs in the zone block
      // and on the duct label; repeating "Open" beside every damper is the
      // clutter that made the drawing unreadable.
      // INSTALLER VIEW carries only what somebody fits: the take-offs and the
      // zone dampers. A reducer is already stated by the size changing on the
      // two labels either side of it — one fact, one mark — and a plain node
      // where two lines meet is not a fitting at all.
      if (state.designView && marker.type === 'reducer') continue;
      // A plain junction where two lines meet is not a fitting. The take-off
      // and the zone damper are, and they are the only marks an installer needs
      // on the drawing.
      if (state.designView && marker.type === 'junction' && !marker.bto) continue;
      // A BTO in design view is the symbol only. "BTO 7" beside every take-off
      // is a debug label — the installer reads the size off the duct it feeds.
      const m = state.designView ? { ...marker, label: null } : marker;
      const s = toScreen(m);
      ctx.save();
      if (m.type === 'junction') {
        ctx.fillStyle = '#F5C200'; ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (m.type === 'reducer') {
        // A bow-tie, the way a reducer is drawn on a real duct layout.
        ctx.fillStyle = '#ffb03a'; ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(s.x - 6, s.y - 5); ctx.lineTo(s.x + 6, s.y + 5);
        ctx.lineTo(s.x + 6, s.y - 5); ctx.lineTo(s.x - 6, s.y + 5);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (m.type === 'bto') {
        // A BRANCH TAKE-OFF, drawn the way one appears on a duct layout: a
        // small solid collar on the main with the branch leaving it. Small
        // enough that fifteen of them do not swamp the plan, dark enough that
        // an installer can count them at a glance.
        ctx.fillStyle = '#F5C200'; ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 5);
        ctx.lineTo(s.x + 5, s.y);
        ctx.lineTo(s.x, s.y + 5);
        ctx.lineTo(s.x - 5, s.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (m.type === 'damper') {
        ctx.fillStyle = '#3fbf6f'; ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(s.x - 6, s.y - 6, 12, 12);
        ctx.fill(); ctx.stroke();
      }
      if (m.label) {
        ctx.fillStyle = '#0c0c24';
        ctx.font = '700 8px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(m.label).slice(0, 4), s.x, s.y + 0.5);
      }
      ctx.restore();
    }
  }

  /**
   * The handles, drawn only in EDIT ROUTE mode.
   *
   * Normal view stays a clean design drawing — an estimator showing a customer
   * the plan does not want it covered in dots. Turn editing on and every node
   * an estimator can grab appears.
   */
  function drawHandles() {
    for (const h of state.handles) {
      const p = toScreen(h);
      const active = h.id === state.activeHandleId;
      const hover = h.id === state.hoverHandleId;
      const r = HANDLE_DRAW_R * (active ? 1.35 : hover ? 1.15 : 1);
      ctx.save();

      // A halo showing the real touch target, so a finger knows where to land.
      if (active || hover) {
        ctx.fillStyle = 'rgba(245,194,0,0.16)';
        ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_TOUCH_R, 0, Math.PI * 2); ctx.fill();
      }

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0c0c24';
      if (h.locked) {
        // A locked node is a square with a bar through it: it reads as fixed,
        // and it reads that way in a roof space on a dim iPad screen.
        ctx.fillStyle = '#8f98b5';
        ctx.beginPath(); ctx.rect(p.x - r, p.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(p.x - r * 0.55, p.y); ctx.lineTo(p.x + r * 0.55, p.y); ctx.stroke();
      } else if (h.kind === 'junction') {
        ctx.fillStyle = active ? '#ffe680' : '#F5C200';
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (h.kind === 'end') {
        ctx.fillStyle = active ? '#ffffff' : '#8fd0ff';
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = active ? '#ffffff' : '#5fa8ff';
        ctx.beginPath();
        ctx.rect(p.x - r * 0.8, p.y - r * 0.8, r * 1.6, r * 1.6);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * The indoor unit and its supply plenum, as one symbol.
   *
   * A fan-coil in a roof space is a box with the trunk coming off it, and that
   * is what gets drawn — not a labelled debug node with coordinates beside it.
   */
  function drawUnit() {
    const p = state.plenum;
    if (!p || p.x === undefined) return;
    const s = toScreen(p);
    ctx.save();
    const w = 30, hh = 20;
    ctx.fillStyle = 'rgba(232,236,247,0.96)';
    ctx.strokeStyle = '#3b4358';
    ctx.lineWidth = 2;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(s.x - w / 2, s.y - hh / 2, w, hh, 3); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(s.x - w / 2, s.y - hh / 2, w, hh); ctx.strokeRect(s.x - w / 2, s.y - hh / 2, w, hh); }
    // Fan blades, so it reads as plant rather than as a junction box.
    ctx.strokeStyle = '#3b4358';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - 4.5, s.y - 4.5); ctx.lineTo(s.x + 4.5, s.y + 4.5);
    ctx.moveTo(s.x + 4.5, s.y - 4.5); ctx.lineTo(s.x - 4.5, s.y + 4.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawLayout() {
    for (const [key, item] of Object.entries(state.layout)) {
      if (!item || item.x === undefined) continue;
      const s = toScreen(item);
      const spec = LAYOUT_ICONS[item.type] || LAYOUT_ICONS.outlet;
      const isOutlet = item.type === 'outlet';
      ctx.save();
      ctx.fillStyle = spec.fill;
      ctx.strokeStyle = '#0c0c24';
      ctx.lineWidth = 2;
      if (isOutlet) {
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath();
        const w = 34, hh = 20;
        ctx.rect(s.x - w / 2, s.y - hh / 2, w, hh);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(spec.glyph, s.x, s.y);
      }
      if (item.label) {
        ctx.fillStyle = '#dfe4ff';
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(item.label, s.x, s.y + 13);
      }
      ctx.restore();
      item._key = key;
    }
  }

  function drawCalibration() {
    const pts = state.calibrationPoints;
    const showStored = state.calibration && state.mode !== MODES.CALIBRATE && pts.length === 0;
    const a = showStored ? state.calibration.pointA : pts[0];
    const b = showStored ? state.calibration.pointB : pts[1];
    if (!a) return;

    ctx.save();
    ctx.strokeStyle = '#ff9f40';
    ctx.fillStyle = '#ff9f40';
    ctx.lineWidth = 2;
    const sa = toScreen(a);
    ctx.beginPath(); ctx.arc(sa.x, sa.y, 5, 0, Math.PI * 2); ctx.fill();
    if (b) {
      const sb = toScreen(b);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(sb.x, sb.y, 5, 0, Math.PI * 2); ctx.fill();
      if (state.calibration) {
        const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
        ctx.font = '700 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0c0c24';
        const text = Math.round(state.calibration.calibrationDistanceMm) + ' mm';
        const w = ctx.measureText(text).width + 12;
        ctx.fillRect(mid.x - w / 2, mid.y - 18, w, 16);
        ctx.fillStyle = '#ff9f40';
        ctx.fillText(text, mid.x, mid.y - 6);
      }
    }
    ctx.restore();
  }

  // ── Hit testing ───────────────────────────────────────────────────────────
  function layoutHit(img) {
    const tol = 16 / state.scale;
    for (const [key, item] of Object.entries(state.layout)) {
      if (!item || item.x === undefined) continue;
      if (Math.abs(item.x - img.x) < tol && Math.abs(item.y - img.y) < tol) return key;
    }
    return null;
  }

  function roomHit(img) {
    for (let i = state.rooms.length - 1; i >= 0; i--) {
      const r = state.rooms[i];
      if (!r.boundaryPx) continue;
      const b = r.boundaryPx;
      if (img.x >= b.x && img.x <= b.x + b.w && img.y >= b.y && img.y <= b.y + b.h) return r.id;
    }
    return null;
  }

  function cornerHit(img) {
    const room = state.rooms.find(r => r.id === state.selectedRoomId);
    if (!room?.boundaryPx) return null;
    const b = room.boundaryPx;
    const tol = 10 / state.scale;
    const corners = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h] };
    for (const [name, [cx, cy]] of Object.entries(corners)) {
      if (Math.abs(cx - img.x) < tol && Math.abs(cy - img.y) < tol) return name;
    }
    return null;
  }

  // ── Pointer handling (mouse, trackpad, touch, Apple Pencil) ───────────────
  const pointers = new Map();
  let pinchStart = null;
  let panning = null;
  let drawingRoom = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(p2.x - p1.x, p2.y - p1.y), scale: state.scale,
                     centre: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
      panning = null; drawingRoom = null;
      return;
    }
    if (pointers.size > 2) return;

    const img = toImage(e.clientX, e.clientY);

    if (state.mode === MODES.CALIBRATE) {
      if (state.calibrationPoints.length >= 2) state.calibrationPoints = [];
      state.calibrationPoints.push(img);
      draw();
      opts.onCalibrationPoints?.(state.calibrationPoints.slice());
      return;
    }

    if (state.mode === MODES.ROUTE) {
      state.draftRoute.push(img);
      draw();
      opts.onRouteDraft?.(state.draftRoute.slice());
      return;
    }

    if (state.mode === MODES.EDIT_ROUTE) {
      // The touch radius is in SCREEN px, so it has to be converted at the
      // current zoom — otherwise a handle is easy to hit zoomed in and
      // impossible zoomed out, which is exactly backwards.
      const radius = HANDLE_TOUCH_R / state.scale;
      const h = opts.onHandlePick?.(img, radius) || null;
      if (h) {
        state.activeHandleId = h.id;
        state.dragging = { kind: 'handle', handle: h, start: img, last: img, moved: false };
        // A press and hold on a node offers to delete it. On an iPad there is
        // no right-click, and an estimator has one finger free.
        state.holdTimer = setTimeout(() => {
          if (state.dragging?.kind === 'handle' && !state.dragging.moved) {
            state.dragging = null;
            state.activeHandleId = null;
            opts.onHandleHold?.(h);
            draw();
          }
        }, 550);
        draw();
        return;
      }
      // Not on a handle: a tap on a run adds a point to it.
      const leg = opts.onRoutePick?.(img, radius * 1.2) || null;
      if (leg) { state.dragging = { kind: 'route-tap', leg, start: img, moved: false }; return; }
      // Otherwise fall through to panning, so the plan can still be moved.
    }

    if (state.mode === MODES.LAYOUT) {
      const key = layoutHit(img);
      if (key) { state.dragging = { kind: 'layout', key }; return; }
    }

    if (state.mode === MODES.ROOM) {
      const corner = cornerHit(img);
      if (corner) { state.dragging = { kind: 'corner', corner, roomId: state.selectedRoomId }; return; }
      const hit = roomHit(img);
      if (hit) {
        state.selectedRoomId = hit;
        opts.onRoomSelect?.(hit);
        state.dragging = { kind: 'move', roomId: hit, start: img,
                           origin: { ...state.rooms.find(r => r.id === hit).boundaryPx } };
        draw();
        return;
      }
      drawingRoom = { start: img, current: img };
      return;
    }

    const hit = roomHit(img);
    if (hit && state.mode === MODES.VIEW) { state.selectedRoomId = hit; opts.onRoomSelect?.(hit); draw(); }
    panning = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchStart && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const factor = (dist / pinchStart.dist) * (pinchStart.scale / state.scale);
      zoomBy(factor, pinchStart.centre);
      return;
    }

    const img = toImage(e.clientX, e.clientY);

    if (state.dragging?.kind === 'handle') {
      const moved = Math.hypot(img.x - state.dragging.start.x, img.y - state.dragging.start.y);
      // A little slop before it counts as a drag, so a tap with a shaky hand on
      // a ladder is still a tap.
      if (moved > 2 / state.scale) {
        state.dragging.moved = true;
        clearTimeout(state.holdTimer);
        opts.onHandleDrag?.(state.dragging.handle, img);
      }
      state.dragging.last = img;
      return;
    }
    if (state.dragging?.kind === 'route-tap') {
      if (Math.hypot(img.x - state.dragging.start.x, img.y - state.dragging.start.y) > 3 / state.scale) {
        state.dragging.moved = true;
      }
      return;
    }
    if (state.mode === MODES.EDIT_ROUTE && !state.dragging) {
      // Light up what is under the pointer, so a mouse user can see what they
      // are about to grab before they grab it.
      const h = opts.onHandlePick?.(img, HANDLE_TOUCH_R / state.scale) || null;
      const id = h?.id || null;
      if (id !== state.hoverHandleId) { state.hoverHandleId = id; draw(); }
    }

    if (state.dragging?.kind === 'layout') {
      const item = state.layout[state.dragging.key];
      item.x = img.x; item.y = img.y;
      draw();
      return;
    }
    if (state.dragging?.kind === 'move') {
      const room = state.rooms.find(r => r.id === state.dragging.roomId);
      room.boundaryPx = { ...room.boundaryPx,
        x: state.dragging.origin.x + (img.x - state.dragging.start.x),
        y: state.dragging.origin.y + (img.y - state.dragging.start.y) };
      draw();
      return;
    }
    if (state.dragging?.kind === 'corner') {
      const room = state.rooms.find(r => r.id === state.dragging.roomId);
      const b = room.boundaryPx;
      const x2 = b.x + b.w, y2 = b.y + b.h;
      const c = state.dragging.corner;
      const nx = c.includes('w') ? img.x : b.x;
      const ny = c.includes('n') ? img.y : b.y;
      const nx2 = c.includes('e') ? img.x : x2;
      const ny2 = c.includes('s') ? img.y : y2;
      room.boundaryPx = { x: Math.min(nx, nx2), y: Math.min(ny, ny2),
                          w: Math.abs(nx2 - nx), h: Math.abs(ny2 - ny) };
      draw();
      return;
    }
    if (drawingRoom) { drawingRoom.current = img; draw(); drawDraftRect(drawingRoom); return; }
    if (panning) {
      state.offsetX = panning.ox + (e.clientX - panning.x);
      state.offsetY = panning.oy + (e.clientY - panning.y);
      draw();
    }
  });

  function drawDraftRect(d) {
    const a = toScreen({ x: Math.min(d.start.x, d.current.x), y: Math.min(d.start.y, d.current.y) });
    const w = Math.abs(d.current.x - d.start.x) * state.scale;
    const hh = Math.abs(d.current.y - d.start.y) * state.scale;
    ctx.save();
    ctx.strokeStyle = '#F5C200';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, w, hh);
    ctx.restore();
  }

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;

    if (state.dragging) {
      const d = state.dragging;
      state.dragging = null;
      clearTimeout(state.holdTimer);

      if (d.kind === 'handle') {
        state.activeHandleId = null;
        // One commit at the END of a drag, not on every pointermove. The whole
        // design recalculates on a commit — length, pressure, materials, cost —
        // and doing that sixty times a second would make the iPad crawl.
        if (d.moved) opts.onHandleDrop?.(d.handle, d.last);
        else opts.onHandleTap?.(d.handle);
        draw();
        return;
      }
      if (d.kind === 'route-tap') {
        if (!d.moved) opts.onRouteTap?.(d.leg, d.start);
        return;
      }

      if (d.kind === 'layout') opts.onLayoutMove?.(d.key, state.layout[d.key]);
      else {
        const room = state.rooms.find(r => r.id === d.roomId);
        if (room) opts.onRoomBoundary?.(room.id, room.boundaryPx);
      }
      return;
    }
    if (drawingRoom) {
      const d = drawingRoom;
      drawingRoom = null;
      const box = { x: Math.min(d.start.x, d.current.x), y: Math.min(d.start.y, d.current.y),
                    w: Math.abs(d.current.x - d.start.x), h: Math.abs(d.current.y - d.start.y) };
      draw();
      if (box.w > 8 && box.h > 8) opts.onRoomDrawn?.(box);
      return;
    }
    panning = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => { if (panning || drawingRoom) endPointer(e); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    if (state.mode === MODES.ROUTE && state.draftRoute.length >= 2) {
      const pts = state.draftRoute.slice();
      state.draftRoute = [];
      draw();
      opts.onRouteComplete?.(pts);
    }
  });

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(wrap);
  window.addEventListener('resize', resize);

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    element: wrap,
    state,
    async setImage(src) {
      // A plan served from storage needs CORS for the report snapshot to work.
      // If the server will not allow it, fall back to a plain load — the plan
      // still displays, only the snapshot in the internal sheet is lost.
      const load = (crossOrigin) => new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        if (crossOrigin) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load the plan image'));
        img.src = src;
      });
      const remote = /^https?:/i.test(src);
      const img = remote ? await load(true).catch(() => load(false)) : await load(false);
      state.image = img;
      pendingFit = true;
      resize();
      fit();
      // One more pass after the browser has settled the surrounding layout.
      requestAnimationFrame(() => { resize(); fit(); });
      return { width: img.naturalWidth, height: img.naturalHeight };
    },
    setMode(mode) {
      state.mode = mode;
      if (mode !== MODES.CALIBRATE) state.calibrationPoints = [];
      if (mode !== MODES.ROUTE) state.draftRoute = [];
      canvas.style.cursor = mode === MODES.VIEW ? 'grab'
        : mode === MODES.CALIBRATE || mode === MODES.ROUTE ? 'crosshair' : 'default';
      draw();
    },
    getMode: () => state.mode,
    // Called on every app render, so it must be idempotent: clearing the
    // picking points unconditionally made it impossible to ever place the
    // second calibration point (each click re-rendered and wiped the first).
    setCalibration(c) {
      const changed = state.calibration !== c;
      state.calibration = c;
      // The calibration is what lets a duct be drawn its real size. Without it
      // the flex renderer falls back to keeping the RATIO between sizes.
      state.pxPerMm = c?.pixelsPerMm || null;
      if (changed) state.calibrationPoints = [];
      draw();
    },
    setLabelDetail(detail) { state.labelDetail = detail || null; draw(); },
    resetCalibrationPoints() { state.calibrationPoints = []; draw(); },
    setRooms(rooms) { state.rooms = rooms || []; draw(); },
    selectRoom(id) { state.selectedRoomId = id; draw(); },
    setRoutes(routes) { state.routes = routes || {}; draw(); },
    setMarkers(markers) { state.markers = markers || []; draw(); },

    // ── Design presentation ─────────────────────────────────────────────────
    /** Zone shading and the per-zone figure blocks. */
    setZones({ chips = [], byRoomId = {} } = {}) {
      state.zoneChips = chips || [];
      state.zoneFillByRoomId = byRoomId || {};
      draw();
    },
    /** Where the diffusers go, so they can be drawn as symbols not nodes. */
    setOutlets(outlets) { state.outlets = outlets || []; draw(); },
    /** The indoor unit / supply plenum position. */
    setPlenum(p) { state.plenum = p || null; draw(); },
    /**
     * DESIGN VIEW hides the setup workings — room boxes, calibration marks,
     * route handles — and turns on zone shading. It is what an installer looks
     * at; ANALYSIS is what the estimator measured with.
     */
    setDesignView(on) { state.designView = !!on; draw(); },
    isDesignView() { return !!state.designView; },
    setShowAnalysis(on) { state.showAnalysis = !!on; draw(); },
    showsAnalysis() { return !!state.showAnalysis; },
    setHandles(handles) { state.handles = handles || []; draw(); },
    /** Image px per screen px — the app needs it to size a touch radius. */
    imagePerScreen() { return 1 / state.scale; },
    setActiveRoute(key) { state.activeRouteKey = key; state.draftRoute = []; draw(); },
    clearDraftRoute() { state.draftRoute = []; draw(); },
    undoDraftPoint() { state.draftRoute.pop(); draw(); return state.draftRoute.slice(); },
    setLayout(layout) { state.layout = layout || {}; draw(); },
    setVisibility({ rooms, routes, layout }) {
      if (rooms !== undefined) state.showRooms = rooms;
      if (routes !== undefined) state.showRoutes = routes;
      if (layout !== undefined) state.showLayout = layout;
      draw();
    },
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(1 / 1.25),
    fit,
    redraw: draw,
    /**
     * The current view as a data URL, for the design documents.
     *
     * JPEG by default: a PDF embeds JPEG bytes verbatim, so the plan goes into
     * the file with no re-encoding and no library. The canvas is painted solid
     * before anything is drawn on it, so there is no transparency to lose.
     * Quality 0.92 keeps the dimension text on the plan readable.
     */
    snapshot({ type = 'image/jpeg', quality = 0.92 } = {}) {
      // No plan, or a canvas that was never laid out because the Plan tab has
      // not been opened, gives a 1-pixel image. Embedding that puts a blank
      // rectangle in a customer document, which looks like a printing fault.
      // Nothing is better than nothing pretending to be something.
      if (!state.image) return null;
      if (canvas.width < 80 || canvas.height < 80) return null;
      try { return canvas.toDataURL(type, quality); } catch (e) { return null; }
    }
  };
}
