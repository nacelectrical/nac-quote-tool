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

import { h } from './dom.mjs';

export const MODES = {
  VIEW: 'view',
  CALIBRATE: 'calibrate',
  ROOM: 'room',
  ROUTE: 'route',
  LAYOUT: 'layout'
};

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
    activeRouteKey: null,
    draftRoute: [],
    layout: {},            // key -> { x, y, label, type }
    dragging: null,
    showRooms: true,
    showRoutes: true,
    showLayout: true
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

    if (state.showRooms) drawRooms();
    if (state.showRoutes) drawRoutes();
    if (state.showLayout) drawLayout();
    drawCalibration();
  }

  function drawRooms() {
    for (const room of state.rooms) {
      if (!room.boundaryPx) continue;
      const p = toScreen(room.boundaryPx);
      const w = room.boundaryPx.w * state.scale;
      const hh = room.boundaryPx.h * state.scale;
      const selected = room.id === state.selectedRoomId;
      const band = room.confidenceBand;
      const stroke = !room.conditioned ? '#555577'
        : band === 'HIGH' ? '#3fbf6f' : band === 'MEDIUM' ? '#F5C200' : '#ff5f5f';

      ctx.save();
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = stroke;
      ctx.fillStyle = selected ? 'rgba(245,194,0,0.16)'
        : room.conditioned ? 'rgba(43,108,184,0.10)' : 'rgba(85,85,119,0.10)';
      ctx.setLineDash(room.conditioned ? [] : [6, 4]);
      ctx.fillRect(p.x, p.y, w, hh);
      ctx.strokeRect(p.x, p.y, w, hh);
      ctx.setLineDash([]);

      if (w > 54 && hh > 26) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(room.label, p.x + w / 2, p.y + hh / 2 - 3);
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        const sub = room.areaSqM ? room.areaSqM.toFixed(2) + ' m²' : 'no dimension';
        ctx.fillText(sub, p.x + w / 2, p.y + hh / 2 + 11);
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

  function drawPolyline(points, colour, width, dash) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach((pt, i) => {
      const s = toScreen(pt);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawRoutes() {
    for (const [key, route] of Object.entries(state.routes)) {
      const active = key === state.activeRouteKey;
      drawPolyline(route.points, active ? '#F5C200' : '#5fa8ff', active ? 3.5 : 2.5);
      route.points.forEach(pt => {
        const s = toScreen(pt);
        ctx.fillStyle = active ? '#F5C200' : '#5fa8ff';
        ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill();
      });
      if (route.label && route.points.length) {
        const s = toScreen(route.points[route.points.length - 1]);
        ctx.fillStyle = '#dfe4ff';
        ctx.font = '10px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(route.label, s.x + 8, s.y - 6);
      }
    }
    if (state.draftRoute.length) {
      drawPolyline(state.draftRoute, '#F5C200', 3, [7, 5]);
      state.draftRoute.forEach(pt => {
        const s = toScreen(pt);
        ctx.fillStyle = '#F5C200';
        ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
      });
    }
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
      if (changed) state.calibrationPoints = [];
      draw();
    },
    resetCalibrationPoints() { state.calibrationPoints = []; draw(); },
    setRooms(rooms) { state.rooms = rooms || []; draw(); },
    selectRoom(id) { state.selectedRoomId = id; draw(); },
    setRoutes(routes) { state.routes = routes || {}; draw(); },
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
