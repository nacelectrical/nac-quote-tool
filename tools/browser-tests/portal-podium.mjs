// ─────────────────────────────────────────────────────────────────────────────
// THE PODIUM PANEL, IN A REAL BROWSER
//
// Nick, 4 November 2026: "Support a manual Podium workflow now: copy the quote
// link, provide an editable message that can be pasted into Podium, record that
// a message was sent manually, and track issued, accepted, declined, expired
// and superseded states. Allow manual pause and resume... Clearly distinguish a
// copied link from a message successfully sent."
//
// This drives /quotes.html the way Nick does. The list endpoint and the
// outreach endpoint are both stubbed by intercepting fetch, so the whole path —
// portal to record to the panel's own state — runs without touching the live
// project and without any possibility of a real message going anywhere.
//
// The two that matter most:
//   · copying the link is recorded as COPYING A LINK, and the panel says in as
//     many words that nobody has sent it;
//   · a record the database refused is reported as NOT recorded, and the panel
//     does not move on.
//
//   node tools/serve.mjs &   node tools/browser-tests/portal-podium.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B = 'http://127.0.0.1:8777';
let fail = 0;

const TOKEN = 'TESTTOKEN00000000000000000000000000';

/** One issued quote, for a clearly labelled test customer. */
const QUOTE = {
  token: TOKEN, designId: 'Q-TEST-0001', proposalNumber: 'NAC-TEST-0001', revision: 1,
  status: 'issued',
  customerName: 'Riley Nguyen (TEST — do not contact)',
  siteAddress: '7 Example Court, Testville QLD 4000',
  customerPhone: '0400 000 111', customerEmail: 'test@example.invalid',
  issuedAt: '2026-11-01T00:00:00Z', issuedBy: 'nick@nacelectrical.com.au',
  expiresAt: '2026-12-01T00:00:00Z',
  firstViewedAt: null, lastViewedAt: null, viewCount: 0,
  quotedTotalIncGst: 17817, acceptedTotalIncGst: null, acceptedBy: null,
  acceptedAt: null, signed: false, chosenSystemId: 'sys-a', selectedOptionIds: [],
  gstRate: 0.1, hasIssuedCopy: true, supersedes: null, supersededBy: null,
  servicem8: null, outreach: null
};

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const device = process.argv[2] === 'mobile' ? { width: 390, height: 844 }
  : process.argv[2] === 'ipad' ? { width: 820, height: 1180 }
  : { width: 1440, height: 1000 };
const ctx = await browser.newContext({ viewport: device, deviceScaleFactor: 2,
  permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  // The URL, not just the message: "Failed to load resource" says nothing
  // about what failed, and a favicon the static server has not got is not a
  // page fault.
  const where = (m.location() && m.location().url) || '';
  errs.push('console: ' + m.text() + (where ? ' [' + where + ']' : ''));
});

await page.addInitScript(({ quote }) => {
  localStorage.setItem('nac_session_v1', JSON.stringify({
    access_token: 'test-token', user: { email: 'nick@nacelectrical.com.au' },
    expires_at: Math.floor(Date.now() / 1000) + 86400 }));

  // The outreach record this stub keeps, so the panel is driven by something
  // that behaves like the endpoint rather than by a hard-coded answer.
  //
  // IN sessionStorage, not in a variable: the suite reloads the page to prove
  // that what was recorded comes back, and a variable would be wiped by the
  // reload and make a record that never persisted look like one that did.
  const S = {
    get out() { try { return JSON.parse(sessionStorage.getItem('out') || 'null'); }
                catch (_) { return null; } },
    set out(v) { sessionStorage.setItem('out', JSON.stringify(v)); },
    get status() { return sessionStorage.getItem('status') || null; },
    get extra() { try { return JSON.parse(sessionStorage.getItem('extra') || '{}'); }
                  catch (_) { return {}; } },
    get calls() { try { return JSON.parse(sessionStorage.getItem('calls') || '[]'); }
                  catch (_) { return []; } },
    set calls(v) { sessionStorage.setItem('calls', JSON.stringify(v)); }
  };
  window.__state = S;
  window.__reset = () => { sessionStorage.removeItem('out'); S.calls = []; };
  window.__setStatus = (status, extra) => {
    sessionStorage.setItem('status', status);
    sessionStorage.setItem('extra', JSON.stringify(extra || {}));
  };
  window.__refuseNext = false;
  window.__setOps = (o) => sessionStorage.setItem('ops', JSON.stringify(o));

  const real = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const J = (o, s = 200) => new Response(JSON.stringify(o),
      { status: s, headers: { 'Content-Type': 'application/json' } });

    if (u.includes('/api/quote-list')) {
      return J({ ok: true, quotes: [{ ...quote, outreach: S.out,
        ...(S.status ? { status: S.status } : {}), ...S.extra }],
        counts: { total: 1, issued: 1, viewed: 0, accepted: 0, declined: 0, expired: 0 },
        acceptedValueIncGst: 0 });
    }

    if (u.includes('/api/quote-outreach')) {
      const body = JSON.parse(opts.body || '{}');
      S.calls = [...S.calls, body];
      if (window.__refuseNext) {
        window.__refuseNext = false;
        return J({ error: 'not_recorded',
          message: 'That was NOT recorded — the database did not confirm the write.' }, 502);
      }
      const now = '2026-11-04T09:00:00Z';
      const o = S.out || { state: 'none', events: [], followUpCount: 0 };
      const next = { ...o, events: [...(o.events || []),
        { at: now, state: body.action, by: 'nick@nacelectrical.com.au', note: '' }] };
      if (body.action === 'link_copied') {
        next.linkCopiedAt = now;
        if (o.state === 'none' || !o.state) next.state = 'link_copied';
      } else if (body.action === 'sent_manually') {
        next.state = 'sent_manually'; next.sentAt = now;
        next.sentBy = 'nick@nacelectrical.com.au'; next.channel = body.channel || null;
      } else if (body.action === 'customer_replied') {
        next.state = 'customer_replied'; next.paused = true;
        next.pausedReason = 'The customer replied.';
      } else if (body.action === 'taken_over') {
        next.state = 'taken_over'; next.paused = true;
        next.pausedReason = 'Nick has taken this one over.';
      } else if (body.action === 'opted_out') {
        next.state = 'opted_out'; next.paused = true;
        next.pausedReason = 'The customer asked not to be followed up.';
      } else if (body.action === 'resume') {
        if (o.state === 'opted_out') {
          return J({ error: 'opted_out',
            message: 'This customer asked not to be followed up. '
              + 'That is not something to resume.' }, 409);
        }
        next.paused = false; next.pausedReason = null;
      }
      S.out = next;
      return J({ ok: true, outreach: next, automaticSending: false,
        schedulingOwner: 'undecided' });
    }

    // ── WAITING FOR NICK, AND WHAT THE ASSISTANT DID ──────────────────
    if (u.includes('/api/ops-activity')) {
      return J(JSON.parse(sessionStorage.getItem('ops') || 'null') || {
        ok: true,
        integration: { configured: false, callLogPresent: true,
                       automationEnabled: false, schedulingOwner: 'undecided' },
        approvals: [], calls: [], counts: { waiting: 0, failed: 0, refused: 0 }
      });
    }
    if (u.includes('/api/servicem8-selftest')) return J({ ok: false, reason: 'no_api_key' });
    if (u.includes('supabase.co/auth/v1/user')) {
      return J({ id: 'u1', email: 'nick@nacelectrical.com.au' });
    }
    if (u.includes('supabase.co')) return J([]);
    return real(url, opts);
  };
}, { quote: QUOTE });

const ok = (name) => console.log('  PASS  ' + name);
const bad = (name, why) => { fail++; console.log('  FAIL  ' + name + '  — ' + why); };
async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e.message.split('\n')[0]); }
}
const must = (cond, why) => { if (!cond) throw new Error(why); };

/** Open the Podium panel and hand back the texts it is showing. */
async function panel() {
  const open = await page.$eval('[data-pod]', d => d.hasAttribute('open'));
  if (!open) await page.click('[data-pod] > summary');
  return {
    pill: (await page.textContent('[data-pill]')).trim(),
    state: (await page.textContent('[data-state]')).trim(),
    said: (await page.textContent('[data-said]')).trim(),
    hist: (await page.textContent('[data-hist]')).trim(),
    message: await page.inputValue('.pod textarea'),
    buttons: await page.$$eval('[data-actions] button', bs => bs.map(b => b.dataset.act))
  };
}

const act = async (id) => {
  await page.click('[data-actions] button[data-act="' + id + '"]');
  await page.waitForTimeout(140);
};

await page.goto(B + '/quotes.html', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-pod]', { timeout: 15000 });

console.log('\n  ' + (process.argv[2] || 'desktop') + ' — ' + device.width + 'x' + device.height);

// ── NOTHING RECORDED IS NOT THE SAME AS NOTHING SENT ────────────────────────

await t('a quote nobody has touched says plainly that nothing is recorded', async () => {
  const p = await panel();
  must(p.pill === 'Not sent', 'pill was "' + p.pill + '"');
  must(/Nothing recorded/.test(p.state), 'state line: ' + p.state);
  must(/Nobody has copied this link or marked it sent/.test(p.state), p.state);
});

await t('the panel says this application sends nothing', async () => {
  const body = await page.textContent('.pod .body');
  must(/Nothing is sent from here/.test(body), 'the panel does not say it sends nothing');
  must(/no Podium connection/.test(body), 'the panel does not say there is no connection');
  must(/schedules nothing/.test(body), 'the panel does not say it schedules nothing');
});

await t('the message is NAC’s, editable, and carries the real link and no price', async () => {
  const p = await panel();
  must(p.message.includes('#' + TOKEN), 'the customer link is not in the message');
  must(p.message.startsWith('Hi Riley,'), 'it does not use the first name: ' + p.message.slice(0, 30));
  must(!/\$/.test(p.message), 'there is a price in the message');
  must(!/\bkW\b/.test(p.message), 'there is a capacity in the message');
  must(/NAC Electrical Air & Refrigeration/.test(p.message), 'NAC does not sign it');
  // Editable, because a message that cannot be changed gets sent saying the
  // wrong thing.
  await page.fill('.pod textarea', 'Edited by hand before sending.');
  must(await page.inputValue('.pod textarea') === 'Edited by hand before sending.',
    'the message could not be edited');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-pod]');
});

// ── A COPIED LINK IS NOT A SENT MESSAGE ─────────────────────────────────────

await t('copying the link is recorded as copying the link, not as sending it', async () => {
  await page.click('button:has-text("Copy link")');
  await page.waitForTimeout(160);
  const calls = await page.evaluate(() => window.__state.calls);
  must(calls.length === 1, 'expected one record, got ' + calls.length);
  must(calls[0].action === 'link_copied', 'recorded as ' + calls[0].action);

  const p = await panel();
  must(p.pill === 'Link copied', 'pill was "' + p.pill + '"');
  must(/not a sent message/.test(p.state), 'state line: ' + p.state);
  must(/nobody has recorded\s+sending it/.test(p.state.replace(/\s+/g, ' ')),
    'state line: ' + p.state);
  must(/NOT a sent message/.test(p.said), 'the confirmation did not say so: ' + p.said);
});

// ── RECORDING A MANUAL SEND ─────────────────────────────────────────────────

await t('marking it sent records who, how and when', async () => {
  await page.fill('.pod input[type=text]', 'Podium SMS');
  await act('sent');
  const calls = await page.evaluate(() => window.__state.calls);
  const last = calls[calls.length - 1];
  must(last.action === 'sent_manually', 'recorded as ' + last.action);
  must(last.channel === 'Podium SMS', 'channel was ' + last.channel);

  const p = await panel();
  must(p.pill === 'Sent', 'pill was "' + p.pill + '"');
  must(/Marked sent/.test(p.state), 'state line: ' + p.state);
  must(/via Podium SMS/.test(p.state), 'the channel is not shown: ' + p.state);
  must(/follow-up clock starts/.test(p.said), 'the confirmation: ' + p.said);
  must(/marked sent/.test(p.hist), 'history: ' + p.hist);
  must(/link copied/.test(p.hist), 'the earlier copy left the history: ' + p.hist);
});

await t('once it is sent the message becomes a follow-up, not a first send', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-pod]');
  const p = await panel();
  must(/following up/i.test(p.message), 'it still reads as a first send');
  must(p.message.includes('#' + TOKEN), 'the link left the follow-up');
});

// ── PAUSE AND RESUME ────────────────────────────────────────────────────────

await t('a customer reply pauses follow-up, and resume is the only way back', async () => {
  await act('replied');
  let p = await panel();
  must(p.pill === 'Customer replied', 'pill was "' + p.pill + '"');
  must(/paused/.test(p.state), 'state line: ' + p.state);
  must(p.buttons.includes('resume'), 'there is no resume button: ' + p.buttons.join(','));
  must(!p.buttons.includes('replied'),
    'a paused quote should not offer "customer replied" again');

  await act('resume');
  p = await panel();
  must(/resumed/i.test(p.said), 'the confirmation: ' + p.said);
  must(p.buttons.includes('replied'), 'the normal actions did not come back');
});

await t('taking it over by hand pauses follow-up', async () => {
  await act('takeover');
  const p = await panel();
  must(p.pill === 'Nick has it', 'pill was "' + p.pill + '"');
  must(/paused/.test(p.state), 'state line: ' + p.state);
  await act('resume');
});

// ── AN OPT-OUT IS FINAL ─────────────────────────────────────────────────────

await t('an opt-out asks first, and then cannot be resumed by anybody', async () => {
  page.once('dialog', d => d.accept());
  await act('optout');
  const p = await panel();
  must(p.pill === 'Opted out', 'pill was "' + p.pill + '"');
  must(/not something to resume/.test(p.state), 'state line: ' + p.state);
  must(p.buttons.length === 2 && p.buttons.includes('copymsg'),
    'an opted-out quote still offers follow-up actions: ' + p.buttons.join(','));
  must(!p.buttons.includes('resume'), 'it offers a resume button');
  must(!p.buttons.includes('optout'), 'it offers to opt out again');
});

await t('dismissing the opt-out confirmation records nothing', async () => {
  await page.evaluate(() => window.__reset());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-pod]');
  await panel();
  page.once('dialog', d => d.dismiss());
  await act('optout');
  const calls = await page.evaluate(() => window.__state.calls);
  must(calls.length === 0, 'it recorded an opt-out nobody confirmed');
});

// ── A REFUSED WRITE IS NOT A RECORD ─────────────────────────────────────────

await t('a record the database refused is reported as NOT recorded', async () => {
  await page.evaluate(() => { window.__refuseNext = true; });
  await act('sent');
  const p = await panel();
  must(/NOT recorded/.test(p.said), 'it did not say so: ' + p.said);
  must(/Nothing has been changed/.test(p.said), 'it did not say so: ' + p.said);
  must(p.pill === 'Not sent', 'the panel moved on anyway: pill is "' + p.pill + '"');
});

// ── THE STATES NICK ASKED TO TRACK ──────────────────────────────────────────

await t('issued, accepted, declined, expired and superseded all read back', async () => {
  for (const [status, extra, expect] of [
    ['issued', {}, 'issued'],
    ['accepted', { acceptedTotalIncGst: 17817, acceptedBy: 'TEST Riley Nguyen',
                   acceptedAt: '2026-11-04T00:00:00Z' }, 'accepted'],
    ['declined', {}, 'declined'],
    ['expired', {}, 'expired'],
    ['superseded', { supersededBy: 'NEWTOKEN' }, 'superseded']
  ]) {
    await page.evaluate(({ status, extra }) => window.__setStatus(status, extra),
      { status, extra });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.q');
    const cls = await page.$eval('.q', d => d.className);
    must(cls.includes(expect), status + ' rendered as "' + cls + '"');
    const head = await page.textContent('.qh');
    must(head.toLowerCase().includes(expect), status + ' is not shown: ' + head);
  }
});

// ── NOTIFYING NICK, AND WHAT NAC CAN SEE ────────────────────────────────────
//
// Nick, section 11: "Notify Nick that a quote needs approval... Record
// actions and failures so NAC can see what happened and retry safely." Both
// were written to the database and read by no screen, which is the same as
// not notifying and not recording.

await t('a quote the assistant asked about is on the screen Nick looks at', async () => {
  await page.evaluate(() => window.__setOps({
    ok: true,
    integration: { configured: true, callLogPresent: true,
                   automationEnabled: false, schedulingOwner: 'undecided' },
    counts: { waiting: 1, failed: 0, refused: 1 },
    approvals: [{
      quoteId: 'Q-ASK-1', customerName: 'TEST — Riley Nguyen (do not contact)',
      siteAddress: '7 Example Court, Testville QLD', proposalNumber: 'NAC-TEST-9',
      requestedBy: 'ops-assistant', requestedAt: '2026-11-04T09:00:00Z',
      note: 'Priced off the plan — over to you.', system: 'Daikin FDYAN160AV1',
      totalIncGst: 16027, testQuote: true, ready: true, missing: [],
      alreadyIssued: false
    }],
    calls: [{ integration: 'ops-assistant', operation: 'quote.update_draft',
      status: 'refused', quoteId: 'Q-ASK-1', customerId: null,
      at: '2026-11-04T09:01:00Z',
      why: ['Prices are set in the quote tool, from NAC’s own catalogue.'] }]
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.ask', { timeout: 10000 });

  const ask = await page.textContent('.ask');
  must(/waiting for your approval/i.test(ask), ask.slice(0, 80));
  must(/Riley Nguyen/.test(ask), 'the customer is not named');
  must(/Priced off the plan/.test(ask), 'the assistant’s note is not shown');
  must(/ops-assistant/.test(ask), 'who asked is not shown');
  must(/ready to approve/.test(ask), 'the gate result is not shown');
  must(/\$16,027/.test(ask), 'the price is not shown: ' + ask.slice(0, 200));
  // Asking is not approving, and the screen has to say so.
  must(/Asking is not approving/i.test(ask), 'the screen reads as an approval button');
  const href = await page.getAttribute('.ask a.btn', 'href');
  must(href === '/quote-builder.html?id=Q-ASK-1', 'it does not open the quote: ' + href);
  // And there is no approve control here — approval is a tick on the preview.
  const buttons = await page.$$eval('.ask button', bs => bs.map(b => b.textContent));
  must(buttons.length === 0, 'the portal offers an approve control: ' + buttons.join(','));
});

await t('a refused call is visible, with the reason', async () => {
  const act = await page.textContent('.act');
  must(/What the assistant did/.test(act));
  must(/quote\.update_draft/.test(act), 'the operation is not listed');
  must(/refused/.test(act), 'the outcome is not shown');
  must(/Prices are set in the quote tool/.test(act), 'the reason is not shown');
});

await t('an unconnected integration says so rather than looking quiet', async () => {
  await page.evaluate(() => window.__setOps({
    ok: true,
    integration: { configured: false, callLogPresent: true,
                   automationEnabled: false, schedulingOwner: 'undecided' },
    approvals: [], calls: [], counts: { waiting: 0, failed: 0, refused: 0 }
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.act');
  const act = await page.textContent('.act');
  must(/NOT CONNECTED/.test(act), act.slice(0, 160));
  must(/Nothing below means the assistant is working/.test(act), act.slice(0, 220));
  must((await page.locator('.ask').count()) === 0,
    'an empty approval list must render nothing, not an empty panel');
});

await t('a missing call log says what to apply', async () => {
  await page.evaluate(() => window.__setOps({
    ok: true,
    integration: { configured: true, callLogPresent: false,
                   automationEnabled: false, schedulingOwner: 'undecided' },
    approvals: [], calls: [], counts: { waiting: 0, failed: 0, refused: 0 }
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.act');
  must(/ops-integration-schema\.sql/.test(await page.textContent('.act')));
});

await t('the activity panel never takes the quote list down with it', async () => {
  await page.evaluate(() => sessionStorage.setItem('ops', 'BROKEN'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-pod]', { timeout: 10000 });
  must((await page.locator('.q').count()) > 0,
    'the quote list went down with the integration panel');
  await page.evaluate(() => sessionStorage.removeItem('ops'));
});

await t('no javascript errors on the page', async () => {
  // A favicon request against the static server is not a page fault.
  const real = errs.filter(e => !/favicon\.ico/.test(e));
  must(real.length === 0, real.join(' | '));
});

await browser.close();
console.log(fail ? '\n  ' + fail + ' failed\n' : '\n  all passed\n');
process.exit(fail ? 1 : 0);
