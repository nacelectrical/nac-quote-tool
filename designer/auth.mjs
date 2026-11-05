// NAC — sign-in for the internal pages.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
// This module signs a NAC staff member in against Supabase Auth and puts their
// access token on every database request. That is the half a browser can do.
//
// It is NOT, on its own, security. The anon key ships in the page source, so
// until the row-level-security policies in designer/rls.sql are applied to the
// project, anyone who reads the page can still query the database directly with
// that key. The sign-in screen is a door; RLS is the lock. Both are needed, and
// the door alone is a speed bump.
//
// Customer-facing pages (sign.html, intake.html, next.html) are deliberately
// NOT guarded — a customer must be able to open their quote without an account.

const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';

const SESSION_KEY = 'nac_session_v1';

/** The stored session, or null. Expired sessions are treated as absent. */
export function currentSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.access_token) return null;
    if (s.expires_at && Date.now() / 1000 > s.expires_at - 30) return null;   // 30s of slack
    return s;
  } catch (e) { return null; }
}

export function currentUserEmail() {
  return currentSession()?.user?.email || null;
}

export function isSignedIn() {
  return currentSession() !== null;
}

function store(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* private mode */ }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  stopKeepAlive();
}

// ─────────────────────────────────────────────────────────────────────────────
// KEEPING THE SESSION ALIVE
//
// Nick, 5 November 2026: "Can I work with this and add to Home Screen?"
//
// A Supabase access token lasts ONE HOUR. The refresh token that renews it was
// being stored and never used — so an estimator who signed in at the kerb was
// signed out again before they had finished walking the house, and on a
// home-screen app, where there is no address bar to glance at, the first sign
// of it is a save that will not land.
//
// Three things wake the renewal, because any one of them alone has a hole:
//
//   · a TIMER at four fifths of the token's life, for a page left open;
//   · VISIBILITY, for an iPad that went in the van and came out an hour later
//     with the timer long since fired into a suspended tab;
//   · ONLINE, for a roof space with no signal, where the renewal that was due
//     could not have reached anybody.
//
// Renewal is SINGLE-FLIGHT. Returning to the app fires visibility and online
// together, and two refreshes racing means the second presents a refresh token
// the first has already spent — which, on a server that rotates them, logs you
// out rather than keeping you in.
// ─────────────────────────────────────────────────────────────────────────────

/** Renew this long before the token actually dies. */
const RENEW_LEAD_SECONDS = 300;
let renewing = null;
let renewTimer = null;

function stopKeepAlive() {
  if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
}

/** The stored session WITHOUT the expiry test — what refreshing works from. */
function storedSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.access_token ? s : null;
  } catch (e) { return null; }
}

function secondsLeft(s) {
  return s && s.expires_at ? (s.expires_at - Date.now() / 1000) : Infinity;
}

/**
 * Renew the access token from the refresh token.
 *
 * Returns the fresh session, or null when there is nothing to renew from or
 * the server refused. A refusal CLEARS the stored session rather than leaving
 * a dead token in place: `dbHeaders()` falls back to the anonymous key when
 * there is no session, and a request that is openly anonymous is refused by
 * RLS, which is a visible failure. A request carrying a token the server has
 * already forgotten is the same failure wearing a signed-in costume.
 */
export function refreshSession() {
  if (renewing) return renewing;
  const s = storedSession();
  if (!s || !s.refresh_token) return Promise.resolve(null);

  renewing = (async () => {
    let res;
    try {
      res = await fetch(SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token })
      });
    } catch (e) {
      // No signal. The session is NOT cleared: it may still be good, and
      // throwing somebody out of a half-typed quote because the roof space has
      // no reception would be the application inventing a problem.
      return null;
    }
    let body = null;
    try { body = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok || !body?.access_token) {
      // The server has refused this refresh token. It will not start working.
      clearSession();
      try { window.dispatchEvent(new CustomEvent('nac-signed-out')); } catch (e) { /* ignore */ }
      return null;
    }
    const next = {
      access_token: body.access_token,
      refresh_token: body.refresh_token || s.refresh_token,
      expires_at: body.expires_at
        || (Math.floor(Date.now() / 1000) + (body.expires_in || 3600)),
      user: body.user ? { id: body.user.id || null, email: body.user.email || s.user?.email }
                      : s.user
    };
    store(next);
    return next;
  })().finally(() => { renewing = null; });

  return renewing;
}

/**
 * The session, renewed first if it is close to expiry.
 *
 * Everything on these pages reads the session SYNCHRONOUSLY through
 * dbHeaders(), so this cannot be made to run before each request without
 * rewriting every call site. It does not need to: keepSessionAlive() renews
 * well ahead of time, and this is here for a caller that wants to be certain
 * before doing something that must not fail — issuing a quote, say.
 */
export async function ensureFreshSession() {
  const s = storedSession();
  if (s && secondsLeft(s) > RENEW_LEAD_SECONDS) return s;
  return (await refreshSession()) || currentSession();
}

/** Keep renewing for as long as this page is open. Safe to call repeatedly. */
export function keepSessionAlive() {
  stopKeepAlive();
  const s = storedSession();
  if (!s || !s.refresh_token) return;

  const left = secondsLeft(s);
  // Four fifths of what is left, floored at ten seconds so a session that is
  // already past due renews now rather than scheduling itself into the past.
  const wait = Math.max(10, Math.min(left - RENEW_LEAD_SECONDS, left * 0.8));
  renewTimer = setTimeout(async () => {
    await refreshSession();
    keepSessionAlive();
  }, wait * 1000);

  if (!keepSessionAlive._wired) {
    keepSessionAlive._wired = true;
    const wake = async () => {
      if (document.visibilityState === 'hidden') return;
      const held = storedSession();
      if (!held) return;
      if (secondsLeft(held) <= RENEW_LEAD_SECONDS) await refreshSession();
      keepSessionAlive();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
  }
}

/**
 * Headers for a database request.
 *
 * A signed-in user's token goes in Authorization, so RLS policies written
 * against `authenticated` apply to them. Signed out, this is the bare anon key,
 * which is what the customer-facing pages use.
 */
export function dbHeaders() {
  const s = currentSession();
  return {
    apikey: ANON_KEY,
    Authorization: 'Bearer ' + (s?.access_token || ANON_KEY)
  };
}

/** Sign in with email and password. Returns { ok } or { ok:false, error }. */
export async function signIn(email, password) {
  if (!email || !password) return { ok: false, error: 'Enter your email and password.' };
  let res;
  try {
    res = await fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim(), password })
    });
  } catch (e) {
    return { ok: false, error: 'Could not reach the sign-in service. Check the connection.' };
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* non-JSON error page */ }

  if (!res.ok) {
    // Supabase returns 400 for bad credentials and 422 for a malformed request.
    const msg = body?.error_description || body?.msg || body?.message || '';
    if (/invalid login credentials/i.test(msg)) return { ok: false, error: 'That email and password do not match an account.' };
    if (/email not confirmed/i.test(msg)) return { ok: false, error: 'That account has not been confirmed yet. Check the invitation email.' };
    if (res.status === 404 || /not found/i.test(msg)) {
      return { ok: false, error: 'Sign-in is not enabled on this Supabase project yet. ' +
                                 'Enable Email auth and create the NAC staff users.' };
    }
    return { ok: false, error: msg || ('Sign-in failed (HTTP ' + res.status + ').') };
  }
  if (!body?.access_token) return { ok: false, error: 'Sign-in returned no token.' };

  store({
    access_token: body.access_token,
    refresh_token: body.refresh_token || null,
    expires_at: body.expires_at || (Math.floor(Date.now() / 1000) + (body.expires_in || 3600)),
    user: { id: body.user?.id || null, email: body.user?.email || String(email).trim() }
  });
  return { ok: true, email: body.user?.email || String(email).trim() };
}

export async function signOut() {
  const s = currentSession();
  clearSession();
  if (!s) return { ok: true };
  try {
    await fetch(SUPA_URL + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + s.access_token }
    });
  } catch (e) { /* the local session is already gone, which is what matters */ }
  return { ok: true };
}

/**
 * Guard an internal page.
 *
 * Renders a sign-in screen over the page and RESOLVES ONLY once a NAC user is
 * signed in. The guarded page's own scripts run after that, so an unsigned
 * visitor never sees customer, pricing or design information.
 */
export function requireSignIn({ pageName = 'this page' } = {}) {
  if (isSignedIn()) { keepSessionAlive(); return Promise.resolve(currentSession()); }

  // Expired on the way in, but renewable: an iPad opened the next morning has
  // an hour-old access token and a refresh token that is still good. Renewing
  // before putting the sign-in screen up is the difference between opening the
  // app and typing a password every morning.
  const held = storedSession();
  if (held && held.refresh_token) {
    return refreshSession().then((fresh) => {
      if (fresh) { keepSessionAlive(); return fresh; }
      return signInScreen({ pageName });
    });
  }
  return signInScreen({ pageName });
}

function signInScreen({ pageName }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'nac-signin';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Sign in to NAC');
    host.innerHTML = `
      <style>
        #nac-signin{position:fixed;inset:0;z-index:2147483647;background:#0c0c24;
          display:flex;align-items:center;justify-content:center;padding:20px;
          font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fff}
        #nac-signin .card{width:100%;max-width:380px;background:#14162a;border:1px solid #2b2f4a;
          border-radius:8px;padding:26px}
        #nac-signin h2{margin:0 0 4px;font-size:20px;letter-spacing:-.01em}
        #nac-signin .mark{display:inline-block;width:20px;height:5px;background:#F5C200;
          vertical-align:middle;margin-right:9px;transform:translateY(-5px)}
        #nac-signin p{margin:0 0 18px;color:#aeb4c8;font-size:13.5px}
        #nac-signin label{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;
          color:#828aa3;margin:14px 0 5px}
        #nac-signin input{width:100%;padding:12px;font-size:16px;border-radius:4px;
          border:1px solid #2b2f4a;background:#0f1124;color:#fff;min-height:46px}
        #nac-signin input:focus-visible{outline:2px solid #F5C200;outline-offset:1px}
        #nac-signin button{width:100%;margin-top:20px;padding:14px;font-size:15px;font-weight:600;
          border:0;border-radius:4px;background:#F5C200;color:#0c0c24;cursor:pointer;min-height:48px}
        #nac-signin button[disabled]{opacity:.6;cursor:default}
        #nac-signin .err{margin-top:14px;padding:10px 12px;border-radius:4px;background:#3a1815;
          color:#ff8e86;font-size:13px;display:none}
        #nac-signin .err.on{display:block}
        #nac-signin .foot{margin-top:16px;font-size:12px;color:#6c7288}
      </style>
      <form class="card" novalidate>
        <h2><span class="mark"></span>NAC staff sign-in</h2>
        <p>${pageName} holds customer, pricing and design information.</p>
        <label for="nac-email">Email</label>
        <input id="nac-email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" required>
        <label for="nac-pass">Password</label>
        <input id="nac-pass" type="password" autocomplete="current-password" required>
        <button type="submit" id="nac-go">Sign in</button>
        <div class="err" id="nac-err" role="alert"></div>
        <div class="foot">NAC Electrical Air &amp; Refrigeration</div>
      </form>`;
    // ── NOTHING BEHIND THE GATE IS READABLE ───────────────────────────
    //
    // Nick: "An unauthenticated user attempting to open an NAC internal page
    // should not gain access to customer, pricing or design information."
    //
    // The overlay covers the page on screen, but the page behind it was still
    // in the accessibility tree and still in innerText — a screen reader on
    // the sign-in screen read the whole shell out, and anything a page had
    // already put in the DOM was there to be read. None of these pages loads
    // data before this resolves, so what was exposed was labels; it is still
    // the wrong default, and one rule fixes it for every screen at once.
    const lock = document.createElement('style');
    lock.id = 'nac-signin-lock';
    lock.textContent = 'body > *:not(#nac-signin){visibility:hidden!important}';
    document.head.appendChild(lock);
    document.body.appendChild(host);

    const form = host.querySelector('form');
    const err = host.querySelector('#nac-err');
    const go = host.querySelector('#nac-go');
    host.querySelector('#nac-email').focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.remove('on');
      go.disabled = true; go.textContent = 'Signing in…';
      const r = await signIn(host.querySelector('#nac-email').value,
                            host.querySelector('#nac-pass').value);
      if (r.ok) {
        host.remove();
        document.getElementById('nac-signin-lock')?.remove();
        keepSessionAlive();
        resolve(currentSession());
        return;
      }
      err.textContent = r.error;
      err.classList.add('on');
      go.disabled = false; go.textContent = 'Sign in';
      host.querySelector('#nac-pass').select();
    });
  });
}
