// ─────────────────────────────────────────────────────────────────────────────
// POST /api/quote-issue
//
// THE PIECE THAT WAS MISSING. The quote presentation — the gate, the content
// library, the reviews, the terms, the customer page — was all built, and
// nothing ever called issuePresentation(). There was no way to send one. Every
// quote the tool produced still went out as the old sign.html link.
//
// This mints the link. A signed-in NAC user posts a design id, the customer,
// and the systems on offer; the presentation is built and gated HERE, on the
// server, with the service-role key; and what comes back is a token and a URL.
//
// Nick: "Do not expose service-role keys or other private credentials to the
// browser." The key is read from the environment, used for the lookups and the
// insert, and never appears in a response, a log line or an error message.
//
// Nick: "If a technical or pricing gate blocks the quote, do not publish a
// customer presentation." The gate runs before anything is written, so a
// blocked quote produces no token at all — there is nothing to leak or revoke.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';
const SUPA_URL = 'https://' + SUPA_HOST;
// The PUBLIC key, used only to ask Supabase who the caller is.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';

const SETTINGS_KEY = 'nac_hvac_settings_v1';

function supa(path, { method = 'GET', key, body = null, prefer = null } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: SUPA_HOST, path, method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
    }
  };
  return new Promise((resolve, reject) => {
    const r = https.request(options, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** NAC staff only. Issuing a quote is not something a link can do. */
async function signedInStaff(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return null;
  try {
    const r = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const user = await r.json().catch(() => null);
    return user?.id ? (user.email || user.id) : null;
  } catch (e) {
    return null;
  }
}

const str = (v) => (v === null || v === undefined) ? '' : String(v);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const issuedBy = await signedInStaff(req);
  if (!issuedBy) {
    return res.status(401).json({ error: 'sign_in_required',
      message: 'NAC staff sign-in is required to issue a quote.' });
  }

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  const body = req.body || {};
  const designId = str(body.designId).trim();
  if (!designId) return res.status(400).json({ error: 'design_required' });

  try {
    const [share, presentationMod] = await Promise.all([
      import('../designer/engines/presentation-share.mjs'),
      import('../designer/engines/presentation.mjs')
    ]);

    // ── Everything the presentation is built from, server-side ─────────────
    const [designRes, contentRes, settingsRes] = await Promise.all([
      supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(designId) + '&select=data&limit=1',
        { key: KEY }),
      supa('/rest/v1/nac_presentation_content?key=eq.library&select=data&limit=1', { key: KEY }),
      supa('/rest/v1/nac_settings?key=eq.' + SETTINGS_KEY + '&select=value&limit=1', { key: KEY })
    ]);

    const designRow = Array.isArray(designRes.body) ? designRes.body[0] : null;
    const design = designRow && (designRow.data?.design || designRow.data);
    if (!design) return res.status(404).json({ error: 'design_not_found' });

    const contentRow = Array.isArray(contentRes.body) ? contentRes.body[0] : null;
    const content = (contentRow && contentRow.data) || {};

    let settings = {};
    try {
      const srow = Array.isArray(settingsRes.body) ? settingsRes.body[0] : null;
      const raw = srow && srow.value;
      settings = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    } catch (e) { settings = {}; }

    const customer = body.customer || design.customer || {};
    const job = body.job || design.job || {};
    const quoteRevision = Number(body.quoteRevision) || 1;
    const validDays = Number(body.validDays) || 30;
    const systemOptions = Array.isArray(body.systemOptions) && body.systemOptions.length
      ? body.systemOptions : null;

    // ── THE GATE RUNS BEFORE ANYTHING IS WRITTEN ───────────────────────────
    // Built as it will be SENT, not as a draft, so every check that only bites
    // on issue bites here — the credentials, the commercial terms, the
    // customer's own details.
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + validDays * 86400000).toISOString();
    const built = presentationMod.buildPresentation({
      design, customer, job, content, settings,
      proposalNumber: str(body.proposalNumber),
      preparedAt: issuedAt, expiresAt,
      revision: quoteRevision,
      status: 'issued',
      selectedOptionIds: body.selectedOptionIds || [],
      privacy: body.privacy || {},
      intro: str(body.intro),
      heroImage: content.heroImage || null,
      systemOptions,
      chosenSystemId: str(body.chosenSystemId) || null
    });

    if (!built.ok) {
      return res.status(409).json({
        error: 'blocked',
        message: 'This quote cannot be issued yet.',
        blockers: (built.blockers || []).map(b => ({ code: b.code, message: b.message }))
      });
    }

    // The structural audit is the last line of defence on the way out, and it
    // runs here too — a quote that would fail it when a customer opened the
    // link should never have been issued in the first place.
    const audit = presentationMod.auditPresentation(built.presentation);
    if (!audit.ok) {
      return res.status(409).json({ error: 'audit_failed',
        message: 'The proposal did not pass its own audit and was not issued.' });
    }

    const issue = share.issuePresentation({
      designId, quoteRevision, validDays, issuedBy,
      selectedOptionIds: body.selectedOptionIds || [],
      supersedes: str(body.supersedes) || null,
      now: issuedAt
    });
    // What the issue has to remember beyond the token: who it is for, and what
    // was on offer. The design is loaded fresh on every view, so the quote
    // follows the job — but the CHOICE the customer was given does not change
    // because somebody edited a design afterwards.
    const record = {
      ...issue,
      customer, job,
      proposalNumber: str(body.proposalNumber),
      intro: str(body.intro),
      privacy: body.privacy || {},
      systemOptions,
      chosenSystemId: str(body.chosenSystemId) || null,
      totalIncGst: built.presentation.investment?.totalIncGst ?? null
    };

    const ins = await supa('/rest/v1/nac_quote_issues', {
      method: 'POST', key: KEY, prefer: 'return=minimal',
      body: {
        token: record.token,
        design_id: designId,
        quote_rev: quoteRevision,
        status: record.status,
        issued_at: issuedAt,
        expires_at: record.expiresAt,
        data: record,
        updated_at: issuedAt
      }
    });
    if (ins.status >= 300) {
      // The one failure worth naming precisely, because it is the outstanding
      // deployment step rather than a fault in the request.
      const missingTable = ins.status === 404
        || /nac_quote_issues/.test(JSON.stringify(ins.body || '')) && ins.status === 400;
      return res.status(502).json({
        error: missingTable ? 'issues_table_missing' : 'store_failed',
        message: missingTable
          ? 'The quote could not be stored: nac_quote_issues does not exist yet. Apply '
            + 'designer/quote-presentation-schema.sql — DEPLOYMENT.md, Part 1.'
          : 'The quote could not be stored.'
      });
    }

    const base = str(body.baseUrl).replace(/\/+$/, '') || 'https://nac-quote-tool.vercel.app';
    return res.status(200).json({
      ok: true,
      token: record.token,
      url: base + '/quote.html#' + record.token,
      expiresAt: record.expiresAt,
      quoteRevision,
      totalIncGst: record.totalIncGst
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
