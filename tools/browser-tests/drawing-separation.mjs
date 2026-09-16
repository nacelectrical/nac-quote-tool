// THE DRAWING MUST NOT LIE ABOUT WHAT IS CONNECTED TO WHAT.
//
// Nick: "The return-air drawing currently appears joined to the supply
// ductwork/BTO system. That is unacceptable even if the underlying data model
// is separate."
//
// He is right, and the distinction is the whole point of this file. There are
// already model-level tests proving the return has its own entities and zero
// BTOs (tests/return-separation.test.mjs). None of them look at the PICTURE.
// The router gives every main and every return the fan coil's own centre as an
// endpoint, so drawn literally they all met at one point and the return read as
// plumbed into the supply — a true model rendered as a false drawing.
//
// So these assertions read what was actually PUT ON THE CANVAS: the re-anchored
// endpoints, the equipment positions, the crossings and every label box. They
// are drawing tests, not model tests.

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
const P = (pt) => '(' + Math.round(pt.x) + ',' + Math.round(pt.y) + ')';
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const { out } = await buildApproved();
out.plan = { ...(out.plan || {}), dataUrl: PLAN };

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1050 } });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.nacDesigner, null, { timeout: 30000 });
await p.evaluate((d) => {
  const a = window.nacDesigner;
  a.design = d; a.mode = 'full'; a.tab = 'plan'; a.render();
}, JSON.parse(JSON.stringify(out)));
await p.waitForTimeout(1500);

const drawn = () => p.evaluate(() => window.nacDesigner.viewer.state.drawn || null);
const setView = async (v) => { await p.evaluate(k => window.nacDesigner.setPlanView(k), v);
                               await p.waitForTimeout(600); };

await setView('clean');
const D = await drawn();

// ── 1. Two boxes, on two sides, with a gap between them ─────────────────────
STEP('[1] The supply plenum and the return box are separate things in separate places');
say('the drawing recorded what it drew', !!D && !!D.equipment);
const E = D.equipment;
say('there is a supply plenum', !!E.supplyPlenum, E.supplyPlenum && P(E.supplyPlenum));
say('there is a return box', !!E.returnBox, E.returnBox && P(E.returnBox));
say('they are not in the same place', E.separationPx > 30,
  Math.round(E.separationPx) + ' px apart');
say('neither sits on the fan coil centre',
  dist(E.supplyPlenum, E.fanCoil) > 10 && dist(E.returnBox, E.fanCoil) > 10,
  'FCU ' + P(E.fanCoil));
// Opposite sides, not merely two points a few pixels apart on the same side.
const angleOf = (pt) => Math.atan2(pt.y - E.fanCoil.y, pt.x - E.fanCoil.x);
const spread = Math.abs(((angleOf(E.returnBox) - angleOf(E.supplyPlenum) + Math.PI)
  % (Math.PI * 2)) - Math.PI);
say('they are on opposite sides of the fan coil', spread > Math.PI / 2,
  Math.round(spread * 180 / Math.PI) + '° apart');

// ── 2. Every duct ends where it should ──────────────────────────────────────
STEP('[2] Return ducts terminate at the return box, and nothing else does');
const nearBox = (pt) => dist(pt, E.returnBox) < 6;
const nearPlenum = (pt) => dist(pt, E.supplyPlenum) < 6;
say('every return duct ends at the return box',
  D.returnEnds.every(r => nearBox(r.a) || nearBox(r.z)),
  D.returnEnds.map(r => P(r.a) + '→' + P(r.z)).join('  '));
say('exactly two return ducts land on it', D.returnEnds.length === 2,
  D.returnEnds.length + ' return runs');
say('NO supply duct terminates at the return box',
  D.supplyEnds.every(r => !nearBox(r.a) && !nearBox(r.z)),
  D.supplyEnds.filter(r => nearBox(r.a) || nearBox(r.z)).map(r => r.role).join(', ') || 'none');
say('NO return duct terminates at the supply plenum',
  D.returnEnds.every(r => !nearPlenum(r.a) && !nearPlenum(r.z)),
  D.returnEnds.filter(r => nearPlenum(r.a) || nearPlenum(r.z)).length + ' offenders');
say('every supply main starts at the supply plenum',
  D.supplyEnds.filter(r => r.role === 'main').every(r => nearPlenum(r.a)),
  D.supplyEnds.filter(r => r.role === 'main').map(r => P(r.a)).join(' '));

STEP('[3] Supply and return share no endpoint at all');
const shared = [];
for (const s of D.supplyEnds) {
  for (const r of D.returnEnds) {
    for (const a of [s.a, s.z]) for (const c of [r.a, r.z]) {
      if (dist(a, c) < 4) shared.push(P(a));
    }
  }
}
say('not one coordinate is shared between a supply and a return end',
  shared.length === 0, shared.join(' ') || 'none shared');

// ── 4. Crossings are crossings, not joints ──────────────────────────────────
STEP('[4] Where the two systems cross, they pass — they do not join');
say('the crossing check ran', Array.isArray(D.crossings),
  D.crossings.length + ' crossing(s)');
// Every crossing must be away from the equipment: two ducts meeting AT the unit
// is the plenum and the box, which is not a crossing.
say('no crossing is reported at the fan coil',
  D.crossings.every(c => dist(c, E.fanCoil) > 20),
  D.crossings.map(P).join(' ') || 'none');
// A crossing is drawn as a GAP in the return plus a bridge. The proof it is not
// a junction: the return run records the break.
const broken = D.returnEnds.reduce((n, r) => n + r.crossings, 0);
say('each crossing breaks the return run rather than dotting it',
  broken === D.crossings.length,
  broken + ' break(s) for ' + D.crossings.length + ' crossing(s)');

// ── 5. The model is still the model ─────────────────────────────────────────
STEP('[5] Nothing about the approved design moved');
const counts = await p.evaluate(() => window.nacDesigner.design.componentCounts);
say('return BTOs remain zero', counts.returnBtos === 0);
say('10 outlets, 3 mains, 5 BTOs, 2 return grilles, 2 return ducts, 1 return box',
  counts.supplyOutlets === 10 && counts.supplyMains === 3 && counts.supplyBtos === 5 &&
  counts.returnGrilles === 2 && counts.returnDucts === 2 && counts.returnPlenums === 1,
  JSON.stringify(counts));
const dampers = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  const returnIds = new Set((d.returnRoutes || []).map(r => r.id));
  return (d.zoneDampers || []).filter(z => returnIds.has(z.sectionId)).length;
});
say('no zone motor is rendered on a return duct', dampers === 0, dampers + ' on returns');

// ── 6. Clean View carries no editing anything ───────────────────────────────
STEP('[6] Clean View and the report have no cyan handles');
const cyanCount = () => p.evaluate(() => {
  const cv = document.querySelector('canvas');
  const c = cv.getContext('2d');
  const px = c.getImageData(0, 0, cv.width, cv.height).data;
  // The selection cyan is #13C7DC. Count anything close to it.
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (Math.abs(px[i] - 0x13) < 40 && Math.abs(px[i + 1] - 0xC7) < 40 &&
        Math.abs(px[i + 2] - 0xDC) < 40) n++;
  }
  return n;
});
await setView('clean');
const cleanCyan = await cyanCount();
say('Clean View contains zero cyan editing pixels', cleanCyan === 0, cleanCyan + ' px');
await setView('outlets');
const editCyan = await cyanCount();
say('Edit outlets DOES show cyan handles', editCyan > 40, editCyan + ' px');
await setView('routes');
const routeCyan = await cyanCount();
say('Edit routes shows its handles too', routeCyan > 40, routeCyan + ' px');
// The report must be clean whatever mode is on.
const snapClean = await p.evaluate(() => {
  const a = window.nacDesigner;
  a.viewer.snapshot({ clean: true, legend: true });   // leaves the canvas restored
  return true;
});
await setView('clean');
say('a report snapshot taken from an edit mode leaves no handles behind',
  (await cyanCount()) === 0 && snapClean);

// ── 7. No label covers a symbol or another label ────────────────────────────
STEP('[7] Nothing on the sheet is written over anything else');
const D2 = await drawn();
const boxes = D2.boxes;
const area = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return (w > 0 && h > 0) ? w * h : 0;
};
const labels = boxes.filter(b => !b.symbol);
const symbols = boxes.filter(b => b.symbol);
say('the sheet registered its symbols and labels', symbols.length > 10 && labels.length > 10,
  symbols.length + ' symbols, ' + labels.length + ' labels');

let onSymbol = 0, worstSym = 0;
for (const l of labels) for (const sB of symbols) {
  const a = area(l, sB);
  if (a > 0) { onSymbol++; worstSym = Math.max(worstSym, a); }
}
say('no label is written across a symbol', onSymbol === 0,
  onSymbol + ' overlap(s), worst ' + Math.round(worstSym) + ' px²');

let onLabel = 0, worstLbl = 0;
for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
  const a = area(labels[i], labels[j]);
  if (a > 0) { onLabel++; worstLbl = Math.max(worstLbl, a); }
}
say('no label is written across another label', onLabel === 0,
  onLabel + ' overlap(s), worst ' + Math.round(worstLbl) + ' px²');

// ── 8. The central equipment/BTO area specifically ──────────────────────────
STEP('[8] The fan-coil and BTO area, where it was worst');
const R = 130;
const central = (bx) => Math.hypot((bx.x0 + bx.x1) / 2 - E.fanCoil.x,
                                   (bx.y0 + bx.y1) / 2 - E.fanCoil.y) < R;
const cLabels = labels.filter(central), cSymbols = symbols.filter(central);
say('the central area is genuinely busy', cLabels.length >= 5 && cSymbols.length >= 4,
  cLabels.length + ' labels, ' + cSymbols.length + ' symbols within ' + R + ' px');
let cHits = 0;
for (const l of cLabels) {
  for (const sB of cSymbols) if (area(l, sB) > 0) cHits++;
  for (const o of cLabels) if (o !== l && area(l, o) > 0) cHits++;
}
say('and nothing in it overlaps anything else', cHits === 0, cHits + ' overlap(s)');

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
await b.close();
process.exit(failures ? 1 : 0);
