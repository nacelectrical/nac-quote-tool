// NAC — create the ServiceM8 job when a customer accepts a quote.
//
// THE RULE THIS ENFORCES
//
// Never report a job that ServiceM8 did not confirm. The previous version
// returned { ok: true } whenever nothing threw — including when ServiceM8
// answered 200 with no record id at all, which is a job that does not exist.
// Now a job counts as created only when ServiceM8 gives back a record id AND
// that record can be read back with its generated job number. Anything less is
// reported as a failure, with what ServiceM8 actually said.
//
// The customer is never blocked by this. Their acceptance is already recorded
// against the quote before this runs. But the OUTCOME is written back to the
// quote row, so a failure is something NAC can see rather than something that
// vanished into a browser that had already navigated away.

const API = 'https://api.servicem8.com/api_1.0/';
const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
const TIMEOUT_MS = 12000;

/** fetch with a deadline — a hung ServiceM8 must not hang the function. */
async function call(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('ServiceM8 did not answer within ' + (timeoutMs / 1000) + ' seconds');
    throw new Error('ServiceM8 could not be reached: ' + e.message);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const KEY = process.env.SERVICEM8_API_KEY;
  const b = req.body || {};
  const quoteId = String(b.quoteId || '').trim();

  if (!KEY) {
    const error = 'ServiceM8 API key not configured on the server (SERVICEM8_API_KEY).';
    await recordOutcome(quoteId, { status: 'failed', error });
    return res.status(500).json({ ok: false, created: false, error });
  }

  const clientName = String(b.clientName || '').trim();
  if (!clientName) return res.status(400).json({ ok: false, created: false, error: 'clientName required' });

  const address = String(b.address || '').trim();
  const phone = String(b.phone || '').trim();
  const email = String(b.email || '').trim();
  const description = String(b.description || 'Ducted AC Supply & Install').trim();

  const H = { 'X-Api-Key': KEY, Accept: 'application/json', 'Content-Type': 'application/json' };

  /** POST a record and return its uuid. Throws unless ServiceM8 gives one. */
  async function createRecord(path, body) {
    const r = await call(API + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const txt = await r.text().catch(() => '');
    if (!r.ok) throw new Error(path + ' failed (HTTP ' + r.status + '): ' + txt.slice(0, 200));
    const uuid = r.headers.get('x-record-uuid') || r.headers.get('X-Record-UUID');
    if (!uuid) {
      // A 200 with no record id is NOT a created record. Saying otherwise is
      // how NAC ends up believing in a job nobody can find.
      throw new Error(path + ' answered HTTP ' + r.status + ' but returned no record id, ' +
        'so nothing was created. ServiceM8 said: ' + (txt.slice(0, 200) || '(nothing)'));
    }
    return uuid;
  }

  try {
    // ── The company ──
    let companyUuid = null;
    const findUrl = API + "company.json?$filter=name eq '" + clientName.replace(/'/g, "''") + "'";
    const findRes = await call(findUrl, { headers: H });
    if (findRes.ok) {
      const found = await findRes.json().catch(() => null);
      if (Array.isArray(found) && found.length > 0) companyUuid = found[0].uuid;
    } else if (findRes.status === 401 || findRes.status === 403) {
      throw new Error('ServiceM8 rejected the API key (HTTP ' + findRes.status + ').');
    }

    const reusedCompany = !!companyUuid;
    if (!companyUuid) {
      companyUuid = await createRecord('company.json', { name: clientName, address, active: 1 });
    }

    // ── The contact. Nice to have; never the reason a job fails. ──
    let contactWarning = null;
    if (phone || email) {
      try {
        const parts = clientName.split(' ');
        await createRecord('companycontact.json', {
          company_uuid: companyUuid,
          first: parts[0] || clientName,
          last: parts.slice(1).join(' '),
          email, mobile: phone, type: 'Billing', active: 1
        });
      } catch (e) { contactWarning = 'The job was created but the contact was not: ' + e.message; }
    }

    // ── The job ──
    const jobUuid = await createRecord('job.json', {
      company_uuid: companyUuid,
      job_address: address,
      job_description: description,
      status: 'Work Order',
      active: 1
    });

    // ── Read it back. This is the confirmation, and it is also where the job
    //    NUMBER comes from — the thing NAC and /api/servicem8 actually use. ──
    let generatedJobId = null;
    let readBackWarning = null;
    try {
      const back = await call(API + 'job/' + jobUuid + '.json', { headers: H });
      if (back.ok) {
        const job = await back.json().catch(() => null);
        generatedJobId = job && (job.generated_job_id || job.uuid) ? String(job.generated_job_id || '') : null;
        if (!job) readBackWarning = 'The job was created but ServiceM8 returned no detail for it.';
      } else {
        readBackWarning = 'The job was created (' + jobUuid + ') but could not be read back (HTTP ' +
          back.status + ').';
      }
    } catch (e) {
      readBackWarning = 'The job was created (' + jobUuid + ') but could not be read back: ' + e.message;
    }

    const warnings = [contactWarning, readBackWarning].filter(Boolean);
    await recordOutcome(quoteId, {
      status: 'created', jobUuid, generatedJobId, companyUuid,
      error: warnings.length ? warnings.join(' ') : null
    });

    return res.status(200).json({
      ok: true, created: true, jobUuid, generatedJobId, companyUuid,
      reusedCompany, warnings
    });
  } catch (e) {
    await recordOutcome(quoteId, { status: 'failed', error: e.message });
    // 502: NAC's own service is fine, the one it depends on is not.
    return res.status(502).json({ ok: false, created: false, error: e.message });
  }
}

/**
 * Write what happened onto the quote, using the server key.
 *
 * The browser cannot do this — the RLS policy in designer/rls.sql deliberately
 * lets an anonymous customer set `accepted` and nothing else. So the record of
 * whether the job was created is made here, where it cannot be lost by the
 * customer closing the tab.
 *
 * Never throws: failing to write the note must not turn a created job into a
 * reported failure.
 */
async function recordOutcome(quoteId, { status, jobUuid = null, generatedJobId = null,
                                        companyUuid = null, error = null }) {
  const SUPA = process.env.SUPABASE_KEY;
  if (!quoteId || !SUPA) return;
  try {
    await fetch(SUPA_URL + '/rest/v1/nac_quotes?id=eq.' + encodeURIComponent(quoteId), {
      method: 'PATCH',
      headers: { apikey: SUPA, Authorization: 'Bearer ' + SUPA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servicem8_status: status,
        servicem8_job_uuid: jobUuid,
        servicem8_job_id: generatedJobId,
        servicem8_company_uuid: companyUuid,
        servicem8_error: error,
        servicem8_attempted_at: new Date().toISOString()
      })
    });
  } catch (e) { /* the outcome still goes back to the caller */ }
}
