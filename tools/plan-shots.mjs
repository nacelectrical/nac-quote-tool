// ─────────────────────────────────────────────────────────────────────────────
// DRAW THE NEW PLANS, THROUGH THE REAL DESIGNER
//
//   node tools/plan-shots.mjs [outDir]
//
// Loads each synthetic plan into designer.html and snapshots the layout the
// router produced, so the drawings can be LOOKED AT rather than inferred from
// a table of counts. Needs the static server on 127.0.0.1:8777.
//
// SYNTHETIC TEST FIXTURES, not NAC jobs.
// ─────────────────────────────────────────────────────────────────────────────

// Playwright lives in /opt/node-tools, which is outside this repository's
// module resolution — the browser suites are run with NODE_PATH set. Resolving
// it explicitly keeps this script runnable on its own.
const pw = await import('/opt/node-tools/node_modules/playwright/index.js');
const chromium = pw.chromium || pw.default.chromium;
import { mkdirSync } from 'node:fs';
import { PLAN_SHAPES, buildPlan } from '../tests/fixtures/plan-shapes.mjs';
import { signInContext } from './browser-tests/signin.mjs';

const OUT = process.argv[2] || '/tmp/nac-plan-shots';
const BASE = process.env.NAC_TEST_BASE || 'http://127.0.0.1:8777';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('  PAGE ERROR ' + e.message));

await p.goto(BASE + '/designer.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.nacDesigner, null, { timeout: 30000 });
await p.waitForTimeout(1500);

for (const spec of PLAN_SHAPES) {
  const r = await buildPlan(spec);
  // ── THESE PLANS HAVE NO DRAWING BEHIND THEM ─────────────────────────────
  // They are built from printed room sizes, not from an uploaded sheet, so
  // there is no architect's image to lay the system over. The viewer needs a
  // raster of the right pixel size to place everything against, and a blank
  // white one is the honest answer: what you see is the system the router
  // produced, on nothing, at the plan's own scale.
  await p.evaluate(async (payload) => {
    const a = window.nacDesigner;
    a.design = payload.design;
    if (payload.settings) a.settings = payload.settings;
    const cv = document.createElement('canvas');
    cv.width = payload.w; cv.height = payload.h;
    const c = cv.getContext('2d');
    c.fillStyle = '#FFFFFF'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#E4E7EF'; c.lineWidth = 2;
    c.strokeRect(1, 1, cv.width - 2, cv.height - 2);
    a.mode = 'full'; a.tab = 'plan'; a.render();
    await new Promise(r => setTimeout(r, 200));
    if (a.viewer && a.viewer.setImage) await a.viewer.setImage(cv.toDataURL('image/png'));
    a.render();
  }, { design: JSON.parse(JSON.stringify(r.out)),
       settings: JSON.parse(JSON.stringify(r.settings)),
       w: spec.widthPx, h: spec.heightPx });
  await p.waitForTimeout(1600);
  await p.evaluate(() => window.nacDesigner.setPlanView('clean'));
  await p.waitForTimeout(900);

  const drawn = await p.evaluate(() => {
    const st = window.nacDesigner.viewer.state.drawn || {};
    return { tubes: (st.tubes || []).length, outlets: (st.outlets || []).length,
             boxes: (st.boxes || []).length, labels: (st.labels || []).length };
  });
  const cv = await p.locator('canvas').first();
  await cv.screenshot({ path: OUT + '/' + spec.key + '.png' });
  console.log(spec.key.padEnd(14) + 'tubes=' + drawn.tubes + ' outlets=' + drawn.outlets
    + ' symbols=' + drawn.boxes + ' labels=' + drawn.labels
    + '  → ' + OUT + '/' + spec.key + '.png');
}

await browser.close();
console.log('done');
