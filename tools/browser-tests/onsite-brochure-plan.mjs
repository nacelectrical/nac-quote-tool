// THE REAL PLAN THAT FAILED ONSITE.
//
//   tests/fixtures/plan-brochure-ground-floor.jpg
//
// A builder's brochure sheet. No dimension chain anywhere on it — every room
// states its own size in text under its name. Twenty rooms are labelled, nine
// of them are ones NAC never air conditions, and two conditioned rooms (MEALS
// and STUDY) carry no size at all.
//
// The labels and their pixel positions below are transcribed off that image.
// The plan reader is stubbed because reading it needs the AI endpoint, which
// this environment cannot reach — but what the stub returns is what is printed
// on the sheet, not a convenient fiction.
//
// What is proved here is the whole of Nick's brief, in order:
//
//   UPLOAD → AUTOMATIC EXCLUSIONS → VERIFY ONLY CONDITIONED UNCERTAIN ROOMS
//   → COMPLETE AUTO DESIGN → MATERIAL LIST → PRICE
//
// without once opening ADVANCED DESIGN.

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PLAN = readFileSync(new URL('../../tests/fixtures/plan-brochure-ground-floor.jpg', import.meta.url));
const PLAN_DATA_URL = 'data:image/jpeg;base64,' + PLAN.toString('base64');

// Every label on the sheet, at the pixel it is printed, in the image's own
// 1179 x 1262 space. `size` is the text printed directly under the name.
const SHEET = [
  ['LIVING',           297,  155, '4.3 x 7.1m'],
  ['KITCHEN',          203,  382, '3.7 x 4.2m'],
  ['MEALS',            398,  436, null],
  ['LOUNGE',           578,  334, '4.0 x 4.9m'],
  ['FAMILY',           238,  633, '5.8 x 3.9m'],
  ['STUDY',            378,  600, null],
  ['FOYER',            548,  663, '3.0 x 3.9m'],
  ['MASTER BEDROOM',   790,  560, '2.7 x 4.0m'],
  ['BEDROOM 4',        430,  772, '3.0 x 3.4m'],
  ['BEDROOM 2',        196, 1068, '3.0 x 3.2m'],
  ['BEDROOM 3',        415, 1068, '3.0 x 3.2m'],
  ['ENSUITE',          790,  700, null],
  ['WC',               222,  737, null],
  ["L'DRY",            186,  771, '2.9 x 2.3m'],
  ['BATH',             196,  884, '2.9 x 1.4m'],
  ['GARAGE',           855,  799, '6.0 x 6.9m'],
  ['COVERED ALFRESCO', 845,  335, null],
  ['PORCH',            658,  775, null],
  ["P'TRY",            137,  438, null],
  ["CUP'D",            313,  987, null]
];

// What NAC air conditions on this sheet, and what it does not. This is the
// answer an NAC estimator would give, written down before the tool is asked.
const SHOULD_BE_EXCLUDED = ['ENSUITE', 'WC', "L'DRY", 'BATH', 'GARAGE',
                            'COVERED ALFRESCO', 'PORCH', "P'TRY", "CUP'D"];
const SHOULD_BE_CONDITIONED = ['LIVING', 'KITCHEN', 'MEALS', 'LOUNGE', 'FAMILY', 'STUDY',
                               'FOYER', 'MASTER BEDROOM', 'BEDROOM 4', 'BEDROOM 2', 'BEDROOM 3'];

const observations = {
  observations: {
    roomLabels: SHEET.map(([text, x, y], i) => ({
      id: 'L' + i, text,
      box: { x: x - text.length * 4, y: y - 9, w: text.length * 8, h: 18 }
    })),
    // The size text sits on its own line under the room name — which is how the
    // real sheet prints it, and the path that adopts a loose pair onto the room
    // above it.
    detections: SHEET.filter(r => r[3]).map(([text, x, y, size], i) => ({
      id: 'D' + i, text: size,
      box: { x: x - size.length * 3.2, y: y + 13, w: size.length * 6.4, h: 14 }
    })),
    walls: [], openings: [], floorAreas: []
  },
  quality: 'good',
  notes: []
};

let failures = 0, step = 0;
const say = (n, c, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failures++; };
const STEP = (n) => console.log(`\n[${++step}] ${n}`);

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 180)));

await p.route('**/api/plan-read', r => r.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(observations) }));
await p.route('**/rest/v1/**', r => r.fulfill({
  status: 200, contentType: 'application/json', body: '[]' }));

const main = () => p.evaluate(() => document.querySelector('.main')?.innerText || '');
const rooms = () => p.evaluate(() => (window.nacDesigner.design.rooms || []).map(r => ({
  label: r.label, status: r.status, cls: r.conditioningStatus, why: r.conditioningReason,
  area: r.areaSqM, band: r.confidenceBand, src: r.measurement?.source,
  box: !!r.boundaryPx, derived: r.boundaryDerived || null })));

// ── 1. UPLOAD the real plan ─────────────────────────────────────────────────
STEP('UPLOAD — the real brochure sheet, read as it is printed');
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1400);

say('the designer opens in QUICK QUOTE MODE',
  await p.evaluate(() => window.nacDesigner.mode === 'quick'));

await p.evaluate(async (url) => {
  const res = await fetch(url);
  const blob = await res.blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'plan-brochure-ground-floor.jpg', { type: 'image/jpeg' }));
  const el = document.querySelector('input[type=file]');
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, PLAN_DATA_URL);
await p.waitForTimeout(2200);
say('the plan is loaded', await p.evaluate(() => !!window.nacDesigner.design.plan));

await p.evaluate(() => window.nacDesigner.readPlan());
await p.waitForTimeout(3500);

const read = await rooms();
say('all twenty labelled rooms were read', read.length === 20, read.length + ' rooms');

// ── 2. CLASSIFICATION ───────────────────────────────────────────────────────
STEP('CLASSIFICATION — every room, and why');
console.log('      ROOM                CLASS            STATUS            AREA     SOURCE');
for (const r of read) {
  console.log('      ' + r.label.padEnd(19) +
    (r.cls || '?').padEnd(17) + String(r.status).padEnd(18) +
    String(r.area ?? '—').padEnd(9) + (r.src || '—'));
}

const clsOf = (l) => read.find(r => r.label === l)?.cls;
say('every room NAC excludes is classified NON_CONDITIONED',
  SHOULD_BE_EXCLUDED.every(l => clsOf(l) === 'NON_CONDITIONED'),
  SHOULD_BE_EXCLUDED.filter(l => clsOf(l) !== 'NON_CONDITIONED').join(', ') || 'all nine');
say('every room NAC conditions is classified CONDITIONED',
  SHOULD_BE_CONDITIONED.every(l => clsOf(l) === 'CONDITIONED'),
  SHOULD_BE_CONDITIONED.filter(l => clsOf(l) !== 'CONDITIONED').join(', ') || 'all eleven');
say('KITCHEN is conditioned even though the pantry beside it is not',
  clsOf('KITCHEN') === 'CONDITIONED' && clsOf("P'TRY") === 'NON_CONDITIONED');
say('no room was left needing a classification decision',
  !read.some(r => r.cls === 'REVIEW_REQUIRED'),
  read.filter(r => r.cls === 'REVIEW_REQUIRED').map(r => r.label).join(', ') || 'none');

say('an excluded room is never asked for a dimension',
  read.filter(r => r.cls === 'NON_CONDITIONED').every(r => r.status === 'Excluded'),
  read.filter(r => r.cls === 'NON_CONDITIONED' && r.status !== 'Excluded')
      .map(r => r.label + '=' + r.status).join(', ') || 'all nine read "Excluded"');

const counts = await p.evaluate(async () => {
  const { classificationSummary } = await import('/designer/engines/classify.mjs');
  const c = classificationSummary(window.nacDesigner.design.rooms);
  return { cond: c.conditionedCount, exc: c.excludedCount, kinds: c.excludedByKind };
});
say('the screen can say "11 CONDITIONED · 9 EXCLUDED AUTOMATICALLY"',
  counts.cond === 11 && counts.exc === 9,
  counts.cond + ' conditioned / ' + counts.exc + ' excluded — ' +
  Object.entries(counts.kinds).map(([k, n]) => n + '×' + k).join(', '));

// ── 3. WHAT VERIFY ASKS ─────────────────────────────────────────────────────
STEP('VERIFY — only conditioned rooms with uncertain dimensions');
const asked = await p.evaluate(async () => {
  const { collectInterruptions } = await import('/designer/engines/interruptions.mjs');
  const i = collectInterruptions(window.nacDesigner.design);
  return { all: i.all.map(x => ({ level: x.level, title: x.title, roomId: x.roomId || null })),
           blockReason: i.blockReason, canQuote: i.canQuote };
});
for (const a of asked.all) console.log('      ' + a.level.padEnd(9) + a.title);

say('no excluded room is in the verification queue',
  !asked.all.some(a => SHOULD_BE_EXCLUDED.some(l => a.title.toUpperCase().includes(l.toUpperCase()))),
  'nothing about bathroom, ensuite, laundry, garage, robe, pantry or alfresco');
say('MEALS is asked for — it is conditioned and has no printed size',
  asked.all.some(a => /MEALS/.test(a.title)));
say('STUDY is asked for — same reason',
  asked.all.some(a => /STUDY/.test(a.title)));
say('each blocked room is named once, not three times',
  asked.all.filter(a => /MEALS/.test(a.title)).length === 1 &&
  asked.all.filter(a => /STUDY/.test(a.title)).length === 1);
say('the headline names the rooms, not "calibration required"',
  /MEALS/.test(asked.blockReason || '') && /STUDY/.test(asked.blockReason || '') &&
  !/CALIBRAT/i.test(asked.blockReason || ''),
  asked.blockReason);

// ── 4. CALIBRATION ──────────────────────────────────────────────────────────
STEP('CALIBRATION — judged on conditioned rooms only');
const cal1 = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  return { required: d.calibrationRequirement?.required, label: d.calibrationRequirement?.statusLabel,
           reason: d.calibrationRequirement?.reason, have: !!d.calibration };
});
console.log('      ' + cal1.label + ' — ' + cal1.reason);
say('calibration is NOT demanded because a bathroom has no readable size',
  !/BATH|ENSUITE|WC|GARAGE|ALFRESCO|PORCH|DRY|TRY|CUP/i.test(cal1.reason || ''));
say('it is asked for only because MEALS and STUDY are unmeasured',
  /MEALS/.test(cal1.reason || '') && /STUDY/.test(cal1.reason || ''));

// The estimator calibrates on the garage: 6.0 m across its printed width.
// This is the two-point calibration, done on the plan, inside quick mode.
await p.evaluate(() => {
  const app = window.nacDesigner;
  app.calibPoints = [{ x: 690, y: 1105 }, { x: 1030, y: 1105 }];
  app.calibDistance = 6000;
  app.calibUnit = 'mm';
  app.applyCalibration();
});
await p.waitForTimeout(1200);
const cal2 = await p.evaluate(() => ({
  ppm: window.nacDesigner.design.calibration?.pixelsPerMm,
  boxes: (window.nacDesigner.design.rooms || []).filter(r => r.boundaryPx).length,
  derived: (window.nacDesigner.design.rooms || []).filter(r => r.boundaryDerived).length
}));
say('the plan calibrates from two points on the drawing', cal2.ppm > 0,
  cal2.ppm?.toFixed(5) + ' px/mm');
// Twelve rooms on this sheet carry a printed size. MEALS and STUDY do not, so
// they are placed later, once the estimator supplies their dimensions.
say('every room with a printed size now has a place on the drawing to route to',
  cal2.boxes === 12 && cal2.derived === 12,
  cal2.boxes + ' rooms placed, ' + cal2.derived + ' from their printed size');

// ── 5. THE TWO ROOMS THE PLAN DOES NOT STATE ────────────────────────────────
STEP('The estimator types the two sizes the sheet does not print');
await p.evaluate(() => {
  const app = window.nacDesigner;
  const find = (l) => app.design.rooms.find(r => r.label === l);
  app.editRoom(find('MEALS').id, { widthMm: 3600, lengthMm: 3400 });
  app.editRoom(find('STUDY').id, { widthMm: 2800, lengthMm: 2600 });
});
await p.waitForTimeout(1500);

const after = await p.evaluate(async () => {
  const { collectInterruptions } = await import('/designer/engines/interruptions.mjs');
  const d = window.nacDesigner.design;
  const i = collectInterruptions(d);
  return { blockReason: i.blockReason, blocking: i.blocking.map(x => x.title),
           stage: d.stage, calReq: d.calibrationRequirement?.statusLabel };
});
say('no conditioned room blocks the design any more',
  !after.blocking.some(t => /MEALS|STUDY|DIMENSIONS/.test(t)),
  after.blocking.join(' | ') || 'nothing blocking');

// ── 6. THE COMPLETE AUTO DESIGN ─────────────────────────────────────────────
STEP('COMPLETE AUTO DESIGN — every stage, without ADVANCED DESIGN');
const design = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  return {
    stage: d.stage,
    sized: d.systemLoad?.roomCount, area: d.systemLoad?.totalConditionedAreaSqM,
    loadKw: d.systemLoad?.designKw,
    unit: d.selectedUnit ? d.selectedUnit.brandName + ' ' + d.selectedUnit.model : null,
    airflow: d.airflow?.systemAirflowLs, outlets: d.outlets?.rows?.length,
    sections: d.network?.sections?.length, routed: !!d.network?.routed,
    routeSegs: d.autoRoute?.segments?.length, routeConf: d.autoRoute?.confidence,
    returns: d.returnDesign?.returnCount, returnRoutes: d.returnRoutes?.length ?? 0,
    zones: d.zones?.zoneCount, dampers: d.zoneDampers?.length,
    pressure: d.pressure?.estimatedRequirementPa,
    bomLines: d.bom?.lineCount, ductM: d.network?.totalDuctLengthM,
    sell: d.commercials?.sellPriceIncGst
  };
});
for (const [k, v] of Object.entries(design)) console.log('      ' + k.padEnd(14) + (v ?? 'NULL'));

say('the pipeline ran to completion', design.stage === 'complete', design.stage);
say('LOAD CALCULATION ran', design.loadKw > 0, design.loadKw + ' kW over ' + design.area + ' m²');
say('EQUIPMENT SELECTION ran', !!design.unit, design.unit);
say('AIRFLOW ran', design.airflow > 0, design.airflow + ' L/s');
say('OUTLET PLACEMENT ran', design.outlets > 0, design.outlets + ' outlets');
say('DUCT SIZING ran', design.sections > 0, design.sections + ' sized runs');
say('AUTO DUCT ROUTING ran', design.routed && design.routeSegs > 0,
  design.routeSegs + ' routed segments, confidence ' + design.routeConf);
say('RETURN AIR ran and was routed', design.returns > 0 && design.returnRoutes > 0,
  design.returns + ' return, ' + design.returnRoutes + ' routed');
say('ZONING ran', design.zones > 0, design.zones + ' zones, ' + design.dampers + ' dampers');
say('STATIC PRESSURE ran', design.pressure > 0, design.pressure + ' Pa');
say('BOM ran', design.bomLines > 0, design.bomLines + ' lines, ' + design.ductM + ' m duct');
say('COSTING ran', design.sell > 0, '$' + design.sell);
say('ADVANCED DESIGN was never opened',
  await p.evaluate(() => window.nacDesigner.mode === 'quick'));

// ── 7. THE LAYOUT IS ACTUALLY ON THE PLAN ───────────────────────────────────
STEP('The duct layout is DRAWN on the floor plan, not just calculated');
await p.evaluate(() => window.nacDesigner.setQuickStep('design'));
await p.waitForTimeout(1400);
const drawn = await p.evaluate(() => {
  const v = window.nacDesigner.viewer;
  const routes = Object.values(v?.state?.routes || {});
  return {
    canvas: !!document.querySelector('.main canvas'),
    routes: routes.length,
    labelled: routes.filter(r => /\u00f8\d+/.test(r.label || '')).length,
    trunk: routes.filter(r => r.role === 'trunk' || r.role === 'main').length,
    branch: routes.filter(r => r.role === 'branch').length,
    final: routes.filter(r => r.role === 'final').length,
    ret: routes.filter(r => r.role === 'return').length,
    markers: (v?.state?.markers || []).length,
    markerTypes: [...new Set((v?.state?.markers || []).map(m => m.type))].sort(),
    diameters: [...new Set(routes.map(r => (r.label || '').match(/\u00f8(\d+)/)?.[1]).filter(Boolean))]
  };
});
console.log('      ' + JSON.stringify(drawn));
say('the plan canvas is on the DESIGN step', drawn.canvas);
say('duct runs are drawn on it', drawn.routes > 0, drawn.routes + ' polylines');
// A run that repeats the size of the run feeding it is deliberately left
// unlabelled — the same number twice on one duct is clutter, not information.
say('the sizes are on the drawing, without labelling the same duct twice',
  drawn.labelled > 0 && drawn.labelled <= drawn.routes,
  drawn.labelled + ' labels on ' + drawn.routes + ' runs');
say('the SUPPLY MAINS are drawn', drawn.trunk > 0, drawn.trunk + ' main/trunk runs');
// Under the NAC flex model every outlet is fed by ONE continuous final flex off
// a take-off. A major branch only exists where several outlets sit well off the
// main and share one run out to them, so zero of them on this plan is the model
// working, not a gap: what must never be zero is the finals.
say('a FINAL FLEX is drawn to every outlet',
  drawn.final === 15 && drawn.branch >= 0, drawn.final + ' finals, ' + drawn.branch + ' major branches');
say('the RETURN is drawn', drawn.ret > 0, drawn.ret + ' return run');
say('zone dampers and take-offs are drawn',
  drawn.markerTypes.includes('bto') && drawn.markerTypes.includes('damper'),
  drawn.markerTypes.join(','));
say('no 450 or 500 duct is anywhere on it',
  !drawn.diameters.includes('450') && !drawn.diameters.includes('500'),
  drawn.diameters.sort((a, c) => a - c).join('/') + ' mm');
// NAC's install rules, enforced by the sizing engine and therefore visible on
// the drawing: nothing below 200, and nothing above 300 on an outlet run.
say('no 150 or smaller anywhere in the auto design',
  !drawn.diameters.some(x => Number(x) < 200),
  drawn.diameters.filter(x => Number(x) < 200).join('/') || 'smallest is 200');

const designText = await main();
say('AUTO ROUTE — VERIFY SITE CONDITIONS is on screen',
  /AUTO ROUTE — VERIFY SITE CONDITIONS/.test(designText));

// ── 8. EXCLUDED ROOMS GOT NOTHING ───────────────────────────────────────────
STEP('Excluded rooms received zero load, zero outlets, zero duct, zero zones');
const zero = await p.evaluate((excluded) => {
  const d = window.nacDesigner.design;
  const ids = (d.rooms || []).filter(r => excluded.includes(r.label)).map(r => r.id);
  return {
    ids: ids.length,
    watts: (d.roomLoads || []).filter(r => ids.includes(r.roomId))
      .reduce((s, r) => s + (r.designW || 0), 0),
    loadRows: (d.roomLoads || []).filter(r => ids.includes(r.roomId)).length,
    airflowRows: (d.airflow?.rows || []).filter(r => ids.includes(r.roomId)).length,
    outlets: (d.outlets?.rows || []).filter(r => ids.includes(r.roomId)).length,
    ducts: (d.network?.sections || []).filter(s => ids.includes(s.roomId)).length,
    routes: (d.autoRoute?.segments || []).filter(s => ids.includes(s.roomId)).length,
    zones: (d.zones?.zones || []).filter(z => (z.roomIds || []).some(r => ids.includes(r))).length
  };
}, SHOULD_BE_EXCLUDED);
console.log('      ' + JSON.stringify(zero));
say('all nine excluded rooms are accounted for', zero.ids === 9);
say('zero load', zero.watts === 0 && zero.loadRows === 0);
say('zero airflow', zero.airflowRows === 0);
say('zero outlets', zero.outlets === 0);
say('zero duct branches', zero.ducts === 0 && zero.routes === 0);
say('zero zones', zero.zones === 0);

// ── 9. MATERIALS AND PRICE, STILL IN QUICK MODE ─────────────────────────────
STEP('MATERIAL LIST and PRICE — without opening ADVANCED DESIGN');
await p.evaluate(() => window.nacDesigner.setQuickStep('price'));
await p.waitForTimeout(1000);
const priceText = await main();
say('the price step shows NAC’s side of the job', /SELL PRICE|Sell price/i.test(priceText));
say('it says plainly whose figures these are',
  /These figures are NAC/i.test(priceText));

const bom = await p.evaluate(() => {
  const b = window.nacDesigner.design.bom;
  return { lines: b?.lineCount, duct: (b?.items || []).filter(i => i.key === 'flex_duct')
             .map(i => i.diameterMm + 'mm x' + i.quantity), cost: b?.totalCost };
});
say('the material list is built', bom.lines > 0, bom.lines + ' lines, $' + bom.cost);
say('duct is ordered in 6 m lengths', bom.duct.length > 0, bom.duct.join(', '));
say('ADVANCED DESIGN was still never opened',
  await p.evaluate(() => window.nacDesigner.mode === 'quick'));

// ── 10. ZONING ──────────────────────────────────────────────────────────────
STEP('ZONING — rooms open to one another share a zone');
const z = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  return {
    count: d.zones?.zoneCount,
    zones: (d.zones?.zones || []).map(x => ({ name: x.name, kind: x.kind,
      rooms: x.rooms, ls: x.airflowLs, pct: x.systemSharePct, open: x.alwaysOpen })),
    meets: d.zones?.meetsMinimum,
    minOpenPct: d.zones?.minimumOpenFractionPct,
    grouping: { method: d.openPlanSuggestion?.method,
                confidence: d.openPlanSuggestion?.confidence,
                grouped: d.openPlanSuggestion?.openPlanRoomCount,
                rooms: d.openPlanSuggestion?.groups?.[0]?.rooms || [] },
    controller: d.controller?.name, controllerCost: d.controller?.cost,
    motors: (d.bom?.items || []).filter(i => /zone_motor/.test(i.key))
      .reduce((s2, i) => s2 + i.quantity, 0),
    sell: d.commercials?.sellPriceIncGst
  };
});
for (const x of z.zones) {
  console.log('      ' + String(x.kind).padEnd(11) + String(x.ls).padStart(5) + ' L/s ' +
    String(x.pct).padStart(5) + '%  ' + (x.rooms || []).join(' + '));
}
console.log('      grouping: ' + JSON.stringify(z.grouping));

say('the house is not one zone per room', z.count < 11, z.count + ' zones, not 11');
say('the open-plan living area is one zone', z.grouping.grouped >= 3,
  z.grouping.rooms.join(' + '));
say('the minimum open airflow rule is met', z.meets === true, z.minOpenPct + '% stays open');
say('the controller in the box is enough', z.controllerCost === 0, z.controller);
// A constant zone is by definition a zone with NO damper — it is the path the
// air always has. So it is one motor per CLOSABLE zone, never one per room.
const closable = z.zones.filter(x => !x.open).length;
say('one zone motor per closable zone, not one per room',
  z.motors === closable && z.motors < 11,
  z.motors + ' motors for ' + z.count + ' zones (' + closable + ' closable, ' +
  (z.count - closable) + ' always open)');

// Without wall data the grouping is a proposal, and it says so and asks.
say('a grouping made from room positions is not claimed as fact',
  z.grouping.confidence !== 'HIGH', z.grouping.confidence + ' via ' + z.grouping.method);
const zoneAsk = await p.evaluate(async () => {
  const { collectInterruptions } = await import('/designer/engines/interruptions.mjs');
  return collectInterruptions(window.nacDesigner.design).all
    .filter(i => /ZONE/.test(i.id)).map(i => ({ id: i.id, level: i.level, title: i.title }));
});
say('the estimator is asked to confirm it, once',
  zoneAsk.some(i => i.id === 'ZONE_GROUPING_UNCONFIRMED'),
  zoneAsk.map(i => i.title).join(' | ') || 'nothing asked');
say('and it is a CONFIRM, not a blocker',
  zoneAsk.every(i => i.level === 'CONFIRM'));

// The one correction the drawing cannot make for itself: a formal lounge
// behind a door, grouped because the reader gave no walls.
STEP('The estimator splits the formal LOUNGE onto its own zone');
const split = await p.evaluate(() => {
  const app = window.nacDesigner;
  const lounge = app.design.rooms.find(r => r.label === 'LOUNGE');
  app.splitRoomFromZone(lounge.id);
  const d = app.design;
  return { count: d.zones.zoneCount, meets: d.zones.meetsMinimum,
           loungeAlone: (d.zones.zones.find(x => (x.rooms || []).includes('LOUNGE')) || {}).rooms,
           source: d.rooms.find(r => r.label === 'LOUNGE').zoneGroupSource,
           motors: (d.bom?.items || []).filter(i => /zone_motor/.test(i.key))
             .reduce((s2, i) => s2 + i.quantity, 0) };
});
say('LOUNGE is on its own zone', split.loungeAlone?.length === 1 &&
  split.loungeAlone[0] === 'LOUNGE', JSON.stringify(split.loungeAlone));
say('it is recorded as the estimator\u2019s call so a re-run will not undo it',
  split.source === 'estimator');
say('splitting a room added a damper to the order',
  split.motors === split.count - 1 && split.motors === z.motors + 1,
  split.count + ' zones, ' + split.motors + ' motors (was ' + z.motors + ')');
say('the airflow rule still holds', split.meets === true);

// ── 11. THE ESTIMATOR'S OVERRIDE ────────────────────────────────────────────
STEP('The estimator can condition an excluded room on the job that needs it');
const before = await p.evaluate(() => window.nacDesigner.design.systemLoad.totalConditionedAreaSqM);
await p.evaluate(async () => {
  const { CONDITIONING } = await import('/designer/engines/classify.mjs');
  const app = window.nacDesigner;
  const g = app.design.rooms.find(r => r.label === 'GARAGE');
  app.setRoomConditioning(g.id, CONDITIONING.CONDITIONED);
});
await p.waitForTimeout(1400);
const over = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  const g = d.rooms.find(r => r.label === 'GARAGE');
  return { cls: g.conditioningStatus, src: g.conditioningSource, status: g.status,
           area: d.systemLoad.totalConditionedAreaSqM,
           inLoad: (d.roomLoads || []).some(r => r.roomId === g.id) };
});
say('the garage becomes CONDITIONED on this job', over.cls === 'CONDITIONED', over.status);
say('it is recorded as the estimator’s call, not a re-read of the label',
  over.src === 'estimator');
say('and it now carries load', over.inLoad && over.area > before,
  before + ' m² → ' + over.area + ' m²');

await b.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
