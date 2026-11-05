// ─────────────────────────────────────────────────────────────────────────────
// POST /api/quote-outreach — RECORDING WHAT NAC ACTUALLY DID WITH A LINK
//
// Nick, 4 November 2026: "Clearly distinguish a copied link from a message
// successfully sent." And: "Record a manual send... Allow manual pause and
// resume."
//
// This application sends nothing. What it can do is remember, honestly, what
// happened: that a link went on a clipboard, that Nick says he sent it and how,
// that the customer wrote back, that Nick has taken it over, that the customer
// asked not to be chased again.
//
// The distinction is the whole point. Following up a quote nobody sent is the
// worst version of a follow-up — the customer gets "just checking you saw my
// quote" for a quote they never got — so copying a link is recorded as copying
// a link and never as sending one.
//
// It writes onto the ISSUE row (nac_quote_issues.data.outreach) rather than the
// frozen offer inside it. The offer a customer was sent cannot change; what NAC
// did about it is a separate record that keeps growing.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();

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
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** NAC staff only. What NAC did about a quote is NAC's record. */
async function signedInStaff(req) {
  const auth = str(req.headers?.authorization || req.headers?.Authorization);
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return null;
  try {
    const r = await fetch('https://' + SUPA_HOST + '/auth/v1/user',
      { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const user = await r.json().catch(() => null);
    return user?.id ? (user.email || user.id) : null;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const by = await signedInStaff(req);
  if (!by) return res.status(401).json({ error: 'sign_in_required' });

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  const body = req.body || {};
  const token = trimmed(body.token);
  const action = trimmed(body.action);
  if (!token) return res.status(400).json({ error: 'token_required' });

  const podium = await import('../designer/engines/podium.mjs');
  const ALLOWED = [podium.OUTREACH.LINK_COPIED, podium.OUTREACH.SENT_MANUALLY,
                   podium.OUTREACH.CUSTOMER_REPLIED, podium.OUTREACH.TAKEN_OVER,
                   podium.OUTREACH.OPTED_OUT, 'resume'];
  if (!ALLOWED.includes(action)) {
    return res.status(400).json({ error: 'unknown_action',
      message: 'Not something that can be recorded. One of: ' + ALLOWED.join(', ') + '.' });
  }

  try {
    const r = await supa('/rest/v1/nac_quote_issues?token=eq.' + encodeURIComponent(token)
      + '&select=token,status,expires_at,data&limit=1', { key: KEY });
    const row = Array.isArray(r.body) ? r.body[0] : null;
    if (!row) return res.status(404).json({ error: 'not_found' });

    const data = row.data || {};
    let outreach;
    if (action === 'resume') {
      const out = podium.resumeOutreach(data.outreach, { by });
      if (!out.ok) {
        // An opt-out is not something to resume. Refused, with the reason.
        return res.status(409).json({ error: out.reason, message: out.message });
      }
      outreach = out.outreach;
    } else {
      outreach = podium.recordOutreach(data.outreach, {
        state: action, by,
        channel: trimmed(body.channel),
        note: trimmed(body.note)
      });
    }

    const patched = await supa('/rest/v1/nac_quote_issues?token=eq.'
      + encodeURIComponent(token), { key: KEY, method: 'PATCH',
        prefer: 'return=representation',
        body: { data: { ...data, outreach }, updated_at: new Date().toISOString() } });

    // ── SAY SAVED ONLY WHEN IT IS SAVED ────────────────────────────────────
    // Nick: "Report success only after the database confirms it was saved."
    const wrote = Array.isArray(patched.body) ? patched.body.length : 0;
    if (patched.status >= 300 || wrote === 0) {
      return res.status(502).json({ error: 'not_recorded',
        message: 'That was NOT recorded — the database did not confirm the write. '
          + 'Nothing has been changed; try again.' });
    }

    const follow = podium.followUpState(
      { status: row.status, expiresAt: row.expires_at, supersededBy: data.supersededBy },
      outreach, {});

    return res.status(200).json({ ok: true, outreach, followUp: follow,
      // So nobody reads a recorded send as a sent message.
      automaticSending: podium.AUTOMATIC_SENDING,
      schedulingOwner: podium.SCHEDULING_OWNER });
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unavailable' });
  }
};
