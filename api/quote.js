// ─────────────────────────────────────────────────────────────────────────────
// One function, five endpoints.
//
// Vercel turns every file in /api into its own Serverless Function, and the
// plan this project deploys on allows twelve. Adding the quote endpoints took
// the count to sixteen, and every deployment since has failed to build — which
// is why nothing after 15 September ever reached production.
//
// So the five quote and presentation endpoints live in /server, where Vercel
// does not treat them as functions, and this one function dispatches to them.
// The public URLs are unchanged: vercel.json rewrites /api/quote-view and the
// rest to this file with ?nac_fn= naming which one. Query strings, method and
// body all survive a rewrite, so each handler sees exactly the request it saw
// before.
//
// tests/api-function-budget.test.mjs keeps the count under the limit and keeps
// this table and vercel.json honest.
// ─────────────────────────────────────────────────────────────────────────────

// The largest limit of any endpoint behind this one: presentation-media takes a
// phone original plus three web copies, base64-inflated.
export const config = { api: { bodyParser: { sizeLimit: '34mb' } } };

// Static specifiers, so the bundler traces them and ships them with the
// function. A dynamic path built from user input would not be traced, and would
// also be a way to reach files that are not endpoints.
const ROUTES = {
  'quote-view': () => import('../server/quote-view.js'),
  'quote-issue': () => import('../server/quote-issue.js'),
  'quote-respond': () => import('../server/quote-respond.js'),
  'presentation-content': () => import('../server/presentation-content.js'),
  'presentation-media': () => import('../server/presentation-media.js')
};

function requestedName(req) {
  const q = req.query && req.query.nac_fn;
  if (typeof q === 'string' && q) return q;
  if (Array.isArray(q) && typeof q[0] === 'string') return q[0];
  // Falls back to the raw URL if the platform has not parsed the query for us.
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
  // The handlers behind this never asked for a dispatch parameter.
  if (req.query && 'nac_fn' in req.query) delete req.query.nac_fn;
  const mod = await load();
  // `.default` is the handler whether the file is ESM or CommonJS.
  return mod.default(req, res);
}
