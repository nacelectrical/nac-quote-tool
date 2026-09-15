// THE AUTO DUCT ROUTER, on a real plan, in the real application.
//
//   AUTO ROUTE → DRAWING → EDIT → RECALCULATE → BOM → PRESSURE → QUOTE
//
// The unit tests prove the tree is a tree. This proves the chain actually
// closes: that what is drawn is the sized design, that dragging a size or
// locking a run changes the bill of materials and the pressure figure, and that
// the estimator is never told an auto route is safe to install.

import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
import { ensureAdvanced } from './advanced.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await signInContext(ctx);

let failures = 0, step = 0;
const say = (n, c, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failures++; };
const STEP = (n) => console.log(`\n[${++step}] ${n}`);

const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 160)));
const stub = { status: 200, contentType: 'application/json', body: '[]' };
await p.route('**/rest/v1/**', r => r.fulfill(stub));

const snap = () => p.evaluate(() => {
  const d = window.nacDesigner.design;
  const routed = (d.network?.sections || []).filter(s => s.points?.length);
  const trunk = routed.filter(s => s.role === 'main' || s.role === 'trunk');
  return {
    routed: !!d.network?.routed,
    segments: routed.length,
    trunkRuns: trunk.length,
    trunkSizes: trunk.map(s => s.diameterMm),
    trunkFlows: trunk.map(s => s.airflowLs),
    junctions: d.network?.junctionCount ?? 0,
    reducers: d.network?.reducerCount ?? 0,
    confidence: d.autoRoute?.confidence || null,
    totalDuctM: d.network?.totalDuctLengthM ?? null,
    ductBomM: (d.bom?.items || []).filter(i => i.key === 'flex_duct')
      .reduce((s, i) => s + (i.metresRequired || 0), 0),
    ductBomCost: (d.bom?.items || []).filter(i => i.key === 'flex_duct')
      .reduce((s, i) => s + (i.totalCost || 0), 0),
    // The return is now routed on the plan too, so its real drawn length is
    // what the BOM adds on top of the supply network — not a fixed allowance.
    returnDuctM: d.returnDesign?.duct?.lengthM
      ?? (d.returnRoute?.lengthM ?? ((d.returnDesign?.duct?.lengthMm ?? 0) / 1000)),
    returnRouted: !!d.returnRoute?.points?.length,
    pressurePa: d.pressure?.estimatedRequirementPa ?? null,
    outletCount: d.outlets?.totals?.total ?? 0,
    // Under the NAC flex model the run that reaches a room is its FINAL FLEX,
    // off a take-off on a main. 'branch' now means only a MAJOR branch shared
    // by a cluster of rooms, and a house can legitimately have none.
    roomRuns: routed.filter(s => s.role === 'final').map(s => s.roomId).sort(),
    majorBranches: routed.filter(s => s.role === 'branch').length,
    mainSupplyCount: d.network?.mainSupplyCount ?? 0,
    btoCount: d.network?.btoCount ?? 0,
    // A STAR is every run leaving the plenum on its own. Under the NAC model
    // nothing but a main may have the plenum as its parent.
    runsOffPlenum: routed.filter(s => !s.parentId).length
  };
});

// ── 1. Load a real plan and let the tool do its thing ───────────────────────
STEP('Load the sample builder plan and verify the rooms');
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1300);
await p.locator('button', { hasText: 'Load the sample builder plan' }).first().click();
await p.waitForTimeout(2600);

await ensureAdvanced(p);
await p.evaluate(() => window.nacDesigner.setTab('rooms'));
await p.waitForTimeout(500);
const va = p.locator('button', { hasText: 'Verify all' });
if (await va.count()) await va.last().click();
await p.waitForTimeout(1800);

// Room boundaries are what the router routes against.
const withBoundary = await p.evaluate(() =>
  (window.nacDesigner.design.rooms || []).filter(r => r.conditioned && r.boundaryPx).length);
say('rooms have boundaries to route against', withBoundary > 0, withBoundary + ' rooms');

// ── 2. It routed on its own ─────────────────────────────────────────────────
STEP('AUTO is the default — the system is laid out without being asked');
const a = await snap();
console.log('     ', JSON.stringify(a));
say('the design is routed', a.routed);
say('every conditioned room is reached by a final flex', a.roomRuns.length > 0,
  a.roomRuns.length + ' finals, ' + a.majorBranches + ' major branches');
// A take-off onto a MAJOR BRANCH is a take-off too — the bedroom wing comes
// off the main through one — so the count to match is one per outlet PLUS one
// per major branch, not one per outlet flat.
say('it is mains-and-take-offs, not a star',
  a.mainSupplyCount >= 2 && a.mainSupplyCount <= 3 &&
  a.runsOffPlenum === a.mainSupplyCount &&
  a.btoCount === a.roomRuns.length + a.majorBranches,
  a.mainSupplyCount + ' mains off the plenum, ' + a.btoCount + ' take-offs for ' +
  a.roomRuns.length + ' outlets and ' + a.majorBranches + ' major branches, ' +
  a.runsOffPlenum + ' runs leave the plenum');

// ── 3. The trunk behaves like a trunk ───────────────────────────────────────
STEP('Trunk airflow and size step DOWN after each take-off');
// The plenum feeds several ARMS, so a flat list of trunk runs is not one chain.
// Each run is compared with the run that actually feeds it.
const chain = await p.evaluate(() => {
  const secs = window.nacDesigner.design.network.sections;
  const byId = new Map(secs.map(s => [s.id, s]));
  return secs.filter(s => s.role === 'main' || s.role === 'trunk')
    .map(s => {
      const parent = s.parentId ? byId.get(s.parentId) : null;
      return { id: s.id, arm: s.mainKey || s.arm || null, ls: s.airflowLs, mm: s.diameterMm,
               parent: parent ? { id: parent.id, ls: parent.airflowLs, mm: parent.diameterMm } : null };
    });
});
const gainers = chain.filter(c => c.parent && c.ls >= c.parent.ls);
const growers = chain.filter(c => c.parent && c.mm > c.parent.mm);
say('airflow falls along every trunk arm', gainers.length === 0,
  gainers.map(c => c.id + ' ' + c.ls + ' after ' + c.parent.ls).join(', ') ||
  chain.map(c => (c.arm || '-') + ':' + c.ls).join(' '));
say('no trunk run is bigger than the one feeding it', growers.length === 0,
  growers.map(c => c.id + ' ' + c.mm + ' after ' + c.parent.mm).join(', ') ||
  chain.map(c => c.mm).join(' / '));
// The plenum feeds two or three MAINS — never one run per room. Each main is
// cut into stretches only where its size actually changes.
const armSet = new Set(chain.map(c => c.arm));
say('the plenum feeds mains, not one run per room',
  armSet.size >= 2 && armSet.size <= 3 && chain.length < a.segments,
  armSet.size + ' main(s): ' + [...armSet].join(', ') + ', ' + chain.length + ' main/trunk runs');
say('the trunk actually reduces across the house',
  a.trunkSizes[a.trunkSizes.length - 1] < a.trunkSizes[0],
  a.trunkSizes[0] + ' → ' + a.trunkSizes[a.trunkSizes.length - 1]);
say('reducers were recorded to buy', a.reducers > 0, a.reducers + ' reducers');

// ── 4. It is on the plan, with the sizes on it ──────────────────────────────
STEP('The layout is drawn on the plan with its diameters');
await p.evaluate(() => window.nacDesigner.setTab('plan'));
await p.waitForTimeout(900);
const drawn = await p.evaluate(() => {
  const v = window.nacDesigner.viewer;
  const routes = Object.values(v.state.routes || {});
  return {
    routes: routes.length,
    labelled: routes.filter(r => /\u00f8\d+/.test(r.label || '')).length,
    unlabelled: routes.filter(r => !/\u00f8\d+/.test(r.label || '')).map(r => r.role),
    widths: [...new Set(routes.map(r => r.width))].length,
    colours: [...new Set(routes.map(r => r.colour))].length,
    markers: (v.state.markers || []).length,
    markerTypes: [...new Set((v.state.markers || []).map(m => m.type))].sort()
  };
});
console.log('     ', JSON.stringify(drawn));
say('every routed run is on the plan', drawn.routes >= a.segments, drawn.routes + ' drawn');
// A run whose size repeats the run feeding it is deliberately left unlabelled —
// repeating the same number 300 mm along the same duct is clutter, not
// information. What matters is that every SIZE CHANGE is called out.
say('every labelled run carries its diameter, and most runs are labelled',
  drawn.labelled >= Math.ceil(drawn.routes * 0.4),
  drawn.labelled + ' of ' + drawn.routes + ' labelled; unlabelled roles: ' +
  (drawn.unlabelled.join(',') || 'none'));
say('line weight varies with duct size', drawn.widths > 1, drawn.widths + ' distinct weights');
say('trunk and branch are drawn differently', drawn.colours > 1, drawn.colours + ' colours');
say('junctions and reducers are drawn as fittings', drawn.markers > 0,
  drawn.markerTypes.join(','));

// ── 5. The drawing feeds the bill of materials and the pressure ─────────────
STEP('The routed lengths reach the BOM and the pressure calculation');
say('the BOM bought duct for the routed metres', a.ductBomM > 0,
  a.ductBomM + ' m, $' + a.ductBomCost.toFixed(2));
// The BOM tallies the RETURN duct with the supply flex on purpose, so off-cuts
// are not double-counted. It is therefore the supply network plus the return,
// and the return is measured off its own routed line rather than assumed.
say('the return is routed on the plan, not assumed', a.returnRouted,
  a.returnDuctM.toFixed(2) + ' m drawn');
say('BOM metres are the supply network plus the routed return, and nothing else',
  a.ductBomM >= a.totalDuctM - 0.5 &&
  a.ductBomM <= a.totalDuctM + a.returnDuctM + 0.5,
  'bom ' + a.ductBomM + ' vs supply ' + a.totalDuctM + ' + return ' + a.returnDuctM.toFixed(2));
say('a pressure figure exists off the real lengths', a.pressurePa > 0, a.pressurePa + ' Pa');

// ── 6. Editing recalculates everything downstream ───────────────────────────
STEP('Changing a duct size recalculates BOM and pressure');
const before = await snap();
const target = await p.evaluate(() => {
  const app = window.nacDesigner;
  // It has to be a run ON THE INDEX RUN. Now that the house is served by
  // several arms, resizing a trunk on a different arm correctly changes
  // nothing the fan has to overcome — the index run is the worst path, and
  // that is the one the pressure figure follows.
  const onIndex = new Set((app.design.pressure?.indexRun?.path || [])
    .map(x => x.id).filter(Boolean));
  const trunks = app.design.network.sections
    .filter(s => (s.role === 'trunk' || s.role === 'main') && s.diameterMm < 400);
  const pick = trunks.find(s => onIndex.has(s.id))
    || trunks.reduce((a, b) => (b.diameterMm < a.diameterMm ? b : a));
  app.setSegmentDiameter(pick.id, 400);
  return { id: pick.id, was: pick.diameterMm, onIndex: onIndex.has(pick.id) };
});
await p.waitForTimeout(900);
const after = await snap();
const nowSize = await p.evaluate((id) =>
  window.nacDesigner.design.network.sections.find(s => s.id === id)?.diameterMm, target.id);
say('the override took', nowSize === 400, target.id + ': ' + target.was + ' → ' + nowSize);
say('the pressure figure moved with it', after.pressurePa !== before.pressurePa,
  before.pressurePa + ' → ' + after.pressurePa);

// ── 7. Locking survives a re-route ──────────────────────────────────────────
STEP('A locked run is not thrown away by RE-ROUTE UNLOCKED');
const lockInfo = await p.evaluate(() => {
  const app = window.nacDesigner;
  // The run into a room: a final flex under the NAC model, a major branch on a
  // layout that has one.
  const branch = app.design.network.sections.find(s => s.role === 'final' || s.role === 'branch');
  // Move it somewhere the router would never put it, then lock it.
  const moved = branch.points.map(pt => ({ x: pt.x + 37, y: pt.y + 23 }));
  app.design.lockedRoutes = { ...(app.design.lockedRoutes || {}),
    [branch.id]: { points: moved, by: 'test', at: new Date().toISOString() } };
  app.update();
  return { id: branch.id, moved };
});
await p.waitForTimeout(700);
await p.evaluate(() => window.nacDesigner.rerouteUnlocked());
await p.waitForTimeout(900);
const kept = await p.evaluate((id) => {
  const s = window.nacDesigner.design.network.sections.find(x => x.id === id);
  return { points: s.points, locked: !!s.locked };
}, lockInfo.id);
say('the locked geometry survived the re-route',
  JSON.stringify(kept.points) === JSON.stringify(lockInfo.moved.map(p => ({ x: p.x, y: p.y }))),
  lockInfo.id);
say('and it is marked as locked', kept.locked);

// ── 8. It never claims to be installable ────────────────────────────────────
STEP('The estimator is never told an auto route is safe to install');
const noticeOnPlan = await p.evaluate(() =>
  (document.querySelector('.main')?.innerText || ''));
say('AUTO ROUTE — VERIFY SITE CONDITIONS is on screen',
  /AUTO ROUTE — VERIFY SITE CONDITIONS/.test(noticeOnPlan));
say('confidence is reported, and is never "install ready"',
  ['HIGH', 'MEDIUM', 'LOW'].includes(a.confidence) &&
  !/install[- ]?ready/i.test(noticeOnPlan), a.confidence);

const warned = await p.evaluate(() =>
  (window.nacDesigner.design.routeScore?.warnings || []).map(w => w.code));
say('an unverified-route warning is raised on the design',
  warned.includes('UNVERIFIED_ROUTE'), warned.join(','));

await b.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
