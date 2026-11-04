// ─────────────────────────────────────────────────────────────────────────────
// THE WHOLE JOURNEY, THROUGH THE REAL APPLICATION, PHOTOGRAPHED
//
// Nick, 4 November 2026: "Test through the actual application using clearly
// labelled test customers... Create an enquiry, add a plan or enter rooms,
// produce one and several equipment options, preview, approve, issue, accept
// and read the result back... Provide mobile and desktop screenshots."
//
// This drives /quote-builder.html and /quotes.html in a real browser, as an
// estimator does — typing into the actual controls, pressing the actual
// buttons — and photographs each step at desktop, iPad and phone widths.
//
// THE CUSTOMER IS A TEST CUSTOMER and says so in their own name. The quote is
// ticked as a TEST QUOTE, so every surface of it is banner-labelled. Nothing
// here touches the live project: the database is stubbed by intercepting
// fetch, exactly as the browser suites do.
//
//   node tools/serve.mjs &   node tools/walkthrough.mjs [outDir]
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B = 'http://127.0.0.1:8777';
const OUT = process.argv[2] || resolve(process.cwd(), 'proof/walkthrough');
mkdirSync(OUT, { recursive: true });

const SIZES = [['desktop', 1440, 1000], ['ipad', 820, 1180], ['phone', 390, 844]];

/** Clearly a test, in the one place a person always reads. */
const CUSTOMER = {
  name: 'TEST CUSTOMER — Riley Nguyen (do not contact)',
  phone: '0400 000 111',
  email: 'test.enquiry@example.invalid',
  address: '7 Example Court, Testville QLD 4000'
};

const UPGRADES = [
  { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1350,
    description: 'Colour touchscreen, phone app control, each zone to its own temperature.',
    requires: ['has_zoning', 'daikin_system'], enabled: true, sortOrder: 1 },
  { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 110,
    unitLabel: 'each', maxQuantity: 8, defaultQuantity: 0,
    description: 'A sensor in the rooms you choose.',
    requires: ['has_zoning', 'daikin_system'], enabled: true, sortOrder: 2 }
];

const ALLOWANCES = [
  { id: 'sb', title: 'Switchboard upgrade allowance', priceIncGst: 850,
    covers: 'Up to a new circuit and a two-pole RCBO. A board replacement is beyond it.',
    kind: 'scope', enabled: true, sortOrder: 0 }
];

const log = [];
const note = (s) => { log.push(s); console.log('  ' + s); };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

for (const [device, width, height] of SIZES) {
  console.log('\n── ' + device + ' ' + width + '×' + height + ' ───────────────');
  const ctx = await browser.newContext({ viewport: { width, height },
    deviceScaleFactor: 2, hasTouch: device !== 'desktop' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    if (/favicon\.ico/.test(where)) return;
    errs.push('console: ' + m.text());
  });

  await page.addInitScript(({ ups, allow }) => {
    localStorage.setItem('nac_session_v1', JSON.stringify({
      access_token: 'walkthrough', user: { email: 'nick@nacelectrical.com.au' },
      expires_at: Math.floor(Date.now() / 1000) + 86400 }));
    sessionStorage.setItem('crm', JSON.stringify({ customers: [], jobs: [] }));
    window.__saved = [];
    window.__issued = null;
    const real = window.fetch;
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      const J = (o, s = 200) => new Response(JSON.stringify(o),
        { status: s, headers: { 'Content-Type': 'application/json' } });

      if (u.includes('/api/presentation-content')) {
        return J({ content: {
          upgrades: ups, installationAllowances: allow,
          reviews: [], installations: [], images: [],
          standardInclusions: { commissioning: true, wasteRemoval: true, wifi: false }
        } });
      }
      if (u.includes('/rest/v1/nac_designs')) {
        if ((opts.method || 'GET') === 'POST') {
          const r = JSON.parse(opts.body);
          window.__saved.push(r);
          try { sessionStorage.setItem('row:' + r.id, r.design); } catch (e) {}
          return new Response('', { status: 201 });
        }
        const m = /id=eq\.([^&]+)/.exec(u);
        if (m) {
          const d = sessionStorage.getItem('row:' + decodeURIComponent(m[1]));
          return J(d ? [{ id: decodeURIComponent(m[1]), design: d }] : []);
        }
        return J([]);
      }
      if (u.includes('/rest/v1/nac_customers') || u.includes('/rest/v1/nac_jobs')) {
        const t = u.includes('nac_customers') ? 'customers' : 'jobs';
        const crm = JSON.parse(sessionStorage.getItem('crm') || '{"customers":[],"jobs":[]}');
        if ((opts.method || 'GET') === 'POST') {
          const row = JSON.parse(opts.body);
          crm[t] = [...crm[t].filter(x => x.id !== row.id), row];
          sessionStorage.setItem('crm', JSON.stringify(crm));
          return new Response('', { status: 201 });
        }
        return J(crm[t]);
      }
      if (u.includes('/rest/v1/nac_settings')) {
        return J([{ value: JSON.stringify({ commercial: { terms: {
          depositPercent: 50, balanceDueEvent: 'completion', validityDays: 30,
          paymentMethods: ['Direct deposit'],
          termsVersion: 'NAC T&C v1.0 (23 September 2026)', confirmed: true,
          confirmedBy: 'nick@nacelectrical.com.au',
          confirmedAt: '2026-09-23T00:00:00Z' } } }) }]);
      }
      if (u.includes('/api/quote-issue')) {
        window.__issued = JSON.parse(opts.body);
        // sessionStorage, so the portal on the NEXT page can see what was
        // issued — window is per page and the journey crosses two of them.
        sessionStorage.setItem('issued', opts.body);
        return J({ ok: true, quoteRevision: 1, token: 'WALKTHROUGHTOKEN0000000000000000',
          url: 'https://nac-quote-tool.vercel.app/quote.html#WALKTHROUGHTOKEN0000000000000000',
          expiresAt: '2026-12-04T00:00:00Z' });
      }
      if (u.includes('/api/quote-list')) {
        const issued = window.__issued
          || JSON.parse(sessionStorage.getItem('issued') || 'null');
        return J({ ok: true, counts: { total: issued ? 1 : 0, issued: issued ? 1 : 0,
          viewed: 0, accepted: 0, declined: 0, expired: 0 },
          acceptedValueIncGst: 0,
          quotes: issued ? [{
            token: 'WALKTHROUGHTOKEN0000000000000000',
            designId: issued.designId, proposalNumber: issued.proposalNumber,
            revision: 1, status: 'issued',
            customerName: (issued.customer || {}).name || null,
            siteAddress: (issued.job || {}).siteAddress || null,
            customerPhone: (issued.customer || {}).phone || null,
            issuedAt: '2026-11-04T00:00:00Z', issuedBy: issued.approvedBy,
            expiresAt: '2026-12-04T00:00:00Z', viewCount: 0, lastViewedAt: null,
            quotedTotalIncGst: 17817, acceptedTotalIncGst: null, acceptedBy: null,
            acceptedAt: null, signed: false, gstRate: 0.1, hasIssuedCopy: true,
            supersedes: null, supersededBy: null, servicem8: null, outreach: null,
            selectedOptionIds: [], chosenSystemId: issued.chosenSystemId || null
          }] : [] });
      }
      if (u.includes('/api/quote-outreach')) {
        const body = JSON.parse(opts.body || '{}');
        return J({ ok: true, automaticSending: false, schedulingOwner: 'undecided',
          outreach: { state: body.action, linkCopiedAt: '2026-11-04T09:00:00Z',
            sentAt: body.action === 'sent_manually' ? '2026-11-04T09:00:00Z' : null,
            sentBy: 'nick@nacelectrical.com.au', channel: body.channel || null,
            paused: false, pausedReason: null, followUpCount: 0,
            events: [{ at: '2026-11-04T09:00:00Z', state: body.action,
                       by: 'nick@nacelectrical.com.au', note: '' }] } });
      }
      if (u.includes('/api/servicem8-selftest')) return J({ ok: false, reason: 'no_api_key' });
      if (u.includes('supabase.co/auth/v1/user')) {
        return J({ id: 'u1', email: 'nick@nacelectrical.com.au' });
      }
      if (u.includes('supabase.co')) return J([]);
      return real(url, opts);
    };
  }, { ups: UPGRADES, allow: ALLOWANCES });

  const shot = async (n, name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(OUT, device + '-' + n + '-' + name + '.png'),
      fullPage: true });
  };

  /** Reveal whichever step owns a control, the way a person clicks the nav. */
  const show = async (sel) => {
    const n = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const body = el && el.closest('.stepbody');
      return body ? Number(body.dataset.step) : null;
    }, sel);
    if (n === null) return false;
    await page.click('.steps button:nth-of-type(1)').catch(() => {});
    await page.evaluate((i) => {
      const b = document.querySelectorAll('.steps li button')[i - 1];
      if (b) b.click();
    }, n);
    await page.waitForTimeout(200);
    return true;
  };

  await page.goto(B + '/quote-builder.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.steps button');

  // ── 1. THE ENQUIRY ──────────────────────────────────────────────────
  await page.fill('#cname', CUSTOMER.name);
  await page.fill('#cphone', CUSTOMER.phone);
  await page.fill('#cemail', CUSTOMER.email);
  await page.fill('#caddr', CUSTOMER.address);
  await page.fill('#pnum', 'NAC-TEST-WALK-01');
  await page.selectOption('#jobtype', 'replacement');
  await page.check('#istest');
  await shot(1, 'enquiry');
  if (device === 'desktop') note('1. Enquiry: test customer, test address, replacement job, TEST QUOTE ticked.');

  // ── 2. THE PLAN AND THE ROOMS ───────────────────────────────────────
  await show('#planMount *') || await page.evaluate(() => {
    const b = document.querySelectorAll('.steps li button')[1]; if (b) b.click();
  });
  await page.waitForTimeout(300);
  await shot(2, 'plan-and-rooms');
  if (device === 'desktop') {
    const txt = await page.evaluate(
      () => (document.querySelector('.stepbody[data-step="2"]') || {}).innerText || '');
    note('2. Plan step: ' + txt.replace(/\n+/g, ' / ').slice(0, 120));
  }

  // ── 3. THE EQUIPMENT ────────────────────────────────────────────────
  //
  // By the LABEL the estimator reads, not by position: several fields on an
  // option row are number inputs with the same step, and picking one by
  // position quietly fills the wrong box.
  const setField = async (rowIndex, label, value) => {
    const ok = await page.evaluate(({ rowIndex, label, value }) => {
      const row = document.querySelectorAll('.stepbody[data-step="3"] .row')[rowIndex];
      if (!row) return false;
      const f = [...row.querySelectorAll('.f')]
        .find(x => (x.querySelector('label') || {}).textContent === label);
      const input = f && f.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, { rowIndex, label, value });
    if (!ok) throw new Error('no field "' + label + '" on option row ' + rowIndex);
  };

  await show('#addSys');
  await setField(0, 'Brand', 'Daikin');
  await setField(0, 'Indoor model', 'FDYAN160AV1');
  await setField(0, 'Outdoor model', 'RZA160C2V1');
  await setField(0, 'Capacity (kW)', '16');
  await setField(0, 'Power supply', '1Ph');
  await setField(0, 'Price including GST', '16027');
  await page.waitForTimeout(400);
  await shot(3, 'equipment-one-option');
  if (device === 'desktop') {
    const money = await page.evaluate(() => (document.querySelector('.omoney') || {}).innerText || '');
    note('3. One option priced. Estimator sees: '
      + money.replace(/\n+/g, ' / ').slice(0, 150));
  }

  // A second option, so the customer has a choice.
  await page.click('#addSys');
  await page.waitForTimeout(300);
  await setField(1, 'Brand', 'Braemar');
  await setField(1, 'Indoor model', 'KDHV160D1S');
  await setField(1, 'Capacity (kW)', '16.3');
  await setField(1, 'Power supply', '1Ph');
  await setField(1, 'Price including GST', '14553');
  await setField(1, 'Warranty (years)', '7');
  await page.waitForTimeout(400);
  await shot(4, 'equipment-two-options');
  if (device === 'desktop') note('4. A second option added — the customer chooses on the page.');

  // ── 4. SCOPE, ALLOWANCE AND PRICING ─────────────────────────────────
  await show('#outlets');
  await page.fill('#outlets', '10');
  await page.fill('#returns', '2');
  await page.fill('#zones', '6');
  await page.fill('#summary', 'Ducted reverse-cycle replacement throughout, six zones.');
  await page.click('#seedIncl');
  await page.click('#seedExcl');
  await page.waitForTimeout(300);
  const allowBtn = page.locator('#allowances button').first();
  if (await allowBtn.count()) { await allowBtn.click(); await page.waitForTimeout(250); }
  await shot(5, 'scope-and-allowance');
  if (device === 'desktop') {
    const firm = await page.evaluate(() => (document.querySelector('#firmness') || {}).innerText || '');
    note('5. Scope + allowance. Firmness now reads: ' + firm.replace(/\n+/g, ' / ').slice(0, 170));
  }

  // ── 5. THE CHECKS ───────────────────────────────────────────────────
  if (device === 'desktop') {
    const checks = await page.evaluate(() => (document.querySelector('#checks') || {}).innerText || '');
    note('6. Checks panel: ' + checks.replace(/\n+/g, ' / ').slice(0, 220));
  }

  // ── 6. PREVIEW, APPROVE, ISSUE ──────────────────────────────────────
  await show('#preview');
  await page.click('#preview');
  await page.waitForTimeout(900);
  await shot(6, 'customer-preview');
  if (device === 'desktop') {
    const prev = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      try { return f.contentDocument.body.innerText.slice(0, 400); } catch (e) { return ''; }
    });
    note('7. Preview is the real customer page: '
      + (prev ? prev.replace(/\n+/g, ' / ').slice(0, 170) : '(rendered in a frame)'));
  }
  await page.click('#prevClose').catch(() => {});
  await page.waitForTimeout(250);

  await show('#approved');
  await page.check('#approved');
  await shot(7, 'approval');
  // Save, as an estimator does before sending anything out. Issue saves on
  // its own too, and refuses if the write does not land.
  await page.click('#save');
  await page.waitForTimeout(900);
  const issueState = await page.evaluate(() => ({
    disabled: document.querySelector('#issue').disabled,
    approved: document.querySelector('#approved').checked,
    checks: (document.querySelector('#checks') || {}).innerText || ''
  }));
  if (device === 'desktop' && issueState.disabled) {
    note('   Issue is DISABLED. approved=' + issueState.approved
      + ' checks: ' + issueState.checks.replace(/\n+/g, ' / ').slice(0, 300));
  }
  await page.click('#issue');
  await page.waitForTimeout(1400);
  await shot(8, 'issued');
  if (device === 'desktop') {
    const issued = await page.evaluate(() => window.__issued);
    const flash = await page.evaluate(
      () => (document.querySelector('.flash') || {}).textContent || '');
    note('8. Issue pressed. The page said: ' + flash.replace(/\s+/g, ' ').slice(0, 200));
    note('   The request carried approvedBy=' + (issued && issued.approvedBy)
      + ', testQuote=' + (issued && issued.testQuote)
      + ', designId=' + (issued && issued.designId));
  }

  // ── 7. THE PORTAL AND THE PODIUM PANEL ──────────────────────────────
  await page.goto(B + '/quotes.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await shot(9, 'portal');
  const pod = page.locator('[data-pod] > summary');
  if (await pod.count()) {
    await pod.click();
    await page.waitForTimeout(400);
    await shot(10, 'podium-panel');
    if (device === 'desktop') {
      const panel = await page.evaluate(() => (document.querySelector('.pod .body') || {}).innerText || '');
      note('9. Podium panel: ' + panel.replace(/\n+/g, ' / ').slice(0, 220));
    }
  }

  console.log('  ' + (errs.length ? 'JS ERRORS: ' + errs.join(' | ') : 'no javascript errors'));
  await ctx.close();
}

await browser.close();
console.log('\n  screenshots in ' + OUT + '\n');
