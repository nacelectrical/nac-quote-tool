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
  if (isSignedIn()) return Promise.resolve(currentSession());

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
      if (r.ok) { host.remove(); resolve(currentSession()); return; }
      err.textContent = r.error;
      err.classList.add('on');
      go.disabled = false; go.textContent = 'Sign in';
      host.querySelector('#nac-pass').select();
    });
  });
}
