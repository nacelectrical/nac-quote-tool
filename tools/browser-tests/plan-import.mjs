// A PLAN OFF A PHONE HAS TO OPEN.
//
// Nick: "Plan won't upload." A floor plan photographed on a phone arrives at
// 12 to 48 megapixels. Held at that size it was megabytes of base64 kept TWICE
// on the design record, tens of megabytes of decoded bitmap, and — past about
// 16.7 million pixels — a canvas iOS Safari will not draw at all. The plan
// then does not appear and nothing says why.
//
//   node tools/serve.mjs &   node tools/browser-tests/plan-import.mjs

import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

/** What iOS Safari will not draw. Everything must land under it. */
const IOS_CANVAS_CEILING_PX = 16_700_000;

const ctx = await b.newContext({ viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await signInContext(ctx);
await ctx.route('**/rest/v1/**', r => r.fulfill({
  status: 200, contentType: 'application/json', body: '[]' }));
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 160)));
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1500);

console.log('\n[1] Every size a plan actually arrives at');
const sizes = await p.evaluate(async (ceiling) => {
  const { preparePlanImage } = await import('/designer/ui/image.mjs');
  const make = (w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#000'; x.font = Math.round(h / 24) + 'px sans-serif';
    x.fillText('4.3 x 7.1m', w * 0.1, h * 0.3);
    return c.toDataURL('image/jpeg', 0.9);
  };
  const out = [];
  for (const [w, h, label] of [[1179, 1262, 'a builder PDF page'],
                               [4032, 3024, 'a 12 MP phone photo'],
                               [8064, 6048, 'a 48 MP phone photo'],
                               [3000, 1200, 'a wide scan']]) {
    const src = make(w, h);
    const r = await preparePlanImage(src);
    out.push({ label, sw: w, sh: h, w: r.width, h: r.height, downscaled: r.downscaled,
               srcLen: src.length, outLen: r.dataUrl.length, ceiling });
  }
  return out;
}, IOS_CANVAS_CEILING_PX);

for (const s of sizes) {
  console.log('      ' + s.label.padEnd(22) + s.sw + '×' + s.sh + ' → ' + s.w + '×' + s.h +
    '  ' + ((s.w * s.h) / 1e6).toFixed(1) + ' Mpx  ' + (s.downscaled ? 'scaled' : 'kept'));
}
say('every plan lands under the iOS canvas ceiling',
  sizes.every(s => s.w * s.h < IOS_CANVAS_CEILING_PX),
  Math.max(...sizes.map(s => Math.round(s.w * s.h / 1e5) / 10)) + ' Mpx worst case');
say('a phone photo is made smaller, not just accepted',
  sizes.filter(s => s.sw * s.sh > 10e6).every(s => s.downscaled && s.outLen < s.srcLen),
  sizes.filter(s => s.downscaled).length + ' of 4 scaled');
say('a plan already small enough is left exactly as it is',
  sizes[0].downscaled === false && sizes[0].w === 1179 && sizes[0].h === 1262,
  'no needless re-encode');
say('the aspect ratio survives', sizes.every(s =>
  Math.abs((s.w / s.h) - (s.sw / s.sh)) < 0.01), 'a plan scaled to a different shape would ruin every measurement');

console.log('\n[2] A file the browser cannot decode says what to do about it');
const bad = await p.evaluate(async () => {
  const { preparePlanImage } = await import('/designer/ui/image.mjs');
  try { await preparePlanImage('data:image/heic;base64,AAAA'); return null; }
  catch (e) { return e.message; }
});
say('an undecodable image is refused, not left hanging', !!bad, (bad || '').slice(0, 60));
say('and it names the likely cause on a phone', /HEIC/i.test(bad || '') && /JPG/i.test(bad || ''),
  'HEIC and JPG both named');

console.log('\n[3] A real plan still goes all the way in');
await p.locator('input[type=file]').first()
  .setInputFiles('tests/fixtures/plan-brochure-ground-floor.jpg');
await p.waitForTimeout(3500);
const loaded = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  return { has: !!d.plan, w: d.plan?.widthPx, h: d.plan?.heightPx,
           keepsOriginal: d.plan?.originalDataUrl !== null && d.plan?.originalDataUrl !== undefined,
           isPdf: d.plan?.isPdf,
           bytes: (d.plan?.dataUrl || '').length + (d.plan?.originalDataUrl || '').length,
           calibration: d.calibration };
});
say('the plan loads', loaded.has === true, loaded.w + '×' + loaded.h);
say('a non-PDF plan is not held twice', loaded.isPdf === false && !loaded.keepsOriginal,
  Math.round(loaded.bytes / 1024) + ' KB on the design');
say('a new plan clears the old calibration', loaded.calibration === null,
  'pixel sizes change, so no measurement may survive one');

await ctx.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);
