// ─────────────────────────────────────────────────────────────────────────────
// The two deployment selftests, behind one function.
//
// Same reason as api/quote.js: /api is capped at twelve Serverless Functions,
// so the handlers live in /server and this file routes to them. /api/server-key
// -selftest and /api/servicem8-selftest still answer on their own URLs, via the
// rewrites in vercel.json.
//
// Neither selftest returns any part of a credential — see the contract tests in
// tests/server-key-selftest.test.mjs and tests/client-secrets.test.mjs. This
// file adds nothing to what they return.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTES = {
  'server-key': () => import('../server/server-key-selftest.js'),
  servicem8: () => import('../server/servicem8-selftest.js')
};

function requestedName(req) {
  const q = req.query && req.query.nac_fn;
  if (typeof q === 'string' && q) return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  const url = typeof req.url === 'string' ? req.url : '';
  const m = /[?&]nac_fn=([^&#]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

export default async function handler(req, res) {
  const name = requestedName(req);
  const load = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  if (!load) {
    res.status(404).json({ ok: false, error: 'unknown_endpoint' });
    return;
  }
  if (req.query && 'nac_fn' in req.query) delete req.query.nac_fn;
  const mod = await load();
  return mod.default(req, res);
}
