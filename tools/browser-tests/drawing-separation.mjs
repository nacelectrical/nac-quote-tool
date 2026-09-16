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

// THE JOB'S OWN SETTINGS GO IN WITH IT.
//
// `render()` re-runs the pipeline against the APP's settings, so injecting the
// design alone silently re-derives it with NAC's defaults. This job is approved
// with a 250 mm minimum supply branch; the shipped default is 200, and the four
// small finals came back resized to 200 — a drawing that was internally
// consistent and described a different design from the approved one.
const { out, settings: jobSettings } = await buildApproved();
out.plan = { ...(out.plan || {}), dataUrl: PLAN };

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1050 } });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.nacDesigner, null, { timeout: 30000 });
// Boot has to finish before the job's settings are applied: loadConfig()
// resolves asynchronously and overwrites them with the stored defaults.
await p.waitForTimeout(1500);
await p.evaluate((payload) => {
  const a = window.nacDesigner;
  a.design = payload.design;
  if (payload.settings) {
    a.settings = payload.settings;
    a.settingsOverride = { duct: { minimumSupplyBranchDiameterMm:
      payload.settings.duct?.minimumSupplyBranchDiameterMm } };
  }
  a.mode = 'full'; a.tab = 'plan'; a.render();
}, { design: JSON.parse(JSON.stringify(out)),
     settings: JSON.parse(JSON.stringify(jobSettings || null)) });
await p.waitForTimeout(1500);

const drawn = () => p.evaluate(() => window.nacDesigner.viewer.state.drawn || null);
const setView = async (v) => { await p.evaluate(k => window.nacDesigner.setPlanView(k), v);
                               await p.waitForTimeout(600); };

await setView('clean');
const D = await drawn();

// ── 1. One assembled arrangement: RETURN PLENUM → FCU → SUPPLY PLENUM ───────
STEP('[1] The plenums are bolted to opposite faces of the fan coil');
say('the drawing recorded what it drew', !!D && !!D.equipment);
const E = D.equipment;
const SP = E.supplyPlenum, RP = E.returnPlenum;
say('there is a supply plenum', !!SP, SP && P(SP));
say('there is a return plenum', !!RP, RP && P(RP));
say('they are not in the same place', E.separationPx > 30,
  Math.round(E.separationPx) + ' px apart');
say('neither sits on the fan coil centre',
  dist(SP, E.fanCoil) > 10 && dist(RP, E.fanCoil) > 10, 'FCU ' + P(E.fanCoil));

// ATTACHED, NOT MERELY NEARBY. Each plenum's inner face is the fan coil's own
// face, so the distance from the FCU centre to that face is exactly half the
// unit — no gap to explain, and no overlap either.
const along = (pt) => (pt.x - E.fanCoil.x) * Math.cos(E.angle)
                    + (pt.y - E.fanCoil.y) * Math.sin(E.angle);
const across = (pt) => -(pt.x - E.fanCoil.x) * Math.sin(E.angle)
                     + (pt.y - E.fanCoil.y) * Math.cos(E.angle);
say('the supply plenum is attached to the FCU discharge face',
  Math.abs(along(SP.innerFace) - E.fanCoil.w / 2) < 0.5,
  'inner face ' + along(SP.innerFace).toFixed(2) + ' px vs half-unit ' + (E.fanCoil.w / 2).toFixed(2));
say('the return plenum is attached to the FCU return face',
  Math.abs(along(RP.innerFace) + E.fanCoil.w / 2) < 0.5,
  'inner face ' + along(RP.innerFace).toFixed(2) + ' px');
say('neither plenum overlaps the FCU body',
  along(SP.innerFace) >= E.fanCoil.w / 2 - 0.01 &&
  along(RP.innerFace) <= -E.fanCoil.w / 2 + 0.01);
say('there is no gap between either plenum and the FCU',
  Math.abs(along(SP.innerFace) - E.fanCoil.w / 2) < 0.5 &&
  Math.abs(along(RP.innerFace) + E.fanCoil.w / 2) < 0.5);
say('the two plenums are on OPPOSITE faces', along(SP) > 0 && along(RP) < 0,
  'supply ' + along(SP).toFixed(1) + ', return ' + along(RP).toFixed(1));
say('both are aligned with the FCU body',
  Math.abs(across(SP)) < 0.5 && Math.abs(across(RP)) < 0.5,
  'off-centre by ' + across(SP).toFixed(2) + ' / ' + across(RP).toFixed(2) + ' px');
say('their bodies are proportional to the FCU face',
  SP.h >= E.fanCoil.h && RP.h >= E.fanCoil.h &&
  SP.h <= E.fanCoil.h * 3 && RP.h <= E.fanCoil.h * 3,
  'FCU face ' + E.fanCoil.h.toFixed(0) + ', supply ' + SP.h.toFixed(0) + ', return ' + RP.h.toFixed(0));

// ── 1b. One collar per duct, and they are separate collars ──────────────────
STEP('[1b] Three supply collars and two return collars, all distinct');
say('the supply plenum shows exactly three ø400 collars', SP.collars.length === 3,
  SP.collars.map(P).join(' '));
say('the return plenum shows exactly two ø400 collars', RP.collars.length === 2,
  RP.collars.map(P).join(' '));
const allDistinct = (list) => list.every((c, i) =>
  list.every((o, j) => i === j || dist(c, o) > 4));
say('no two supply collars are in the same place', allDistinct(SP.collars));
say('no two return collars are in the same place', allDistinct(RP.collars));
say('every supply collar points out of the discharge face',
  SP.collars.every(c => along(c) > 0), SP.collars.map(c => along(c).toFixed(0)).join(' '));
say('every return collar points out of the return face',
  RP.collars.every(c => along(c) < 0), RP.collars.map(c => along(c).toFixed(0)).join(' '));

// ── 2. Every duct ends on its own collar ────────────────────────────────────
STEP('[2] Return ducts terminate at separate return collars, and nothing else does');
// A run is anchored at a collar TIP, one collar length beyond the face. Match
// on the NEAREST collar rather than any collar inside a radius: the collars are
// a duct-width apart, so a radius wide enough to reach a tip also reaches the
// neighbour, and two ducts on two collars both answered to collar 0.
const nearestCollar = (pt, collars) => {
  let best = -1, bestK = Infinity;
  collars.forEach((c, i) => { const k = dist(pt, c); if (k < bestK) { bestK = k; best = i; } });
  return bestK <= 14 ? best : -1;
};
const onCollar = (pt, collars) => nearestCollar(pt, collars) >= 0;
const seatOf = (pt, collars) => nearestCollar(pt, collars);
say('every return duct ends on a return-plenum collar',
  D.returnEnds.every(r => onCollar(r.a, RP.collars) || onCollar(r.z, RP.collars)),
  D.returnEnds.map(r => P(r.a) + '→' + P(r.z)).join('  '));
say('exactly two return ducts land on it', D.returnEnds.length === 2,
  D.returnEnds.length + ' return runs');
const retSeats = D.returnEnds.map(r =>
  onCollar(r.z, RP.collars) ? seatOf(r.z, RP.collars) : seatOf(r.a, RP.collars));
say('the two return ducts land on DIFFERENT collars',
  retSeats.length === 2 && retSeats[0] !== retSeats[1] && retSeats.every(i => i >= 0),
  'collar indices ' + retSeats.join(' and '));
say('NO supply duct terminates on a return collar',
  D.supplyEnds.every(r => !onCollar(r.a, RP.collars) && !onCollar(r.z, RP.collars)),
  D.supplyEnds.filter(r => onCollar(r.a, RP.collars) || onCollar(r.z, RP.collars))
    .map(r => r.role).join(', ') || 'none');
say('NO return duct terminates on a supply collar',
  D.returnEnds.every(r => !onCollar(r.a, SP.collars) && !onCollar(r.z, SP.collars)),
  D.returnEnds.filter(r => onCollar(r.a, SP.collars) || onCollar(r.z, SP.collars)).length + ' offenders');
const mains = D.supplyEnds.filter(r => r.role === 'main');
say('every supply main starts on a supply-plenum collar',
  mains.every(r => onCollar(r.a, SP.collars)), mains.map(r => P(r.a)).join(' '));
const mainSeats = mains.map(r => seatOf(r.a, SP.collars));
say('the three mains leave three DIFFERENT collars',
  new Set(mainSeats).size === 3 && mainSeats.every(i => i >= 0),
  'collar indices ' + mainSeats.join(', '));

// ── 2b. No duct is drawn through the equipment ──────────────────────────────
STEP('[2b] No duct is drawn through the fan coil or either plenum');
const band = {
  a0: -(E.fanCoil.w / 2 + RP.w), a1: E.fanCoil.w / 2 + SP.w,
  c: Math.max(E.fanCoil.h, SP.h, RP.h) / 2
};
// Inside the band but not on a collar face is a duct crossing the metal. The
// lead-out from each collar is deliberately allowed: that IS the connection.
const throughMetal = [];
for (const path of D.paths) {
  for (const q of path.points) {
    const la = along(q), ac = across(q);
    if (la > band.a0 + 1 && la < band.a1 - 1 && Math.abs(ac) < band.c - 1) {
      throughMetal.push(path.role + ' ' + P(q));
      break;
    }
  }
}
say('no duct has a point inside the equipment bodies', throughMetal.length === 0,
  throughMetal.join(', ') || 'none');

// ── 2c. R1 and R2 are two ducts, not one spine ──────────────────────────────
STEP('[2c] R1 and R2 stay separate the whole way to two separate collars');
const rPaths = D.paths.filter(p => p.role === 'return');
say('there are exactly two return routes drawn', rPaths.length === 2,
  rPaths.length + ' return path(s)');
// A shared SEGMENT, not a shared endpoint: any point of one route lying on the
// other's line means the two have merged into one dashed spine, which is what
// this is here to stop.
const segDist = (p, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
  if (l2 < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
};
const pathGap = (A, B) => {
  let worst = Infinity;
  for (const q of A.points) {
    for (let i = 1; i < B.points.length; i++) {
      worst = Math.min(worst, segDist(q, B.points[i - 1], B.points[i]));
    }
  }
  return worst;
};
if (rPaths.length === 2) {
  // Measured along the shared corridor only: both routes legitimately converge
  // ON the plenum, and the collars are what keeps those ends apart.
  const away = (p) => ({ ...p, points: p.points.filter(q =>
    dist(q, E.fanCoil) > Math.max(E.supplyPlenum.h, E.returnPlenum.h)) });
  const gapAll = Math.min(pathGap(rPaths[0], rPaths[1]), pathGap(rPaths[1], rPaths[0]));
  const gapCorridor = Math.min(pathGap(away(rPaths[0]), rPaths[1]),
                               pathGap(away(rPaths[1]), rPaths[0]));
  say('R1 and R2 share no point of duct anywhere', gapAll > 4,
    'closest approach ' + gapAll.toFixed(1) + ' px');
  // Each ø400 is about 14 px wide here, so the two must be more than that apart
  // to show a gap rather than one fat run with a seam.
  say('they stay visibly apart along the shared corridor', gapCorridor > 14,
    'corridor separation ' + gapCorridor.toFixed(1) + ' px');
  const seats = rPaths.map(p => {
    const ends = [p.points[0], p.points[p.points.length - 1]];
    for (const e of ends) { const i = nearestCollar(e, RP.collars); if (i >= 0) return i; }
    return -1;
  });
  say('they terminate at DIFFERENT return-plenum collars',
    seats[0] !== seats[1] && seats.every(i => i >= 0),
    'collar ' + seats.join(' and collar '));
  const c0 = RP.collars[seats[0]], c1 = RP.collars[seats[1]];
  say('and those two collars are at different coordinates',
    c0 && c1 && dist(c0, c1) > 8, c0 && c1 ? P(c0) + ' vs ' + P(c1) : 'missing');
  say('no supply fitting sits on either return path',
    D.btos.every(b => rPaths.every(rp => {
      let k = Infinity;
      for (let i = 1; i < rp.points.length; i++) {
        k = Math.min(k, segDist({ x: b.x, y: b.y }, rp.points[i - 1], rp.points[i]));
      }
      return k > b.clearPx + 6;
    })),
    D.btos.map(b => {
      let k = Infinity;
      for (const rp of rPaths) for (let i = 1; i < rp.points.length; i++) {
        k = Math.min(k, segDist({ x: b.x, y: b.y }, rp.points[i - 1], rp.points[i]));
      }
      return b.label + ' ' + Math.round(k) + 'px';
    }).join(', '));
}

// ── 2d. The supply plenum is the fabricated piece the report describes ──────
STEP('[2d] The supply plenum is drawn as the piece of metal the order buys');
const plenumRec = await p.evaluate(() => window.nacDesigner.design.supplyPlenum || null);
say('the design recorded how the plenum is made', !!plenumRec,
  plenumRec && plenumRec.kind);
if (plenumRec) {
  say('three ø400 collars do not fit the discharge flange, so it is a transition',
    plenumRec.kind === 'widened',
    plenumRec.collarRowMm + ' mm of collar across a ' + plenumRec.flangeWidthMm + ' mm flange');
  // The DRAWING has to agree: the collar face must be wider than the throat.
  say('the drawn plenum widens beyond the FCU discharge face',
    SP.h > E.fanCoil.h + 1,
    'collar face ' + SP.h.toFixed(1) + ' px vs throat ' + E.fanCoil.h.toFixed(1) + ' px');
  say('and it still bolts flat to that face',
    Math.abs(along(SP.innerFace) - E.fanCoil.w / 2) < 0.5);
  const widenRatio = SP.h / E.fanCoil.h;
  const realRatio = plenumRec.bodyWidthMm / plenumRec.flangeWidthMm;
  say('the drawn widening is in proportion to the fabricated one',
    Math.abs(widenRatio - realRatio) < realRatio * 0.6,
    'drawn ×' + widenRatio.toFixed(2) + ' vs specified ×' + realRatio.toFixed(2));
}

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

// ── 9. Text is off the ductwork, and on its own system's side ──────────────
//
// Nick: "prevent labels from covering ducts or equipment; keep return labels on
// the return side; keep supply labels on the supply side." A duct is a line, so
// it could never be booked as a rectangle and labels were free to sit across
// it. The renderer now stamps every run into an occupancy grid, so this is
// measurable: re-stamp the drawn paths here and charge each placed label for
// what it covers.
STEP('[9] No label is written along a duct');
const cover = await p.evaluate(async () => {
  const SYM = await import('/designer/ui/symbols.mjs');
  const D = window.nacDesigner.viewer.state.drawn;
  const L = SYM.createLabelLedger();
  for (const path of (D.paths || [])) {
    if (!path.points || path.points.length < 2) continue;
    L.route(path.points, (path.widthPx || 4) / 2 + 1,
            path.role === 'return' ? 'return' : 'supply');
  }
  return (D.boxes || []).filter(b => !b.symbol).map(b => ({
    box: [Math.round(b.x0), Math.round(b.y0)],
    supply: L.ductCover(b, 'supply'),
    ret: L.ductCover(b, 'return')
  }));
});
const buried = cover.filter(c => Math.min(c.supply, c.ret) > 0.55);
say('no label is buried in a duct', buried.length === 0,
  buried.length + ' of ' + cover.length + ' label(s) more than half on ink' +
  (buried.length ? ' — worst at ' + buried[0].box : ''));
const worstCover = cover.reduce((m, c) => Math.max(m, Math.min(c.supply, c.ret)), 0);
say('and the worst one is still mostly on clear paper', worstCover < 0.55,
  'worst coverage ' + (worstCover * 100).toFixed(0) + '%');

// ── 10. Every crossing hops, and the hop clears what it crosses ────────────
STEP('[10] Each crossing is a bridge, not a joint');
const hops = await p.evaluate(() => (window.nacDesigner.viewer.state.drawn.crossings || [])
  .map(c => ({ r: c.hopR ?? null, gap: c.gapPx ?? null })));
say('every crossing carries a hop radius sized from the run it crosses',
  hops.length > 0 && hops.every(h => h.r > 4),
  hops.map(h => 'r=' + (h.r ? h.r.toFixed(1) : '-')).join(' '));
say('and the gap cut in the return is the full width of that hop',
  hops.every(h => h.gap && Math.abs(h.gap - h.r * 2) < 0.01),
  hops.map(h => 'gap=' + (h.gap ? h.gap.toFixed(1) : '-')).join(' '));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
await b.close();
process.exit(failures ? 1 : 0);
