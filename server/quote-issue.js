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

/**
 * The GST rate this offer is frozen at.
 *
 * It comes from the costing that produced the price (design.commercials), and
 * falls back to the commercial settings — the same figure the settings screen
 * writes. Only when neither carries a number at all is the statutory 10% used,
 * and that is a default, not an assumption about NAC's registration.
 *
 * Read with a null check rather than `||`, because a configured 0 is a real
 * answer and `Number(0) || 0.1` turns it into ten per cent.
 */
function gstRateOf(design, settings) {
  for (const v of [design && design.commercials && design.commercials.gstRate,
                   settings && settings.commercial && settings.commercial.gstRate]) {
    if (v === null || v === undefined || v === '') continue;
    const x = Number(v);
    if (Number.isFinite(x) && x >= 0 && x < 1) return x;
  }
  return 0.1;
}

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

    // ── THE PRICE ON THE SCREEN MUST BE THE PRICE IN THE SAVED DESIGN ──────
    //
    // buildPresentation takes the system options from the REQUEST when it is
    // given any, and falls back to the design only when it is not. So the
    // figure a customer is quoted for the designed unit comes off the
    // estimator's screen, and the saved design is never consulted. A screen
    // left open while the design was recosted — in another tab, on the iPad,
    // by somebody else — issues the old number, and nothing notices.
    //
    // The alternatives are a different matter: a Braemar is meant to cost
    // something other than the Daikin that was designed, and its price is the
    // estimator's to set. Only the option that IS the designed unit has a
    // figure the design can check, so only that one is reconciled.
    //
    // This refuses rather than silently preferring one number over the other.
    // Either figure could be the right one, and the application does not get
    // to decide which; the estimator reloads and issues again.
    const designedSell = Number(design.commercials && design.commercials.sellPriceIncGst);
    const designedModel = str(design.selectedUnit && design.selectedUnit.model).trim().toLowerCase();
    if (systemOptions && Number.isFinite(designedSell) && designedModel) {
      for (const opt of systemOptions) {
        if (str(opt && opt.model).trim().toLowerCase() !== designedModel) continue;
        const asked = Number(opt.priceIncGst);
        if (!Number.isFinite(asked)) continue;
        if (Math.round(asked * 100) !== Math.round(designedSell * 100)) {
          return res.status(409).json({
            error: 'price_mismatch',
            message: 'This screen is offering ' + (opt.model || 'the designed system') + ' at $'
              + asked.toFixed(2) + ', and the saved design prices it at $' + designedSell.toFixed(2)
              + '. Reload the job and issue again so the customer is quoted the current figure.',
            screenPriceIncGst: Math.round(asked * 100) / 100,
            designPriceIncGst: Math.round(designedSell * 100) / 100
          });
        }
      }
    }

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
      // ── A CONFIGURED 0% IS NOT 10% ────────────────────────────────────
      // `Number(x) || 0.1` reads a legitimately configured zero rate as
      // falsy and silently replaces it with ten per cent. The rate on the
      // offer is the rate the costing actually used; it is only defaulted
      // when there is genuinely nothing on file.
      gstRate: gstRateOf(design, settings),
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

    // ── THE PREVIOUS REVISION IS CLOSED, NOT OVERWRITTEN ───────────────────
    //
    // supersede() has been in presentation-share.mjs since revisions were
    // designed, and NOTHING CALLED IT. `supersedes` was recorded on the new
    // issue and the old link went on serving its own offer as though it were
    // current — two live links to the same job at two different prices, and
    // either could be accepted.
    //
    // The old issue is marked and pointed forward. Its offer, its totals, its
    // acceptance and its audit trail are left exactly as they were: an
    // archived revision is evidence of what was offered, and a customer who
    // follows an old link is sent to the current one rather than shown an
    // error.
    //
    // An ACCEPTED issue is never relabelled — supersede() keeps its status, so
    // a signed acceptance survives a later revision being issued.
    let superseded = null;
    const prevToken = str(body.supersedes).trim();
    if (prevToken) {
      const prevRes = await supa('/rest/v1/nac_quote_issues?token=eq.'
        + encodeURIComponent(prevToken) + '&select=data&limit=1', { key: KEY });
      const prevRow = Array.isArray(prevRes.body) ? prevRes.body[0] : null;
      if (prevRow && prevRow.data) {
        const { previous } = share.supersede(prevRow.data, record);
        const patched = await supa('/rest/v1/nac_quote_issues?token=eq.'
          + encodeURIComponent(prevToken), {
            method: 'PATCH', key: KEY,
            body: { data: previous, status: previous.status,
                    updated_at: new Date().toISOString() }
          });
        superseded = {
          token: prevToken,
          status: previous.status,
          // Said plainly, because "superseded" and "still accepted" are
          // different outcomes and NAC needs to know which one happened.
          note: previous.status === 'accepted'
            ? 'The previous revision had already been accepted and keeps that status. '
              + 'Its acceptance record is unchanged.'
            : 'The previous link now points customers at this revision.',
          ok: patched.status < 300
        };
      } else {
        superseded = { token: prevToken, status: null, ok: false,
          note: 'The previous revision could not be found, so nothing was superseded.' };
      }
    }

    const base = str(body.baseUrl).replace(/\/+$/, '') || 'https://nac-quote-tool.vercel.app';
    return res.status(200).json({
      ok: true,
      token: record.token,
      url: base + '/quote.html#' + record.token,
      expiresAt: record.expiresAt,
      quoteRevision,
      gstRate: frozen.offer.gstRate,
      totalIncGst: record.totalIncGst,
      superseded
    });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
