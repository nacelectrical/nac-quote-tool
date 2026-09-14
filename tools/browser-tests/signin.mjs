// The internal pages are behind a sign-in gate (designer/auth.mjs), so a test
// that just navigates to one waits forever on the sign-in screen. This seeds a
// session before any page script runs, which is what a signed-in NAC user has.
//
// It does NOT test the gate — tools/browser-tests/auth-gate.mjs does that, by
// deliberately not calling this.
export const TEST_SESSION = {
  access_token: 'test-access-token',
  refresh_token: null,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'test-user', email: 'nick@nacelectrical.com.au' }
};

/** Seed the session into every page opened in this context. */
export async function signInContext(ctx, session = TEST_SESSION) {
  await ctx.addInitScript((s) => {
    try { localStorage.setItem('nac_session_v1', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }, session);
}
