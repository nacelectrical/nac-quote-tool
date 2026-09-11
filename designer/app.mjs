// NAC AI HVAC DESIGNER — application shell.
//
// Workflow:  UPLOAD PLAN → CALIBRATE → VERIFY ROOMS → SIZE SYSTEM
//            → DESIGN AIRFLOW → DESIGN DUCTS → REVIEW → QUOTE
//
// This module owns state and wiring only. Every number on screen comes out of
// the deterministic engines in ./engines; nothing is computed here.

import { h, mount, clear, button, badge, banner, empty, toast, input, field, select, card, table } from './ui/dom.mjs';
import { createPlanViewer, MODES } from './ui/plan-viewer.mjs';
import { renderPdfPage } from './ui/pdf.mjs';
import { tilePlan, mergeTileObservations } from './ui/image.mjs';
import * as Tabs from './ui/tabs.mjs';
import { renderSettingsScreen } from './ui/settings-screen.mjs';
import { internalReportHtml, customerReportHtml, openReport } from './ui/reports.mjs';
import { confirmDialog, alertDialog, formDialog, pickDialog, linkDialog } from './ui/modal.mjs';

import { DEFAULT_SETTINGS, settingsWith } from './engines/settings.mjs';
import { calibrate, parseScaleLabel } from './engines/calibration.mjs';
import { interpretPlan, measureRooms } from './engines/interpret.mjs';
import { chainMmAtPx, chainPxAtMm } from './engines/chains.mjs';
import { parseRoomDimensionPair } from './engines/dimensions.mjs';
import { buildRoom, manualMeasurement, applyRoomOverride, verifyRoom,
         parseFloorAreaText, crossCheckFloorArea } from './engines/rooms.mjs';
import { buildCatalogue, ZONE_CONTROLLERS } from './engines/catalogue.mjs';
import { runPipeline, designSummary } from './engines/pipeline.mjs';
import { routeLength } from './engines/ducts.mjs';
import { acknowledge } from './engines/warnings.mjs';
import { createDesign, addRevision, diffDesigns, restoreRevision } from './engines/model.mjs';
import * as Store from './engines/store.mjs';
import * as Sample from './engines/sample-plan.mjs';
import { samplePlanDataUrl } from './engines/sample-plan-image.mjs';

const TABS = [
  ['overview', 'Overview'], ['plan', 'Plan'], ['rooms', 'Rooms'], ['sizing', 'Sizing'],
  ['equipment', 'Equipment'], ['airflow', 'Airflow'], ['outlets', 'Outlets'],
  ['ductwork', 'Ductwork'], ['return', 'Return'], ['zones', 'Zones'],
  ['materials', 'Materials'], ['financials', 'Financials'], ['warnings', 'Warnings']
];

const STEPS = [
  { key: 'upload',    label: 'Upload plan',   done: (d) => !!d.plan },
  { key: 'calibrate', label: 'Calibrate',     done: (d) => !!d.calibration },
  { key: 'rooms',     label: 'Verify rooms',  done: (d) => (d.rooms || []).some(r => r.conditioned && (r.status === 'Verified' || r.status === 'Manual')) },
  { key: 'size',      label: 'Size system',   done: (d) => !!d.selectedUnit },
  { key: 'airflow',   label: 'Design airflow',done: (d) => !!d.airflow },
  { key: 'ducts',     label: 'Design ducts',  done: (d) => !!d.network && d.network.sections.some(s => s.lengthMm) },
  { key: 'review',    label: 'Review',        done: (d) => d.warningSummary?.canApprove },
  { key: 'quote',     label: 'Quote',         done: (d) => !!d.quoteId }
];

export class DesignerApp {
  constructor(root) {
    this.root = root;
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.settingsOverride = {};
    this.materialRates = {};
    this.equipmentSpecs = {};
    this.nacBrands = null;
    this.nacControllers = null;
    this.catalogue = buildCatalogue({});
    this.controllers = ZONE_CONTROLLERS;
    this.design = createDesign({});
    this.summary = {};
    this.tab = 'plan';
    this.selectedRoomId = null;
    this.settingsSection = null;
    this.specModelKey = '';
    this.assistantOpen = false;
    this.assistantLog = [];
    this.routeTargetRoomId = null;
    this.dirty = false;
    this.busy = false;
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  async init() {
    this.renderShell();
    await this.loadConfig();
    const params = new URLSearchParams(location.search);
    const designId = params.get('design');
    if (designId) {
      const d = await Store.loadDesign(designId);
      if (d) { this.design = d; toast('Loaded design ' + designId); }
      else toast('Could not find design ' + designId, 'bad');
    }
    // ?draft=NAC-… comes from the intake form's notification: start the design
    // on that customer, with the plan they uploaded already on screen.
    const draftRef = params.get('draft');
    if (draftRef && !designId) await this.loadIntakeDraft(draftRef);
    if (params.get('quote')) this.design.quoteId = params.get('quote');
    if (params.get('job')) this.design.jobId = params.get('job');
    if (params.get('sample') === '1') this.loadSample();
    this.recompute();
    this.render();
    window.addEventListener('beforeunload', (e) => {
      if (this.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  async loadConfig() {
    const [override, rates, specs, brands, controllers] = await Promise.all([
      Store.getJson(Store.SETTINGS_KEYS.hvacSettings, {}),
      Store.getJson(Store.SETTINGS_KEYS.materialRates, {}),
      Store.getJson(Store.SETTINGS_KEYS.equipmentSpecs, {}),
      Store.loadNacBrands(),
      Store.loadNacControllers()
    ]);
    this.settingsOverride = override || {};
    this.settings = settingsWith(this.settingsOverride);
    this.materialRates = rates || {};
    this.equipmentSpecs = specs || {};
    this.nacBrands = brands;
    this.nacControllers = controllers;
    this.rebuildCatalogue();
  }

  rebuildCatalogue() {
    this.catalogue = buildCatalogue({ savedBrands: this.nacBrands, specStore: this.equipmentSpecs });
    // Pull controller prices out of the existing nac_ctrl record.
    this.controllerPricing = {};
    for (const c of (this.nacControllers || [])) {
      if (c.price !== undefined && c.price !== '') this.controllerPricing[c.id] = { price: Number(c.price) };
    }
    this.controllers = ZONE_CONTROLLERS.map(c => ({ ...c, ...(this.controllerPricing[c.id] || {}) }));
  }

  // ── Core recompute ────────────────────────────────────────────────────────

  recompute() {
    this.design = runPipeline(this.design, {
      settings: this.settings,
      catalogue: this.catalogue,
      controllers: this.controllers,
      controllerPricing: this.controllerPricing,
      nacRates: this.materialRates,
      allowLowConfidence: !!this.design.allowLowConfidence
    });
    this.summary = designSummary(this.design);
    this.dirty = true;
  }

  update() { this.recompute(); this.render(); }

  // ── Shell ─────────────────────────────────────────────────────────────────

  renderShell() {
    this.headerEl = h('header', { class: 'app-head' });
    this.stepsEl = h('nav', { class: 'steps' });
    this.tabsEl = h('nav', { class: 'tabs' });
    this.mainEl = h('main', { class: 'main' });
    this.assistantEl = h('aside', { class: 'assistant' });
    mount(this.root, this.headerEl, this.stepsEl, this.tabsEl,
      h('div', { class: 'body' }, this.mainEl, this.assistantEl));
  }

  render() {
    this.renderHeader();
    this.renderSteps();
    this.renderTabs();
    if (this.settingsSection) {
      mount(this.mainEl, renderSettingsScreen(this, this.settingsSection));
    } else if (this.tab === 'plan') {
      this.renderPlanTab();
    } else {
      const fn = {
        overview: Tabs.renderOverview, rooms: Tabs.renderRooms, sizing: Tabs.renderSizing,
        equipment: Tabs.renderEquipment, airflow: Tabs.renderAirflow, outlets: Tabs.renderOutlets,
        ductwork: Tabs.renderDuctwork, return: Tabs.renderReturn, zones: Tabs.renderZones,
        materials: Tabs.renderMaterials, financials: Tabs.renderFinancials, warnings: Tabs.renderWarnings
      }[this.tab];
      mount(this.mainEl, h('div', { class: 'tab-body' }, ...(fn ? fn(this).filter(Boolean) : [empty('—')])));
    }
    this.renderAssistant();
  }

  renderHeader() {
    const w = this.design.warningSummary;
    mount(this.headerEl,
      h('div', { class: 'brand' },
        h('img', { src: '/nac-logo.jpg', alt: 'NAC', onerror: (e) => e.target.style.display = 'none' }),
        h('div', {},
          h('h1', {}, 'NAC AI HVAC DESIGNER'),
          h('div', { class: 'sub' }, this.design.customer?.name || 'New design', ' · ', this.design.id))),
      h('div', { class: 'head-actions' },
        w ? badge((w.counts.CRITICAL || 0) + ' critical · ' + (w.counts.WARNING || 0) + ' warnings',
          w.counts.CRITICAL ? 'bad' : w.counts.WARNING ? 'warn' : 'ok') : null,
        button(this.assistantOpen ? 'Hide assistant' : 'NAC Design Assistant',
          () => { this.assistantOpen = !this.assistantOpen; this.render(); }, 'ghost small'),
        button('Save', () => this.save(), 'small'),
        button('Designs', () => this.showDesignList(), 'ghost small'),
        button('Revisions', () => this.showRevisions(), 'ghost small'),
        button('Settings', () => this.openSettings(), 'ghost small'),
        button('Reports', () => this.showReportMenu(), 'ghost small')));
  }

  renderSteps() {
    mount(this.stepsEl, STEPS.map((s, i) => {
      const done = s.done(this.design);
      return h('button', {
        class: 'step' + (done ? ' done' : ''),
        onclick: () => this.setTab({ upload: 'plan', calibrate: 'plan', rooms: 'rooms', size: 'equipment',
                                     airflow: 'airflow', ducts: 'ductwork', review: 'warnings', quote: 'financials' }[s.key])
      }, h('span', { class: 'step-n' }, done ? '✓' : String(i + 1)), h('span', {}, s.label));
    }));
  }

  renderTabs() {
    mount(this.tabsEl, TABS.map(([key, label]) => {
      const count = key === 'warnings' && this.design.warnings?.length ? this.design.warnings.length : null;
      return h('button', {
        class: 'tab' + (this.tab === key && !this.settingsSection ? ' on' : ''),
        onclick: () => this.setTab(key)
      }, label, count ? h('span', { class: 'tab-count' }, count) : null);
    }));
  }

  setTab(tab) { this.tab = tab; this.settingsSection = null; this.render(); }

  // ── Plan tab (PART 2, 6, 7, 17, 18) ───────────────────────────────────────

  renderPlanTab() {
    const d = this.design;
    const viewerHost = h('div', { class: 'plan-host' });
    const tools = h('div', { class: 'plan-tools' });

    mount(this.mainEl, h('div', { class: 'plan-layout' }, tools, viewerHost));

    if (!this.viewer) {
      this.viewer = createPlanViewer(viewerHost, {
        onCalibrationPoints: (pts) => { this.calibPoints = pts; this.render(); },
        onRoomSelect: (id) => { this.selectedRoomId = id; this.render(); },
        onRoomBoundary: (id, box) => this.setRoomBoundary(id, box),
        onRoomDrawn: (box) => this.createRoomFromBox(box),
        onRouteComplete: (pts) => this.completeRoute(pts),
        onRouteDraft: () => this.render(),
        onLayoutMove: (key, item) => { this.design.layout[key] = { ...item }; this.dirty = true; }
      });
    } else {
      viewerHost.appendChild(this.viewer.element);
    }

    // The viewer only exists once the Plan tab has been opened, so this is the
    // single place the plan image is loaded onto it.
    if (d.plan?.dataUrl && this.loadedPlanUrl !== d.plan.dataUrl) {
      const url = d.plan.dataUrl;
      this.loadedPlanUrl = url;
      this.viewer.setImage(url)
        .then(() => { this.viewer.fit(); this.viewer.redraw(); })
        .catch(() => { this.loadedPlanUrl = null; toast('Could not display the plan image.', 'bad'); });
    } else if (!d.plan) {
      this.loadedPlanUrl = null;
    }

    this.viewer.setRooms(d.rooms || []);
    this.viewer.selectRoom(this.selectedRoomId);
    this.viewer.setCalibration(d.calibration);
    this.viewer.setRoutes(this.routeOverlay());
    this.viewer.setLayout(d.layout || {});
    this.viewer.redraw();

    mount(tools,
      this.renderUploadPanel(),
      this.renderNumbersPanel(),
      this.renderIntakePanel(),
      this.renderCalibratePanel(),
      this.renderPlanModePanel(),
      this.renderRoutePanel(),
      this.renderLayoutPanel());
  }

  renderUploadPanel() {
    const d = this.design;
    const plan = d.plan;
    return card('1. Floor plan', 'PDF, JPG, JPEG or PNG',
      h('input', { type: 'file', class: 'inp', accept: '.pdf,.png,.jpg,.jpeg,image/*,application/pdf',
        disabled: this.busy,
        onchange: (e) => this.handleUpload(e.target.files[0]) }),
      this.busy ? h('div', { class: 'plan-status' }, this.planStatus || 'Opening the plan…') : null,
      plan?.isPdf && plan.pageCount > 1
        ? h('div', { class: 'page-switch' },
            h('span', {}, 'Page'),
            button('‹', () => this.setPlanPage(plan.pageNumber - 1), 'tiny ghost'),
            select(String(plan.pageNumber),
              Array.from({ length: plan.pageCount }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
              v => this.setPlanPage(Number(v))),
            button('›', () => this.setPlanPage(plan.pageNumber + 1), 'tiny ghost'),
            h('span', {}, 'of ' + plan.pageCount))
        : null,
      d.plan ? h('div', { class: 'note' },
        d.plan.fileName +
        (d.plan.widthPx ? ' — ' + d.plan.widthPx + ' × ' + d.plan.heightPx + ' px' : '') +
        (d.plan.isPdf && d.plan.pageCount > 1 ? ' · page ' + d.plan.pageNumber + ' of ' + d.plan.pageCount : '') +
        (d.plan.fromIntake ? ' · from the customer\'s intake form' : '')) : null,
      d.intake?.photoUrls?.length
        ? h('div', { class: 'note' }, d.intake.photoUrls.length + ' site photo(s) from the intake: ',
            d.intake.photoUrls.map((u, i) =>
              h('a', { href: u, target: '_blank', rel: 'noopener', class: 'photo-link' }, (i + 1) + ' ')))
        : null,
      d.plan ? h('div', { class: 'btn-row' },
        button(this.busy ? 'Reading…' : 'Read plan with AI', () => this.readPlan(), 'primary small'),
        button('Fit', () => this.viewer.fit(), 'ghost small'),
        button('+', () => this.viewer.zoomIn(), 'ghost small'),
        button('−', () => this.viewer.zoomOut(), 'ghost small')) : null,
      d.interpretation ? h('div', { class: 'note' },
        d.interpretation.summary.lengthCount + ' dimensions read, ' +
        d.interpretation.summary.chainCount + ' chains, ' +
        d.interpretation.summary.closingChains + ' closing. Image quality: ' +
        (d.interpretation.quality || '—') + '.') : null,
      (d.interpretation?.notes || []).length
        ? h('ul', { class: 'evidence' }, d.interpretation.notes.map(n => h('li', {}, n))) : null,
      button('Load the sample builder plan', () => { this.loadSample(); this.update(); }, 'ghost small'));
  }

  /**
   * Every number the reader took off the drawing, listed so it can be checked
   * against the plan and corrected. A misread digit is the one failure that the
   * confidence scoring downstream cannot catch — the number looks perfectly
   * ordinary, it is just wrong — so this is the only place it can be caught.
   */
  renderNumbersPanel() {
    const d = this.design;
    const dims = d.detectedDimensions || [];
    if (!dims.length) return null;

    const lengths = dims.filter(x => x.mm !== null);
    const showAll = !!this.showAllNumbers;
    const rows = showAll ? dims : lengths;

    return card('Numbers read from the plan',
      'Check each one against the drawing. Edit a wrong value, or clear it to drop it.',
      banner('warn', 'These are read by AI and can be misread. Nothing here is trusted until you have ' +
        'checked it — a wrong digit adds up to a plausible-looking room.'),
      h('div', { class: 'note' },
        lengths.length + ' length(s) read' +
        (dims.length > lengths.length ? ', ' + (dims.length - lengths.length) + ' non-length annotation(s)' : '') +
        (d.interpretation?.tileCount > 1 ? ' across ' + d.interpretation.tileCount + ' sections of the sheet' : '') +
        '. ' + (d.chains || []).length + ' chain(s) built.'),
      ...(d.interpretation?.notes || []).map(n => banner('info', n)),
      ...this.floorAreaCheck(),
      table([
        { key: 'text', label: 'As printed', width: '90px' },
        { key: 'orientation', label: 'Axis', width: '60px',
          render: (r) => badge(r.orientation === 'vertical' ? '↕' : '↔', 'muted') },
        { key: 'classification', label: 'Read as',
          render: (r) => h('span', {}, String(r.classification || 'unknown').replace(/_/g, ' ')) },
        { key: 'mm', label: 'mm', align: 'right', width: '110px',
          render: (r) => input(r.mm ?? '', v => this.editDetectedDimension(r.id, v),
            // Deliberately NOT live: each edit rebuilds every chain and re-measures
            // the rooms, so it commits when the field is left, not per keystroke.
            { type: 'number', step: '1', inputmode: 'numeric', placeholder: 'not a length' }) },
        { key: 'act', label: '', width: '40px',
          render: (r) => button('✕', () => this.removeDetectedDimension(r.id), 'ghost small') }
      ], rows, { rowClass: (r) => r.mm === null ? 'muted-row' : '' }),
      h('div', { class: 'btn-row' },
        button(showAll ? 'Hide annotations' : 'Show everything read',
          () => { this.showAllNumbers = !showAll; this.render(); }, 'ghost small'),
        button('Re-read the plan', () => this.readPlan(), 'ghost small'),
        button('Clear all', () => this.clearDetectedDimensions(), 'ghost small')));
  }

  /**
   * The floor-area schedule off the sheet, and whether the rooms agree with it.
   * Room areas are internal faces and the schedule measures to the outside of
   * the external walls, so the rooms should come in a little UNDER. Coming in
   * over means two rooms are claiming the same floor.
   */
  floorAreaCheck() {
    const d = this.design;
    if (!d.printedResidenceSqM) return [];
    const check = crossCheckFloorArea(d.rooms || [], d.printedResidenceSqM);
    if (!check) return [];
    return [
      h('div', { class: 'note' },
        'The sheet prints ' + check.printedSqM + ' m² under roof; the rooms add to ' +
        check.summedSqM + ' m² (' + (check.deltaPct > 0 ? '+' : '') + check.deltaPct + '%).'),
      ...check.warnings.map(w => banner(w.severity === 'WARNING' ? 'warn' : 'info', w.message))
    ];
  }

  /** Correct a number the reader got wrong, and rebuild the chains from it. */
  editDetectedDimension(id, value) {
    const mm = value === '' || value === null ? null : Number(value);
    if (mm !== null && (!isFinite(mm) || mm <= 0)) return;
    this.design.detectedDimensions = (this.design.detectedDimensions || [])
      .map(x => x.id === id ? { ...x, mm, source: 'estimator_corrected',
                                evidence: ['Corrected by the estimator.'] } : x);
    this.rebuildFromDimensions();
  }

  removeDetectedDimension(id) {
    this.design.detectedDimensions = (this.design.detectedDimensions || []).filter(x => x.id !== id);
    this.rebuildFromDimensions();
  }

  clearDetectedDimensions() {
    this.design.detectedDimensions = [];
    this.design.chains = [];
    this.design.interpretation = null;
    this.dirty = true;
    toast('Cleared. Draw the rooms on the plan, or type them on the Rooms tab.');
    this.update();
  }

  /**
   * Rebuild the chains — and any room measured from them — after the estimator
   * has changed a number. A correction is worthless if it does not flow through.
   */
  rebuildFromDimensions() {
    const d = this.design;
    const interp = interpretPlan({
      rawDetections: (d.detectedDimensions || []).map(x => ({
        id: x.id, text: x.mm === null ? x.text : String(x.mm), box: x.box,
        orientation: x.orientation, row: x.row
      })),
      walls: d.walls, openings: d.openings,
      overallWidthMm: null, overallDepthMm: null
    }, { settings: this.settings });

    d.detectedDimensions = interp.detectedDimensions.map(x => {
      const prior = (this.design.detectedDimensions || []).find(p => p.id === x.id);
      return prior?.source === 'estimator_corrected' ? { ...x, source: 'estimator_corrected' } : x;
    });
    d.chains = interp.chains;
    d.interpretation = { ...(d.interpretation || {}), summary: interp.summary };

    // Re-measure any room that was placed against a chain.
    const rooms = this.roomsFromObservations(
      { roomLabels: (d.rooms || []).filter(r => r.labelPx).map(r => ({ text: r.label, box: r.labelPx })) },
      interp);
    if (rooms.length) {
      const byLabel = new Map(rooms.map(r => [r.label.toLowerCase(), r]));
      d.rooms = (d.rooms || []).map(r => {
        const next = byLabel.get(r.label.toLowerCase());
        // A room the estimator has typed or verified is never overwritten.
        if (!next || r.measurement?.source === 'manual' || r.status === 'verified') return r;
        return { ...next, id: r.id, conditioned: r.conditioned, roomType: r.roomType,
                 ceilingHeightMm: r.ceilingHeightMm };
      });
    }
    this.dirty = true;
    this.deferUpdate();
  }

  /**
   * Re-render after the current event has finished.
   *
   * A `change` handler fires during the click that blurred the field, so
   * re-rendering inside it replaces the element being clicked and the click is
   * lost — edit a number, tap a tab, nothing happens. Deferring by a frame lets
   * the click land first.
   */
  deferUpdate() {
    if (this._deferred) return;
    this._deferred = requestAnimationFrame(() => { this._deferred = null; this.update(); });
  }

  renderIntakePanel() {
    const intake = this.design.intake;
    if (!intake?.pack) return null;
    return card('From the intake form', 'What the customer submitted, and the quick read taken from it',
      h('pre', { class: 'intake-pack' }, intake.pack),
      h('p', { class: 'note' },
        'That was a quick read for triage. Everything below is measured properly and replaces it.'));
  }

  renderCalibratePanel() {
    const d = this.design;
    const pts = this.calibPoints || [];
    const active = this.viewer?.getMode() === MODES.CALIBRATE;

    return card('2. Calibrate plan', 'Click two points, then enter the distance printed between them',
      banner('info', 'A screenshot or a re-exported PDF does NOT keep its original A3/A4 scale. ' +
        'Any printed scale label is treated as supporting information only.'),
      d.scaleLabel ? h('div', { class: 'note' }, 'Scale label read from the drawing: ' + d.scaleLabel.label +
        ' — ' + d.scaleLabel.note) : null,
      h('div', { class: 'btn-row' },
        button(active ? 'Picking points…' : 'CALIBRATE PLAN',
          () => { this.calibPoints = []; this.viewer.setMode(active ? MODES.VIEW : MODES.CALIBRATE); this.render(); },
          active ? 'primary small' : 'small'),
        active ? button('Reset points', () => { this.calibPoints = []; this.viewer.resetCalibrationPoints(); this.render(); }, 'ghost small') : null),
      active ? h('div', { class: 'note' }, pts.length === 0 ? 'Click point A on the plan.'
        : pts.length === 1 ? 'Now click point B.' : 'Two points set — enter the distance below.') : null,
      active && pts.length === 2 ? h('div', { class: 'grid-2' },
        field('Known distance', input(this.calibDistance ?? '', v => { this.calibDistance = v; },
          { type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'e.g. 6000', live: true })),
        field('Units', select(this.calibUnit || 'mm', ['mm', 'm'], v => { this.calibUnit = v; }))) : null,
      active && pts.length === 2
        ? button('Apply calibration', () => this.applyCalibration(), 'primary small') : null,
      d.calibration ? h('div', { class: 'calib-readout' },
        h('div', {}, h('span', {}, 'CALIBRATION DISTANCE'), h('strong', {}, d.calibration.display.calibrationDistance)),
        h('div', {}, h('span', {}, 'PIXEL DISTANCE'), h('strong', {}, d.calibration.display.pixelDistance)),
        h('div', {}, h('span', {}, 'CALCULATED SCALE'), h('strong', {}, d.calibration.display.calculatedScale)))
        : banner('warn', 'Not calibrated. Rooms read from the plan\'s dimension strings are measured ' +
            'from those dimensions and do not need this, but any room you draw by hand cannot be ' +
            'measured until you calibrate.'));
  }

  renderPlanModePanel() {
    const mode = this.viewer?.getMode() || MODES.VIEW;
    const set = (m) => { this.viewer.setMode(mode === m ? MODES.VIEW : m); this.render(); };
    return card('3. Rooms on the plan', 'Drag to draw a room, drag a corner to resize, drag the middle to move',
      h('div', { class: 'btn-row' },
        button(mode === MODES.ROOM ? 'Editing rooms…' : 'Edit rooms', () => set(MODES.ROOM),
          mode === MODES.ROOM ? 'primary small' : 'small'),
        button('Add room manually', () => this.addManualRoom(), 'ghost small'),
        button('Go to room verification', () => this.setTab('rooms'), 'ghost small')),
      this.selectedRoomId ? (() => {
        const r = (this.design.rooms || []).find(x => x.id === this.selectedRoomId);
        return r ? h('div', { class: 'note' }, r.label + ' — ' +
          (r.areaSqM ? r.areaSqM.toFixed(2) + ' m²' : 'no dimension') + ' · ' +
          Math.round(r.confidence) + '% ' + r.confidenceBand + ' · ' +
          (r.measurement?.sourceLabel || '')) : null;
      })() : null);
  }

  renderRoutePanel() {
    const d = this.design;
    const mode = this.viewer?.getMode() || MODES.VIEW;
    const rooms = (d.airflow?.rows || []).map(r => ({ value: r.roomId, label: r.label }));

    return card('4. Duct routes', 'Click along the route, double-click to finish. Length is measured through the calibration.',
      !d.calibration ? banner('warn', 'Calibrate the plan first — routes cannot be measured without it.') : null,
      h('div', { class: 'grid-2' },
        field('Route for', select(this.routeTargetRoomId || '',
          [{ value: '', label: 'Choose…' }, { value: '__main', label: 'Main duct (unit → plenum)' }, ...rooms],
          v => { this.routeTargetRoomId = v; this.viewer.setActiveRoute(v === '__main' ? 'main' : v); this.render(); })),
        field('', h('div', { class: 'btn-row' },
          button(mode === MODES.ROUTE ? 'Drawing…' : 'Draw route',
            () => { this.viewer.setMode(mode === MODES.ROUTE ? MODES.VIEW : MODES.ROUTE); this.render(); },
            mode === MODES.ROUTE ? 'primary small' : 'small'),
          button('Undo point', () => { this.viewer.undoDraftPoint(); this.render(); }, 'ghost small'),
          button('Clear', () => { this.viewer.clearDraftRoute(); this.render(); }, 'ghost small')))),
      this.routeSummaryTable());
  }

  routeSummaryTable() {
    const d = this.design;
    const rows = [];
    if (d.mainRoute) rows.push({ id: 'main', label: 'Main duct', lengthM: d.mainRoute.lengthM,
                                 source: d.mainRoute.source, note: d.mainRoute.note });
    for (const [roomId, r] of Object.entries(d.ductRoutes || {})) {
      const room = (d.rooms || []).find(x => x.id === roomId);
      rows.push({ id: roomId, label: room?.label || roomId, lengthM: r.lengthM, source: r.source, note: r.note });
    }
    if (!rows.length) return h('div', { class: 'note' }, 'No routes drawn yet. Lengths can also be typed on the Ductwork tab.');
    return table([
      { key: 'label', label: 'Route' },
      { key: 'lengthM', label: 'Length (m)', align: 'right', width: '110px',
        render: (r) => input(r.lengthM ?? '', v => this.setRouteLength(r.id, v), { type: 'number', step: '0.1' }) },
      { key: 'source', label: 'Source' },
      { key: 'clear', label: '', align: 'right', width: '40px',
        render: (r) => button('✕', () => this.clearRoute(r.id), 'tiny ghost') }
    ], rows, { compact: true });
  }

  renderLayoutPanel() {
    const mode = this.viewer?.getMode() || MODES.VIEW;
    const layout = this.design.layout || {};
    return card('5. Equipment layout', 'Drag anything into place on the plan',
      h('div', { class: 'btn-row' },
        button(mode === MODES.LAYOUT ? 'Moving items…' : 'Move items', () => {
          this.viewer.setMode(mode === MODES.LAYOUT ? MODES.VIEW : MODES.LAYOUT); this.render();
        }, mode === MODES.LAYOUT ? 'primary small' : 'small'),
        button('+ Indoor unit', () => this.placeLayout('indoorUnit', 'Indoor unit'), 'ghost small'),
        button('+ Supply plenum', () => this.placeLayout('plenum', 'Supply plenum'), 'ghost small'),
        button('+ Return grille', () => this.placeLayout('returnGrille', 'Return'), 'ghost small'),
        button('Place all outlets', () => this.placeAllOutlets(), 'ghost small'),
        button('Clear layout', () => { this.design.layout = {}; this.update(); }, 'ghost small')),
      Object.keys(layout).length
        ? h('div', { class: 'note' }, Object.keys(layout).length + ' item(s) placed.')
        : h('div', { class: 'note' }, 'Nothing placed yet.'));
  }

  // ── Plan actions ──────────────────────────────────────────────────────────

  async handleUpload(file) {
    if (!file) return;
    const isPdf = file.type.includes('pdf') || /\.pdf$/i.test(file.name || '');
    this.busy = true; this.render();
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(new Error('the file could not be read'));
        r.readAsDataURL(file);
      });

      let imageUrl = dataUrl, pageNumber = null, pageCount = null, dims;

      if (isPdf) {
        const page = await renderPdfPage(dataUrl, 1, {
          onProgress: (m) => { this.planStatus = m; this.render(); }
        });
        imageUrl = page.dataUrl;
        pageNumber = page.pageNumber;
        pageCount = page.pageCount;
      }

      dims = await this.viewer.setImage(imageUrl);
      this.loadedPlanUrl = imageUrl;
      this.design.plan = {
        fileName: file.name, mediaType: file.type, isPdf,
        dataUrl: imageUrl,
        originalDataUrl: dataUrl,      // kept so another page can be rendered
        pageNumber, pageCount,
        widthPx: dims.width, heightPx: dims.height,
        uploadedAt: new Date().toISOString()
      };
      // A new plan invalidates the old calibration — it is never carried over.
      this.design.calibration = null;
      this.dirty = true;
      toast(pageCount > 1
        ? 'Page 1 of ' + pageCount + ' loaded. Switch pages if the floor plan is further in, then calibrate.'
        : 'Plan loaded. Calibrate it next.');
      this.update();
    } catch (e) {
      const detail = String(e.message || 'unknown error').replace(/\.?$/, '.');
      toast('Could not open that plan — ' + detail +
        (isPdf ? ' Export the page as a PNG or JPG and upload that instead.' : ''), 'bad');
    } finally {
      this.busy = false;
      this.planStatus = null;
      this.render();
    }
  }

  /** Switch to another page of a multi-page plan set. */
  async setPlanPage(pageNumber) {
    const plan = this.design.plan;
    if (!plan?.isPdf || !plan.originalDataUrl) return;
    const n = Math.round(Number(pageNumber));
    if (!n || n === plan.pageNumber) return;

    this.busy = true; this.render();
    try {
      const page = await renderPdfPage(plan.originalDataUrl, n, {
        onProgress: (m) => { this.planStatus = m; this.render(); }
      });
      const dims = await this.viewer.setImage(page.dataUrl);
      this.loadedPlanUrl = page.dataUrl;
      this.design.plan = { ...plan, dataUrl: page.dataUrl, pageNumber: page.pageNumber,
                           pageCount: page.pageCount, widthPx: dims.width, heightPx: dims.height };
      // A different page is a different sheet at a different scale, so the
      // calibration and anything measured from the image no longer apply.
      this.design.calibration = null;
      this.design.rooms = (this.design.rooms || []).map(r => ({ ...r, boundaryPx: null }));
      this.design.ductRoutes = {};
      this.design.mainRoute = null;
      this.design.layout = {};
      this.dirty = true;
      toast('Page ' + page.pageNumber + ' of ' + page.pageCount + '. Calibrate this page before measuring.');
      this.update();
    } catch (e) {
      toast('Could not render page ' + n + ': ' + e.message, 'bad');
    } finally {
      this.busy = false;
      this.planStatus = null;
      this.render();
    }
  }

  applyCalibration() {
    const pts = this.calibPoints || [];
    if (pts.length !== 2) return toast('Pick two points on the plan first.', 'bad');
    const c = calibrate({
      pointA: pts[0], pointB: pts[1],
      knownDistance: this.calibDistance, unit: this.calibUnit || 'mm',
      imageWidthPx: this.design.plan?.widthPx, imageHeightPx: this.design.plan?.heightPx,
      scaleLabel: this.design.interpretation?.observations?.scaleLabelText
    });
    if (c.error) return toast(c.error, 'bad');
    this.design.calibration = c;
    this.design.scaleLabel = c.scaleLabel;
    this.calibPoints = [];
    this.viewer.setMode(MODES.VIEW);
    this.viewer.setCalibration(c);
    toast('Calibrated: ' + c.display.calculatedScale);
    this.remeasureCalibratedRooms();
    this.update();
  }

  /** Any room measured from pixels is re-measured when the calibration changes. */
  remeasureCalibratedRooms() {
    const cal = this.design.calibration;
    if (!cal) return;
    this.design.rooms = (this.design.rooms || []).map(r => {
      if (!r.boundaryPx || r.measurement?.source === 'manual' ||
          r.measurement?.source === 'verified_architectural' ||
          r.measurement?.source === 'dimension_chain' ||
          r.measurement?.source === 'chain_plus_wall_geometry') return r;
      const [remeasured] = measureRooms([{ ...r, boundaryPx: r.boundaryPx }],
        { calibration: cal }, { settings: this.settings, imageQuality: this.imageQuality });
      return { ...remeasured, id: r.id, status: r.status === 'Verified' ? 'Review' : remeasured.status,
               conditioned: r.conditioned, ceilingHeightMm: r.ceilingHeightMm };
    });
  }

  async readPlan() {
    const d = this.design;
    if (!d.plan) return toast('Upload a plan first.', 'bad');
    this.busy = true; this.render();
    try {
      // Always read the RENDERED page, never the source PDF: the reader returns
      // boxes in the pixels of whatever it is given, and everything here is in
      // the rendered page's pixels. Sending the PDF would read page 1 whatever
      // page is on screen, in a coordinate space the canvas does not share.
      //
      // The page is read in overlapping tiles at close to full resolution.
      // Dimension text is 2-3 mm high on the original sheet — shrunk to fit one
      // request it becomes a few pixels tall and the digits get guessed.
      const { tiles } = await tilePlan(d.plan.dataUrl);
      const results = [];
      let done = 0;
      const report = () => {
        this.planStatus = 'Reading the plan — ' + done + ' of ' + tiles.length +
                          (tiles.length > 1 ? ' sections' : ' page') + '…';
        this.render();
      };
      report();

      // A few at a time: enough to keep it quick, not so many that a big sheet
      // fires a dozen requests at once.
      // Numbered up front: the workers run concurrently, so a counter read at
      // send time would hand several tiles the same number.
      const queue = tiles.map((tile, i) => ({ tile, index: i + 1 }));
      const worker = async () => {
        while (queue.length) {
          const { tile, index } = queue.shift();
          const res = await fetch('/api/plan-read', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: tile.dataUrl.split(',')[1],
              mediaType: 'image/jpeg',
              imageWidthPx: tile.width, imageHeightPx: tile.height,
              region: tiles.length > 1
                ? { index, total: tiles.length, col: tile.col, row: tile.row }
                : null
            })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          results.push({ tile, data });
          done += 1; report();
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, tiles.length) }, worker));

      const merged = mergeTileObservations(results);
      const obs = merged.observations;
      this.imageQuality = merged.quality === 'poor' ? 'low' : merged.quality;

      const interp = interpretPlan({
        rawDetections: obs.detections,
        walls: obs.walls,
        openings: obs.openings,
        overallWidthMm: null, overallDepthMm: null
      }, { settings: this.settings });

      d.interpretation = { ...merged, summary: interp.summary, tileCount: tiles.length };
      d.detectedDimensions = interp.detectedDimensions;
      d.chains = interp.chains;
      d.walls = obs.walls || [];
      d.openings = obs.openings || [];
      if (obs.scaleLabelText) d.scaleLabel = parseScaleLabel(obs.scaleLabelText);

      // The floor-area schedule the sheet prints is an independent check on the
      // room schedule — the one number on the drawing that catches an open-plan
      // area measured twice.
      d.floorAreas = obs.floorAreas || [];
      const residence = (d.floorAreas || []).find(a => /residence|dwelling|house|living\s*area/i.test(a.label))
        || (d.floorAreas || []).find(a => /total/i.test(a.label));
      d.printedResidenceSqM = residence ? parseFloorAreaText(residence.text) : null;

      // Build candidate rooms from the labels the reader found, matched against
      // the reconstructed chains where the label sits inside a chain bay.
      const rooms = this.roomsFromObservations(obs, interp);
      if (rooms.length) {
        const existing = new Map((d.rooms || []).map(r => [r.label.toLowerCase(), r]));
        d.rooms = rooms.map(r => existing.get(r.label.toLowerCase())
          ? { ...r, id: existing.get(r.label.toLowerCase()).id,
              status: existing.get(r.label.toLowerCase()).status,
              ceilingHeightMm: existing.get(r.label.toLowerCase()).ceilingHeightMm }
          : r);
      }

      toast(interp.summary.lengthCount + ' dimensions read, ' + interp.summary.closingChains + ' chain(s) closed.' +
        (rooms.length ? ' ' + rooms.length + ' rooms proposed — verify them.' : '') +
        ' Check every number against the drawing.');
      if (merged.conflictCount) {
        toast(merged.conflictCount + ' number(s) were read two different ways. Both are listed — check them.', 'warn');
      }
      if (merged.quality === 'poor') {
        toast('The image is low quality. Check every room before sizing.', 'warn');
      }
    } catch (e) {
      toast('Plan read failed: ' + e.message + '. Calibrate and enter the rooms manually.', 'bad');
    } finally {
      this.busy = false;
      this.planStatus = null;
      this.update();
    }
  }

  /** Turn detected room labels into measurable room definitions. */
  roomsFromObservations(obs, interp) {
    const cal = this.design.calibration;
    const hChain = interp.primaryHorizontalChain;
    const vChain = interp.primaryVerticalChain;
    const labels = (obs.roomLabels || []).filter(l => l.text && l.box);
    if (!labels.length) return [];

    // A reader may hand back the size as its own text item rather than on the
    // room. Anything that parses as a pair and sits within a line or two below
    // a room name belongs to that room.
    adoptLooseDimensionPairs(labels, obs.detections);

    // A chain's stations are millimetres from its OWN zero, which is wherever
    // the first dimension sits in the image — not the image's left edge. So a
    // label's pixel position is converted through the chain's own pixel anchor,
    // fitted from the dimension text it was built from. Dividing by the
    // calibration instead would measure from the wrong origin and drop every
    // room into the wrong bay.
    const anchored = hChain?.pixelAnchor && vChain?.pixelAnchor;
    const defs = labels.map(l => {
      const def = { label: l.text, labelPx: l.box };

      // A size printed against the room beats everything else. It is the
      // architect's own figure for that room, so it needs no chain, no
      // calibration and no geometry — which is the whole of how a builder's
      // brochure plan states its rooms.
      const printed = parseRoomDimensionPair(l.dimensionText);
      if (printed) {
        def.printedWidthMm = printed.widthMm;
        def.printedLengthMm = printed.lengthMm;
        def.printedText = printed.printed;
      }

      if (anchored) {
        // The label's centre, not its corner — a long room name would otherwise
        // read as sitting further left and up than it does.
        const xMm = chainMmAtPx(hChain, l.box.x + l.box.w / 2);
        const yMm = chainMmAtPx(vChain, l.box.y + l.box.h / 2);
        const hBay = xMm === null ? null : bayContaining(hChain, xMm);
        const vBay = yMm === null ? null : bayContaining(vChain, yMm);
        if (hBay && vBay) {
          def.hStations = [hBay.i, hBay.i + 1];
          def.vStations = [vBay.i, vBay.i + 1];
          const x0 = chainPxAtMm(hChain, hChain.stations[hBay.i]);
          const x1 = chainPxAtMm(hChain, hChain.stations[hBay.i + 1]);
          const y0 = chainPxAtMm(vChain, vChain.stations[vBay.i]);
          const y1 = chainPxAtMm(vChain, vChain.stations[vBay.i + 1]);
          def.boundaryPx = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
      }
      return def;
    });

    return measureRooms(defs, { hChain, vChain, calibration: cal, walls: obs.walls || [] },
      { settings: this.settings, imageQuality: this.imageQuality });
  }

  createRoomFromBox(box) {
    const cal = this.design.calibration;
    const [room] = measureRooms([{ label: 'New room ' + ((this.design.rooms || []).length + 1), boundaryPx: box }],
      { calibration: cal }, { settings: this.settings, imageQuality: this.imageQuality });
    this.design.rooms = [...(this.design.rooms || []), room];
    this.selectedRoomId = room.id;
    if (!cal) toast('Room added. Calibrate the plan to measure it, or type the dimensions on the Rooms tab.', 'warn');
    this.update();
  }

  setRoomBoundary(id, box) {
    const cal = this.design.calibration;
    this.design.rooms = (this.design.rooms || []).map(r => {
      if (r.id !== id) return r;
      if (!cal) return { ...r, boundaryPx: box };
      const [m] = measureRooms([{ ...r, boundaryPx: box, widthMm: undefined, lengthMm: undefined,
                                  hStations: undefined, vStations: undefined }],
        { calibration: cal }, { settings: this.settings, imageQuality: this.imageQuality });
      return { ...m, id: r.id, label: r.label, conditioned: r.conditioned,
               ceilingHeightMm: r.ceilingHeightMm, boundaryPx: box,
               status: r.conditioned ? 'Review' : 'Excluded' };
    });
    this.update();
  }

  routeOverlay() {
    const out = {};
    if (this.design.mainRoute?.points) out.main = { points: this.design.mainRoute.points, label: 'Main duct' };
    for (const [roomId, r] of Object.entries(this.design.ductRoutes || {})) {
      if (!r.points) continue;
      const room = (this.design.rooms || []).find(x => x.id === roomId);
      out[roomId] = { points: r.points, label: room?.label || roomId };
    }
    return out;
  }

  completeRoute(points) {
    const target = this.routeTargetRoomId;
    if (!target) return toast('Choose which route you are drawing first.', 'bad');
    const r = routeLength(this.design.calibration, points, { settings: this.settings });
    if (r.lengthMm === null) return toast(r.note, 'bad');
    const record = { ...r, points };
    if (target === '__main') this.design.mainRoute = record;
    else this.design.ductRoutes = { ...(this.design.ductRoutes || {}), [target]: record };
    toast('Route measured: ' + r.lengthM + ' m');
    this.update();
  }

  setRouteLength(id, value) {
    const mm = value === '' ? null : Number(value) * 1000;
    const patch = { lengthMm: mm, lengthM: mm === null ? null : Number(value),
                    source: 'manual', note: 'Length entered by the estimator.' };
    if (id === 'main') this.design.mainRoute = { ...(this.design.mainRoute || {}), ...patch };
    else this.design.ductRoutes = { ...this.design.ductRoutes, [id]: { ...(this.design.ductRoutes[id] || {}), ...patch } };
    this.update();
  }

  clearRoute(id) {
    if (id === 'main') this.design.mainRoute = null;
    else { const r = { ...this.design.ductRoutes }; delete r[id]; this.design.ductRoutes = r; }
    this.update();
  }

  placeLayout(type, label) {
    const img = this.design.plan;
    const base = img ? { x: img.widthPx * 0.5, y: img.heightPx * 0.5 } : { x: 100, y: 100 };
    this.design.layout = { ...(this.design.layout || {}),
      [type]: { ...base, type, label } };
    this.viewer.setMode(MODES.LAYOUT);
    toast('Placed ' + label + ' — drag it into position.');
    this.update();
  }

  placeAllOutlets() {
    const layout = { ...(this.design.layout || {}) };
    for (const row of (this.design.outlets?.rows || [])) {
      const room = (this.design.rooms || []).find(r => r.id === row.roomId);
      if (!room?.boundaryPx) continue;
      for (let i = 0; i < row.quantity; i++) {
        const frac = (i + 1) / (row.quantity + 1);
        layout['outlet_' + row.roomId + '_' + i] = {
          x: room.boundaryPx.x + room.boundaryPx.w * frac,
          y: room.boundaryPx.y + room.boundaryPx.h / 2,
          type: 'outlet', label: row.label + ' ' + (i + 1)
        };
      }
    }
    this.design.layout = layout;
    this.viewer.setMode(MODES.LAYOUT);
    this.update();
  }

  // ── Room actions ──────────────────────────────────────────────────────────

  selectRoom(id) { this.selectedRoomId = id; this.viewer?.selectRoom(id); this.render(); }

  editRoom(id, patch) {
    this.design.rooms = (this.design.rooms || []).map(r =>
      r.id === id ? applyRoomOverride(r, patch, 'estimator') : r);
    this.update();
  }

  verifyRoom(id) {
    this.design.rooms = (this.design.rooms || []).map(r => r.id === id ? verifyRoom(r, 'estimator') : r);
    this.update();
  }

  verifyAllHigh() {
    this.design.rooms = (this.design.rooms || []).map(r =>
      r.conditioned && r.confidenceBand === 'HIGH' ? verifyRoom(r, 'estimator') : r);
    this.update();
  }

  async verifyAll() {
    const low = (this.design.rooms || []).filter(r => r.conditioned && r.confidenceBand === 'LOW');
    if (low.length && !await confirmDialog({
        title: 'Verify rooms that are LOW confidence?',
        message: low.length + ' room(s) were measured with low confidence. Check their dimensions ' +
                 'against the plan before you verify them — verifying is what lets them into the sizing.',
        lines: low.map(r => r.label + ' — ' + Math.round(r.confidence) + '% confidence'),
        confirmLabel: 'Verify all anyway', danger: true })) return;
    this.design.rooms = (this.design.rooms || []).map(r => r.conditioned ? verifyRoom(r, 'estimator') : r);
    this.update();
  }

  async addManualRoom() {
    // One form, not three chained prompts — a chain can be cut short by the
    // browser and leave a half-entered room behind.
    const v = await formDialog({
      title: 'Add a room by hand',
      message: 'Enter width and length, or leave them blank and enter the floor area instead.',
      submitLabel: 'Add room',
      fields: [
        { key: 'label',  label: 'Room name', value: 'New room' },
        { key: 'width',  label: 'Width (m)',  type: 'number', step: '0.01', min: 0, value: '' },
        { key: 'length', label: 'Length (m)', type: 'number', step: '0.01', min: 0, value: '' },
        { key: 'area',   label: 'Or floor area (m²)', type: 'number', step: '0.01', min: 0, value: '',
          hint: 'Used only when width and length are left blank.' }
      ]
    });
    if (!v) return;
    const label = (v.label || '').trim() || 'New room';
    const w = Number(v.width) || 0, l = Number(v.length) || 0;
    let room;
    if (w > 0 && l > 0) {
      room = buildRoom({ label, measurement: manualMeasurement(w * 1000, l * 1000) }, { settings: this.settings });
    } else {
      const a = Number(v.area) || 0;
      if (!a) return toast('Enter either width and length, or a floor area.', 'bad');
      room = buildRoom({ label, measurement: { widthMm: null, lengthMm: null, areaSqM: a, source: 'manual',
        sourceLabel: 'Manual entry', evidence: ['Area entered by the estimator.'], areaOnly: true } },
        { settings: this.settings });
    }
    this.design.rooms = [...(this.design.rooms || []), room];
    this.selectedRoomId = room.id;
    this.update();
  }

  async deleteRoom(id) {
    const r = (this.design.rooms || []).find(x => x.id === id);
    if (!await confirmDialog({
      title: 'Remove ' + (r?.label || 'this room') + '?',
      message: 'It comes out of the load, the airflow and the duct network. You can add it back by hand.',
      confirmLabel: 'Remove room', danger: true })) return;
    this.design.rooms = (this.design.rooms || []).filter(x => x.id !== id);
    if (this.selectedRoomId === id) this.selectedRoomId = null;
    this.update();
  }

  async mergeRoomPrompt() {
    const rooms = this.design.rooms || [];
    const sel = rooms.find(r => r.id === this.selectedRoomId);
    if (!sel) return toast('Select a room first.', 'bad');
    const others = rooms.filter(r => r.id !== sel.id);
    if (!others.length) return toast('There is no other room to merge into.', 'bad');
    const id = await pickDialog({
      title: 'Merge "' + sel.label + '" into which room?',
      message: 'The two areas are added together and kept under the room you choose.',
      options: others.map(r => ({ value: r.id, label: r.label,
        sub: r.areaSqM ? r.areaSqM.toFixed(2) + ' m²' : 'no area yet' })),
      emptyText: 'There is no other room to merge into.'
    });
    const target = others.find(r => r.id === id);
    if (!target) return;
    const area = (sel.areaSqM || 0) + (target.areaSqM || 0);
    this.design.rooms = rooms
      .filter(r => r.id !== sel.id)
      .map(r => r.id === target.id
        ? applyRoomOverride(r, { areaSqM: area, label: target.label + ' + ' + sel.label }, 'estimator')
        : r);
    this.selectedRoomId = target.id;
    this.update();
  }

  async splitRoomPrompt() {
    const sel = (this.design.rooms || []).find(r => r.id === this.selectedRoomId);
    if (!sel) return toast('Select a room first.', 'bad');
    if (!sel.areaSqM) return toast('That room has no area to split.', 'bad');
    const v = await formDialog({
      title: 'Split ' + sel.label,
      message: sel.label + ' is ' + sel.areaSqM.toFixed(2) + ' m². Choose how much of it becomes a new room.',
      submitLabel: 'Split room',
      fields: [
        { key: 'share', label: 'Share going to the new room', type: 'number',
          step: '0.05', min: 0.05, max: 0.95, value: '0.5',
          hint: 'Between 0 and 1. 0.5 splits it in half.' },
        { key: 'label', label: 'Name for the new room', value: sel.label + ' B' }
      ]
    });
    if (!v) return;
    const share = Number(v.share);
    if (!(share > 0 && share < 1)) return toast('The share has to be between 0 and 1.', 'bad');
    const newArea = sel.areaSqM * share;
    const label = (v.label || '').trim() || (sel.label + ' B');
    const kept = applyRoomOverride(sel, { areaSqM: sel.areaSqM - newArea }, 'estimator');
    const added = buildRoom({ label, measurement: { widthMm: null, lengthMm: null, areaSqM: newArea,
      source: 'manual', sourceLabel: 'Manual entry',
      evidence: ['Split from ' + sel.label + ' by the estimator.'], areaOnly: true },
      ceilingHeightMm: sel.ceilingHeightMm, conditioned: sel.conditioned }, { settings: this.settings });
    this.design.rooms = (this.design.rooms || []).map(r => r.id === sel.id ? kept : r).concat([added]);
    this.update();
  }

  // ── Design field actions ──────────────────────────────────────────────────

  setDesignField(key, value) { this.design[key] = value; this.update(); }

  selectUnit(brandId, modelId) {
    this.design.selectedUnitKey = brandId + ':' + modelId;
    this.update();
  }

  setLoadOverride(roomId, coolingW) {
    const list = (this.design.roomLoadOverrides || []).filter(o => o.roomId !== roomId);
    if (coolingW !== null) list.push({ roomId, coolingW, note: 'Load manually adjusted by the estimator.' });
    this.design.roomLoadOverrides = list;
    this.update();
  }

  setAirflowOverride(roomId, value) {
    const o = { ...(this.design.airflowOverrides || {}) };
    if (value === '' || value === null) delete o[roomId]; else o[roomId] = Number(value);
    this.design.airflowOverrides = o;
    this.update();
  }

  setOutletOverride(roomId, patch) {
    const o = { ...(this.design.outletOverrides || {}) };
    o[roomId] = { ...(o[roomId] || {}), ...patch };
    if (o[roomId].quantity === null) delete o[roomId].quantity;
    this.design.outletOverrides = o;
    this.update();
  }

  setDuctDiameter(sectionId, diameterMm) {
    this.design.ductDiameterOverrides = { ...(this.design.ductDiameterOverrides || {}), [sectionId]: diameterMm };
    this.update();
  }

  setDuctLength(sectionId, value) {
    if (sectionId === 'main') return this.setRouteLength('main', value);

    // A final connection has its own length, held alongside the branch route so
    // editing one does not silently rewrite the other.
    const finalMatch = sectionId.match(/^final_(.+)_(\d+)$/);
    if (finalMatch) {
      const [, roomId, n] = finalMatch;
      const routes = { ...(this.design.ductRoutes || {}) };
      const route = { ...(routes[roomId] || {}) };
      const lengths = [...(route.finalLengthsMm || [])];
      lengths[Number(n) - 1] = value === '' ? null : Number(value) * 1000;
      route.finalLengthsMm = lengths;
      routes[roomId] = route;
      this.design.ductRoutes = routes;
      return this.update();
    }
    this.setRouteLength(sectionId.replace(/^branch_/, ''), value);
  }

  setReturnGrille(index, size) {
    const list = [...(this.design.returnGrilleOverrides || [])];
    list[index] = size;
    this.design.returnGrilleOverrides = list;
    this.update();
  }

  renameZone(zoneId, name) {
    this.design.zoneDefinitions = (this.design.zones?.zones || []).map(z =>
      z.id === zoneId ? { ...z, name } : z);
    this.update();
  }

  setZoneKind(zoneId, kind) {
    this.design.zoneDefinitions = (this.design.zones?.zones || []).map(z =>
      z.id === zoneId ? { ...z, kind } : z);
    this.update();
  }

  resetZones() { this.design.zoneDefinitions = null; this.update(); }

  async groupZonePrompt() {
    const zones = this.design.zones?.zones || [];
    if (zones.length < 2) return toast('There are not two zones to group.', 'bad');
    // Tap the zones themselves — nobody should have to type "1,3,4".
    const picked = await pickDialog({
      title: 'Group zones into one',
      message: 'Choose two or more zones. They become a single zone served together.',
      multi: true, submitLabel: 'Group them',
      options: zones.map(z => ({ value: z.id, label: z.name, meta: z.airflowLs + ' L/s' }))
    });
    if (!picked) return;
    const idx = picked.map(id => zones.findIndex(z => z.id === id)).filter(i => i >= 0);
    if (idx.length < 2) return toast('Choose at least two zones to group.', 'bad');
    const merged = idx.map(i => zones[i]);
    const rest = zones.filter((_, i) => !idx.includes(i));
    this.design.zoneDefinitions = [...rest, {
      id: merged[0].id, name: merged.map(z => z.name).join(' + '), kind: 'grouped',
      roomIds: merged.flatMap(z => z.roomIds), rooms: merged.flatMap(z => z.rooms),
      airflowLs: merged.reduce((s, z) => s + z.airflowLs, 0)
    }];
    this.update();
  }

  editBom(index, patch) {
    const item = this.design.bom.items[index];
    if (!item) return;
    // Record the edit against the line's identity, not its position, so a full
    // recompute re-applies it instead of losing it.
    const match = item.key + '|' + item.label;
    const edits = (this.design.bomEdits || []).filter(e => e.match !== match);
    edits.push({
      match,
      quantity: patch.quantity !== undefined ? patch.quantity : item.quantity,
      unitCost: patch.unitCost !== undefined ? patch.unitCost : item.unitCost
    });
    this.design.bomEdits = edits;
    this.update();
  }

  async addMaterialPrompt() {
    const v = await formDialog({
      title: 'Add a material line',
      message: 'This goes into the bill of materials at the cost you enter, and into the job cost.',
      submitLabel: 'Add line',
      fields: [
        { key: 'label',    label: 'Description', value: '' },
        { key: 'quantity', label: 'Quantity',    type: 'number', step: '0.01', min: 0, value: '1' },
        { key: 'unitCost', label: 'Unit cost ($)', type: 'number', step: '0.01', min: 0, value: '0' }
      ]
    });
    if (!v) return;
    const label = (v.label || '').trim();
    if (!label) return toast('Enter a description for the line.', 'bad');
    this.design.extraMaterials = [...(this.design.extraMaterials || []),
      { label, quantity: Number(v.quantity) || 0, unitCost: Number(v.unitCost) || 0,
        unit: 'each', category: 'other' }];
    this.update();
  }

  async addLabourPrompt() {
    const flat = this.settings.commercial.labourMode !== 'hourly';
    const v = await formDialog({
      title: flat ? 'Add an extra charge' : 'Add a labour line',
      message: flat
        ? 'This job is priced at cost plus a flat fee, so an extra charge is added to the job cost.'
        : 'Hours are costed at the labour rate in HVAC Design Settings.',
      submitLabel: 'Add line',
      fields: flat
        ? [{ key: 'task', label: 'What is the charge for?', value: '' },
           { key: 'cost', label: 'Amount ($)', type: 'number', step: '0.01', min: 0, value: '0' }]
        : [{ key: 'task',  label: 'Labour description', value: '' },
           { key: 'hours', label: 'Hours', type: 'number', step: '0.25', min: 0, value: '1' }]
    });
    if (!v) return;
    const task = (v.task || '').trim();
    if (!task) return toast('Enter a description for the line.', 'bad');
    if (flat) {
      const cost = Number(v.cost) || 0;
      if (!cost) return toast('Enter an amount for the charge.', 'bad');
      this.design.extraLabour = [...(this.design.extraLabour || []), { task, cost }];
    } else {
      this.design.extraLabour = [...(this.design.extraLabour || []), { task, hours: Number(v.hours) || 0 }];
    }
    this.update();
  }

  addExtra() {
    this.design.quoteExtras = [...(this.design.quoteExtras || []), { label: '', qty: 1, price: 0 }];
    this.update();
  }
  editExtra(i, patch) {
    this.design.quoteExtras = (this.design.quoteExtras || []).map((e, idx) => idx === i ? { ...e, ...patch } : e);
    this.update();
  }
  removeExtra(i) {
    this.design.quoteExtras = (this.design.quoteExtras || []).filter((_, idx) => idx !== i);
    this.update();
  }

  exportBomCsv() {
    // Carries the supplier part code so the sheet can be handed to MMEM as an
    // order, and the metres so a whole-length quantity can be checked.
    const rows = [['Category', 'Item', 'Part code', 'Qty', 'Unit',
                   'Metres needed', 'Unit cost', 'Total', 'Price source']];
    for (const i of this.design.bom.items) {
      rows.push([i.category, i.label, i.supplierCode ?? '', i.quantity, i.unit,
                 i.metresRequired ?? '', i.unitCost ?? '', i.totalCost ?? '', i.priceSource ?? '']);
    }
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = this.design.id + '-bom.csv';
    a.click();
  }

  async acknowledgeWarning(w) {
    // An acknowledgement carries a name, so the warning text has to be fully
    // readable at the moment it is signed for — not truncated in a prompt box.
    const v = await formDialog({
      title: 'Acknowledge ' + w.code,
      subtitle: w.message,
      message: 'Acknowledging records that you have read this and decided the design can proceed. ' +
               'It is kept against the design with your name and the time.',
      submitLabel: 'Acknowledge',
      fields: [
        { key: 'who',  label: 'Your name', value: this.lastAcknowledgedBy || '' },
        { key: 'note', label: 'What have you done about it?', type: 'textarea', value: '',
          hint: 'Optional, but it is what the next person reads.' }
      ]
    });
    if (!v) return;
    const who = (v.who || '').trim();
    if (!who) return toast('An acknowledgement has to carry a name.', 'bad');
    this.lastAcknowledgedBy = who;
    this.design.warningAcknowledgements = acknowledge(this.design, w, who, (v.note || '').trim());
    this.update();
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  openSettings(section = 'load') { this.settingsSection = section; this.render(); }
  closeSettings() { this.settingsSection = null; this.render(); }

  updateSetting(path, value) {
    const keys = path.split('.');
    let cur = this.settingsOverride;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    this.settings = settingsWith(this.settingsOverride);
    this.update();
  }

  async resetSettingsSection(section) {
    if (!await confirmDialog({
      title: 'Reset the ' + section + ' settings?',
      message: 'Everything NAC has changed in this section goes back to the shipped defaults. ' +
               'Other sections are left alone.',
      confirmLabel: 'Reset ' + section, danger: true })) return;
    if (section === 'materials') this.materialRates = {};
    else if (section === 'specs') { /* specs are data, never reset in bulk */ toast('Equipment specs are manufacturer data — clear them one model at a time.', 'warn'); return; }
    else delete this.settingsOverride[section === 'return' ? 'returnAir' : section];
    this.settings = settingsWith(this.settingsOverride);
    this.rebuildCatalogue();
    this.update();
  }

  updateMaterialRate(path, value) {
    const keys = path.split('.');
    let cur = this.materialRates;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    if (value === null) delete cur[keys[keys.length - 1]];
    else cur[keys[keys.length - 1]] = value;
    this.update();
  }

  setSpecModel(key) { this.specModelKey = key; this.render(); }

  updateSpec(specKey, fieldName, value) {
    this.equipmentSpecs = { ...this.equipmentSpecs,
      [specKey]: { ...(this.equipmentSpecs[specKey] || {}),
        [fieldName]: value === '' ? undefined : (isNaN(Number(value)) ? value : Number(value)) } };
    this.rebuildCatalogue();
    this.update();
  }

  async saveSettings() {
    await Promise.all([
      Store.setJson(Store.SETTINGS_KEYS.hvacSettings, this.settingsOverride),
      Store.setJson(Store.SETTINGS_KEYS.materialRates, this.materialRates),
      Store.setJson(Store.SETTINGS_KEYS.equipmentSpecs, this.equipmentSpecs)
    ]);
    toast('HVAC Design Settings saved.');
  }

  // ── Persistence & quote (PART 23) ─────────────────────────────────────────

  async save(reason = 'Saved by estimator') {
    this.design = addRevision(this.design, { by: 'estimator', reason });
    const r = await Store.saveDesign(this.design);
    // Only a database write clears the dirty flag. A local-only copy is still
    // unsaved work as far as any other device is concerned, so the Save button
    // must keep asking to be pressed.
    this.dirty = !r.synced;
    if (r.synced) {
      toast('Design saved (revision ' + this.design.revisions.length + ').');
    } else {
      toast('SAVED ON THIS DEVICE ONLY — it has not reached the database' +
            (r.error ? ' (' + r.error + ')' : '') +
            '. It will not appear on another device. Press Save again when you have signal.', 'bad');
    }
    this.render();
  }

  async showDesignList() {
    const list = await Store.listDesigns();
    const id = await pickDialog({
      title: 'Open a design',
      message: list.length ? 'Most recently updated first.' : null,
      options: list.map(d => ({
        value: d.id,
        label: d.customer || 'No customer name',
        sub: d.id,
        meta: d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('en-AU') : ''
      })),
      emptyText: 'No saved designs yet. Save one and it will appear here.'
    });
    if (!id) return;
    const d = await Store.loadDesign(id);
    if (!d) return toast('Could not load that design.', 'bad');
    this.design = d;
    this.selectedRoomId = null;
    this.update();
  }

  async addDesignToQuote() {
    const d = this.design;
    if (!d.warningSummary?.canApprove) {
      const crit = (d.warningSummary?.unacknowledgedCritical || []);
      if (!await confirmDialog({
        title: 'This design has not been approved',
        message: d.warningSummary.blockReason,
        lines: crit.slice(0, 8).map(w => w.message)
          .concat(crit.length > 8 ? ['…and ' + (crit.length - 8) + ' more'] : []),
        confirmLabel: 'Quote it anyway', danger: true })) return;
    }
    if (!d.commercials?.sellPriceIncGst) {
      return toast('No sell price. Set the installed price for this model in the existing Price Setup screen.', 'bad');
    }

    // A line with NO cost makes the sell price short by whatever it is worth.
    // On job-cost-plus-fee that is money given away, so it stops the quote.
    if (d.bom?.unpricedCount) {
      return toast(d.bom.unpricedCount + ' material line(s) have no cost at all, so the price is short by ' +
        'whatever they are worth: ' + (d.bom.unpricedLabels || []).join(', ') +
        '. Enter their cost on the Materials tab before quoting.', 'bad');
    }

    // Placeholder rates are shipped starting values, not NAC prices. On this
    // basis they go straight through to the customer, so the estimator is shown
    // exactly which lines are guesses and what they are worth before a quote
    // exists — never silently.
    if (d.bom?.placeholderCount) {
      const detail = (d.bom.placeholderDetail || []).slice(0, 10)
        .map(l => l.label + '  ' + l.quantity + ' ' + l.unit +
                  ' @ $' + Number(l.unitCost).toFixed(2) + ' = $' + Number(l.totalCost).toFixed(2));
      const more = (d.bom.placeholderCount > 10) ? ['…and ' + (d.bom.placeholderCount - 10) + ' more'] : [];
      const ok = await confirmDialog({
        title: 'UNCONFIRMED MATERIAL PRICES',
        message: d.bom.placeholderCount + ' line(s) use shipped placeholder rates, not NAC prices. ' +
          'They are worth $' + Number(d.bom.placeholderCost).toFixed(2) + ' of the $' +
          Number(d.commercials.totalJobCost).toFixed(2) + ' job cost, and on the job-cost-plus-fee ' +
          'basis that goes straight to the customer.',
        lines: detail.concat(more),
        cancelLabel: 'Set the real rates first',
        confirmLabel: 'Quote on these figures', danger: true });
      if (!ok) return;
    }
    try {
      const r = await Store.pushDesignToQuote(d);
      this.design.quoteId = r.quoteId;
      this.design.status = 'quoted';
      await this.save('Pushed to quote ' + r.quoteId);
      this.design.quotedRevision = this.design.revisions.length;
      await linkDialog({
        title: 'Quote ' + r.quoteId + ' created',
        message: 'Send this link to the customer. It opens their quote and lets them accept and sign it.',
        url: r.signUrl });
      this.update();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  /** PART 23 — show exactly what changed before the quote is refreshed. */
  async updateQuoteFromDesign() {
    const d = this.design;
    if (!d.quoteId) return toast('This design is not linked to a quote yet.', 'bad');

    // Compare against the revision the quote was actually built from, so the
    // change list is the real design diff rather than a guess.
    const quotedRev = (d.revisions || []).find(r => r.number === d.quotedRevision)
      || [...(d.revisions || [])].reverse().find(r => /quote/i.test(r.reason || ''));
    const changes = quotedRev ? diffDesigns(quotedRev.snapshot, d) : [];

    // The customer-facing total is the thing that actually matters, so it is
    // read back off the live quote rather than inferred.
    const existing = await Store.fetchQuote(d.quoteId);
    let before = [];
    try { before = JSON.parse(existing?.line_items || '[]'); } catch (e) { /* ignore */ }
    const oldTotal = before.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const newTotal = (d.quoteLineItems || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
    if (oldTotal !== newTotal) {
      changes.unshift({ field: 'Quoted total (inc GST)', from: '$' + oldTotal.toFixed(2), to: '$' + newTotal.toFixed(2) });
    }

    const lines = changes.map(c => c.field + ':  ' + (c.from ?? '—') + '  →  ' + (c.to ?? '—'));
    const body = changes.length
      ? 'These are the differences between the quote as it stands and this design.'
      : (quotedRev ? 'Nothing has changed since the quote was created.'
                   : 'No earlier revision to compare against — the quote will be rewritten from the current design.');

    if (!await confirmDialog({
      title: 'Update quote ' + d.quoteId + '?',
      message: body, lines,
      confirmLabel: 'Update the quote' })) return;

    try {
      await Store.pushDesignToQuote(d, { quoteId: d.quoteId });
      await this.save('Updated quote ' + d.quoteId);
      this.design.quotedRevision = this.design.revisions.length;
      toast('Quote ' + d.quoteId + ' updated.');
      this.render();
    } catch (e) { toast(e.message, 'bad'); }
  }

  /** Historical designs are never overwritten — an earlier one can be restored. */
  async showRevisions() {
    const revs = this.design.revisions || [];
    if (!revs.length) return toast('No saved revisions yet.', 'warn');
    const n = await pickDialog({
      title: 'Revisions of ' + this.design.id,
      message: 'Choosing one restores it as a NEW revision. Nothing is overwritten — ' +
               'the current design stays in the history.',
      submitLabel: 'Restore',
      options: [...revs].reverse().map(r => ({
        value: r.number,
        label: 'Revision ' + r.number + ' — ' + (r.reason || 'saved'),
        sub: new Date(r.at).toLocaleString('en-AU'),
        meta: r.snapshot?.systemLoad ? r.snapshot.systemLoad.designKw + ' kW' : ''
      }))
    });
    if (n === null || !revs.some(r => r.number === n)) return;
    if (!await confirmDialog({
      title: 'Restore revision ' + n + '?',
      message: 'The design goes back to how it was at revision ' + n +
               ', saved as revision ' + (revs.length + 1) + '. Nothing is lost.',
      confirmLabel: 'Restore it' })) return;
    this.design = restoreRevision(this.design, n, 'estimator');
    this.selectedRoomId = null;
    this.loadedPlanUrl = null;
    toast('Restored revision ' + n + ' as revision ' + this.design.revisions.length + '.');
    this.update();
  }

  openInQuoteBuilder() {
    if (!this.design.quoteId) return toast('Add the design to a quote first.', 'bad');
    window.open('/admin.html?draft=' + encodeURIComponent(this.design.quoteId), '_blank');
  }

  // ── Reports (PART 26) ─────────────────────────────────────────────────────

  async showReportMenu() {
    const snapshot = this.viewer?.snapshot() || null;
    const logo = document.querySelector('.brand img')?.src || null;
    const which = await pickDialog({
      title: 'Which report?',
      options: [
        { value: 'internal', label: 'Internal HVAC Design Sheet',
          sub: 'The full working — supplier costs, margin, every calculation. NAC only.' },
        { value: 'customer', label: 'Customer HVAC Design Summary',
          sub: 'What the system is and what is included. No costs, no margin, no internal notes.' }
      ]
    });
    if (which === 'internal') openReport(internalReportHtml(this.design, { logo, planSnapshot: snapshot }), 'internal sheet');
    else if (which === 'customer') openReport(customerReportHtml(this.design, { logo, planSnapshot: snapshot }), 'customer summary');
  }

  // ── NAC Design Assistant (PART 28) ────────────────────────────────────────

  renderAssistant() {
    this.assistantEl.style.display = this.assistantOpen ? 'flex' : 'none';
    if (!this.assistantOpen) return;

    const inputEl = h('textarea', { class: 'inp ta', rows: 3,
      placeholder: 'Ask about this design — sizing, a room measurement, a duct size, a warning…' });

    const ask = async (q) => {
      const question = q || inputEl.value.trim();
      if (!question) return;
      inputEl.value = '';
      this.assistantLog.push({ role: 'you', text: question });
      this.assistantLog.push({ role: 'assistant', text: 'Thinking…', pending: true });
      this.renderAssistant();
      try {
        // The assistant only needs the engineering picture. The plan image,
        // the revision history and the customer's contact details never leave
        // the browser.
        const { plan, revisions, customer, ...engineering } = this.design;
        const res = await fetch('/api/design-assistant', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            design: { ...engineering, settingsUsed: this.settings }
          })
        });
        const data = await res.json();
        this.assistantLog.pop();
        this.assistantLog.push({ role: 'assistant', text: data.error ? ('Sorry — ' + data.error) : data.answer });
      } catch (e) {
        this.assistantLog.pop();
        this.assistantLog.push({ role: 'assistant', text: 'Could not reach the assistant: ' + e.message });
      }
      this.renderAssistant();
    };

    const suggestions = [
      'Why is this system size recommended?',
      'Which rooms are least reliable and why?',
      'Are any duct velocities too high?',
      'Explain the static pressure estimate.',
      'What would you change about the zoning?'
    ];

    mount(this.assistantEl,
      h('div', { class: 'assist-head' },
        h('strong', {}, 'NAC DESIGN ASSISTANT'),
        button('✕', () => { this.assistantOpen = false; this.render(); }, 'tiny ghost')),
      h('div', { class: 'assist-note' },
        'Answers come from this design\'s calculated figures only. The assistant can suggest changes ' +
        'but cannot make them.'),
      h('div', { class: 'assist-log' },
        this.assistantLog.length ? this.assistantLog.map(m =>
          h('div', { class: 'msg ' + m.role + (m.pending ? ' pending' : '') }, m.text))
          : h('div', { class: 'assist-suggest' },
              suggestions.map(s => button(s, () => ask(s), 'chip')))),
      h('div', { class: 'assist-input' }, inputEl,
        button('Ask', () => ask(), 'primary small')));
    const log = this.assistantEl.querySelector('.assist-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  /**
   * Start a design from the intake form's draft: the customer's details, the
   * floor plan they uploaded, and a link back to the same quote record so the
   * finished design updates that draft rather than creating a second one.
   */
  async loadIntakeDraft(quoteRef) {
    let draft;
    try { draft = await Store.loadIntakeDraft(quoteRef); }
    catch (e) { draft = null; }
    if (!draft) {
      toast('Could not load intake draft ' + quoteRef + '. Start the design manually.', 'bad');
      return;
    }

    const d = createDesign({
      customer: draft.customer,
      job: { description: draft.jobDescription, climate: this.settings.load.defaultClimate },
      quoteId: draft.quoteId
    });
    d.notes = draft.intakePack || '';
    d.intake = {
      quoteId: draft.quoteId,
      planUrl: draft.planUrl,
      photoUrls: draft.photoUrls,
      pack: draft.intakePack,
      options: draft.intakeOptions
    };

    if (draft.planUrl) {
      d.plan = {
        fileName: 'Customer floor plan',
        mediaType: /\.pdf($|\?)/i.test(draft.planUrl) ? 'application/pdf' : 'image/jpeg',
        isPdf: /\.pdf($|\?)/i.test(draft.planUrl),
        dataUrl: draft.planUrl,
        storageUrl: draft.planUrl,
        widthPx: null, heightPx: null,
        uploadedAt: null,
        fromIntake: true
      };
    }

    this.design = d;
    this.selectedRoomId = null;
    this.loadedPlanUrl = null;
    this.tab = 'plan';
    toast(draft.planUrl
      ? 'Loaded ' + (draft.customer.name || quoteRef) + ' from the intake form. Calibrate the plan to begin.'
      : 'Loaded ' + (draft.customer.name || quoteRef) + ' — no floor plan was attached, so upload one.',
      draft.planUrl ? '' : 'warn');
  }

  // ── Sample project (PART 36) ──────────────────────────────────────────────

  loadSample() {
    const cal = calibrate({
      pointA: Sample.SAMPLE_PLAN_META.calibrationPointA,
      pointB: Sample.SAMPLE_PLAN_META.calibrationPointB,
      knownDistance: Sample.SAMPLE_PLAN_META.calibrationKnownDistance,
      unit: Sample.SAMPLE_PLAN_META.calibrationUnit,
      imageWidthPx: Sample.SAMPLE_PLAN_META.imageWidthPx,
      imageHeightPx: Sample.SAMPLE_PLAN_META.imageHeightPx,
      scaleLabel: Sample.SAMPLE_PLAN_META.scaleLabelText
    });
    const interp = interpretPlan({
      rawDetections: Sample.sampleDetections(),
      openings: Sample.sampleOpenings(),
      walls: Sample.sampleWalls(),
      overallWidthMm: Sample.H_OVERALL_MM,
      overallDepthMm: Sample.V_OVERALL_MM
    }, { settings: this.settings });

    const px = Sample.PX_PER_MM, o = Sample.SAMPLE_PLAN_META.originPx;
    const rooms = measureRooms(Sample.SAMPLE_ROOMS.map(r => ({
      ...r, hStations: r.h, vStations: r.v,
      boundaryPx: {
        x: o.x + Sample.H_STATIONS[r.h[0]] * px,
        y: o.y + Sample.V_STATIONS[r.v[0]] * px,
        w: (Sample.H_STATIONS[r.h[1]] - Sample.H_STATIONS[r.h[0]]) * px,
        h: (Sample.V_STATIONS[r.v[1]] - Sample.V_STATIONS[r.v[0]]) * px
      }
    })), {
      hChain: interp.primaryHorizontalChain,
      vChain: interp.primaryVerticalChain,
      walls: Sample.sampleWalls(),
      calibration: cal
    }, { settings: this.settings });

    const d = createDesign({ customer: Sample.SAMPLE_CUSTOMER, job: Sample.SAMPLE_JOB });
    d.calibration = cal;
    d.scaleLabel = cal.scaleLabel;
    d.detectedDimensions = interp.detectedDimensions;
    d.chains = interp.chains;
    d.rooms = rooms;
    d.mainRoute = { lengthMm: 4200, lengthM: 4.2, source: 'manual', note: 'Sample project.' };
    d.ductRoutes = Object.fromEntries(rooms.filter(r => r.conditioned)
      .map((r, i) => [r.id, { lengthMm: 5000 + i * 900, lengthM: (5000 + i * 900) / 1000,
                              source: 'manual', note: 'Sample project.' }]));
    d.returnDuctLengthMm = 2500;
    d.notes = 'Sample Australian builder plan — every room dimension is reconstructed from the ' +
      'perimeter dimension chains, not read from a room label.';
    d.plan = {
      fileName: 'sample-builder-plan.svg', mediaType: 'image/svg+xml', isPdf: false,
      dataUrl: samplePlanDataUrl(),
      widthPx: Sample.SAMPLE_PLAN_META.imageWidthPx,
      heightPx: Sample.SAMPLE_PLAN_META.imageHeightPx,
      uploadedAt: new Date().toISOString()
    };
    this.design = d;
    this.selectedRoomId = null;
    toast('Sample plan loaded. Rooms still need verifying — that is the point.');
  }
}

/**
 * Attach a printed room size that came back as a loose text item to the room it
 * sits under. Builders print the size on the line directly beneath the name, so
 * the owner is the nearest label horizontally overlapping it and above it by no
 * more than a couple of lines.
 */
function adoptLooseDimensionPairs(labels, detections) {
  const loose = (detections || []).filter(d => d.box && parseRoomDimensionPair(d.text));
  if (!loose.length) return;

  for (const d of loose) {
    const dc = d.box.x + d.box.w / 2;
    let best = null, bestGap = Infinity;
    for (const l of labels) {
      if (l.dimensionText) continue;                 // already has its own
      const lc = l.box.x + l.box.w / 2;
      const gapY = d.box.y - (l.box.y + l.box.h);    // how far below the name
      if (gapY < -l.box.h || gapY > l.box.h * 3) continue;
      if (Math.abs(dc - lc) > Math.max(l.box.w, d.box.w)) continue;
      const gap = Math.abs(gapY) + Math.abs(dc - lc) * 0.25;
      if (gap < bestGap) { best = l; bestGap = gap; }
    }
    if (best) best.dimensionText = d.text;
  }
}

/** Find which bay of a chain a millimetre coordinate falls in. */
function bayContaining(chain, mm) {
  if (!chain?.stations) return null;
  for (let i = 0; i < chain.stations.length - 1; i++) {
    if (mm >= chain.stations[i] && mm <= chain.stations[i + 1]) {
      const width = chain.stations[i + 1] - chain.stations[i];
      if (width < 400) continue;      // that is a wall, not a room
      return { i, width };
    }
  }
  return null;
}


