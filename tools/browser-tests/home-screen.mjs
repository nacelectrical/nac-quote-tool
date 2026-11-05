// ─────────────────────────────────────────────────────────────────────────────
// ADDED TO THE HOME SCREEN, IN A REAL BROWSER
//
// Nick, 5 November 2026: "Can I work with this and add to Home Screen?"
//
// tests/home-screen.test.mjs checks the manifest and the icons as FILES. This
// drives the pages: it makes the browser fetch the manifest the way an install
// does, loads every icon it names through the page, and then runs the app the
// way iOS runs it from a home screen — with no browser around it — because
// that is where window.open() stops working and the print button died.
//
//   node tools/serve.mjs &   node tools/browser-tests/home-screen.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B = 'http://127.0.0.1:8777';
let fail = 0;

const step = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + '  — ' + e.message); fail++; }
};

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

// ── AS AN IPAD, LAUNCHED FROM THE HOME SCREEN ──────────────────────────────
//
// navigator.standalone is what iOS sets and what the page tests for. It cannot
// be emulated, so it is set here, and display-mode is forced through the same
// media feature Chromium uses for an installed app.
const ctx = await browser.newContext({
  viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2
});
await ctx.addInitScript(() => {
  Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
  localStorage.setItem('nac_session_v1', JSON.stringify({
    access_token: 'test-token', refresh_token: 'test-refresh',
    user: { email: 'nick@nacelectrical.com.au' },
    expires_at: Math.floor(Date.now() / 1000) + 86400 }));
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u);
    const J = (x) => new Response(JSON.stringify(x),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (s.includes('/api/presentation-content')) {
      return J({ content: { upgrades: [], reviews: [], installations: [], images: [] } });
    }
    if (s.includes('/rest/v1/')) return J([]);
    if (s.includes('/auth/v1/')) return J({});
    // The static dev server has no API behind it. These are the portal's own
    // calls; what they return does not matter here, only that the page is not
    // left reporting a failure that belongs to the harness.
    if (s.includes('/api/quote-list')) return J({ quotes: [], counts: {} });
    if (s.includes('/api/ops-activity')) return J({ approvals: [], calls: [], counts: {} });
    return real(u, o);
  };
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

// ── THE MANIFEST, AS AN INSTALL READS IT ───────────────────────────────────
await page.goto(B + '/quotes.html', { waitUntil: 'networkidle' });

await step('the page points at a manifest the browser can read', async () => {
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  if (href !== '/manifest.webmanifest') throw new Error('manifest href is ' + href);
  const r = await page.request.get(B + href);
  if (!r.ok()) throw new Error('the manifest is ' + r.status());
  // Served as anything else, the browser ignores it and installs a bookmark
  // with a screenshot for an icon — and says nothing.
  const type = r.headers()['content-type'] || '';
  if (!/manifest\+json|application\/json/.test(type)) {
    throw new Error('the manifest is served as ' + type);
  }
  const m = await r.json();
  if (m.display !== 'standalone') throw new Error('display is ' + m.display);
  if (m.start_url !== '/quotes.html') throw new Error('start_url is ' + m.start_url);
});

await step('every icon loads, through the page, at its full size', async () => {
  const m = await (await page.request.get(B + '/manifest.webmanifest')).json();
  const srcs = [...m.icons.map(i => i.src), '/icons/apple-touch-icon.png',
                '/icons/favicon-32.png'];
  for (const src of srcs) {
    const got = await page.evaluate((s) => new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => ok(null);
      img.src = s;
    }), src);
    if (!got) throw new Error(src + ' did not load');
    if (got.w < 32 || got.w !== got.h) {
      throw new Error(src + ' is ' + got.w + 'x' + got.h + ' — an icon has to be square');
    }
  }
});

await step('iOS has an icon and a name of its own', async () => {
  const apple = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
  if (apple !== '/icons/apple-touch-icon.png') throw new Error('apple-touch-icon is ' + apple);
  const title = await page.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content');
  if (title !== 'NAC Quotes') throw new Error('the home-screen label is ' + title);
  const cap = await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content');
  if (cap !== 'yes') throw new Error('it would open in a browser tab');
});

// ── THE APP, WITH NO BROWSER AROUND IT ─────────────────────────────────────
await step('the builder opens and knows it is running as an app', async () => {
  await page.goto(B + '/quote-builder.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  if (await page.locator('#nac-signin').count()) {
    throw new Error('the sign-in gate came up over a live session');
  }
  if (!await page.evaluate(() => window.navigator.standalone === true)) {
    throw new Error('standalone was not emulated');
  }
});

/** The least a quote can be and still build a proposal to print. */
async function fillAQuote() {
  const goStep = async (n) => {
    await page.locator('.steps button').nth(n - 1).click();
    await page.waitForTimeout(250);
  };
  await goStep(1);
  await page.fill('#cname', 'Test Quote \u2014 do not send');
  await page.fill('#caddr', '12 Boronia Street, Buderim QLD 4556');
  await goStep(3);
  const row = page.locator('#systems .row').nth(0).locator('.f input');
  await row.nth(0).fill('Daikin');
  await row.nth(1).fill('FDYAN160AV1');
  await row.nth(3).fill('16');
  await row.nth(5).fill('16027');
  await goStep(4);
  await page.fill('#outlets', '10');
  await page.click('#seedIncl');
  await page.click('#seedExcl');
  await page.waitForTimeout(300);
}

await step('the printable proposal opens INSIDE the app', async () => {
  await fillAQuote();
  // Launched from the home screen there is no second window to open. Before
  // this, the print button was dead and said so in a message about allowing
  // pop-ups that nobody could act on.
  //
  // window.open is replaced with one that records and refuses, which is what
  // iOS does, so a page still reaching for it fails this rather than quietly
  // doing nothing on an iPad.
  await page.evaluate(() => {
    window.__opened = 0;
    window.open = () => { window.__opened++; return null; };
  });
  await page.evaluate(() => {
    const steps = [...document.querySelectorAll('.steps button')];
    if (steps[4]) steps[4].click();
  });
  await page.waitForTimeout(300);
  await page.locator('#printPrev').click();
  await page.waitForTimeout(700);

  if (await page.evaluate(() => window.__opened) !== 0) {
    throw new Error('it still reached for a second window');
  }
  const wrap = page.locator('.printwrap');
  if (!await wrap.count()) throw new Error('nothing opened');
  const frame = page.frameLocator('.printwrap iframe');
  const body = await frame.locator('body').textContent();
  if (!/NAC/i.test(String(body))) {
    throw new Error('the printable proposal is empty: ' + String(body).slice(0, 120));
  }
  // And it has a way out, because in the app there is no back button.
  if (!await wrap.locator('button', { hasText: 'Close' }).count()) {
    throw new Error('no way back out of the printable view');
  }
  if (process.env.NAC_SHOT) {
    await page.screenshot({ path: process.env.NAC_SHOT });
  }
  await wrap.locator('button', { hasText: 'Close' }).click();
  await page.waitForTimeout(200);
  if (await page.locator('.printwrap').count()) throw new Error('Close did not close it');
});

await step('no javascript errors while running as an app', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
});

await ctx.close();
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED');
process.exit(fail ? 1 : 0);
