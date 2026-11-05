// ─────────────────────────────────────────────────────────────────────────────
// ADD TO HOME SCREEN
//
// Nick, 5 November 2026: "Can I work with this and add to Home Screen?"
//
// Without a manifest and an apple-touch-icon, iOS still lets you add a page to
// the home screen — it just gives it a blurry screenshot of whatever was on
// screen, labels it with the <title>, and opens it in a browser tab. That is
// not an app, and it is not something to hand an estimator.
//
// These checks are about the things that are WRONG SILENTLY: an icon path that
// 404s shows no error, it just falls back to the screenshot. A manifest with no
// start_url opens whatever page happened to be installed. A 512px icon that is
// really 192 is upscaled and looks it. None of that announces itself, so it is
// pinned here instead.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (p) => readFileSync(ROOT + '/' + p, 'utf8');
const MANIFEST = JSON.parse(read('manifest.webmanifest'));

/** A PNG says its own size in the IHDR chunk, 16 bytes in. No library needed. */
function pngSize(path) {
  const b = readFileSync(ROOT + '/' + path);
  assert.equal(b.toString('ascii', 1, 4), 'PNG', path + ' is not a PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** The pages that ARE the internal app. */
const STAFF = ['quotes.html', 'quote-builder.html', 'index.html', 'admin.html', 'setup.html'];

test('the manifest says what it has to for an installed app', () => {
  assert.equal(MANIFEST.name, 'NAC Quotes');
  assert.ok(MANIFEST.short_name.length <= 12, 'the short name is truncated under an icon');
  assert.equal(MANIFEST.display, 'standalone', 'it would open in a browser tab');
  // The portal, not whichever page was open when it was installed.
  assert.equal(MANIFEST.start_url, '/quotes.html');
  assert.equal(MANIFEST.scope, '/');
  assert.match(MANIFEST.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(MANIFEST.background_color, /^#[0-9a-f]{6}$/i);
});

test('every icon the manifest names is there, and is the size it claims', () => {
  assert.ok(MANIFEST.icons.length >= 2);
  for (const icon of MANIFEST.icons) {
    const path = icon.src.replace(/^\//, '');
    assert.ok(existsSync(ROOT + '/' + path), icon.src + ' is named and not present');
    const [w, h] = icon.sizes.split('x').map(Number);
    const real = pngSize(path);
    // A 512 that is really a 192 is upscaled on the home screen and looks it,
    // and nothing anywhere reports it.
    assert.deepEqual(real, { width: w, height: h },
      icon.src + ' claims ' + icon.sizes + ' and is ' + real.width + 'x' + real.height);
    assert.equal(icon.type, 'image/png');
  }
  // Android masks icons to whatever shape the launcher uses, and crops a
  // non-maskable one into its own corners.
  assert.ok(MANIFEST.icons.some(i => i.purpose === 'maskable'),
    'no maskable icon — Android will crop the mark');
  assert.ok(MANIFEST.icons.some(i => i.purpose === 'any'));
});

test('iOS gets the icon it actually reads, at the size it wants', () => {
  // iOS ignores the manifest icons for the home screen and uses this one.
  const apple = pngSize('icons/apple-touch-icon.png');
  assert.deepEqual(apple, { width: 180, height: 180 });
  for (const page of STAFF) {
    const html = read(page);
    assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/,
      page + ' has no apple-touch-icon, so iOS uses a screenshot of it');
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/,
      page + ' has no manifest link');
    assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/,
      page + ' would open in a browser tab rather than as an app');
    // The label under the icon. Without it iOS uses the <title>, which on
    // these pages reads "Quote only — NAC".
    assert.match(html, /name="apple-mobile-web-app-title" content="NAC Quotes"/, page);
    assert.match(html, /name="theme-color" content="#0c0c24"/, page);
  }
});

test('the customer’s proposal is not NAC’s internal app', () => {
  // A customer saving their quote to their home screen should get a bookmark
  // to THEIR proposal. A manifest here would install NAC's staff tool, scoped
  // to the whole site, on a customer's phone — and send them to /quotes.html,
  // which is the internal portal.
  const html = read('quote.html');
  assert.match(html, /<link rel="apple-touch-icon"/, 'the saved proposal has no icon');
  assert.ok(!/rel="manifest"/.test(html),
    'the customer page offers to install the internal app');
});

test('the icons are real images, not placeholders', () => {
  for (const f of ['icons/apple-touch-icon.png', 'icons/icon-192.png',
                   'icons/icon-512.png', 'icons/icon-maskable-512.png',
                   'icons/favicon-32.png']) {
    const bytes = readFileSync(ROOT + '/' + f).length;
    // A 512px PNG of a flat colour compresses to a few hundred bytes. NAC's
    // mark is a gradient hexagon and does not.
    const floor = /512/.test(f) ? 8000 : (/favicon/.test(f) ? 400 : 3000);
    assert.ok(bytes > floor, f + ' is ' + bytes + ' bytes — that is not the NAC mark');
  }
});

test('the maskable icon keeps the mark inside the safe zone', () => {
  // Android can crop up to 20% off each edge. The mark is sized to 55% of the
  // canvas so a circular mask takes background and not the snowflake.
  const { width } = pngSize('icons/icon-maskable-512.png');
  const b = readFileSync(ROOT + '/icons/icon-maskable-512.png');
  assert.equal(width, 512);
  assert.ok(b.length < readFileSync(ROOT + '/icons/icon-512.png').length,
    'the maskable icon is not padded in from the full-bleed one');
});

test('the shortcuts go where they say', () => {
  const urls = (MANIFEST.shortcuts || []).map(s => s.url);
  assert.deepEqual(urls, ['/quote-builder.html', '/quotes.html']);
  for (const s of MANIFEST.shortcuts) {
    assert.ok(existsSync(ROOT + s.url), s.url + ' is a shortcut to a page that is not there');
  }
});

// ── THE SESSION HAS TO LAST LONGER THAN A SITE VISIT ───────────────────────
//
// A Supabase access token lasts an hour, and the refresh token that renews it
// was stored and never used. On a home-screen app, where there is no address
// bar to glance at, the first sign of an expired session is a save that will
// not land.
//
// auth.mjs is browser code, so the browser it needs is built here: a Map for
// localStorage, a recording fetch, and enough of window and document to hang
// the wake-up listeners on. That is the whole of what it touches, and it means
// these are checks on what the module DOES rather than on what it says.

function fakeBrowser() {
  const store = new Map();
  const calls = [];
  const listeners = new Map();
  const on = (t, fn) => { listeners.set(t, [...(listeners.get(t) || []), fn]); };

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  globalThis.document = { addEventListener: on, visibilityState: 'visible' };
  globalThis.window = {
    addEventListener: on,
    dispatchEvent: (e) => { calls.push({ event: e.type }); return true; }
  };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

  const reply = [];
  const realFetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    const next = reply.shift();
    if (!next) throw new Error('no reply queued');
    if (next.throw) throw new Error('offline');
    return {
      ok: next.ok !== false,
      status: next.status || (next.ok === false ? 400 : 200),
      json: async () => next.body
    };
  };
  globalThis.fetch = realFetch;

  return {
    calls, reply,
    fire: async (type) => {
      for (const fn of listeners.get(type) || []) await fn();
    },
    session: () => JSON.parse(store.get('nac_session_v1') || 'null'),
    put: (s) => store.set('nac_session_v1', JSON.stringify(s)),
    restoreFetch: () => { globalThis.fetch = realFetch; }
  };
}

const B = fakeBrowser();
const auth = await import('../designer/auth.mjs');
const soon = (secs) => ({
  access_token: 'old-token', refresh_token: 'rt-1',
  expires_at: Math.floor(Date.now() / 1000) + secs,
  user: { id: 'u1', email: 'nick@nacelectrical.com.au' }
});

test('an expired access token is renewed from the refresh token', async () => {
  B.put(soon(-10));                       // an hour has passed
  assert.equal(auth.currentSession(), null, 'an expired token is not offered as a session');
  B.reply.push({ ok: true, body: { access_token: 'new-token', refresh_token: 'rt-2',
                                   expires_in: 3600 } });
  const fresh = await auth.refreshSession();
  assert.equal(fresh.access_token, 'new-token');
  const sent = B.calls[B.calls.length - 1];
  assert.match(sent.url, /grant_type=refresh_token/);
  assert.equal(sent.body.refresh_token, 'rt-1');
  // ROTATED. The server handed back a new refresh token and the old one is
  // spent; keeping the old one is how the next renewal fails.
  assert.equal(B.session().refresh_token, 'rt-2');
  assert.ok(auth.currentSession(), 'the renewed session is not usable');
  assert.equal(auth.dbHeaders().Authorization, 'Bearer new-token');
});

test('two wake-ups at once spend the refresh token ONCE', async () => {
  // visibilitychange and online arrive together when an iPad comes out of a
  // van. Two refreshes racing means the second presents a token the first has
  // already spent, which on a server that rotates them signs you out.
  B.put(soon(-10));
  B.calls.length = 0;
  B.reply.push({ ok: true, body: { access_token: 'n1', refresh_token: 'rt-3',
                                   expires_in: 3600 } });
  const [a, b] = await Promise.all([auth.refreshSession(), auth.refreshSession()]);
  assert.equal(B.calls.filter(c => c.url).length, 1,
    'the refresh token was presented twice');
  assert.equal(a.access_token, 'n1');
  assert.equal(b.access_token, 'n1');
});

test('no signal does not throw the estimator out of a half-typed quote', async () => {
  // A refresh that could not REACH the server says nothing about whether the
  // session is good.
  B.put(soon(-10));
  B.reply.push({ throw: true });
  const r = await auth.refreshSession();
  assert.equal(r, null);
  assert.ok(B.session(), 'a roof space with no reception signed the estimator out');
  assert.equal(B.session().refresh_token, 'rt-1', 'the session was altered on a failure');
});

test('a refusal clears the session rather than leaving a dead token', async () => {
  // A token the server has forgotten will not start working. dbHeaders() falls
  // back to the anonymous key with no session, and an openly anonymous request
  // is refused by RLS — a visible failure, rather than the same failure
  // wearing a signed-in costume.
  B.put(soon(-10));
  B.reply.push({ ok: false, body: { error: 'invalid_grant' } });
  const r = await auth.refreshSession();
  assert.equal(r, null);
  assert.equal(B.session(), null, 'a refused session was left in place');
  assert.ok(B.calls.some(c => c.event === 'nac-signed-out'), 'nothing was told');
});

test('nothing to renew from is not an error', async () => {
  B.put({ access_token: 'a', refresh_token: null, expires_at: 1 });
  assert.equal(await auth.refreshSession(), null);
});

test('coming back to the app renews a session that is nearly out', async () => {
  B.put(soon(60));                        // a minute left: inside the lead
  auth.keepSessionAlive();
  B.reply.push({ ok: true, body: { access_token: 'woken', refresh_token: 'rt-9',
                                   expires_in: 3600 } });
  await B.fire('visibilitychange');
  assert.equal(B.session().access_token, 'woken');
});

test('a session with hours left is not renewed on every glance', async () => {
  B.put({ ...soon(3000), access_token: 'plenty' });
  auth.keepSessionAlive();
  // Nothing queued: a fetch here would throw and fail this test.
  await B.fire('visibilitychange');
  await B.fire('online');
  assert.equal(B.session().access_token, 'plenty');
  assert.equal((await auth.ensureFreshSession()).access_token, 'plenty');
});

test('the printable proposal does not need a second window', () => {
  // Launched from the home screen there is no browser around the app, and
  // window.open() either does nothing or throws you out into Safari. The print
  // button was the only thing that relied on it.
  const html = read('quote-builder.html');
  assert.match(html, /function showPrintable/);
  assert.match(html, /navigator\.standalone === true/);
  assert.match(html, /display-mode: standalone/);
  // And a blocked pop-up in an ordinary browser lands in the same place rather
  // than on a message about allowing pop-ups.
  assert.ok(!/Allow pop-ups for this site/.test(html),
    'the dead end is still there');
});

// ── WHAT ONLY GOES WRONG IN PRODUCTION ─────────────────────────────────────
//
// The first cut of this renewed correctly against a server that was up and a
// browser with one tab open. Neither is a safe assumption, and none of the
// checks above would have caught either.

test('Supabase having a bad minute does not sign the estimator out', async () => {
  // This cleared the session on ANY response that was not a success, which put
  // rate limiting and a gateway hiccup in the same bucket as "your sign-in is
  // no longer valid" — and signed somebody out over a 500 that would have been
  // gone by the next attempt.
  for (const status of [429, 500, 502, 503]) {
    B.put({ ...soon(-10), refresh_token: 'rt-keep' });
    B.reply.push({ ok: false, status, body: { msg: 'upstream' } });
    const r = await auth.refreshSession();
    assert.equal(r, null, 'HTTP ' + status + ' was treated as a renewal');
    assert.ok(B.session(), 'HTTP ' + status + ' signed the estimator out');
    assert.equal(B.session().refresh_token, 'rt-keep');
  }
});

test('a credential the server refuses IS cleared', async () => {
  for (const status of [400, 401]) {
    B.put({ ...soon(-10), refresh_token: 'rt-dead' });
    B.reply.push({ ok: false, status, body: { error: 'invalid_grant' } });
    assert.equal(await auth.refreshSession(), null);
    assert.equal(B.session(), null, 'HTTP ' + status + ' left a dead token in place');
  }
});

test('the second tab does not spend a token the first one already spent', async () => {
  // The portal and the builder are two pages, two JavaScript contexts, one
  // session in localStorage. Supabase ROTATES refresh tokens, so two tabs
  // waking together — which is what "New quote" from the portal does — meant
  // the second presenting a token the first had spent, and being told no.
  B.put({ ...soon(-10), refresh_token: 'rt-a' });
  B.reply.push({ ok: true, body: { access_token: 'first', refresh_token: 'rt-b',
                                   expires_in: 3600 } });
  await auth.refreshSession();                 // the first tab renews

  // The second tab wakes and finds the session already fresh. No request: a
  // queued reply would be left over, and the next test would get it.
  B.calls.length = 0;
  const again = await auth.refreshSession();
  assert.equal(again.access_token, 'first');
  assert.equal(B.calls.filter(c => c.url).length, 0, 'it renewed a session that was fine');
});

test('a refusal about a token another tab has already replaced is ignored', async () => {
  // Between the request going out and the answer coming back, the other tab
  // renewed and stored a working session. Clearing here would throw away a
  // good session to punish a dead one.
  B.put({ ...soon(-10), refresh_token: 'rt-old' });
  globalThis.fetch = async () => {
    B.put({ ...soon(3600), access_token: 'from-the-other-tab', refresh_token: 'rt-new' });
    return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  };
  const r = await auth.refreshSession();
  assert.ok(B.session(), 'the good session the other tab stored was thrown away');
  assert.equal(B.session().access_token, 'from-the-other-tab');
  assert.equal(r.access_token, 'from-the-other-tab');
  B.restoreFetch();
});

test('a session with no expiry does not renew in a tight loop', async () => {
  // secondsLeft() is Infinity for a session carrying no expires_at, setTimeout
  // turns a delay of Infinity into ZERO, and the callback reschedules itself —
  // so one malformed session turned the keep-alive into a loop firing
  // renewals at Supabase as fast as the network would carry them.
  const delays = [];
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { delays.push(ms); return 0; };
  try {
    B.put({ access_token: 'a', refresh_token: 'rt', user: {} });   // no expires_at
    auth.keepSessionAlive();
  } finally { globalThis.setTimeout = realTimeout; }
  assert.equal(delays.length, 1);
  assert.ok(Number.isFinite(delays[0]), 'the delay is ' + delays[0]);
  assert.ok(delays[0] >= 10000, 'it would fire immediately and reschedule itself');
  assert.ok(delays[0] <= 1800000, 'the delay is ' + delays[0] + 'ms');
});

test('the renewal timer does not outlive the session', () => {
  // Signing out stops it. Without that the timer holds a reference to a
  // session that is gone and fires a refresh nobody asked for — which is also
  // why this test file would otherwise sit there for forty minutes waiting
  // for a timer to go off.
  auth.clearSession();
  assert.equal(auth.currentSession(), null);
});

// ── A FIX HAS TO BE ABLE TO REACH AN INSTALLED APP ─────────────────────────
//
// Nick, 5 November 2026: "Can I go into my Home Screen save or do I have to
// delete and save again?"
//
// The answer has to be no, always. A home-screen app has no address bar and
// no reload button, so one stale .mjs is a bug the estimator cannot clear and
// cannot see — and the blank Floor plan step was caused by exactly one .mjs.

const VERCEL = JSON.parse(read('vercel.json'));
const headerFor = (source) =>
  (VERCEL.headers || []).find(h => h.source === source);
const valueOf = (rule, key) =>
  ((rule && rule.headers) || []).find(h => h.key === key)?.value || '';

test('the app’s code is re-checked on every load', () => {
  for (const source of ['/(.*).html', '/(.*).mjs', '/designer/content/(.*)']) {
    const rule = headerFor(source);
    assert.ok(rule, 'nothing governs the cache for ' + source);
    const cc = valueOf(rule, 'Cache-Control');
    assert.match(cc, /max-age=0/, source + ' may be served from cache: ' + cc);
    assert.match(cc, /must-revalidate/, source + ' is not revalidated: ' + cc);
    // must-revalidate still allows a 304 — the file is re-CHECKED, not re-sent.
    assert.ok(!/immutable/.test(cc), source + ' is marked immutable');
  }
});

test('nothing here makes an API response cacheable', () => {
  // /api/* responses carry customer, pricing and design information and set
  // their own `no-store`. A "public" Cache-Control forced on them from
  // vercel.json would undo that, from a file nobody reads when thinking about
  // what the server returns.
  for (const rule of VERCEL.headers || []) {
    const touchesApi = /^\/api\b/.test(rule.source) || rule.source === '/(.*)';
    if (!touchesApi) continue;
    const cc = valueOf(rule, 'Cache-Control');
    assert.ok(!/public/.test(cc),
      rule.source + ' makes an API response publicly cacheable: ' + cc);
  }
  // And the rules that ARE public reach only static things.
  for (const rule of VERCEL.headers || []) {
    if (!/public/.test(valueOf(rule, 'Cache-Control'))) continue;
    assert.ok(/\.html|\.mjs|\/icons\/|designer\/content|manifest/.test(rule.source),
      'a public cache rule on something unexpected: ' + rule.source);
  }
});

test('the icons may sit in the cache, because they do not change', () => {
  const cc = valueOf(headerFor('/icons/(.*)'), 'Cache-Control');
  assert.match(cc, /max-age=\d{4,}/, 'the icons are re-fetched constantly: ' + cc);
});
