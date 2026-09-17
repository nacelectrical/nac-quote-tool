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

import { drawFlexDesign, sizeKey } from './flex-renderer.mjs';
import { h } from './dom.mjs';
import { ROUTING, DRAWING } from '../engines/nac-standard.mjs';
import * as SYMBOLS from './symbols.mjs';

export const MODES = {
  VIEW: 'view',
  CALIBRATE: 'calibrate',
  ROOM: 'room',
  ROUTE: 'route',
  LAYOUT: 'layout',
  EDIT_ROUTE: 'edit_route',
  /** SITE ADJUST — one finger, gloves on, in a roof. See `drawSiteLayer`. */
  SITE: 'site'
};

/**
 * THE SITE ADJUST GESTURE MODES.
 *
 * One is always on and it is always named on screen. Nick: "Prevent dragging
 * the drawing when the installer intends to move a component." The only way to
 * guarantee that is to make panning and moving different MODES rather than
 * different gestures on the same finger — which is what these are.
 */
export const SITE_GESTURE = {
  PAN: 'pan', SELECT: 'select', MOVE: 'move',
  ROUTE: 'route', ADD: 'add', DELETE: 'delete'
};

/**
 * How big a Site Adjust grab target is, in SCREEN pixels.
 *
 * Nick: "Use large touch targets suitable for gloves. Small canvas handles are
 * not acceptable." 30 px of radius is a 60 px target — bigger than Apple's 44
 * and bigger than the office handle, because the office handle is for a mouse.
 */
export const SITE_TOUCH_R = 30;
export const SITE_DRAW_R = 15;

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
    // ── SITE ADJUST ───────────────────────────────────────────────────────
    // Which gesture is armed, what can be grabbed, and which run is open for
    // route editing. The viewer holds the geometry; site-adjust.mjs holds the
    // meaning and fills these in on every render.
    siteGesture: SITE_GESTURE.SELECT,
    /** Re-fit when the box changes shape, unless a finger has moved the plan. */
    autoFit: false,
    userAdjusted: false,
    siteTargets: [],       // [{ id, kind, x, y, badge, movable }]
    siteSelectedId: null,
    siteRoute: null,       // { sectionId, points: [{x,y}], locked }
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
    // ── THE BOX CHANGED SHAPE, SO THE DRAWING HAS TO BE RE-FITTED ─────────
    //
    // On the iPad a sheet takes half the width the moment something is tapped,
    // and the canvas is a different box from one frame to the next. Keeping the
    // old scale and offset is what left the plan as a sliver in one corner —
    // and a plan that has slid off the edge is one nobody can tap.
    //
    // The ResizeObserver is the ONLY thing that knows the box has settled, so
    // the re-fit belongs here rather than on a timer somebody has to guess.
    // A fit that would undo the installer's own pinch is not done: panning and
    // zooming set `userAdjusted`, and a fit clears it.
    if (state.autoFit && !state.userAdjusted && r.width > 80 && r.height > 80) {
      fit();
      return;
    }
    draw();
  }

  /** How much of the canvas the zone schedule needs down the left. */
  const SCHEDULE_GUTTER_PX = 178;

  function scheduleGutter(r) {
    // A drawing sheet sizes the drawing to fit BESIDE its title block. Centring
    // the plan and then hunting for somewhere to put the schedule is how the
    // schedule ended up sitting on the house.
    if (!state.designView || !state.zoneChips.length) return 0;
    // NOT ON THE IPAD. Site Adjust is a plan somebody is putting a finger on,
    // and 178 px of zone schedule down the side of a canvas that already gives
    // half its width to a sheet leaves the house too small to tap accurately.
    if (state.mode === MODES.SITE) return 0;
    return r.width > SCHEDULE_GUTTER_PX * 2.2 ? SCHEDULE_GUTTER_PX : 0;
  }

  function fit() {
    if (!state.image) return;
    const r = wrap.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) { pendingFit = true; return; }
    pendingFit = false;
    state.userAdjusted = false;
    const gutter = scheduleGutter(r);
    const usable = r.width - gutter;
    const s = Math.min(usable / state.image.width, r.height / state.image.height) * 0.94;
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, s));
    state.offsetX = gutter + (usable - state.image.width * state.scale) / 2;
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
    state.userAdjusted = true;
    draw();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  function draw() {
    const r = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    // A REPORT PAGE IS PAPER, NOT AN APP WINDOW.
    //
    // On screen the space around the plan is the app's own dark chrome, which is
    // right there and wrong everywhere else: embedded in the PDF it printed a
    // black band down a third of the landscape sheet and made the drawing
    // smaller to fit inside it. During a report capture the background is white,
    // so what goes on the page is a drawing on paper.
    ctx.fillStyle = state.paperBackground ? '#FFFFFF' : '#0a0a1c';
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
      state.drawn = drawFlexDesign(ctx, {
        routes: state.routes,
        outlets: state.outlets,
        markers: state.markers,
        plenum: state.plenum,
        zoneFillByRoomId: state.zoneFillByRoomId,
        rooms: state.rooms,
        // Zone dampers are drawn IN the ductwork, across the run they control,
        // AND LABELLED WITH THEIR ZONE. Nick: zoning is not shown by colouring
        // the duct network — the network's colour is its size — it is shown by
        // the damper and its label. The tag carries the zone's number and its
        // colour, which is the same number and colour as its row in the
        // schedule, so a damper on the plan and a line in the table are
        // obviously the same thing.
        dampers: (state.markers || []).filter(m => m.type === 'damper')
          .map(m => {
            const chip = state.zoneChips.find(c =>
              c.fullName === m.label || c.title === m.label || c.zoneId === m.label);
            return { ...m,
                     zoneLabel: chip?.index ? 'Z' + chip.index : (m.label || null),
                     colour: chip?.colour || '#1d7a48' };
          }),
        toScreen,
        scale: state.scale,
        pxPerMm: state.pxPerMm || null,
        labelDetail: state.labelDetail || null,
        // What the symbols need to describe themselves honestly: the unit's
        // model under the FCU, the real grille sizes on the return symbols, and
        // the outlet type the design actually selected.
        unitModel: state.unitModel || null,
        // The fabricated arrangement, so the symbol is the piece of metal the
        // schedule, the BOM and the warning all describe.
        supplyPlenum: state.supplyPlenum || null,
        returnGrilles: state.returnGrilles || [],
        outletType: state.outletType || 'square',
        selectedId: state.selectedId || null
      });
      // NOT ON THE IPAD: Site Adjust needs the width for the house, not for a
      // schedule nobody reads with a torch in their teeth.
      if (state.mode !== MODES.SITE) drawZoneSchedule();
      drawZoneBadges();
      // A COMPACT KEY, on the report. Drawn from the same functions as the
      // sheet, so a symbol in the legend is by construction the symbol on the
      // drawing — a hand-kept key eventually describes a drawing that moved on.
      if (state.showLegend) {
        const r0 = wrap.getBoundingClientRect();
        // ONE COLUMN, TOP-ALIGNED, ON A REPORT. Pinned to the bottom of the
        // canvas the key sat a long way under the zone schedule, and the crop
        // had to span from one to the other — a tall empty strip of column that
        // the landscape page then scaled up along with the drawing.
        const legendY = state.paperBackground
          ? Math.min(r0.height - 214, (state.scheduleBottomY ?? 0) + 12)
          : r0.height - 214;
        // THREE PANELS, ONE COLUMN, ONE LEFT EDGE. Nick: "Move the zone
        // schedule, duct legend and symbol legend into a compact aligned side
        // column." The duct sizes already have their own key directly under the
        // schedule, so this panel carries the SYMBOLS only — printing them
        // twice is what made the column tall enough to set the plan's scale.
        const lx = state.paperBackground ? (state.scheduleX ?? 14) : 14;
        const lw = state.paperBackground
          ? Math.max(150, Math.min(210, state.scheduleW ?? 178)) : 178;
        const dim = SYMBOLS.drawLegend(ctx, { x: lx, y: legendY }, {
          sizes: [],
          hasReturn: false,
          width: lw,
          title: 'SYMBOLS',
          outletType: state.outletType || 'square'
        });
        if (dim) {
          state.labelBoxes.push({ x: lx, y: legendY, w: dim.width, h: dim.height,
                                  kind: 'schedule' });
        }
      }
      // EDITING HANDLES SIT ON TOP OF THE CLEAN DRAWING, NOT INSTEAD OF IT.
      //
      // An estimator on a roof moving a diffuser wants to see the finished
      // drawing with a grab handle on it — not be dropped back into the setup
      // view with room boxes and analysis linework. So each edit mode adds only
      // its own handles to the installer drawing, and Clean View adds none.
      if (state.mode === MODES.EDIT_ROUTE) drawHandles();
      if (state.mode === MODES.LAYOUT && state.showLayout) drawLayoutHandles();
      if (state.mode === MODES.CALIBRATE) drawCalibration();
      // SITE ADJUST IS AN EDIT MODE ON THE INSTALLER DRAWING. It is drawn here,
      // inside the design-view branch, because that branch RETURNS — the site
      // layer added only at the bottom of draw() was never reached on the one
      // view Site Adjust actually runs on, so the grab circles were invisible
      // and a finger had nothing to aim at.
      if (state.mode === MODES.SITE) drawSiteLayer();
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
    if (state.designView && state.mode !== MODES.SITE) { drawZoneSchedule(); }
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
    if (state.mode === MODES.SITE) drawSiteLayer();
    if (!state.designView || state.showAnalysis) drawCalibration();
  }

  /**
   * THE SITE ADJUST LAYER — grab targets a gloved finger can actually hit.
   *
   * Drawn in SCREEN space, so a handle is the same size whatever the zoom: an
   * installer zooms in to see the duct, not to make the targets bigger, and a
   * target that shrinks when you zoom out is a target you cannot hit at all.
   */
  function drawSiteLayer() {
    const P = { outlet: '#C79400', bto: '#1D7A48', damper: '#7A3FB8',
                fcu: '#2B6CB8', plenum: '#3B2D8F', returnPlenum: '#6E7486',
                returnGrille: '#8A5A00', duct: '#4A4F57' };
    const toScreen = (p) => ({ x: p.x * state.scale + state.offsetX,
                               y: p.y * state.scale + state.offsetY });
    ctx.save();
    ctx.lineJoin = 'round';

    // The run being edited, with a handle on every point of it.
    if (state.siteRoute?.points?.length) {
      const pts = state.siteRoute.points.map(toScreen);
      ctx.strokeStyle = 'rgba(19,199,220,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
      ctx.setLineDash([]);
      pts.forEach((p, i) => {
        const dragging = state.dragging?.kind === 'site-route' &&
                         state.dragging.hit?.pointIndex === i && state.dragging.moved;
        const at = dragging ? toScreen(state.dragging.last) : p;
        ctx.beginPath();
        ctx.arc(at.x, at.y, SITE_DRAW_R, 0, Math.PI * 2);
        ctx.fillStyle = dragging ? 'rgba(19,199,220,0.95)' : 'rgba(255,255,255,0.95)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#13C7DC';
        ctx.stroke();
      });
      if (state.siteRoute.locked) {
        const mid = pts[Math.floor(pts.length / 2)];
        ctx.font = '800 12px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = '#8A5A00';
        ctx.textAlign = 'center';
        ctx.fillText('LOCKED', mid.x, mid.y - SITE_DRAW_R - 8);
      }
    }

    for (const t of (state.siteTargets || [])) {
      if (t.x === null || t.x === undefined) continue;
      const dragging = state.dragging?.kind === 'site-move' &&
                       state.dragging.target?.id === t.id && state.dragging.moved;
      const at = dragging ? toScreen(state.dragging.last) : toScreen(t);
      const selected = state.siteSelectedId === t.id;
      const colour = P[t.kind] || P.duct;

      // The target itself: a wide ring, not a dot. The ring is the thing being
      // aimed at, so it is drawn the size it is hit at.
      ctx.beginPath();
      ctx.arc(at.x, at.y, SITE_DRAW_R, 0, Math.PI * 2);
      ctx.fillStyle = dragging ? 'rgba(19,199,220,0.30)'
        : selected ? 'rgba(19,199,220,0.22)' : 'rgba(255,255,255,0.72)';
      ctx.fill();
      ctx.lineWidth = selected || dragging ? 4 : 2.5;
      ctx.strokeStyle = selected || dragging ? '#13C7DC' : colour;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x, at.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();

      if (t.badge) {
        ctx.font = '800 10.5px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeText(t.badge, at.x, at.y - SITE_DRAW_R - 9);
        ctx.fillStyle = colour;
        ctx.fillText(t.badge, at.x, at.y - SITE_DRAW_R - 9);
      }
      // Where it came from, while it is being moved: an installer needs to see
      // how far they have taken it, not just where their finger is.
      if (dragging) {
        const from = toScreen(t);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(19,199,220,0.7)';
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(at.x, at.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
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
        void b;   // no badge is drawn in design view — nothing to reserve
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

    // SECONDARY. Nick: "zone info neat and secondary". A title block twice the
    // height of a bedroom is not secondary, it is the first thing you read.
    const titleFont = '800 9px -apple-system, system-ui, sans-serif';
    const headFont = '700 7px -apple-system, system-ui, sans-serif';
    const rowFont = '600 8.5px -apple-system, system-ui, sans-serif';
    const numFont = '600 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';

    ctx.save();
    ctx.font = rowFont;
    const nameW = Math.min(92, Math.max(50,
      Math.ceil(Math.max(...chips.map(c => ctx.measureText(zoneShortName(c)).width))) + 4));
    const pad = 7, rowH = 12, headH = 24;
    // Columns are measured from where the NAME starts (past the swatch), not
    // from the panel edge — measuring from the edge is what let a long room
    // name run straight through the kW figure beside it.
    const nameX = pad + 14;
    const colKw = nameX + nameW + 10, colLs = colKw + 34, colM2 = colLs + 34;
    const w = colM2 + 36 + pad;
    const h = headH + chips.length * rowH + pad;

    // fit() reserves the gutter, so the schedule has a home rather than hunting
    // for a gap. It only falls back onto the plan on a canvas too narrow to
    // have reserved one.
    const gutter = scheduleGutter(r);
    const box = gutter
      ? { x: Math.max(8, (gutter - w) / 2), y: 14 }
      : { x: 10, y: 10 };
    box.x = Math.max(6, Math.min(box.x, r.width - w - 6));
    box.y = Math.max(6, Math.min(box.y, r.height - h - 6));

    // A LEGEND ON A DRAWING SHEET, not a dark UI chip. The plan is pale; a
    // heavy black block beside it pulls the eye away from the ducts, which are
    // the thing being read.
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.strokeStyle = 'rgba(60,66,88,0.35)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(box.x, box.y, w, h, 5); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(box.x, box.y, w, h); ctx.strokeRect(box.x, box.y, w, h); }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = titleFont;
    ctx.fillStyle = '#16162e';
    ctx.fillText('ZONE SCHEDULE', box.x + pad, box.y + 6);

    ctx.font = headFont;
    ctx.fillStyle = '#7b8398';
    ctx.fillText('ZONE', box.x + nameX, box.y + 17);
    ctx.textAlign = 'right';
    ctx.fillText('kW', box.x + colKw + 18, box.y + 17);
    ctx.fillText('L/s', box.x + colLs + 18, box.y + 17);
    ctx.fillText('m\u00b2', box.x + colM2 + 18, box.y + 17);

    chips.forEach((c, i) => {
      const y = box.y + headH + i * rowH;
      // The swatch is the link back to the plan: the same colour fills the
      // rooms and the same number is on the badge in them.
      ctx.fillStyle = c.colour;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(box.x + pad, y + 1.5, 10, 9.5, 2);
      else ctx.rect(box.x + pad, y + 1.5, 10, 9.5);
      ctx.fill();
      // The tag is the SAME tag as the one on the damper out on the plan —
      // Z3 here is Z3 there — which is how a schedule row and a motor in a
      // roof become obviously the same thing.
      ctx.font = '800 6.5px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText('Z' + String(c.index ?? i + 1), box.x + pad + 5, y + 3.5);

      ctx.textAlign = 'left';
      ctx.font = rowFont;
      ctx.fillStyle = '#23283a';
      // Clipped to its own column. A room name running through the kW figure
      // beside it is how a schedule stops being a schedule.
      ctx.save();
      ctx.beginPath(); ctx.rect(box.x + nameX, y, nameW, rowH); ctx.clip();
      ctx.fillText(zoneShortName(c), box.x + nameX, y + 2);
      ctx.restore();

      ctx.textAlign = 'right';
      ctx.font = numFont;
      ctx.fillStyle = '#4a5268';
      ctx.fillText((c.kw ?? 0).toFixed(2), box.x + colKw + 18, y + 2);
      ctx.fillText(String(Math.round(c.airflowLs || 0)), box.x + colLs + 18, y + 2);
      ctx.fillText((c.areaSqM ?? 0).toFixed(1), box.x + colM2 + 18, y + 2);
    });
    ctx.restore();
    state.labelBoxes.push({ x: box.x, y: box.y, w, h, kind: 'schedule' });
    // Where the column starts and how wide it is, so the duct key and the
    // symbol key line up on it instead of each choosing their own left edge.
    state.scheduleX = box.x;
    state.scheduleW = w;
    const keyBottom = drawSizeKey(box.x, box.y + h + 10, w);
    // Where the title block ends, so the symbol key can sit straight under it
    // rather than being pinned to the bottom of whatever the canvas happens to
    // be. On a report that tall empty strip of column was scaled up along with
    // the drawing.
    state.scheduleBottomY = keyBottom ?? (box.y + h + 10);
  }

  /**
   * THE DUCT SIZE KEY.
   *
   * Nick's first rule of reading the drawing is "duct size from colour", so the
   * key belongs ON the sheet under the schedule, not in a strip of HTML beside
   * the canvas where it is not part of the drawing and does not print.
   */
  function drawSizeKey(x, y, w) {
    const sizes = sizeKey(state.routes || {});
    const hasReturn = Object.values(state.routes || {}).some(r => r.role === 'return');
    if (!sizes.length) return;
    const rows = sizes.length + (hasReturn ? 1 : 0);
    const rowH = 12, pad = 7, headH = 18;
    const h = headH + rows * rowH + pad;

    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.strokeStyle = 'rgba(60,66,88,0.35)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '800 9px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#16162e';
    ctx.fillText('DUCT SIZE', x + pad, y + 6);

    ctx.lineCap = 'round';
    sizes.forEach((sz, i) => {
      const ry = y + headH + i * rowH + rowH / 2;
      ctx.strokeStyle = sz.colour;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + pad, ry); ctx.lineTo(x + pad + 22, ry); ctx.stroke();
      ctx.font = '600 8.5px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#23283a';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u00f8' + sz.diameterMm, x + pad + 28, ry);
    });
    if (hasReturn) {
      const ry = y + headH + sizes.length * rowH + rowH / 2;
      ctx.strokeStyle = DRAWING.returnColour;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x + pad, ry); ctx.lineTo(x + pad + 22, ry); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#23283a';
      ctx.textBaseline = 'middle';
      ctx.font = '600 8.5px -apple-system, system-ui, sans-serif';
      ctx.fillText('RETURN', x + pad + 28, ry);
    }
    ctx.restore();
    state.labelBoxes.push({ x, y, w, h, kind: 'schedule' });
    return y + h;
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
  /**
   * NO NUMBERED CIRCLES ON THE PLAN.
   *
   * Nick: "Hide by default ... unnecessary numbered circles, repeated labels."
   * Zoning is read off the DAMPERS — the Z-tag is on the motor, where the zone
   * actually closes — and the schedule carries the figures. A disc in the
   * middle of every room was a third way of saying the same thing, sitting on
   * top of the diffusers while it said it.
   *
   * The zone that never closes has no damper to label, so the schedule marks
   * it rather than the plan.
   */
  function drawZoneBadges() { /* intentionally nothing — see above */ }

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
        // A BRANCH TAKE-OFF IS A PIECE OF SHEET METAL, NOT A DIAMOND.
        //
        // This drew a yellow diamond, which is the shape Nick objected to — "no
        // diamond" — and it is also a ROUTE NODE drawn over the body, which the
        // brief rules out. The setup view is not the installer drawing, but a
        // symbol that means one thing on one view and another on the next is
        // worse than either. So it is the library's manifold here too, at the
        // small end of its range.
        SYMBOLS.drawBto(ctx, s, {
          inletAngle: m.angle ?? Math.PI, outletAngles: [0], scale: 0.85 });
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

      // ONE EDITING COLOUR ACROSS THE WHOLE APPLICATION.
      //
      // These were their own yellows and blues, which meant "you are editing
      // this" was said three different ways depending on which mode you were
      // in — and none of them matched the cyan the outlet handles use. Nick's
      // palette: "Selected editing item: bright cyan highlight." A locked node
      // keeps its own grey and its bar, because locked is a different statement
      // from editable and must not read as cyan.
      if (h.locked) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0c0c24';
        ctx.fillStyle = '#8f98b5';
        ctx.beginPath(); ctx.rect(p.x - r, p.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#0c0c24'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(p.x - r * 0.55, p.y); ctx.lineTo(p.x + r * 0.55, p.y); ctx.stroke();
      } else {
        // A junction — which on this design is a BTO — gets a slightly larger
        // grab point, because it moves a fitting rather than a bend.
        SYMBOLS.drawEditHandle(ctx, p,
          { r: h.kind === 'junction' ? r * 1.15 : r * 0.9 });
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

  /**
   * EDIT OUTLETS: A GRAB POINT, NOT A REPLACEMENT SYMBOL.
   *
   * `drawLayout` paints each placed item as a big filled rectangle, which is
   * right for the SETUP view where there is no drawing underneath. Over the
   * installer drawing it buried every diffuser it was meant to let you move —
   * Nick: "Editing handles must not replace the outlet symbol." So on the clean
   * drawing each item gets a small handle offset clear of its own symbol, and
   * the symbol stays visible while you drag it.
   */
  function drawLayoutHandles() {
    for (const [key, item] of Object.entries(state.layout)) {
      if (!item || item.x === undefined) continue;
      const s = toScreen(item);
      SYMBOLS.drawEditHandle(ctx, { x: s.x + 13, y: s.y - 13 }, { r: 5.5 });
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

  // ── SITE ADJUST ─────────────────────────────────────────────────────────
  //
  // The viewer owns the GESTURES and the coordinates; Site Adjust owns what the
  // things under the finger MEAN. So the hit tests are callbacks: this file
  // never learns what a BTO is, and site-adjust.mjs never learns about pinch
  // zoom or device pixel ratios.
  //
  // Nothing recalculates during a drag. `onSiteMoveEnd` fires ONCE, on release.
  function siteRadius() { return SITE_TOUCH_R / state.scale; }

  function siteDown(e, img) {
    const g = state.siteGesture;
    if (g === SITE_GESTURE.PAN) {
      panning = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
      return;
    }

    if (g === SITE_GESTURE.ROUTE) {
      const hit = opts.onSiteRouteHit?.(img, siteRadius()) || null;
      if (hit?.pointIndex !== null && hit?.pointIndex !== undefined) {
        state.dragging = { kind: 'site-route', hit, start: img, last: img, moved: false };
        // Press and hold removes the point. One finger, no right-click.
        state.holdTimer = setTimeout(() => {
          if (state.dragging?.kind === 'site-route' && !state.dragging.moved) {
            state.dragging = null;
            opts.onSiteRoutePointHold?.(hit);
            draw();
          }
        }, 550);
        draw();
        return;
      }
      if (hit?.sectionId) {
        state.dragging = { kind: 'site-route-tap', hit, start: img, moved: false };
        return;
      }
      panning = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
      return;
    }

    const target = opts.onSiteHit?.(img, siteRadius()) || null;

    if (g === SITE_GESTURE.MOVE) {
      if (target && target.movable !== false) {
        state.siteSelectedId = target.id;
        state.dragging = { kind: 'site-move', target, start: img, last: img, moved: false };
        draw();
        return;
      }
      // Nothing under the finger: the plan may still be moved, which is the one
      // place the two gestures are allowed to share a finger.
      panning = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
      return;
    }

    if (g === SITE_GESTURE.ADD || g === SITE_GESTURE.DELETE ||
        g === SITE_GESTURE.SELECT) {
      state.dragging = { kind: 'site-tap', target, start: img, moved: false, gesture: g };
      return;
    }
    panning = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    // ── A FINGER THAT NEVER LIFTED ────────────────────────────────────────
    //
    // A pointerup can go missing: the canvas is re-parented mid-gesture when a
    // commit re-renders the screen, a dialog opens over it, the browser cancels
    // the capture. The id then sits in this map forever, every later touch
    // makes it look like TWO fingers, and the viewer treats every tap as the
    // start of a pinch — so nothing on the plan can be tapped again until the
    // page is reloaded. On an iPad that reads as "the app has stopped working".
    //
    // So a pointer nobody has heard from in a second and a half is gone.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    for (const [id, p] of pointers) {
      if (id !== e.pointerId && now - (p.t || 0) > 1500) pointers.delete(id);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now });
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

    if (state.mode === MODES.SITE) { siteDown(e, img); return; }

    if (state.mode === MODES.LAYOUT) {
      const key = layoutHit(img);
      if (key) {
        opts.onLayoutPick?.(key, { ...state.layout[key] });
        state.dragging = { kind: 'layout', key };
        return;
      }
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
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY,
      t: (typeof performance !== 'undefined' ? performance.now() : Date.now()) });

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
    // ── SITE ADJUST DRAGS ─────────────────────────────────────────────────
    // A ghost follows the finger and NOTHING ELSE HAPPENS. The design is not
    // touched, the engine is not run, the schedule is not rebuilt. All of that
    // happens once, on release, in endPointer.
    if (state.dragging?.kind === 'site-move' || state.dragging?.kind === 'site-route') {
      const moved = Math.hypot(img.x - state.dragging.start.x, img.y - state.dragging.start.y);
      if (moved > 3 / state.scale) {
        state.dragging.moved = true;
        clearTimeout(state.holdTimer);
      }
      state.dragging.last = img;
      draw();
      return;
    }
    if (state.dragging?.kind === 'site-tap' || state.dragging?.kind === 'site-route-tap') {
      if (Math.hypot(img.x - state.dragging.start.x, img.y - state.dragging.start.y) >
          6 / state.scale) state.dragging.moved = true;
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
      // Somebody has put the plan where they want it; a later re-fit would be
      // the tool undoing their work.
      if (Math.hypot(e.clientX - panning.x, e.clientY - panning.y) > 4) {
        state.userAdjusted = true;
      }
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

      // ── SITE ADJUST: ONE COMMIT, ON RELEASE ────────────────────────────
      if (d.kind === 'site-move') {
        if (d.moved) opts.onSiteMoveEnd?.(d.target, d.last);
        else opts.onSiteSelect?.(d.target);
        draw();
        return;
      }
      if (d.kind === 'site-route') {
        if (d.moved) opts.onSiteRoutePointEnd?.(d.hit, d.last);
        draw();
        return;
      }
      if (d.kind === 'site-route-tap') {
        if (!d.moved) opts.onSiteRouteTap?.(d.hit, d.start);
        draw();
        return;
      }
      if (d.kind === 'site-tap') {
        if (!d.moved) {
          if (d.gesture === SITE_GESTURE.ADD) opts.onSiteAdd?.(d.start, d.target);
          else if (d.gesture === SITE_GESTURE.DELETE) opts.onSiteDelete?.(d.target, d.start);
          else { state.siteSelectedId = d.target?.id ?? null; opts.onSiteSelect?.(d.target); }
        }
        draw();
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
  // The browser took the capture away — the gesture is over whether or not a
  // pointerup ever arrives. Ending it here is what stops the stale-finger bug
  // above from happening in the first place.
  canvas.addEventListener('lostpointercapture', (e) => {
    if (pointers.has(e.pointerId)) endPointer(e);
  });
  canvas.addEventListener('pointerleave', (e) => { if (panning || drawingRoom) endPointer(e); });
  // A finger that leaves the canvas mid-drag must not leave a fitting half
  // moved: the drag is ended where it left, and it commits like any other.
  canvas.addEventListener('pointerout', (e) => {
    if (state.mode === MODES.SITE && String(state.dragging?.kind || '').startsWith('site')) {
      endPointer(e);
    }
  });

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

    // ── SITE ADJUST ───────────────────────────────────────────────────────
    /** Which gesture the finger is armed with. Panning and moving are modes. */
    /** Keep the drawing fitted as the box changes shape. On for Site Adjust. */
    setAutoFit(on) { state.autoFit = !!on; if (on) state.userAdjusted = false; },
    setSiteGesture(g) {
      state.siteGesture = g || SITE_GESTURE.SELECT;
      canvas.style.cursor = g === SITE_GESTURE.PAN ? 'grab'
        : g === SITE_GESTURE.ADD || g === SITE_GESTURE.DELETE ? 'crosshair' : 'pointer';
      draw();
    },
    getSiteGesture: () => state.siteGesture,
    /** What the gesture layer thinks is happening. For diagnostics only. */
    gestureDebug: () => ({ mode: state.mode, gesture: state.siteGesture,
                           pointers: pointers.size, dragging: state.dragging?.kind || null,
                           panning: !!panning, targets: state.siteTargets.length,
                           scale: state.scale }),
    /** Everything that can be grabbed, in image coordinates. */
    setSiteTargets(list) { state.siteTargets = list || []; draw(); },
    setSiteSelected(id) { state.siteSelectedId = id ?? null; draw(); },
    /** The one run open for route editing, or null. */
    setSiteRoute(route) { state.siteRoute = route || null; draw(); },
    getSiteRoute: () => state.siteRoute,
    /** What Site Adjust's tests are given, so the two can never drift apart. */
    siteTouchRadius: () => SITE_TOUCH_R / state.scale,
    siteRedraw: () => draw(),
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
    /**
     * The facts the symbol library needs to label equipment properly.
     *
     * Kept as one call because these travel together: they are all "what this
     * particular job's equipment actually is", and the symbols are useless as
     * a shared library if each surface has to remember to pass them separately.
     */
    setEquipment({ unitModel, returnGrilles, outletType, supplyPlenum } = {}) {
      if (unitModel !== undefined) state.unitModel = unitModel;
      if (returnGrilles !== undefined) state.returnGrilles = returnGrilles || [];
      if (outletType !== undefined) state.outletType = outletType;
      if (supplyPlenum !== undefined) state.supplyPlenum = supplyPlenum || null;
      draw();
    },
    /** Highlight one item in cyan — the thing under the finger. */
    setSelected(id) { state.selectedId = id || null; draw(); },
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
    snapshot({ type = 'image/jpeg', quality = 0.92,
               clean = true, legend = true } = {}) {
      // A REPORT IS ALWAYS THE CLEAN DRAWING.
      //
      // This captured whatever the canvas happened to be showing, so a snapshot
      // taken while an edit mode was on put drag handles and room boxes into a
      // customer PDF. Nick: "Reports: Use Clean View automatically." So the
      // view is forced clean for the capture and put back afterwards — the
      // estimator does not lose their place for having pressed Download.
      const prior = { mode: state.mode, designView: state.designView,
                      showAnalysis: state.showAnalysis, showRooms: state.showRooms,
                      handles: state.handles, legend: state.showLegend,
                      paper: state.paperBackground };
      state.paperBackground = true;
      if (clean) {
        state.mode = MODES.VIEW;
        state.designView = true;
        state.showAnalysis = false;
        state.showRooms = false;
        state.handles = [];
        state.showLegend = legend;
        draw();
      }
      const restore = () => {
        if (!clean) return;
        Object.assign(state, { mode: prior.mode, designView: prior.designView,
                               showAnalysis: prior.showAnalysis, showRooms: prior.showRooms,
                               handles: prior.handles, showLegend: prior.legend,
                               paperBackground: prior.paper });
        draw();
      };
      // The paper background is restored even when `clean` was not asked for.
      const restoreAll = () => { state.paperBackground = prior.paper; restore(); if (!clean) draw(); };
      try { return snapshotNow(type, quality); } finally { restoreAll(); }
    },
    /**
     * THE TITLE BLOCK ON ITS OWN, so the plan does not have to share a bitmap.
     *
     * Captured together, the column and the drawing become one picture whose
     * shape is neither the column's nor the plan's — and a landscape page then
     * scales that shape to fit, which means the drawing is sized by how tall the
     * key happens to be. Captured apart, the plan can be set to the full height
     * of the paper and the key placed beside it.
     */
    legendStrip({ type = 'image/jpeg', quality = 0.94 } = {}) {
      const prior = { mode: state.mode, designView: state.designView,
                      showAnalysis: state.showAnalysis, showRooms: state.showRooms,
                      handles: state.handles, legend: state.showLegend,
                      paper: state.paperBackground };
      state.mode = MODES.VIEW; state.designView = true;
      state.showAnalysis = false; state.showRooms = false; state.handles = [];
      state.showLegend = true; state.paperBackground = true;
      draw();
      try {
        const boxes = (state.labelBoxes || []).filter(b => b.kind === 'schedule');
        if (!boxes.length) return null;
        const x0 = Math.min(...boxes.map(b => b.x)) - 6;
        const y0 = Math.min(...boxes.map(b => b.y)) - 6;
        const x1 = Math.max(...boxes.map(b => b.x + b.w)) + 6;
        const y1 = Math.max(...boxes.map(b => b.y + b.h)) + 6;
        if (!(x1 - x0 > 30 && y1 - y0 > 30)) return null;
        const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
        const out = document.createElement('canvas');
        out.width = Math.round((x1 - x0) * dpr);
        out.height = Math.round((y1 - y0) * dpr);
        const c = out.getContext('2d');
        c.fillStyle = '#FFFFFF';
        c.fillRect(0, 0, out.width, out.height);
        c.drawImage(canvas, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr,
                    0, 0, out.width, out.height);
        return out.toDataURL(type, quality);
      } catch (e) {
        return null;
      } finally {
        Object.assign(state, { mode: prior.mode, designView: prior.designView,
                               showAnalysis: prior.showAnalysis, showRooms: prior.showRooms,
                               handles: prior.handles, showLegend: prior.legend,
                               paperBackground: prior.paper });
        draw();
      }
    },

    /** The raw capture, with the view exactly as it stands. */
    snapshotRaw({ type = 'image/jpeg', quality = 0.92 } = {}) {
      return snapshotNow(type, quality);
    },

    /**
     * AN ENLARGED CROP OF THE EQUIPMENT AREA.
     *
     * Nick: "An enlarged equipment-area inset… the installer must be able to
     * see the return plenum fitted to the FCU intake, the FCU body, the supply
     * plenum fitted to the discharge, two ø400 return collars, three ø400
     * supply collars."
     *
     * At whole-house scale all of that is about a centimetre of paper. So the
     * capture is taken from the SAME Clean View drawing — not a second,
     * separately-drawn picture that could disagree with it — and the region
     * comes from the bounds the renderer itself recorded for the assembly. The
     * crop is then scaled up, so the collars print at a size you can count.
     */
    equipmentInset({ type = 'image/jpeg', quality = 0.94, pad = 150, zoom = 2.4 } = {}) {
      const prior = { mode: state.mode, designView: state.designView,
                      showAnalysis: state.showAnalysis, showRooms: state.showRooms,
                      handles: state.handles, legend: state.showLegend,
                      paper: state.paperBackground };
      state.mode = MODES.VIEW;
      state.designView = true;
      state.showAnalysis = false;
      state.showRooms = false;
      state.handles = [];
      state.showLegend = false;              // a legend inside a crop is noise
      state.paperBackground = true;
      draw();
      try {
        const b = state.drawn?.equipment?.bounds;
        if (!state.image || !b) return null;
        const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
        // ── NO LABEL MAY BE CUT BY THE EDGE OF THE PICTURE ──────────────
        //
        // Nick: "The equipment inset currently clips the Kitchen outlet label
        // on the left, the Lounge label on the right, parts of BTO-A and BTO-C1
        // ... No label may be cut by the image boundary."
        //
        // A fixed pad around the assembly cannot know that, because a label
        // sits wherever the placer found room. So the window starts at the pad
        // and then GROWS to swallow whole any label it has caught part of —
        // twice, because swallowing one can bring the edge up against another.
        // Half a label is worse than no label: `· 400-250-250-250` with the
        // name cut off is a spec an installer cannot match to a fitting.
        let box = { x0: b.cx - b.w / 2 - pad, y0: b.cy - b.h / 2 - pad,
                    x1: b.cx + b.w / 2 + pad, y1: b.cy + b.h / 2 + pad };
        const labels = (state.labelBoxes || [])
          .filter(l => l.kind !== 'schedule')
          .map(l => ({ x0: l.x, y0: l.y, x1: l.x + l.w, y1: l.y + l.h }))
          .concat((state.drawn?.boxes || [])
            .filter(k => !k.symbol)
            .map(k => ({ x0: k.x0, y0: k.y0, x1: k.x1, y1: k.y1 })));
        const M2 = 4;                       // a hair of white outside the text
        for (let pass = 0; pass < 3; pass++) {
          let grew = false;
          for (const l of labels) {
            const touches = l.x0 < box.x1 && box.x0 < l.x1 &&
                            l.y0 < box.y1 && box.y0 < l.y1;
            if (!touches) continue;
            if (l.x0 - M2 < box.x0) { box.x0 = l.x0 - M2; grew = true; }
            if (l.y0 - M2 < box.y0) { box.y0 = l.y0 - M2; grew = true; }
            if (l.x1 + M2 > box.x1) { box.x1 = l.x1 + M2; grew = true; }
            if (l.y1 + M2 > box.y1) { box.y1 = l.y1 + M2; grew = true; }
          }
          if (!grew) break;
        }
        const x = Math.max(0, box.x0 * dpr);
        const y = Math.max(0, box.y0 * dpr);
        const w = Math.min(canvas.width - x, (box.x1 - box.x0) * dpr);
        const h = Math.min(canvas.height - y, (box.y1 - box.y0) * dpr);
        if (!(w > 20 && h > 20)) return null;
        const out = document.createElement('canvas');
        out.width = Math.round(w * zoom);
        out.height = Math.round(h * zoom);
        const c = out.getContext('2d');
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.fillStyle = '#FFFFFF';
        c.fillRect(0, 0, out.width, out.height);
        c.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
        return out.toDataURL(type, quality);
      } catch (e) {
        return null;
      } finally {
        Object.assign(state, { mode: prior.mode, designView: prior.designView,
                               showAnalysis: prior.showAnalysis, showRooms: prior.showRooms,
                               handles: prior.handles, showLegend: prior.legend,
                               paperBackground: prior.paper });
        draw();
      }
    }
  };

  /**
   * THE PLAN, NOT A PHOTOGRAPH OF THE APP.
   *
   * The canvas is whatever shape the browser window is, and the viewer paints
   * the space around the plan in the app's own dark chrome. Embedded whole,
   * that dark surround took roughly half of the landscape sheet and the drawing
   * was scaled down to fit inside it — on the one page an installer actually
   * carries.
   *
   * So the capture is trimmed to what was drawn: the plan image's own rectangle,
   * grown to take in any duct, symbol or label that reaches outside it, and the
   * legend and zone schedule in their corners.
   */
  /**
   * THE RECTANGLE THAT ACTUALLY HAS INK IN IT.
   *
   * The image rectangle is not the drawing. A builder's sheet carries white
   * margins all round, and on the landscape page that white was scaled up along
   * with everything else — the plan was drawn as tall as the paper allowed and
   * then a fifth of that height was the sheet's own blank border.
   *
   * So the canvas is scanned for anything that is not the paper background. It
   * runs once, on a capture, over a few million pixels, and it is the difference
   * between a drawing an installer can read at arm's length and one they cannot.
   */
  function inkBounds() {
    try {
      const w = canvas.width, h = canvas.height;
      const px = ctx.getImageData(0, 0, w, h).data;
      const dpr = w / Math.max(1, canvas.clientWidth || w);
      // INK, NOT "ANYTHING THAT IS NOT PURE WHITE".
      //
      // A first/last off-white pixel rule hands the sheet to whatever the
      // builder drew out in the margins. On this plan that is a pale landscaping
      // strip down the right edge and the ghost of a title-block border down the
      // left: between them they were about a fifth of the captured width, and on
      // a landscape page the drawing was scaled down to make room for them.
      const cols = new Int32Array(w), rows = new Int32Array(h);
      let total = 0;
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
          const i = row + x * 4;
          const v = px[i] < px[i + 1] ? (px[i] < px[i + 2] ? px[i] : px[i + 2])
                                      : (px[i + 1] < px[i + 2] ? px[i + 1] : px[i + 2]);
          if (v > 200) continue;
          cols[x]++; rows[y]++; total++;
        }
      }
      if (!total) return null;
      // THE DRAWING IS THE BIG BLOCK OF INK.
      //
      // Lines carrying ink are grouped into runs; runs separated by less than a
      // clear gutter are one run; the heaviest run is the drawing. Sheet
      // furniture sits beyond a white gutter and carries a fraction of the ink,
      // so it drops out — while an outside wall at the edge of the house does
      // not, because there is no gutter between it and the rest of the plan.
      const span = (counts, n, cross) => {
        // A line counts as inked on its own ink, never on how much ink the
        // drawing has elsewhere: a share-of-total floor threw away the garage,
        // which is mostly white, along with the sheet's margins.
        const floor = Math.max(2, Math.round(cross * 0.005));
        const gutter = Math.max(14, Math.round(n * 0.02));
        let best = null, cur = null, blank = 0;
        const close = () => {
          if (cur && (!best || cur.ink > best.ink)) best = cur;
          cur = null; blank = 0;
        };
        for (let i = 0; i < n; i++) {
          if (counts[i] >= floor) {
            if (!cur) cur = { a: i, b: i, ink: 0 };
            cur.b = i; cur.ink += counts[i]; blank = 0;
          } else if (cur && ++blank > gutter) close();
        }
        close();
        return best ? [best.a, best.b] : [0, n - 1];
      };
      const [x0, x1] = span(cols, w, h);
      const [y0, y1] = span(rows, h, w);
      if (!(x1 > x0 && y1 > y0)) return null;
      return { x: x0 / dpr, y: y0 / dpr,
               w: (x1 - x0) / dpr, h: (y1 - y0) / dpr };
    } catch (e) { return null; }
  }

  function drawnBounds() {
    if (!state.image) return null;
    const ink = inkBounds();
    const a = ink ? { x: ink.x, y: ink.y } : toScreen({ x: 0, y: 0 });
    const b = ink ? { x: ink.x + ink.w, y: ink.y + ink.h }
                  : toScreen({ x: state.image.naturalWidth, y: state.image.naturalHeight });
    let box = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
                x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
    const take = (x0, y0, x1, y1) => {
      box.x0 = Math.min(box.x0, x0); box.y0 = Math.min(box.y0, y0);
      box.x1 = Math.max(box.x1, x1); box.y1 = Math.max(box.y1, y1);
    };
    for (const bx of (state.drawn?.boxes || [])) take(bx.x0, bx.y0, bx.x1, bx.y1);
    // The title block is captured separately for a report, so it must not drag
    // the plan's own crop out to meet it. Asked for WITH the legend, it is part
    // of the picture and is taken in explicitly — the ink rule above keeps only
    // the heaviest block of ink, and the column sits across a white gutter from
    // the drawing, which is exactly what that rule is there to throw away.
    for (const b of (state.labelBoxes || [])) {
      if (b.kind !== 'schedule') continue;
      if (state.showLegend) take(b.x, b.y, b.x + b.w, b.y + b.h);
      else if (state.paperBackground && box.x0 < b.x + b.w) {
        box.x0 = Math.max(box.x0, b.x + b.w + 8);
      }
    }
    const pad = 10;
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    return { x: Math.max(0, box.x0 - pad), y: Math.max(0, box.y0 - pad),
             w: Math.min(w, box.x1 + pad) - Math.max(0, box.x0 - pad),
             h: Math.min(h, box.y1 + pad) - Math.max(0, box.y0 - pad) };
  }

  function snapshotNow(type, quality) {
      // No plan, or a canvas that was never laid out because the Plan tab has
      // not been opened, gives a 1-pixel image. Embedding that puts a blank
      // rectangle in a customer document, which looks like a printing fault.
      // Nothing is better than nothing pretending to be something.
    if (!state.image) return null;
    if (canvas.width < 80 || canvas.height < 80) return null;
    try {
      const b = drawnBounds();
      if (!b || !(b.w > 40 && b.h > 40)) return canvas.toDataURL(type, quality);
      const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
      const out = document.createElement('canvas');
      out.width = Math.round(b.w * dpr);
      out.height = Math.round(b.h * dpr);
      const c = out.getContext('2d');
      // White behind it: a JPEG has no alpha, and a report page is paper.
      c.fillStyle = '#FFFFFF';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(canvas, b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr,
                  0, 0, out.width, out.height);
      return out.toDataURL(type, quality);
    } catch (e) { return null; }
  }
}
