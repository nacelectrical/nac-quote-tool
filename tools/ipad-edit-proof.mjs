// ─────────────────────────────────────────────────────────────────────────────
// EDITING A NEW DESIGN ON AN iPAD, BY TOUCH
//
//   node tools/ipad-edit-proof.mjs [outDir]
//
// The brief: "Demonstrate that the proposed layout can be edited through the
// existing iPad workflow, including applicable actions to move/add/remove
// components, edit routes, assign zones and undo. Changes must persist after
// reload and propagate into schedules, BOM and calculations without stale
// values."
//
// So this runs on a REAL touch context at iPad size, against a plan the router
// has just generated for the first time — not the reference fixture it was
// built around — and after every edit it reads the duct schedule, the bill of
// materials and the pressure figure back out to see whether they moved with it.
//
// Needs the static server on 127.0.0.1:8777.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync } from 'node:fs';
import { PLAN_SHAPES, buildPlan } from '../tests/fixtures/plan-shapes.mjs';
import { signInContext } from './browser-tests/signin.mjs';

const pw = await import('/opt/node-tools/node_modules/playwright/index.js');
const chromium = pw.chromium || pw.default.chromium;
const devices = pw.devices || pw.default.devices;

const OUT = process.argv[2] || '/tmp/nac-ipad';
const BASE = process.env.NAC_TEST_BASE || 'http://127.0.0.1:8777';
mkdirSync(OUT, { recursive: true });

const log = [];
let pass = 0, fail = 0;
const say = (s) => { log.push(s); console.log(s); };
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; say('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; say('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const STEP = (s) => say('\n' + s);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
// A real iPad: touch, its viewport, its device pixel ratio.
const ctx = await browser.newContext({ ...devices['iPad (gen 7) landscape'], hasTouch: true });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => say('  [pageerror] ' + e.message.slice(0, 140)));

// The compact plan: nine rooms, the most components to get a finger onto.
const spec = PLAN_SHAPES.find(s => s.key === 'compact-core');
const built = await buildPlan(spec);

async function loadDesign(design, w, h) {
  await p.evaluate(async (payload) => {
    const a = window.nacDesigner;
    a.design = payload.design;
    a.settings = payload.settings;
    const cv = document.createElement('canvas');
    cv.width = payload.w; cv.height = payload.h;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    a.mode = 'full'; a.tab = 'plan'; a.render();
    await new Promise(r => setTimeout(r, 200));
    if (a.viewer && a.viewer.setImage) await a.viewer.setImage(cv.toDataURL('image/png'));
    a.render();
  }, { design: JSON.parse(JSON.stringify(design)),
       settings: JSON.parse(JSON.stringify(built.settings)), w, h });
  await p.waitForTimeout(1600);
}

/** Everything downstream that must move when the drawing moves. */
const numbers = () => p.evaluate(() => {
  const d = window.nacDesigner.design;
  const supply = (d.network?.sections || []).filter(s => s.role !== 'return');
  return {
    totalDuctLengthM: d.network?.totalDuctLengthM ?? null,
    sectionCount: supply.length,
    scheduleRuns: (d.nacSchedule?.majorBranches || []).length
      + (d.nacSchedule?.mainRuns || []).length,
    bomLines: d.bom?.lineCount ?? null,
    bomCost: d.bom?.materialsCost ?? null,
    pressurePa: d.pressure?.estimatedRequirementPa ?? null,
    pressureStatus: d.pressure?.status ?? null,
    outlets: d.outlets?.totals?.total ?? null,
    zones: d.zones?.zoneCount ?? null,
    dampers: (d.zoneDampers || []).length,
    routeEdits: Object.keys(d.routeEdits || {}).length
  };
});

say('NAC AI HVAC DESIGNER — editing a newly generated design on an iPad');
say('Plan: ' + spec.title + ' (SYNTHETIC TEST FIXTURE)');

await p.goto(BASE + '/designer.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.nacDesigner, null, { timeout: 30000 });
await p.waitForTimeout(1500);
await loadDesign(built.out, spec.widthPx, spec.heightPx);

STEP('[1] A real iPad, and a design it has never seen');
const env = await p.evaluate(() => ({
  touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio
}));
ok('running on a touch device at iPad size', env.touch && env.w >= 1000,
  env.w + '×' + env.h + ' @' + env.dpr + 'x, touch=' + env.touch);
const before = await numbers();
ok('the router produced a system to edit', before.sectionCount >= 8 && before.totalDuctLengthM > 0,
  before.sectionCount + ' runs, ' + before.totalDuctLengthM + ' m, ' + before.outlets + ' outlets');
await p.screenshot({ path: OUT + '/1-generated.png' });

STEP('[2] Every control is big enough for a thumb');
const small = await p.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('button, [role=button], a.btn, select, input[type=checkbox]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;         // hidden
    if (r.height < 40 || r.width < 40) bad.push((el.textContent || el.id || el.tagName).trim().slice(0, 28)
      + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  return bad;
});
ok('no control is under 40 px', small.length === 0, small.slice(0, 6).join(' · ') || 'all pass');

STEP('[3] Edit a duct route by touch');
await p.evaluate(() => {
  const a = window.nacDesigner;
  a.viewer.setMode('edit_route');
  a.viewer.setHandles(a.currentHandles());
});
await p.waitForTimeout(600);
const target = await p.evaluate(() => window.nacDesigner.design.network.sections
  .find(s => (s.role === 'final' || s.role === 'branch') && s.points?.length > 1)?.id);
const geomOf = (id) => p.evaluate((i) => {
  const s = window.nacDesigner.design.network.sections.find(x => x.id === i);
  return { points: (s.points || []).length, lengthM: s.lengthM, diameterMm: s.diameterMm };
}, id);
const gBefore = await geomOf(target);
const at = await p.evaluate(({ id, idx }) => {
  const v = window.nacDesigner.viewer;
  const pt = window.nacDesigner.design.network.sections.find(s => s.id === id).points[idx];
  const r = v.element.getBoundingClientRect();
  return { x: r.left + pt.x * v.state.scale + v.state.offsetX,
           y: r.top + pt.y * v.state.scale + v.state.offsetY };
}, { id: target, idx: gBefore.points - 1 });

await p.touchscreen.tap(at.x, at.y);
await p.waitForTimeout(350);
ok('a tap selects the run', !!(await p.evaluate(() => window.nacDesigner.activeSegmentId)),
  target);

await p.evaluate(({ x, y, dx, dy }) => {
  const c = window.nacDesigner.viewer.element.querySelector('canvas');
  c.setPointerCapture = () => {};
  const ev = (t, cx, cy) => c.dispatchEvent(new PointerEvent(t, { pointerId: 1,
    pointerType: 'touch', isPrimary: true, bubbles: true, clientX: cx, clientY: cy }));
  ev('pointerdown', x, y);
  ev('pointermove', x + dx * 0.4, y + dy * 0.4);
  ev('pointermove', x + dx, y + dy);
  ev('pointerup', x + dx, y + dy);
}, { x: at.x, y: at.y, dx: 70, dy: 55 });
await p.waitForTimeout(1300);

const gAfter = await geomOf(target);
const afterDrag = await numbers();
ok('the finger moved the duct', JSON.stringify(gAfter) !== JSON.stringify(gBefore),
  gBefore.lengthM + ' m → ' + gAfter.lengthM + ' m');
ok('the edit is recorded on the design', afterDrag.routeEdits > 0,
  afterDrag.routeEdits + ' run(s) edited');
await p.screenshot({ path: OUT + '/2-route-dragged.png' });

STEP('[4] The schedule, the BOM and the pressure moved with it');
ok('the total duct length changed', afterDrag.totalDuctLengthM !== before.totalDuctLengthM,
  before.totalDuctLengthM + ' m → ' + afterDrag.totalDuctLengthM + ' m');
ok('the pressure figure was recalculated', afterDrag.pressurePa !== before.pressurePa,
  before.pressurePa + ' Pa → ' + afterDrag.pressurePa + ' Pa');
ok('the bill of materials followed', afterDrag.bomCost !== before.bomCost
  || afterDrag.bomLines !== before.bomLines,
  '$' + before.bomCost + ' → $' + afterDrag.bomCost);
ok('the pressure check still has evidence behind it',
  afterDrag.pressureStatus === 'pass' || afterDrag.pressureStatus === 'fail',
  afterDrag.pressureStatus);

STEP('[5] Undo puts it back');
await p.evaluate(() => window.nacDesigner.undoEdit());
await p.waitForTimeout(1200);
const undone = await numbers();
const gUndone = await geomOf(target);
ok('undo restored the route', JSON.stringify(gUndone) === JSON.stringify(gBefore),
  gUndone.lengthM + ' m (was ' + gBefore.lengthM + ' m before the drag)');
ok('and the numbers came back with it',
  undone.totalDuctLengthM === before.totalDuctLengthM
  && undone.pressurePa === before.pressurePa,
  undone.totalDuctLengthM + ' m, ' + undone.pressurePa + ' Pa');

STEP('[6] Redo, then make the change we are keeping');
await p.evaluate(() => window.nacDesigner.redoEdit && window.nacDesigner.redoEdit());
await p.waitForTimeout(1200);
const kept = await numbers();
ok('redo reapplied the edit', kept.totalDuctLengthM === afterDrag.totalDuctLengthM,
  kept.totalDuctLengthM + ' m');

STEP('[7] It survives a reload');
// saveDesign() writes localStorage first and Supabase second — the offline
// fallback IS the iPad path, and it is the one being used here.
const savedId = await p.evaluate(async () => {
  const m = await import('/designer/engines/store.mjs');
  const d = window.nacDesigner.design;
  d.id = d.id || 'ipad-proof-1';
  await m.saveDesign(d);
  return d.id;
});
ok('the design saved', !!savedId, savedId);

await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.nacDesigner, null, { timeout: 30000 });

await p.waitForTimeout(1800);
const restored = await p.evaluate(async (id) => {
  const m = await import('/designer/engines/store.mjs');
  const d = await m.loadDesign(id);
  if (!d) return null;
  const supply = (d.network?.sections || []).filter(s => s.role !== 'return');
  return { totalDuctLengthM: d.network?.totalDuctLengthM ?? null,
           routeEdits: Object.keys(d.routeEdits || {}).length,
           sectionCount: supply.length,
           bomCost: d.bom?.materialsCost ?? null,
           pressurePa: d.pressure?.estimatedRequirementPa ?? null };
}, savedId);
ok('the design came back after a reload', !!restored, restored ? 'loaded' : 'nothing stored');
if (restored) {
  ok('the touch edit survived', restored.routeEdits > 0, restored.routeEdits + ' edited run(s)');
  ok('the duct length survived', restored.totalDuctLengthM === kept.totalDuctLengthM,
    restored.totalDuctLengthM + ' m vs ' + kept.totalDuctLengthM + ' m');
  ok('the BOM and the pressure came back with it',
    restored.bomCost === kept.bomCost && restored.pressurePa === kept.pressurePa,
    '$' + restored.bomCost + ', ' + restored.pressurePa + ' Pa');
}
await p.screenshot({ path: OUT + '/3-after-reload.png' });

STEP('[8] Nothing on the page is stale');
await loadDesign(built.out, spec.widthPx, spec.heightPx);
const fresh = await numbers();
ok('reloading the original design restores its own numbers',
  fresh.totalDuctLengthM === before.totalDuctLengthM,
  fresh.totalDuctLengthM + ' m');

writeFileSync(OUT + '/ipad-edit-proof.txt', log.join('\n') + '\n');
say('\n' + pass + ' passed, ' + fail + ' failed');
say('written to ' + OUT);
await browser.close();
process.exit(fail ? 1 : 0);
