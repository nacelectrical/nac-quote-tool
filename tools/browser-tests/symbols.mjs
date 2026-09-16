// VISUAL REGRESSION FOR EVERY SYMBOL AND EVERY VIEW MODE.
//
// A symbol library is only worth having if a change to it is noticed, so each
// symbol is rendered to its own canvas and measured. What is asserted is its
// INK SIGNATURE: how much of the tile it covers, how far it spreads, and how
// many distinct colours it puts down.
//
// That is deliberately not a pixel-for-pixel golden image. A golden PNG breaks
// on a font hint or an antialiasing change and gets deleted the third time it
// cries wolf. A signature catches the things that actually matter — a symbol
// that vanished, collapsed to a dot, grew to swallow the drawing, or lost the
// colour that distinguishes it — and tolerates the things that do not.
//
// Every bound below was read off the real rendering, then given room to move.

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

// ── Every symbol, drawn alone on a clean tile and measured ──────────────────

const TILE = 120;
const signatures = await p.evaluate(async (tile) => {
  const SYM = await import('/designer/ui/symbols.mjs');
  const mid = { x: tile / 2, y: tile / 2 };

  // Each entry is a symbol and the arguments that make it draw its normal self.
  const CASES = {
    fanCoil:            (c) => SYM.drawFanCoil(c, mid, { model: 'FDYAN160AV1' }),
    supplyPlenum:       (c) => SYM.drawSupplyPlenum(c, mid, { spigotAngles: [0, 0.6, -0.6] }),
    bto3:               (c) => SYM.drawBto(c, mid, { inletAngle: Math.PI,
                                outletAngles: [0, 0.8, -0.8], label: 'BTO-A', spec: '400-250-250' }),
    bto5:               (c) => SYM.drawBto(c, mid, { inletAngle: Math.PI,
                                outletAngles: [0, 0.6, -0.6, 1.4, -1.4], label: 'BTO-C' }),
    reducer:            (c) => SYM.drawReducer(c, mid, { fromMm: 400, toMm: 350 }),
    tee:                (c) => SYM.drawTee(c, mid, { kind: 'tee' }),
    yPiece:             (c) => SYM.drawTee(c, mid, { kind: 'y' }),
    collar:             (c) => SYM.drawCollar(c, mid, { angle: 0 }),
    squareDiffuser:     (c) => SYM.drawSquareDiffuser(c, mid, {}),
    roundDiffuser:      (c) => SYM.drawRoundDiffuser(c, mid, {}),
    linearSlotDiffuser: (c) => SYM.drawLinearSlotDiffuser(c, mid, {}),
    sidewallGrille:     (c) => SYM.drawSidewallGrille(c, mid, {}),
    editHandle:         (c) => SYM.drawEditHandle(c, mid, {}),
    returnGrille:       (c) => SYM.drawReturnGrilleSymbol(c, mid, { label: 'R1 · 600×400' }),
    returnBox:          (c) => SYM.drawReturnBox(c, mid, { inletAngles: [Math.PI, 2.4] }),
    zoneDamper:         (c) => SYM.drawZoneDamper(c, mid, { label: 'ZM-1 · ZONE 1' }),
    constantZone:       (c) => SYM.drawZoneDamper(c, mid, { constant: true }),
    thermostat:         (c) => SYM.drawThermostat(c, mid, { mark: 'T' }),
    zoneController:     (c) => SYM.drawZoneControllerPanel(c, mid, {}),
    drainLine:          (c) => SYM.drawDrainLine(c, [{ x: 12, y: 60 }, { x: 108, y: 60 }],
                                { sizeLabel: 'ø20' }),
    refrigerantPair:    (c) => SYM.drawRefrigerantPair(c, [{ x: 12, y: 60 }, { x: 108, y: 60 }], {}),
    isolator:           (c) => SYM.drawIsolator(c, mid, {}),
    arrow:              (c) => SYM.drawArrow(c, mid, 0, {}),
    ductMain400:        (c) => SYM.drawDuctRun(c, [{ x: 10, y: 60 }, { x: 110, y: 60 }],
                                { diameterMm: 400, role: 'main', widthPx: 16 }),
    ductArm350:         (c) => SYM.drawDuctRun(c, [{ x: 10, y: 60 }, { x: 110, y: 60 }],
                                { diameterMm: 350, role: 'arm', widthPx: 12 }),
    ductFinal250:       (c) => SYM.drawDuctRun(c, [{ x: 10, y: 60 }, { x: 110, y: 60 }],
                                { diameterMm: 250, role: 'final', widthPx: 8 }),
    ductReturn:         (c) => SYM.drawDuctRun(c, [{ x: 10, y: 60 }, { x: 110, y: 60 }],
                                { diameterMm: 400, role: 'return', widthPx: 14 }),
    roomBoundary:       (c) => SYM.drawRoomBoundary(c, { x: 20, y: 30, w: 80, h: 60 }, {}),
    label:              (c) => SYM.drawLabel(c, 'ø350 · 138 L/s', mid, {})
  };

  const out = {};
  for (const [name, draw] of Object.entries(CASES)) {
    const cv = document.createElement('canvas');
    cv.width = tile; cv.height = tile;
    const c = cv.getContext('2d');
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, tile, tile);
    draw(c);
    const px = c.getImageData(0, 0, tile, tile).data;
    let ink = 0, minX = tile, maxX = 0, minY = tile, maxY = 0;
    let sr = 0, sg = 0, sb = 0;
    const colours = new Set();
    const pts = [];
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const i = (y * tile + x) * 4;
        const r = px[i], g = px[i + 1], bl = px[i + 2];
        // Anything meaningfully off white counts as ink.
        if (r > 246 && g > 246 && bl > 246) continue;
        ink++;
        pts.push(x, y);
        sr += r; sg += g; sb += bl;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (bl >> 4));
      }
    }
    // CORNER FILL separates a square from a circle, which ink area cannot: both
    // cover the same bounding box, but only the square puts ink in the corners
    // of it. MEAN COLOUR separates the return box from the supply plenum, which
    // are the same shape in different metal.
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    let corner = 0;
    for (let k = 0; k < pts.length; k += 2) {
      const fx = (pts[k] - minX) / bw, fy = (pts[k + 1] - minY) / bh;
      if ((fx < 0.2 || fx > 0.8) && (fy < 0.2 || fy > 0.8)) corner++;
    }
    out[name] = { ink, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY),
                  colours: colours.size,
                  cornerPct: ink ? Math.round((corner / ink) * 100) : 0,
                  rgb: ink ? [Math.round(sr / ink), Math.round(sg / ink),
                              Math.round(sb / ink)] : [255, 255, 255] };
  }
  return out;
}, TILE);

STEP('[1] Every symbol puts ink on the page');
const names = Object.keys(signatures);
say('the library drew all ' + names.length + ' cases', names.length >= 29, names.length + ' symbols');
const blank = names.filter(n => signatures[n].ink < 20);
say('no symbol renders blank or as a speck', blank.length === 0,
  blank.map(n => n + '=' + signatures[n].ink + 'px').join(', ') || 'all have a body');
const bloated = names.filter(n => signatures[n].w > TILE - 4 && signatures[n].h > TILE - 4);
say('no symbol swallows its whole tile', bloated.length === 0,
  bloated.join(', ') || 'all bounded');

STEP('[2] Each symbol keeps its own shape');
// A signature is a range, not a pixel. These catch a symbol collapsing,
// exploding, or losing what makes it distinguishable.
const EXPECT = {
  fanCoil:            { ink: [900, 4200], w: [50, 110] },
  supplyPlenum:       { ink: [300, 2600], w: [20, 110] },
  bto3:               { ink: [300, 2600], w: [20, 110] },
  bto5:               { ink: [300, 2800], w: [20, 110] },
  reducer:            { ink: [200, 1800], w: [12, 90] },
  tee:                { ink: [40, 900],  w: [8, 60] },
  yPiece:             { ink: [40, 900],  w: [8, 60] },
  collar:             { ink: [20, 400],  w: [4, 40] },
  squareDiffuser:     { ink: [80, 900],  w: [10, 40] },
  roundDiffuser:      { ink: [80, 900],  w: [10, 40] },
  linearSlotDiffuser: { ink: [80, 1200], w: [18, 60] },
  sidewallGrille:     { ink: [60, 1000], w: [14, 50] },
  editHandle:         { ink: [30, 500],  w: [6, 30] },
  returnGrille:       { ink: [300, 2600], w: [18, 110] },
  returnBox:          { ink: [200, 2200], w: [14, 110] },
  zoneDamper:         { ink: [150, 2200], w: [10, 110] },
  thermostat:         { ink: [60, 900],  w: [10, 40] },
  zoneController:     { ink: [60, 1000], w: [12, 45] },
  isolator:           { ink: [60, 900],  w: [10, 40] },
  arrow:              { ink: [10, 400],  w: [4, 30] },
  ductMain400:        { ink: [1600, 3400], w: [95, 120] },
  ductArm350:         { ink: [1200, 2700], w: [95, 120] },
  ductFinal250:       { ink: [900, 2100],  w: [95, 120] },
  ductReturn:         { ink: [1200, 2700], w: [95, 120] },
  roomBoundary:       { ink: [60, 900],  w: [60, 100] }
};
for (const [name, want] of Object.entries(EXPECT)) {
  const got = signatures[name];
  const okInk = got.ink >= want.ink[0] && got.ink <= want.ink[1];
  const okW = got.w >= want.w[0] && got.w <= want.w[1];
  say(name + ' holds its shape', okInk && okW,
    got.ink + 'px ink, ' + got.w + '×' + got.h + ', ' + got.colours + ' colours');
}

STEP('[3] The symbols that must not look alike, do not');
const differs = (a, bName, what) => {
  const A = signatures[a], B = signatures[bName];
  const colourGap = Math.abs(A.rgb[0] - B.rgb[0]) + Math.abs(A.rgb[1] - B.rgb[1]) +
                    Math.abs(A.rgb[2] - B.rgb[2]);
  // Four ways two symbols can be told apart: how much ink, how big it is, how
  // much of that ink reaches the CORNERS of its box, and what colour it is. Any
  // one of them clearly apart is enough; all four close means they look alike.
  // Ink area alone could not separate a square diffuser from a round one — both
  // fill the same box — nor the return box from the supply plenum, which are
  // the same shape in different metal.
  const far = Math.abs(A.ink - B.ink) > Math.max(25, A.ink * 0.1) ||
              Math.abs(A.w - B.w) > 4 || Math.abs(A.h - B.h) > 4 ||
              Math.abs(A.cornerPct - B.cornerPct) > 6 ||
              colourGap > 45;
  const show = (n, X) => n + '=' + X.ink + 'px/' + X.w + '\u00d7' + X.h + '/' +
    X.cornerPct + '%corner/rgb' + X.rgb.join(',');
  say(what, far, show(a, A) + '  ' + show(bName, B));
};
differs('squareDiffuser', 'roundDiffuser', 'a square diffuser is not a round one');
differs('bto3', 'bto5', 'a five-port BTO is not a three-port BTO');
differs('returnGrille', 'bto3', 'a return grille is not a BTO');
differs('returnBox', 'supplyPlenum', 'the return box is not the supply plenum');
differs('ductMain400', 'ductFinal250', 'a supply main is not a final outlet duct');
differs('ductMain400', 'ductReturn', 'a supply main is not a return duct');
differs('editHandle', 'squareDiffuser', 'an edit handle is not an outlet symbol');

STEP('[4] Line hierarchy holds');
say('main is heavier than arm, arm than final',
  signatures.ductMain400.ink > signatures.ductArm350.ink &&
  signatures.ductArm350.ink > signatures.ductFinal250.ink,
  [signatures.ductMain400.ink, signatures.ductArm350.ink, signatures.ductFinal250.ink].join(' > '));
say('control wiring and drain stay lighter than any duct',
  signatures.drainLine.ink < signatures.ductFinal250.ink &&
  signatures.refrigerantPair.ink < signatures.ductFinal250.ink,
  'drain ' + signatures.drainLine.ink + ', refrig ' + signatures.refrigerantPair.ink +
  ', final ' + signatures.ductFinal250.ink);
say('the room boundary is the lightest thing on the sheet',
  signatures.roomBoundary.ink < signatures.ductFinal250.ink,
  signatures.roomBoundary.ink + ' vs ' + signatures.ductFinal250.ink);

STEP('[5] Colour is never the only cue');
const palette = await p.evaluate(async () => {
  const SYM = await import('/designer/ui/symbols.mjs');
  return { c400: SYM.ductColour(400), c350: SYM.ductColour(350), c300: SYM.ductColour(300),
           c250: SYM.ductColour(250), c200: SYM.ductColour(200),
           ret: SYM.RETURN_COLOUR, sel: SYM.SELECTION_COLOUR, warn: SYM.WARNING_COLOUR,
           room: SYM.ROOM_COLOUR,
           labels: { duct: SYM.LABEL.duct(350, 138),
                     outlet: SYM.LABEL.outlet(7, 'MASTER', 50),
                     bto: SYM.LABEL.bto('BTO-C2', 350, [250, 250, 250]),
                     ret: SYM.LABEL.returnGrille('R1', 600, 400, 400),
                     zm: SYM.LABEL.zoneMotor(3, 'BEDROOMS'),
                     red: SYM.LABEL.reducer(400, 350) } };
});
const distinct = new Set([palette.c400, palette.c350, palette.c300, palette.c250,
                          palette.c200, palette.ret]);
say('every duct size has its own colour', distinct.size === 6, [...distinct].join(' '));
say('selection and warning are distinct from every duct colour',
  !distinct.has(palette.sel) && !distinct.has(palette.warn),
  palette.sel + ' / ' + palette.warn);
say('a duct label always carries its diameter', /ø350/.test(palette.labels.duct),
  palette.labels.duct);

STEP('[6] Label formats are the ones the brief specifies');
const L = palette.labels;
say('duct   ' + L.duct, L.duct === 'ø350 · 138 L/s');
say('outlet ' + L.outlet, L.outlet === 'O7 · MASTER · 50 L/s');
say('BTO    ' + L.bto, L.bto === 'BTO-C2 · 350-250-250-250');
say('return ' + L.ret, L.ret === 'R1 · 600×400 · ø400');
say('motor  ' + L.zm, L.zm === 'ZM-3 · BEDROOMS');
say('reducer ' + L.red, L.red === 'ø400→ø350');

// ── The four view modes, on the approved design ────────────────────────────

// THE JOB'S OWN SETTINGS GO IN WITH IT.
//
// `render()` re-runs the pipeline against the APP's settings, so injecting the
// design alone silently re-derives it with NAC's defaults. This job is approved
// with a 250 mm minimum supply branch; the shipped default is 200, and the four
// small finals came back resized to 200 — a drawing that was internally
// consistent and described a different design from the approved one.
const { out, settings: jobSettings } = await buildApproved();
out.plan = { ...(out.plan || {}), dataUrl: PLAN };
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
await p.waitForTimeout(1400);

const inkOfCanvas = () => p.evaluate(() => {
  const cv = document.querySelector('canvas');
  const c = cv.getContext('2d');
  const px = c.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0, cyan = 0;
  const colours = new Set();
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // The editing cyan, #13C7DC — counted separately because it is the one
    // thing that should differ between Clean view and an edit mode.
    if (Math.abs(r - 0x13) < 40 && Math.abs(g - 0xC7) < 40 && Math.abs(b - 0xDC) < 40) cyan++;
    if (r > 246 && g > 246 && b > 246) continue;
    ink++;
    colours.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
  }
  return { ink, cyan, colours: colours.size };
});
const setView = async (v) => { await p.evaluate(k => window.nacDesigner.setPlanView(k), v);
                               await p.waitForTimeout(700); };

STEP('[7] Every view mode renders, and they differ from one another');
const modes = {};
for (const v of ['clean', 'outlets', 'routes', 'rooms']) {
  await setView(v);
  modes[v] = await inkOfCanvas();
  say(v + ' renders a drawing', modes[v].ink > 5000,
    modes[v].ink + 'px ink, ' + modes[v].cyan + 'px cyan, ' + modes[v].colours + ' colours');
}
// TOTAL INK IS THE WRONG MEASURE FOR THIS. A handle is a white disc with a
// cyan ring, so adding one to the drawing can REDUCE ink where it covers a
// duct. What actually distinguishes an edit mode is the editing colour.
say('Clean view has no editing colour at all', modes.clean.cyan === 0,
  modes.clean.cyan + 'px cyan');
say('Edit routes adds cyan handles to the same drawing', modes.routes.cyan > 40,
  modes.clean.cyan + ' -> ' + modes.routes.cyan + 'px cyan');
say('Edit outlets adds them too', modes.outlets.cyan > 40,
  modes.outlets.cyan + 'px cyan');
say('Edit rooms is a different drawing again', modes.rooms.ink !== modes.clean.ink,
  modes.clean.ink + ' vs ' + modes.rooms.ink);

STEP('[8] The approved design is untouched by any of it');
const counts = await p.evaluate(() => window.nacDesigner.design.componentCounts);
say('10 outlets, 3 mains, 5 BTOs, 0 return BTOs',
  counts.supplyOutlets === 10 && counts.supplyMains === 3 &&
  counts.supplyBtos === 5 && counts.returnBtos === 0,
  JSON.stringify(counts));

STEP('[9] A report snapshot is Clean View with a legend, whatever mode is on');
await setView('routes');
const snap = await p.evaluate(() => {
  const a = window.nacDesigner;
  const before = a.viewer.getMode();
  const url = a.viewer.snapshot({ clean: true, legend: true });
  return { ok: !!url && url.length > 4000, after: a.viewer.getMode(), before };
});
say('a snapshot is produced', snap.ok);
say('and the editing mode is put back afterwards', snap.after === snap.before,
  snap.before + ' → ' + snap.after);

// ── The two redesigned symbols, measured rather than eyeballed ──────────────
//
// Nick rejected the old BTO ("a circle, pill, blob or generic route node") and
// the old damper ("a floating square or a long slash extending outside the
// duct"). Ink signatures cannot tell a blob from a manifold, so these read the
// GEOMETRY the symbol library computes — the same numbers the renderer uses to
// trim ducts back to the collar face — and check the things he listed.

STEP('[10] The BTO is a fabricated manifold with countable collars');
const btoGeo = await p.evaluate(async () => {
  const SYM = await import('/designer/ui/symbols.mjs');
  const mk = (outs, inletMm, outMm) => SYM.btoGeometry({
    at: { x: 200, y: 200 }, inletAngle: Math.PI, outletAngles: outs,
    inletMm, outletMm: outMm });
  const A = mk([0, 0.8, -0.8], 400, [250, 250, 250]);          // BTO-A
  const C = mk([0.4, -0.4], 400, [350, 350]);                  // BTO-C
  const C2 = mk([0, 0.9, -0.9], 350, [250, 250, 250]);         // BTO-C2
  const dims = (g) => ({
    w: g.w, h: g.h, clearPx: g.clearPx,
    inletWidth: g.inlet?.width ?? null,
    outletWidths: g.outlets.map(o => o.width),
    collars: g.outlets.length,
    // How far each collar root is from the body centre, and its tip.
    rootDist: g.outlets.map(o => Math.hypot(o.root.x - g.at.x, o.root.y - g.at.y)),
    tipDist: g.outlets.map(o => Math.hypot(o.tip.x - g.at.x, o.tip.y - g.at.y)),
    inletRootDist: g.inlet ? Math.hypot(g.inlet.root.x - g.at.x, g.inlet.root.y - g.at.y) : null,
    // The angle each collar points, against the duct it belongs to.
    angles: g.outlets.map(o => o.angle)
  });
  return { A: dims(A), C: dims(C), C2: dims(C2), wanted: [0, 0.8, -0.8] };
});
say('BTO-A draws three outlet collars for three ports', btoGeo.A.collars === 3);
say('BTO-C draws two outlet collars for two ports', btoGeo.C.collars === 2);
say('BTO-C2 draws three outlet collars for three ports', btoGeo.C2.collars === 3);
say('every collar points along the duct it serves',
  btoGeo.A.angles.every((a, i) => Math.abs(a - btoGeo.wanted[i]) < 1e-9),
  btoGeo.A.angles.map(a => Math.round(a * 180 / Math.PI) + '°').join(' '));
say('the inlet is drawn wider than the outlet collars',
  btoGeo.A.inletWidth > Math.max(...btoGeo.A.outletWidths),
  'inlet ' + btoGeo.A.inletWidth + ' vs outlets ' + btoGeo.A.outletWidths.join('/'));
say('the body is compact enough not to cover the plan',
  btoGeo.A.w <= 26 && btoGeo.A.h <= 30 && btoGeo.C2.w <= 26 && btoGeo.C2.h <= 30,
  'A ' + btoGeo.A.w.toFixed(0) + '×' + btoGeo.A.h.toFixed(0) +
  ', C2 ' + btoGeo.C2.w.toFixed(0) + '×' + btoGeo.C2.h.toFixed(0));
say('the body is big enough to identify', btoGeo.A.w >= 15 && btoGeo.A.h >= 13);
say('the body scales with the number of collars',
  btoGeo.C2.h > btoGeo.C.h, 'three-port ' + btoGeo.C2.h.toFixed(1) +
  ' vs two-port ' + btoGeo.C.h.toFixed(1));
say('the body scales with the inlet size',
  btoGeo.C.w > btoGeo.C2.w, 'ø400 inlet ' + btoGeo.C.w.toFixed(1) +
  ' vs ø350 inlet ' + btoGeo.C2.w.toFixed(1));
// THE DUCT STOPS AT THE COLLAR FACE. The renderer trims each run back to the
// collar TIP, so every tip must be outside the body — otherwise the trimmed
// duct would begin inside the metal and read as running through it.
const halfDiag = (g) => Math.hypot(g.w, g.h) / 2;
say('every collar tip lies outside the body',
  btoGeo.A.tipDist.every((d, i) => d > btoGeo.A.rootDist[i]) &&
  btoGeo.A.rootDist.every(d => d >= Math.min(btoGeo.A.w, btoGeo.A.h) / 2 - 0.01),
  'roots ' + btoGeo.A.rootDist.map(d => d.toFixed(1)).join('/') +
  ', tips ' + btoGeo.A.tipDist.map(d => d.toFixed(1)).join('/'));
say('the trim radius reaches past the body corners',
  btoGeo.A.clearPx >= Math.max(btoGeo.A.w, btoGeo.A.h) / 2,
  'clear ' + btoGeo.A.clearPx.toFixed(1) + ' px vs half-body ' +
  (Math.max(btoGeo.A.w, btoGeo.A.h) / 2).toFixed(1));

// NOT A CIRCLE, NOT A ROUTE NODE. A rectangle with a double outline puts ink in
// the corners of its bounding box; a disc does not, and an edit handle is both
// round and far smaller.
say('a BTO does not look like a route handle or a diffuser',
  Math.abs(signatures.bto3.cornerPct - signatures.editHandle.cornerPct) > 6 ||
  Math.abs(signatures.bto3.ink - signatures.editHandle.ink) > 100,
  'bto ' + signatures.bto3.cornerPct + '% corner / ' + signatures.bto3.ink + 'px, handle ' +
  signatures.editHandle.cornerPct + '% / ' + signatures.editHandle.ink + 'px');

STEP('[11] The zone damper is an inline motorised damper');
const dmp = await p.evaluate(async () => {
  const SYM = await import('/designer/ui/symbols.mjs');
  const g250 = SYM.damperGeometry({ at: { x: 200, y: 200 }, angle: 0.7,
                                    diameterMm: 250, pxPerMm: 0.0566667, scale: 1 });
  const g350 = SYM.damperGeometry({ at: { x: 200, y: 200 }, angle: 0.7,
                                    diameterMm: 350, pxPerMm: 0.0566667, scale: 1 });
  return { g250, g350, DAMPER: SYM.DAMPER };
});
say('the damper body is inline with the duct, not across it',
  dmp.g250.angle === 0.7, 'body angle ' + dmp.g250.angle);
say('the body width follows the duct diameter',
  dmp.g350.h > dmp.g250.h, 'ø250 ' + dmp.g250.h.toFixed(1) +
  ' vs ø350 ' + dmp.g350.h.toFixed(1));
say('the body stays within sane bounds at any size',
  dmp.g250.h >= dmp.DAMPER.minBodyWidth && dmp.g350.h <= dmp.DAMPER.maxBodyWidth,
  dmp.g250.h.toFixed(1) + ' … ' + dmp.g350.h.toFixed(1));
say('the actuator is mounted ON the body, not floating',
  dmp.g250.actuator.offset <= dmp.g250.h / 2 + dmp.g250.actuator.h / 2 + dmp.DAMPER.shaft + 0.01,
  'offset ' + dmp.g250.actuator.offset.toFixed(1) + ' px, body half-width ' +
  (dmp.g250.h / 2).toFixed(1) + ' + actuator half ' + (dmp.g250.actuator.h / 2).toFixed(1) +
  ' + shaft ' + dmp.DAMPER.shaft);
// The blade is drawn inside the body by construction — it is clipped to
// (w/2 - 1.6, h/2 - 1.6) — so the check is that the body is big enough to hold
// a blade at all rather than a slash sticking out of a hairline.
say('the body is large enough for the blade to sit inside it',
  dmp.g250.w > 4 && dmp.g250.h > 4, dmp.g250.w.toFixed(1) + '×' + dmp.g250.h.toFixed(1));
// A CASING AS LONG AS IT IS WIDE IS A SQUARE, AND A SQUARE TURNED TO FOLLOW A
// DUCT IS A DIAMOND. Nick: "The zone damper still looks like a diamond across
// the duct." A casing visibly longer than the duct is wide reads as a
// rectangle at every angle, because its two long sides stay parallel to the run.
say('the casing is visibly longer than it is wide',
  dmp.g250.w / dmp.g250.h >= 1.4 && dmp.g350.w / dmp.g350.h >= 1.4,
  'ø250 ' + (dmp.g250.w / dmp.g250.h).toFixed(2) + '×, ø350 ' +
  (dmp.g350.w / dmp.g350.h).toFixed(2) + '×');
// COUNT THE ACTUATOR, NOT THE INK. Total ink says the opposite of the truth
// here: the constant tile carries the words CONSTANT – LOCKED OPEN, which are
// more ink than the little green box they replace. The actuator's own colour is
// the only thing that answers the question actually being asked.
const actuatorPixels = await p.evaluate(async () => {
  const SYM = await import('/designer/ui/symbols.mjs');
  const count = (opts) => {
    const cv = document.createElement('canvas');
    cv.width = 120; cv.height = 120;
    const c = cv.getContext('2d');
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, 120, 120);
    SYM.drawZoneDamper(c, { x: 60, y: 60 }, opts);
    const px = c.getImageData(0, 0, 120, 120).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      // The actuator green, #1D7A48, and the darker outline around it.
      if (px[i] < 90 && px[i + 1] > 70 && px[i + 1] < 160 && px[i + 2] < 110 &&
          px[i + 1] > px[i] + 25 && px[i + 1] > px[i + 2] + 15) n++;
    }
    return n;
  };
  return { motorised: count({ label: 'ZM-1 · Z3' }), constant: count({ constant: true }) };
});
say('a motorised zone draws an actuator', actuatorPixels.motorised > 20,
  actuatorPixels.motorised + ' actuator px');
say('a constant zone draws the same body with NO actuator',
  actuatorPixels.constant === 0,
  actuatorPixels.constant + ' actuator px on a locked-open damper');
// And on the live drawing: never on a return, and the label is off the duct.
const damperCheck = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  const returnIds = new Set((d.returnRoutes || []).map(r => r.id));
  return { onReturn: (d.zoneDampers || []).filter(z => returnIds.has(z.sectionId)).length,
           total: (d.zoneDampers || []).length };
});
say('no zone damper is placed on return ductwork', damperCheck.onReturn === 0,
  damperCheck.total + ' dampers, ' + damperCheck.onReturn + ' on returns');

STEP('[12] The equipment assembly is one arrangement, not three loose boxes');
const asm = await p.evaluate(async () => {
  const SYM = await import('/designer/ui/symbols.mjs');
  const g = SYM.equipmentAssembly({ at: { x: 300, y: 300 }, supplyBearing: -1.2,
    supplyCollars: 3, returnCollars: 2, fcuW: 48, fcuH: 24 });
  const local = (pt) => SYM.assemblyLocal(g, pt);
  return {
    angle: g.angle,
    supplyInner: local(g.supply.innerFace).along,
    returnInner: local(g.return.innerFace).along,
    supplyCollars: g.supply.collars.length,
    returnCollars: g.return.collars.length,
    supplyAcross: g.supply.collars.map(c => local(c).across),
    returnAcross: g.return.collars.map(c => local(c).across),
    // A duct that tries to cross the assembly must be reported as blocked.
    blockedThrough: SYM.assemblyBlocks(g, { x: 300, y: 200 }, { x: 300, y: 400 }),
    blockedClear: SYM.assemblyBlocks(g, { x: 900, y: 200 }, { x: 900, y: 400 })
  };
});
say('the unit is drawn square on the sheet',
  Math.abs(asm.angle % (Math.PI / 2)) < 1e-9,
  'axis ' + Math.round(asm.angle * 180 / Math.PI) + '°');
say('the supply plenum bolts to the discharge face',
  Math.abs(asm.supplyInner - 24) < 1e-9, asm.supplyInner.toFixed(2));
say('the return plenum bolts to the return face',
  Math.abs(asm.returnInner + 24) < 1e-9, asm.returnInner.toFixed(2));
say('three supply collars, spread across the face, none doubled up',
  asm.supplyCollars === 3 && new Set(asm.supplyAcross.map(v => v.toFixed(3))).size === 3,
  asm.supplyAcross.map(v => v.toFixed(1)).join(' '));
say('two return collars, spread across the face, none doubled up',
  asm.returnCollars === 2 && new Set(asm.returnAcross.map(v => v.toFixed(3))).size === 2,
  asm.returnAcross.map(v => v.toFixed(1)).join(' '));
say('a duct through the assembly is detected', asm.blockedThrough === true);
say('a duct well clear of it is not', asm.blockedClear === false);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
await b.close();
process.exit(failures ? 1 : 0);
