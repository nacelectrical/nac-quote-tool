// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD, IN A REAL BROWSER
//
// Nick, 8 November 2026: a dashboard showing what needs him, and
// "distinguish unavailable data from zero."
//
// That last rule is what most of this suite is about. An empty panel reads as
// "nothing to do"; a panel whose source failed must NOT read that way, because
// on a board somebody runs their week off, confusing the two is how a job goes
// quiet for a fortnight.
//
//   node tools/serve.mjs &   node tools/browser-tests/dashboard.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B = 'http://127.0.0.1:8777';
let fail = 0;
const step = async (n, fn) => {
  try { await fn(); console.log('  PASS  ' + n); }
  catch (e) { console.log('  FAIL  ' + n + '  — ' + e.message); fail++; }
};

const QUOTES = [
  { token: 'q1', designId: 'D1', status: 'issued', customerName: 'Mark Lewis',
    siteAddress: '57 Cupania St, Mudjimba', issuedAt: '2026-10-25T00:00:00Z',
    quotedTotalIncGst: 15716, viewCount: 0, revision: 1 },
  { token: 'q2', designId: 'D2', status: 'issued', customerName: 'No Figure',
    siteAddress: 'Somewhere', issuedAt: '2026-11-07T00:00:00Z',
    quotedTotalIncGst: null, viewCount: 2, revision: 1 },
  { token: 'q3', designId: 'D3', status: 'accepted', customerName: 'Jane Doe',
    acceptedBy: 'Jane Doe', siteAddress: '2 Beach Rd',
    acceptedAt: '2026-11-06T00:00:00Z', acceptedTotalIncGst: 21000, revision: 1 }
];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

/**
 * The enquiries and handovers the board now reads.
 *
 * Both had no endpoint until 8 November and were passed as null. They are real
 * sources now, so the stub has to answer them — and has to be able to answer
 * them BADLY, because "the source did not answer" is the state this whole
 * suite exists to check.
 */
const ENQUIRIES = [
  { id: 'NAC-NEWLEAD-1', customer: { name: 'New Lead', phone: '0400 000 111', email: null },
    site: { address: '3 Example Pde, Testville' }, receivedAt: '2026-11-07T22:00:00Z',
    state: 'new', planUrl: 'https://x.invalid/plan-a.pdf', photoUrls: [],
    assessment: null, links: { designId: null, quoteId: null, issuedToken: null,
                               legacyQuoteId: null }, missing: [] },
  // No way to contact them. The board has to say what is missing.
  { id: 'NAC-NOCONTACT-1', customer: { name: 'No Contact', phone: null, email: null },
    site: { address: null }, receivedAt: '2026-11-08T01:00:00Z', state: 'new',
    planUrl: null, photoUrls: [], assessment: null,
    links: { designId: null, quoteId: null, issuedToken: null, legacyQuoteId: null },
    missing: [] }
];

const HANDOVERS = [
  { id: 'q3:1', quoteToken: 'q3', revision: 1, state: 'prepared',
    customer: { name: 'Jane Doe' }, property: { siteAddress: '2 Beach Rd' },
    deposit: { state: 'unknown' }, equipment: { state: 'unknown' },
    scheduling: { state: 'unknown' },
    outstanding: ['Deposit received — not checked', 'Equipment available — not checked'],
    readyToBook: false, sync: { state: 'prepared', externalId: null } }
];

async function open({ quotesOk = true, enquiriesOk = true, handoversOk = true,
                      device = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport: device, deviceScaleFactor: 2 });
  await ctx.addInitScript(({ quotes, ok, enquiries, enqOk, handovers, hoOk }) => {
    localStorage.setItem('nac_session_v1', JSON.stringify({
      access_token: 't', refresh_token: 'r',
      user: { email: 'nick@nacelectrical.com.au' },
      expires_at: Math.floor(Date.now() / 1000) + 86400 }));
    const real = window.fetch;
    window.fetch = async (u, o = {}) => {
      const s = String(u);
      const J = (x, st = 200) => new Response(JSON.stringify(x),
        { status: st, headers: { 'Content-Type': 'application/json' } });
      if (s.includes('/api/quote-list')) {
        return ok ? J({ quotes }) : J({ error: 'read_failed' }, 502);
      }
      if (s.includes('/api/ops-activity')) return J({ approvals: [] });
      if (s.includes('/api/enquiries')) {
        // available:false with a null count is what the endpoint really sends
        // when it could not read. It must NOT become an empty list here.
        return enqOk ? J({ ok: true, available: true, count: enquiries.length, enquiries })
                     : J({ ok: false, available: false, count: null, enquiries: null }, 502);
      }
      if (s.includes('/api/handover')) {
        return hoOk ? J({ ok: true, available: true, count: handovers.length, handovers })
                    : J({ ok: true, available: false, count: null, handovers: null,
                          error: 'handovers_table_missing' });
      }
      if (s.includes('/rest/v1/') || s.includes('/auth/v1/')) return J([]);
      return real(u, o);
    };
  }, { quotes: QUOTES, ok: quotesOk, enquiries: ENQUIRIES, enqOk: enquiriesOk,
       handovers: HANDOVERS, hoOk: handoversOk });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(B + '/dashboard.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}

// ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
const bad = await open({ quotesOk: false, enquiriesOk: false, handoversOk: false });
await step('A SOURCE THAT FAILED DOES NOT READ AS "nothing to do"', async () => {
  const text = await bad.page.textContent('body');
  if (!/could not be read/i.test(text)) {
    throw new Error('a failed source said nothing: ' + text.replace(/\s+/g, ' ').slice(0, 200));
  }
  if (!/unknown/i.test(text) && !/\?/.test(text)) {
    throw new Error('no unknown marker on the panel');
  }
  // And it must not have printed a tidy zero anywhere it matters.
  if (/Nothing outstanding/i.test(text)) {
    throw new Error('an unreadable panel claimed there was nothing outstanding');
  }
});

await step('money is "Not available", never $0, when its source failed', async () => {
  const text = await bad.page.textContent('#money');
  if (!/Not available/i.test(text)) throw new Error('money said: ' + text.trim().slice(0, 120));
  if (/\$0\b/.test(text)) throw new Error('an unreadable total was shown as $0');
});
await bad.ctx.close();

// ── WITH REAL DATA ─────────────────────────────────────────────────────────
const good = await open({});
await step('the stages are populated from issued and accepted records', async () => {
  const text = await good.page.textContent('body');
  for (const want of ['Mark Lewis', 'Jane Doe', 'Issued, awaiting a response',
                      'Accepted, awaiting the next action']) {
    if (!text.includes(want)) throw new Error('missing: ' + want);
  }
});

await step('only totals with a source are added up', async () => {
  const money = await good.page.textContent('#money');
  // $15,716 issued (q2 has no figure and is NOT counted as zero), $21,000 accepted.
  if (!/15,716/.test(money)) throw new Error('issued total wrong: ' + money.replace(/\s+/g, ' '));
  if (!/21,000/.test(money)) throw new Error('accepted total wrong: ' + money.replace(/\s+/g, ' '));
  if (!/1 with a figure/.test(money)) {
    throw new Error('it did not say how many had a figure: ' + money.replace(/\s+/g, ' '));
  }
});

await step('a quote with no total is still listed, just without a number', async () => {
  const text = await good.page.textContent('body');
  if (!text.includes('No Figure')) throw new Error('a quote with no total was dropped');
});

await step('what needs Nick says WHY for each item', async () => {
  const needs = await good.page.textContent('#needs');
  // q1 was issued 2+ weeks ago with no views; q3 is accepted with no handover.
  if (!/no answer|Accepted, and no handover/i.test(needs)) {
    throw new Error('no reasons given: ' + needs.replace(/\s+/g, ' ').slice(0, 200));
  }
});

await step('enquiries are listed, with what each one is missing', async () => {
  // The panel said "could not be read" until 8 November, because there was no
  // endpoint. Honest, and useless.
  const text = await good.page.textContent('body');
  if (!text.includes('New enquiries')) throw new Error('no enquiry panel');
  if (!text.includes('New Lead')) throw new Error('the enquiry was not listed');
  if (!/Start the assessment/i.test(text)) {
    throw new Error('a complete enquiry should offer the next action');
  }
  if (!/Fill in[^<]*site address/i.test(text)) {
    throw new Error('an incomplete enquiry has to say what is missing: '
      + text.replace(/\s+/g, ' ').slice(0, 400));
  }
});

await step('an accepted job shows what its handover is still waiting on', async () => {
  const text = await good.page.textContent('body');
  if (!/2 thing\(s\) before it can be booked/.test(text)) {
    throw new Error('the handover state did not reach the accepted panel: '
      + text.replace(/\s+/g, ' ').slice(0, 400));
  }
  // And acceptance alone must never read as booked.
  if (/Ready to book/i.test(text)) {
    throw new Error('an accepted job with an unchecked deposit was shown as ready');
  }
});

await step('connections show four states, not a green light for everything', async () => {
  const text = await good.page.textContent('body');
  for (const want of ['ServiceM8', 'Xero', 'Podium', 'Not connected']) {
    if (!text.includes(want)) throw new Error('missing connection line: ' + want);
  }
  if (/Podium[^$]{0,60}Connected/i.test(text)) {
    throw new Error('Podium is shown as connected and it is not');
  }
});

await step('it fits a phone with no sideways scroll', async () => {
  const over = await good.page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 1) throw new Error(over + 'px of sideways scroll at 390px');
  const small = await good.page.evaluate(() =>
    [...document.querySelectorAll('a.row, .nav a')]
      .filter(e => e.getBoundingClientRect().height < 36).length);
  if (small) throw new Error(small + ' tap target(s) under 36px');
});

await step('no javascript errors', async () => {
  if (good.errs.length) throw new Error(good.errs.slice(0, 3).join(' | '));
});

if (process.env.NAC_SHOT) {
  await good.page.screenshot({ path: process.env.NAC_SHOT, fullPage: true });
}
await good.ctx.close();
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED');
process.exit(fail ? 1 : 0);
