// THE PLAN TAB OPENS ON THE DRAWING, NOT ON THE WORKINGS.
//
// Nick, looking at the Plan tab on the approved job: "It is too cluttered and
// does not look like the approved installer drawing." It was opening on the
// SETUP view — green room boxes, analysis labels, a route handle on every one
// of a hundred and eighty tessellation points, and a big yellow editing
// rectangle over every outlet — because the installer drawing had only ever
// been switched on for quick mode's review step.
//
// What is proved here is the switch, not the drawing: Clean View is the
// default, each edit mode shows ONLY its own handles, green room boxes belong
// to Edit rooms alone, and nothing on screen reads "undefined".

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { signInContext } from './signin.mjs';
import { buildApproved } from '../../tests/fixtures/approved-job.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PLAN = 'data:image/jpeg;base64,' + readFileSync(
  new URL('../../tests/fixtures/plan-brochure-ground-floor.jpg', import.meta.url)).toString('base64');

let failures = 0;
const STEP = (name) => console.log(`\n${name}`);
const say = (label, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const { out } = await buildApproved();
out.plan = { ...(out.plan || {}), dataUrl: PLAN };

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1050 } });
await signInContext(ctx);
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.nacDesigner, null, { timeout: 30000 });
await p.evaluate((d) => {
  const a = window.nacDesigner;
  a.design = d; a.mode = 'full'; a.tab = 'plan'; a.render();
}, JSON.parse(JSON.stringify(out)));
await p.waitForTimeout(1200);

const view = () => p.evaluate(() => {
  const a = window.nacDesigner;
  return {
    planView: a.planView,
    mode: a.viewer.getMode(),
    designView: a.viewer.isDesignView(),
    analysis: a.viewer.showsAnalysis(),
    rooms: !!a.viewer.state.showRooms,
    handles: a.viewer.state.handles.length,
    outlets: a.viewer.state.outlets.length,
    btoMarkers: (a.viewer.state.markers || []).filter(m => m.type === 'bto').length
  };
});
const set = async (v) => { await p.evaluate(k => window.nacDesigner.setPlanView(k), v);
                           await p.waitForTimeout(500); };

// ── 1. CLEAN VIEW IS THE DEFAULT ────────────────────────────────────────────
STEP('[1] The Plan tab opens clean');
const start = await view();
say('Clean view is the default', start.planView === 'clean', start.planView);
say('the installer drawing is on, not the setup view', start.designView && !start.analysis);
say('no green room boxes', start.rooms === false);
say('no editing handles', start.handles === 0, start.handles + ' handles');

// ── 2. THE DRAWING ITSELF ───────────────────────────────────────────────────
STEP('[2] The approved drawing, drawn once');
say('one diffuser per outlet, no phantoms on the fittings',
  start.outlets === out.componentCounts.supplyOutlets,
  start.outlets + ' diffusers for ' + out.componentCounts.supplyOutlets + ' outlets');
say('every BTO has a fitting symbol',
  start.btoMarkers === out.componentCounts.supplyBtos,
  start.btoMarkers + ' fittings for ' + out.componentCounts.supplyBtos + ' BTOs');

// ── 3. EACH EDIT MODE SHOWS ONLY ITS OWN HANDLES ────────────────────────────
STEP('[3] Edit outlets / equipment');
await set('outlets');
const o = await view();
say('the drawing stays, the setup view does not come back', o.designView && !o.analysis);
say('still no green room boxes', o.rooms === false);
say('the viewer is in layout mode', o.mode === 'layout', o.mode);

STEP('[4] Edit routes / BTOs');
await set('routes');
const r = await view();
say('the drawing stays', r.designView && !r.analysis);
say('route handles appear', r.handles > 0, r.handles + ' handles');
say('and they are the ones worth grabbing, not every swept point',
  r.handles < 40, r.handles + ' handles — 181 before the fix');
const kinds = await p.evaluate(() => {
  const k = {};
  for (const h of window.nacDesigner.viewer.state.handles) k[h.kind] = (k[h.kind] || 0) + 1;
  return k;
});
say('junction handles are the BTOs', (kinds.junction || 0) > 0, JSON.stringify(kinds));
say('no bare tessellation handles', !kinds.node, JSON.stringify(kinds));

STEP('[5] Edit rooms');
await set('rooms');
const rm = await view();
say('green room boxes appear HERE and only here', rm.rooms === true);
say('the analysis workings come back with them', rm.analysis === true);
say('the viewer is in room mode', rm.mode === 'room', rm.mode);

STEP('[6] Back to clean');
await set('clean');
const back = await view();
say('room boxes go away again', back.rooms === false);
say('handles go away again', back.handles === 0, back.handles + ' handles');
say('the drawing is back', back.designView && !back.analysis);

// ── 7. THE PLAN LINE NEVER READS "undefined" ────────────────────────────────
STEP('[7] The plan description');
const body = await p.evaluate(() => document.body.innerText);
say('nothing on screen reads "undefined"', !/undefined/.test(body));
const note = await p.evaluate(() =>
  [...document.querySelectorAll('.note')].map(n => n.textContent.trim()).find(t => / px/.test(t)) || '');
say('the plan line names the plan', !!note && !/^undefined/.test(note), note);

// ── 8. EDITING STILL WORKS ──────────────────────────────────────────────────
STEP('[8] On-site editing survives the tidy-up');
await set('routes');
const drag = await p.evaluate(() => {
  const a = window.nacDesigner;
  const h = a.currentHandles().find(x => x.kind === 'junction' && !x.locked);
  if (!h) return { ok: false, why: 'no junction handle' };
  const before = a.design.network.totalDuctLengthM;
  a.onHandleDrop(h, { x: h.x + 30, y: h.y - 20 });
  return { ok: true, before, after: a.design.network.totalDuctLengthM };
});
say('a BTO handle can still be dragged', drag.ok, drag.why || '');
say('and dropping it recalculates the design',
  drag.ok && drag.before !== drag.after,
  drag.ok ? drag.before + ' m → ' + drag.after + ' m' : '');

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
await b.close();
process.exit(failures ? 1 : 0);
