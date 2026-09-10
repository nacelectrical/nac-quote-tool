// NAC AI HVAC DESIGNER — regression tests for the plan viewer's picking state.
//
// The calibrate flow is worth guarding at this level because the failure mode
// is silent: the estimator taps point A, taps point B, and the viewer still
// shows one point. Nothing throws, so no other test notices.
//
// The viewer is a canvas widget, so this file stands up the smallest DOM that
// createPlanViewer() actually touches rather than pulling in a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal DOM ────────────────────────────────────────────────────────────
function makeCtx() {
  const noop = () => {};
  return new Proxy({ measureText: () => ({ width: 10 }) }, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

class StubNode {}

function makeElement(tag) {
  const listeners = new Map();
  const el = Object.assign(new StubNode(), {
    tagName: String(tag).toUpperCase(),
    children: [], style: {}, dataset: {}, className: '',
    width: 1000, height: 800, clientWidth: 1000, clientHeight: 800,
    setAttribute: noopSet, removeAttribute: () => {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
    },
    dispatch(type, ev) {
      for (const fn of listeners.get(type) || []) fn({ preventDefault: () => {}, stopPropagation: () => {}, ...ev });
    },
    hasListener: (type) => (listeners.get(type) || []).length > 0,
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }),
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    querySelector: () => null, querySelectorAll: () => []
  });
  Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
  function noopSet() {}
  return el;
}

function installDom() {
  const prior = { document: global.document, window: global.window,
                  ResizeObserver: global.ResizeObserver, Node: global.Node,
                  requestAnimationFrame: global.requestAnimationFrame };
  global.Node = StubNode;
  global.document = { createElement: makeElement, createTextNode: (t) => ({ nodeValue: t }) };
  global.window = { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} };
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.requestAnimationFrame = (fn) => { fn(); return 0; };
  return () => Object.assign(global, prior);
}

async function makeViewer(opts) {
  const restore = installDom();
  const { createPlanViewer, MODES } = await import('../designer/ui/plan-viewer.mjs');
  const container = makeElement('div');
  const viewer = createPlanViewer(container, opts);
  // The canvas is the first child of the .plan-wrap the viewer creates.
  const canvas = container.children[0].children[0];
  return { viewer, canvas, MODES, restore };
}

const down = (canvas, x, y) =>
  canvas.dispatch('pointerdown', { clientX: x, clientY: y, pointerId: 1, button: 0 });

// ── Tests ──────────────────────────────────────────────────────────────────

test('two calibration points can be picked in a row', async () => {
  const picked = [];
  const { viewer, canvas, MODES, restore } = await makeViewer({
    onCalibrationPoints: (pts) => picked.push(pts.length)
  });
  try {
    viewer.setMode(MODES.CALIBRATE);
    down(canvas, 100, 100);
    down(canvas, 400, 100);
    assert.deepEqual(picked, [1, 2], 'the second click must add a point, not replace the first');
  } finally { restore(); }
});

test('re-applying the same calibration does not discard picked points', async () => {
  // The app re-renders on every calibration click and pushes design.calibration
  // back into the viewer each time. That must not clear the picking state.
  const picked = [];
  const { viewer, canvas, MODES, restore } = await makeViewer({
    onCalibrationPoints: (pts) => picked.push(pts.length)
  });
  try {
    viewer.setMode(MODES.CALIBRATE);
    viewer.setCalibration(null);
    down(canvas, 100, 100);
    viewer.setCalibration(null);   // what render() does after the first click
    down(canvas, 400, 100);
    viewer.setCalibration(null);
    assert.deepEqual(picked, [1, 2]);
  } finally { restore(); }
});

test('a new calibration clears the picking markers', async () => {
  const picked = [];
  const { viewer, canvas, MODES, restore } = await makeViewer({
    onCalibrationPoints: (pts) => picked.push(pts.length)
  });
  try {
    viewer.setMode(MODES.CALIBRATE);
    down(canvas, 100, 100);
    down(canvas, 400, 100);
    viewer.setCalibration({ pxPerMm: 0.1 });
    down(canvas, 200, 200);
    assert.deepEqual(picked, [1, 2, 1], 'markers reset once a calibration is applied');
  } finally { restore(); }
});

test('a third click starts a fresh pair', async () => {
  const picked = [];
  const { viewer, canvas, MODES, restore } = await makeViewer({
    onCalibrationPoints: (pts) => picked.push(pts.length)
  });
  try {
    viewer.setMode(MODES.CALIBRATE);
    down(canvas, 100, 100);
    down(canvas, 400, 100);
    down(canvas, 500, 500);
    assert.deepEqual(picked, [1, 2, 1]);
  } finally { restore(); }
});

test('leaving calibrate mode clears the points', async () => {
  const picked = [];
  const { viewer, canvas, MODES, restore } = await makeViewer({
    onCalibrationPoints: (pts) => picked.push(pts.length)
  });
  try {
    viewer.setMode(MODES.CALIBRATE);
    down(canvas, 100, 100);
    viewer.setMode(MODES.VIEW);
    viewer.setMode(MODES.CALIBRATE);
    down(canvas, 400, 100);
    // Re-entering calibrate mode starts from zero, so this is point one again.
    assert.deepEqual(picked, [1, 1]);
  } finally { restore(); }
});
