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

const { DESIGN_SELECT, parseDesign, designUpdatedAt } = require('./design-row.js');

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
    const [share, presentationMod, offerMod] = await Promise.all([
      import('../designer/engines/presentation-share.mjs'),
      import('../designer/engines/presentation.mjs'),
      import('../designer/engines/issued-offer.mjs')
    ]);

    // ── Everything the presentation is built from, server-side ─────────────
    const [designRes, contentRes, settingsRes] = await Promise.all([
      // ── THE COLUMN IS `design`, AND IT IS TEXT ──────────────────────────
      //
      // nac_designs (designer/schema.sql) has `design text not null` holding
      // the DuctDesign as a JSON STRING, which is what store.mjs saveDesign
      // writes. This endpoint asked for a column called `data`, which exists
      // in neither schema.sql nor production-setup.sql — so against the real
      // database every attempt to issue a quote failed, and no quote has ever
      // been issued from the live site.
      supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(designId)
        + '&select=' + DESIGN_SELECT + '&limit=1', { key: KEY }),
      supa('/rest/v1/nac_presentation_content?key=eq.library&select=data,updated_at&limit=1', { key: KEY }),
      supa('/rest/v1/nac_settings?key=eq.' + SETTINGS_KEY + '&select=value,updated_at&limit=1', { key: KEY })
    ]);

    const designRow = Array.isArray(designRes.body) ? designRes.body[0] : null;
    const design = parseDesign(designRow);
    if (!design) return res.status(404).json({ error: 'design_not_found' });

    const contentRow = Array.isArray(contentRes.body) ? contentRes.body[0] : null;
    const content = (contentRow && contentRow.data) || {};
    const settingsRow0 = Array.isArray(settingsRes.body) ? settingsRes.body[0] : null;

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

    // ── FREEZE THE OFFER ───────────────────────────────────────────────────
    //
    // The customer may choose between the systems on the page, so the document
    // is built once for EACH of them, here, while the design and the prices
    // are the ones this quote is being issued on. From this point nothing
    // downstream reads the design, the content library or the settings again.
    //
    // Every alternative goes through the same gate and the same audit as the
    // one on screen. An option that would fail either is not something a
    // customer should be able to select their way into.
    const presentations = {};
    if (systemOptions && systemOptions.length) {
      for (const opt of systemOptions) {
        const id = str(opt && opt.id).trim();
        if (!id) continue;
        const alt = (id === str(body.chosenSystemId).trim()) ? built : presentationMod.buildPresentation({
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
          chosenSystemId: id
        });
        if (!alt.ok) {
          return res.status(409).json({
            error: 'blocked',
            message: 'This quote cannot be issued: the "' + (opt.label || id)
              + '" option does not pass the publish gate.',
            blockers: (alt.blockers || []).map(b => ({ code: b.code, message: b.message }))
          });
        }
        if (!presentationMod.auditPresentation(alt.presentation).ok) {
          return res.status(409).json({ error: 'audit_failed',
            message: 'The "' + (opt.label || id) + '" option did not pass its own audit.' });
        }
        presentations[id] = alt.presentation;
      }
    }
    if (!Object.keys(presentations).length) {
      presentations[offerMod.SINGLE_SYSTEM] = built.presentation;
    }

    const frozen = offerMod.freezeOffer({
      presentations,
      defaultSystemId: str(body.chosenSystemId).trim() || offerMod.SINGLE_SYSTEM,
      gstRate: Number(design.commercials && design.commercials.gstRate) || 0.1,
      issuedAt,
      source: {
        designId,
        designUpdatedAt: designUpdatedAt(designRow),
        contentUpdatedAt: contentRow && (contentRow.updated_at || null),
        settingsUpdatedAt: settingsRow0 && (settingsRow0.updated_at || null),
        termsVersion: settings.commercial && settings.commercial.terms
          && settings.commercial.terms.termsVersion || null
      }
    });
    if (!frozen.ok) {
      return res.status(500).json({ error: 'offer_not_frozen', message: frozen.message });
    }

    const issue = share.issuePresentation({
      designId, quoteRevision, validDays, issuedBy,
      selectedOptionIds: body.selectedOptionIds || [],
      supersedes: str(body.supersedes) || null,
      now: issuedAt
    });
    // What the issue remembers: who it is for, and THE OFFER ITSELF. The
    // frozen documents travel with the issue, so a later edit to the design or
    // to the content library cannot reach a quote that has already gone out.
    // Changing what a customer was offered means issuing a new revision.
    const record = {
      ...issue,
      customer, job,
      proposalNumber: str(body.proposalNumber),
      intro: str(body.intro),
      privacy: body.privacy || {},
      systemOptions,
      chosenSystemId: str(body.chosenSystemId).trim() || frozen.offer.defaultSystemId,
      offer: frozen.offer,
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
