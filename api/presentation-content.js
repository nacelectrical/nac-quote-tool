// ─────────────────────────────────────────────────────────────────────────────
// GET / PUT /api/presentation-content
//
// The quote presentation content library: reviews, past installations, image
// assets, trust copy, upgrades, payment terms, terms and conditions.
//
// It lives behind the server for the same reason the issued quotes do — the
// table is readable only by the service role, so neither the admin screen nor
// a customer page ever holds a key that could read it directly.
//
// Writes are normalised through the content engine on the way in. That is not
// tidiness: it is what stops a hand-edited payload storing `approved: "false"`
// as a truthy string and publishing a review nobody approved.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https');
const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';

function supa(path, { method = 'GET', key, body = null, prefer = null } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    hostname: SUPA_HOST, path, method,
    headers: {
      apikey: key, Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json', Accept: 'application/json',
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
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', () => reject(new Error('upstream_unavailable')));
    if (payload) r.write(payload);
    r.end();
  });
}

/** Keep one library document rather than a row per record — it is small. */
const LIBRARY_KEY = 'library';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  try {
    if (req.method === 'GET') {
      const r = await supa('/rest/v1/nac_presentation_content?key=eq.'
        + LIBRARY_KEY + '&select=data&limit=1', { key: KEY });
      const row = Array.isArray(r.body) ? r.body[0] : null;
      return res.status(200).json({ content: (row && row.data) || {} });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const content = await import('../designer/engines/presentation-content.mjs');
      const incoming = (req.body && req.body.content) || {};

      // Normalise every collection through the engine. Anything the engine does
      // not know about is dropped rather than stored, so the library cannot
      // grow fields the publish rules have never been taught to check.
      const clean = {
        logo: typeof incoming.logo === 'string' ? incoming.logo : null,
        heroImage: incoming.heroImage || null,
        trust: content.normaliseTrust(incoming.trust || {}),
        reviews: (incoming.reviews || []).map(content.normaliseReview),
        installations: (incoming.installations || []).map(content.normaliseInstallation),
        images: (incoming.images || []).map(content.normaliseImageAsset),
        upgrades: (incoming.upgrades || []).map(content.normaliseUpgrade),
        standardInclusions: {
          commissioning: incoming.standardInclusions?.commissioning === true,
          wasteRemoval: incoming.standardInclusions?.wasteRemoval === true,
          wifi: incoming.standardInclusions?.wifi === true
        },
        paymentTerms: {
          depositPercent: num(incoming.paymentTerms?.depositPercent),
          depositAmount: num(incoming.paymentTerms?.depositAmount),
          depositInstructions: str(incoming.paymentTerms?.depositInstructions, 2000),
          validity: str(incoming.paymentTerms?.validity, 500),
          validDays: num(incoming.paymentTerms?.validDays),
          stages: (incoming.paymentTerms?.stages || []).slice(0, 8).map(s => ({
            label: str(s.label, 120), detail: str(s.detail, 400)
          })).filter(s => s.label)
        },
        aftercare: {
          commissioning: str(incoming.aftercare?.commissioning, 1000),
          filterCare: str(incoming.aftercare?.filterCare, 1000),
          servicing: str(incoming.aftercare?.servicing, 1000),
          support: str(incoming.aftercare?.support, 1000)
        },
        termsAndConditions: str(incoming.termsAndConditions, 40000),
        emailIntro: str(incoming.emailIntro, 4000),
        intro: str(incoming.intro, 4000),
        sectionOrder: Array.isArray(incoming.sectionOrder)
          ? incoming.sectionOrder.map(s => str(s, 40)).filter(Boolean).slice(0, 20) : [],
        hiddenSections: Array.isArray(incoming.hiddenSections)
          ? incoming.hiddenSections.map(s => str(s, 40)).filter(Boolean).slice(0, 20) : []
      };

      const r = await supa('/rest/v1/nac_presentation_content', {
        method: 'POST', key: KEY,
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: { key: LIBRARY_KEY, data: clean, updated_at: new Date().toISOString() }
      });
      if (r.status >= 400) return res.status(r.status).json({ error: 'write_failed' });
      return res.status(200).json({ ok: true, content: clean });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};

function str(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
