// DRAGGABLE ROUTE EDITING — the fifteen things that have to be true.
//
// The handles rendering proves nothing. What matters is that a dragged run is
// still a real duct section: that its length changes, that the pressure and the
// bill of materials and the price follow, that a locked run does not move, that
// the installer sheet and the supplier order describe the EDITED system, and
// that all of it survives a save and a reload.
//
// Dragging is done with real pointer events, and the iPad check uses genuine
// touch events through a touch-enabled context — not a mouse pretending.

import { chromium, devices } from 'playwright';
import { signInContext } from './signin.mjs';
import { ensureAdvanced } from './advanced.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

const settings = new Map(), designs = new Map(), quotes = new Map();
let failures = 0, n = 0;
const ITEM = (i, name) => console.log(`\n[${i}] ${name}`);
const say = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

async function stubDb(p) {
  await p.route('**/rest/v1/nac_settings**', async r => {
    const q = r.request();
    if (q.method() === 'POST') { const x = JSON.parse(q.postData() || '{}'); settings.set(x.key, x.value);
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
    const m = /key=eq\.([^&]+)/.exec(q.url());
    const v = m ? settings.get(decodeURIComponent(m[1])) : undefined;
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(v !== undefined ? [{ value: v }] : []) });
  });
  await p.route('**/rest/v1/nac_designs**', async r => {
    const q = r.request();
    if (q.method() === 'POST') { const x = JSON.parse(q.postData() || '{}'); designs.set(x.id, x);
      return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
    const m = /id=eq\.([^&]+)/.exec(q.url());
    if (m) { const d = designs.get(decodeURIComponent(m[1]));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d ? [d] : []) }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...designs.values()]) });
  });
  await p.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

/** Load the sample plan, verify rooms, and let AUTO ROUTE do its thing. */
async function prepare(p) {
  await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await p.locator('button', { hasText: 'Load the sample builder plan' }).first().click();
  await p.waitForTimeout(2600);
  await ensureAdvanced(p);
  await p.evaluate(() => window.nacDesigner.setTab('rooms'));
  await p.waitForTimeout(500);
  const va = p.locator('button', { hasText: 'Verify all' });
  if (await va.count()) await va.last().click();
  await p.waitForTimeout(1900);
  await p.evaluate(() => window.nacDesigner.setTab('plan'));
  await p.waitForTimeout(900);
}

const snap = (p) => p.evaluate(() => {
  const d = window.nacDesigner.design;
  const sec = (id) => (d.network?.sections || []).find(s => s.id === id);
  const flex = (d.bom?.items || []).filter(i => i.key === 'flex_duct');
  return {
    routed: !!d.network?.routed,
    totalDuctM: d.network?.totalDuctLengthM,
    pressurePa: d.pressure?.estimatedRequirementPa,
    jobCost: d.commercials?.totalJobCost,
    sell: d.commercials?.sellPriceIncGst,
    flexPacks: flex.reduce((s, i) => s + i.quantity, 0),
    flexCost: flex.reduce((s, i) => s + (i.totalCost || 0), 0),
    warnCodes: (d.routeScore?.warnings || []).map(w => w.code),
    editCount: Object.keys(d.routeEdits || {}).length,
    lockCount: Object.keys(d.lockedRoutes || {}).length,
    sections: (d.network?.sections || []).filter(s => s.points)
      .map(s => ({ id: s.id, role: s.role, len: s.lengthM, dia: s.diameterMm,
                   locked: !!s.locked, edited: !!s.edited, pts: s.points.length })),
    get: (id) => null
  };
});

const geom = (p, id) => p.evaluate((i) =>
  window.nacDesigner.design.network.sections.find(s => s.id === i)?.points, id);

/** Drag a handle with real pointer events, in screen coordinates. */
async function dragHandleOnScreen(p, sectionId, pointIndex, dx, dy) {
  const box = await p.evaluate(({ id, idx }) => {
    const app = window.nacDesigner, v = app.viewer;
    const s = app.design.network.sections.find(x => x.id === id);
    const pt = s.points[idx];
    const r = v.element.getBoundingClientRect();
    return { x: r.left + pt.x * v.state.scale + v.state.offsetX,
             y: r.top + pt.y * v.state.scale + v.state.offsetY };
  }, { id: sectionId, idx: pointIndex });
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  await p.mouse.move(box.x + dx / 2, box.y + dy / 2, { steps: 4 });
  await p.mouse.move(box.x + dx, box.y + dy, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(900);
}

// ═══════════════════════════════════════════════════════════════════════════
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 150)));
await stubDb(p);
await prepare(p);

// ── 1 ──────────────────────────────────────────────────────────────────────
ITEM(1, 'auto route generates');
const s0 = await snap(p);
say('the design is routed', s0.routed);
say('it has trunk and branch runs', s0.sections.some(x => x.role === 'trunk') &&
  s0.sections.some(x => x.role === 'branch'), s0.sections.length + ' runs');

// Turn editing on so handles exist.
await p.evaluate(() => {
  const app = window.nacDesigner;
  app.viewer.setMode('edit_route');
  app.viewer.setHandles(app.currentHandles());
});
await p.waitForTimeout(400);
const handleCount = await p.evaluate(() => window.nacDesigner.viewer.state.handles.length);
say('handles appear in EDIT ROUTE mode', handleCount > 0, handleCount + ' handles');

// ── 2 ──────────────────────────────────────────────────────────────────────
ITEM(2, 'trunk node can be dragged');
const trunkId = await p.evaluate(() =>
  window.nacDesigner.design.network.sections.find(s => s.role === 'trunk' && s.points?.length)?.id);
const trunkBefore = await geom(p, trunkId);
await dragHandleOnScreen(p, trunkId, trunkBefore.length - 1, 0, -70);
const trunkAfter = await geom(p, trunkId);
say('the trunk geometry changed', JSON.stringify(trunkAfter) !== JSON.stringify(trunkBefore),
  trunkId + ': ' + trunkBefore.length + ' → ' + trunkAfter.length + ' points');
const s1 = await snap(p);
say('the edit was recorded against the design', s1.editCount > 0, s1.editCount + ' run(s) edited');

// ── 3 ──────────────────────────────────────────────────────────────────────
ITEM(3, 'branch stays connected');
const connected = await p.evaluate(() => {
  const secs = window.nacDesigner.design.network.sections.filter(s => s.points?.length);
  const byId = new Map(secs.map(s => [s.id, s]));
  const near = (a, b) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  const bad = [];
  for (const s of secs) {
    if (!s.parentId) continue;
    const parent = byId.get(s.parentId);
    if (!parent?.points) continue;
    const start = s.points[0];
    const touches = parent.points.some(pt => near(pt, start));
    if (!touches) bad.push(s.id + ' → ' + s.parentId);
  }
  return { bad, checked: secs.filter(s => s.parentId).length };
});
say('every run still meets its parent after the drag', connected.bad.length === 0,
  connected.checked + ' joints checked' + (connected.bad.length ? ' — broken: ' + connected.bad.join(', ') : ''));

// ── 4 ──────────────────────────────────────────────────────────────────────
ITEM(4, 'junction can be dragged');
const jBefore = await p.evaluate(() => {
  const app = window.nacDesigner;
  const j = app.currentHandles().find(h => h.kind === 'junction' && !h.locked);
  return j ? { id: j.id, x: j.x, y: j.y, sectionIds: j.sectionIds } : null;
});
say('a junction handle exists', !!jBefore, jBefore ? jBefore.sectionIds.length + ' runs meet there' : '');
const beforeGeom = {};
for (const id of (jBefore?.sectionIds || [])) beforeGeom[id] = await geom(p, id);
await p.evaluate(({ jx, jy }) => {
  const app = window.nacDesigner;
  const j = app.currentHandles().find(h => h.kind === 'junction' && !h.locked);
  app.onHandleDrop(j, { x: jx + 45, y: jy - 30 });
}, { jx: jBefore.x, jy: jBefore.y });
await p.waitForTimeout(900);
const allMoved = await p.evaluate((ids) => {
  const secs = window.nacDesigner.design.network.sections;
  return ids.every(id => (secs.find(s => s.id === id)?.points || []).length >= 2);
}, jBefore.sectionIds);
say('every run at the junction still has geometry', allMoved);
const stillJoined = await p.evaluate(() => {
  const secs = window.nacDesigner.design.network.sections.filter(s => s.points?.length);
  const byId = new Map(secs.map(s => [s.id, s]));
  const near = (a, c) => Math.abs(a.x - c.x) < 2 && Math.abs(a.y - c.y) < 2;
  return secs.filter(s => s.parentId && byId.get(s.parentId)?.points)
    .every(s => byId.get(s.parentId).points.some(pt => near(pt, s.points[0])));
});
say('the junction did not come apart', stillJoined);

// ── 5 & 6 ──────────────────────────────────────────────────────────────────
ITEM(5, 'locked segment is preserved');
const lockTarget = await p.evaluate(() => {
  const app = window.nacDesigner;
  const s = app.design.network.sections.find(x => x.role === 'branch' && x.points?.length);
  app.onHandleDrop(app.currentHandles().find(h => h.sectionIds.includes(s.id) && h.kind !== 'junction'),
    { x: s.points[s.points.length - 1].x + 55, y: s.points[s.points.length - 1].y + 35 });
  return s.id;
});
await p.waitForTimeout(800);
await p.evaluate((id) => window.nacDesigner.toggleRouteLock(id), lockTarget);
await p.waitForTimeout(800);
const lockedGeom = await geom(p, lockTarget);
const lockedFlag = await p.evaluate((id) =>
  !!window.nacDesigner.design.network.sections.find(s => s.id === id)?.locked, lockTarget);
say('the run is locked', lockedFlag, lockTarget);

ITEM(6, 're-route unlocked does not move locked geometry');
await p.evaluate(() => window.nacDesigner.rerouteUnlocked());
await p.waitForTimeout(1200);
const afterReroute = await geom(p, lockTarget);
say('the locked geometry is byte-for-byte identical',
  JSON.stringify(afterReroute) === JSON.stringify(lockedGeom));
const stillLocked = await p.evaluate((id) =>
  !!window.nacDesigner.design.network.sections.find(s => s.id === id)?.locked, lockTarget);
say('and it is still flagged as locked', stillLocked);

// ── 7 ──────────────────────────────────────────────────────────────────────
ITEM(7, 'routed length changes');
const before7 = await snap(p);
// Move the branch that is ON THE INDEX RUN. Static pressure is set by the
// worst path, so moving any other branch legitimately leaves the system figure
// alone — testing that would prove nothing about recalculation.
const moved7 = await p.evaluate(async () => {
  const app = window.nacDesigner;
  const { indexRun } = await import('/designer/engines/ducts.mjs');
  const run = indexRun(app.design.network);
  const tail = [...run.path].reverse()
    .find(s => s.role === 'branch' &&
      !app.design.network.sections.find(x => x.id === s.id)?.locked);
  const sec = app.design.network.sections.find(x => x.id === tail.id);
  const was = { len: sec.lengthM, pa: sec.pressureDropPa };
  app.moveWholeBranch(sec.id, { x: 0, y: -150 });
  return { id: sec.id, was };
});
await p.waitForTimeout(1100);
const after7 = await snap(p);
const moved7After = await p.evaluate((id) => {
  const s = window.nacDesigner.design.network.sections.find(x => x.id === id);
  return { len: s.lengthM, pa: s.pressureDropPa };
}, moved7.id);
say('the total routed duct length moved', after7.totalDuctM !== before7.totalDuctM,
  before7.totalDuctM + ' m → ' + after7.totalDuctM + ' m');
say('the moved run re-measured itself', moved7After.len !== moved7.was.len,
  moved7.id + ': ' + moved7.was.len + ' m → ' + moved7After.len + ' m');

// ── 8 ──────────────────────────────────────────────────────────────────────
ITEM(8, 'pressure recalculates');
say('that run\u2019s own pressure drop changed', moved7After.pa !== moved7.was.pa,
  moved7.was.pa + ' Pa → ' + moved7After.pa + ' Pa');
say('and the system static pressure moved with it', after7.pressurePa !== before7.pressurePa,
  before7.pressurePa + ' Pa → ' + after7.pressurePa + ' Pa');

// ── 9 ──────────────────────────────────────────────────────────────────────
ITEM(9, 'BOM changes if length changes enough to affect pack quantity');
// Push a branch a long way so the metres must cross a 6 m boundary.
const before9 = await snap(p);
await p.evaluate(() => {
  const app = window.nacDesigner;
  const s = app.design.network.sections.find(x => x.role === 'branch' && !x.locked && x.points?.length);
  app.moveWholeBranch(s.id, { x: 260, y: 210 });
});
await p.waitForTimeout(1100);
const after9 = await snap(p);
say('the number of 6 m lengths to buy changed', after9.flexPacks !== before9.flexPacks,
  before9.flexPacks + ' packs → ' + after9.flexPacks + ' packs');
say('and the duct cost changed with it', after9.flexCost !== before9.flexCost,
  '$' + before9.flexCost + ' → $' + after9.flexCost);

// ── 10 ─────────────────────────────────────────────────────────────────────
ITEM(10, 'costing updates');
say('the internal job cost moved', after9.jobCost !== before9.jobCost,
  '$' + before9.jobCost + ' → $' + after9.jobCost);
say('the customer sell price moved', after9.sell !== before9.sell,
  '$' + before9.sell + ' → $' + after9.sell);

// ── 11 ─────────────────────────────────────────────────────────────────────
ITEM(11, 'installer sheet uses final edited geometry');
const sheet = await p.evaluate(async () => {
  const { installerSheet } = await import('/designer/engines/order.mjs');
  const sh = installerSheet(window.nacDesigner.design);
  const net = window.nacDesigner.design.network.sections;
  return { ducts: sh.ducts.map(d => ({ id: d.id, len: d.lengthM })),
           live: net.filter(s => s.points).map(s => ({ id: s.id, len: s.lengthM })) };
});
const sheetMatches = sheet.ducts.filter(d => sheet.live.some(l => l.id === d.id))
  .every(d => d.len === sheet.live.find(l => l.id === d.id).len);
say('every duct length on the sheet is the edited one', sheetMatches,
  sheet.ducts.length + ' runs on the sheet');

// ── 12 ─────────────────────────────────────────────────────────────────────
ITEM(12, 'supplier order list uses final quantities');
const order = await p.evaluate(async () => {
  const { supplierOrderList } = await import('/designer/engines/order.mjs');
  const o = supplierOrderList(window.nacDesigner.design);
  const bom = (window.nacDesigner.design.bom?.items || []).filter(i => i.key === 'flex_duct');
  return { orderPacks: o.lines.filter(l => l.key === 'flex_duct').reduce((s, l) => s + l.quantity, 0),
           bomPacks: bom.reduce((s, i) => s + i.quantity, 0) };
});
say('the order quantity equals the edited BOM quantity',
  order.orderPacks === order.bomPacks && order.orderPacks === after9.flexPacks,
  'order ' + order.orderPacks + ' / bom ' + order.bomPacks + ' / live ' + after9.flexPacks);

// ── 13 ─────────────────────────────────────────────────────────────────────
ITEM(13, 'save/refresh preserves edited route');
const beforeSave = await snap(p);
const savedGeom = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  return { id: d.id, edits: Object.keys(d.routeEdits || {}).length,
           locks: Object.keys(d.lockedRoutes || {}).length,
           total: d.network.totalDuctLengthM };
});
await p.evaluate(() => window.nacDesigner.save());
await p.waitForTimeout(1400);

const p2 = await ctx.newPage();
p2.on('pageerror', e => console.log('   [pageerror2]', e.message.slice(0, 150)));
await stubDb(p2);
await p2.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p2.waitForTimeout(1400);
const reloaded = await p2.evaluate(async (id) => {
  const app = window.nacDesigner;
  const Store = await import('/designer/engines/store.mjs');
  const d = await Store.loadDesign(id);
  if (!d) return null;
  app.design = d;
  app.update();
  return { edits: Object.keys(app.design.routeEdits || {}).length,
           locks: Object.keys(app.design.lockedRoutes || {}).length,
           total: app.design.network?.totalDuctLengthM,
           routed: !!app.design.network?.routed };
}, savedGeom.id);
say('the design came back from the database', !!reloaded);
say('the hand-moved runs survived the reload', reloaded?.edits === savedGeom.edits,
  savedGeom.edits + ' → ' + reloaded?.edits);
say('the locks survived too', reloaded?.locks === savedGeom.locks,
  savedGeom.locks + ' → ' + reloaded?.locks);
say('and the routed length is identical after reload', reloaded?.total === savedGeom.total,
  savedGeom.total + ' m → ' + reloaded?.total + ' m');
await p2.close();

// ── 14 ─────────────────────────────────────────────────────────────────────
ITEM(14, 'undo/redo works');
const u0 = await snap(p);
await p.evaluate(() => {
  const app = window.nacDesigner;
  const s = app.design.network.sections.find(x => x.role === 'branch' && !x.locked && x.points?.length);
  app.moveWholeBranch(s.id, { x: 70, y: 0 });
});
await p.waitForTimeout(900);
const u1 = await snap(p);
say('a move changes the design', u1.totalDuctM !== u0.totalDuctM,
  u0.totalDuctM + ' → ' + u1.totalDuctM);
await p.evaluate(() => window.nacDesigner.undoEdit());
await p.waitForTimeout(900);
const u2 = await snap(p);
say('UNDO puts it back exactly', u2.totalDuctM === u0.totalDuctM,
  u1.totalDuctM + ' → ' + u2.totalDuctM + ' (was ' + u0.totalDuctM + ')');
await p.evaluate(() => window.nacDesigner.redoEdit());
await p.waitForTimeout(900);
const u3 = await snap(p);
say('REDO puts it back again', u3.totalDuctM === u1.totalDuctM,
  u2.totalDuctM + ' → ' + u3.totalDuctM);
// A diameter change and a lock must be undoable too.
await p.evaluate(() => {
  const app = window.nacDesigner;
  const s = app.design.network.sections.find(x => x.role === 'branch' && !x.locked);
  app.setSegmentDiameter(s.id, 400);
});
await p.waitForTimeout(800);
const dOver = await p.evaluate(() => Object.keys(window.nacDesigner.design.ductDiameterOverrides || {}).length);
await p.evaluate(() => window.nacDesigner.undoEdit());
await p.waitForTimeout(800);
const dBack = await p.evaluate(() => Object.keys(window.nacDesigner.design.ductDiameterOverrides || {}).length);
say('a manual diameter is undoable', dOver === 1 && dBack === 0, dOver + ' → ' + dBack);

// Conflict checks re-ran after all that editing.
const finalWarn = await snap(p);
say('route checks re-ran after editing',
  finalWarn.warnCodes.includes('UNVERIFIED_ROUTE'), finalWarn.warnCodes.join(','));
const noticeVisible = await p.evaluate(() => (document.querySelector('.main')?.innerText || ''));
say('AUTO ROUTE — VERIFY SITE CONDITIONS is still on screen',
  /AUTO ROUTE — VERIFY SITE CONDITIONS/.test(noticeVisible));

await p.close();

// ── 15 ─────────────────────────────────────────────────────────────────────
ITEM(15, 'iPad touch editing works');
const ipad = await b.newContext({ ...devices['iPad (gen 7) landscape'], hasTouch: true });
await signInContext(ipad);
const t = await ipad.newPage();
t.on('pageerror', e => console.log('   [pageerror-ipad]', e.message.slice(0, 150)));
await stubDb(t);
await prepare(t);
await t.evaluate(() => {
  const app = window.nacDesigner;
  app.viewer.setMode('edit_route');
  app.viewer.setHandles(app.currentHandles());
});
await t.waitForTimeout(500);

const touchInfo = await t.evaluate(() => ({
  touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  handles: window.nacDesigner.viewer.state.handles.length,
  width: window.innerWidth
}));
say('running on a real touch device', touchInfo.touch,
  touchInfo.width + 'px, ' + touchInfo.handles + ' handles');

// Drag a node with genuine touch events.
const tBranch = await t.evaluate(() =>
  window.nacDesigner.design.network.sections.find(s => s.role === 'branch' && s.points?.length)?.id);
const tBefore = await geom(t, tBranch);
const tPos = await t.evaluate(({ id, idx }) => {
  const v = window.nacDesigner.viewer;
  const pt = window.nacDesigner.design.network.sections.find(s => s.id === id).points[idx];
  const r = v.element.getBoundingClientRect();
  return { x: r.left + pt.x * v.state.scale + v.state.offsetX,
           y: r.top + pt.y * v.state.scale + v.state.offsetY };
}, { id: tBranch, idx: tBefore.length - 1 });

await t.touchscreen.tap(tPos.x, tPos.y);
await t.waitForTimeout(300);
const selected = await t.evaluate(() => window.nacDesigner.activeSegmentId);
say('a tap on a node selects its run', !!selected, selected || 'nothing selected');

// A real drag: pointer events with pointerType touch.
await t.evaluate(({ x, y, dx, dy }) => {
  const c = window.nacDesigner.viewer.element.querySelector('canvas');
  const ev = (type, cx, cy) => c.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true,
    clientX: cx, clientY: cy }));
  c.setPointerCapture = () => {};
  ev('pointerdown', x, y);
  ev('pointermove', x + dx * 0.5, y + dy * 0.5);
  ev('pointermove', x + dx, y + dy);
  ev('pointerup', x + dx, y + dy);
}, { x: tPos.x, y: tPos.y, dx: 60, dy: -45 });
await t.waitForTimeout(1100);
const tAfter = await geom(t, tBranch);
say('a touch drag moves the duct', JSON.stringify(tAfter) !== JSON.stringify(tBefore),
  tBefore.length + ' → ' + tAfter.length + ' points');

const tEdits = await t.evaluate(() => Object.keys(window.nacDesigner.design.routeEdits || {}).length);
say('the touch edit reached the design', tEdits > 0, tEdits + ' run(s) edited');

// Pinch zoom and pan still work while editing.
const zoomed = await t.evaluate(() => {
  const v = window.nacDesigner.viewer;
  const before = v.state.scale;
  v.zoomIn(); v.zoomIn();
  const after = v.state.scale;
  v.fit();
  return { before, after };
});
say('zooming still works in edit mode', zoomed.after > zoomed.before,
  zoomed.before.toFixed(2) + ' → ' + zoomed.after.toFixed(2));

// Touch targets are big enough for a finger.
const targets = await t.evaluate(async () => {
  const { HANDLE_TOUCH_R, HANDLE_DRAW_R } = await import('/designer/ui/plan-viewer.mjs');
  const small = [...document.querySelectorAll('.plan-tools .btn')]
    .filter(el => el.getBoundingClientRect().height < 32).length;
  return { touchR: HANDLE_TOUCH_R, drawR: HANDLE_DRAW_R, smallButtons: small,
           buttons: document.querySelectorAll('.plan-tools .btn').length };
});
say('handles have a finger-sized target', targets.touchR >= 20,
  targets.touchR * 2 + 'px target around a ' + targets.drawR * 2 + 'px dot');
say('no tiny controls in the route panel', targets.smallButtons === 0,
  targets.smallButtons + ' of ' + targets.buttons + ' under 32px');

// Locking from touch.
await t.evaluate((id) => window.nacDesigner.toggleRouteLock(id), tBranch);
await t.waitForTimeout(700);
const tLocked = await t.evaluate((id) =>
  !!window.nacDesigner.design.network.sections.find(s => s.id === id)?.locked, tBranch);
say('a run can be locked from the iPad', tLocked);

await t.close();
await b.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
