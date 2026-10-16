// ─────────────────────────────────────────────────────────────────────────────
// CREATE THE SERVICEM8 JOB
//
// Called once, by quote-respond, the moment a customer accepts. Nick: "so it's
// set up without having to do anything manually."
//
// THREE RULES, in order of how much they matter.
//
// 1. THE ACCEPTANCE COMES FIRST. If ServiceM8 is down, slow, or rejects
//    something, the customer still accepted. Their acceptance is already
//    written before this runs, and nothing here can undo it or make the page
//    show them an error. The failure is recorded on the issue so NAC sees it
//    in the portal and can retry — it is never the customer's problem.
//
// 2. ONE ACCEPTANCE, ONE JOB. A retry, a replayed request or a second browser
//    must not produce a second job in ServiceM8. The issue record carries what
//    was created; if a job is already on it, this does nothing.
//
// 3. NOTHING IS INVENTED. The mapping (designer/engines/servicem8-job.mjs)
//    refuses rather than posting a job with no address or no customer. A job
//    ServiceM8 accepts but nobody can work from is worse than no job.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const API = 'https://api.servicem8.com/api_1.0/';

/**
 * ServiceM8 returns the new record's UUID in a header, not the body.
 * Both spellings have been seen in the wild, so both are read.
 */
function newUuid(res) {
  const h = res && res.headers;
  if (!h) return null;
  const get = typeof h.get === 'function' ? (k) => h.get(k) : (k) => h[k];
  return get('x-record-uuid') || get('X-Record-UUID') || null;
}

async function post(path, body, key, fetchImpl) {
  const r = await fetchImpl(API + path, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, uuid: newUuid(r), text };
}

async function get(path, key, fetchImpl) {
  const r = await fetchImpl(API + path, {
    headers: { 'X-Api-Key': key, Accept: 'application/json' }
  });
  const text = await r.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { ok: r.ok, status: r.status, json, text };
}

/** base64 out of a data URI, without dragging the prefix along. */
function dataUriBytes(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) return null;
  try {
    return m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  } catch (e) { return null; }
}

/**
 * Find an existing client by name and address before making another one.
 *
 * ServiceM8 will happily hold four "Sarah Whitlock"s, and an office that has
 * to work out which one is the real one every time is the manual work this is
 * supposed to remove.
 */
async function findCompany(company, key, fetchImpl) {
  const name = String(company.name || '').replace(/'/g, "''");
  if (!name) return null;
  const r = await get("company.json?$filter=name eq '" + encodeURIComponent(name) + "'",
    key, fetchImpl);
  if (!r.ok || !Array.isArray(r.json) || !r.json.length) return null;
  const addr = String(company.address || '').trim().toLowerCase();
  // Same name AND same address is the same customer. Same name alone is not.
  const exact = r.json.find(c => String(c.address || '').trim().toLowerCase() === addr);
  return exact ? exact.uuid : null;
}

/**
 * @param {object} plan   from buildJobPlan()
 * @returns {Promise<{ok:boolean, jobUuid?:string, generatedJobId?:string, …}>}
 */
async function createJob(plan, { key, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!key) return { ok: false, reason: 'no_api_key',
    message: 'SERVICEM8_API_KEY is not set on the server, so no job was created.' };
  const steps = [];
  const note = (what, r) => { steps.push({ what, status: r.status, ok: r.ok }); return r; };

  try {
    // 1 ── the client
    let companyUuid = await findCompany(plan.company, key, fetchImpl);
    if (companyUuid) steps.push({ what: 'company.matched', status: 200, ok: true });
    else {
      const r = note('company.create', await post('company.json', plan.company, key, fetchImpl));
      if (!r.ok || !r.uuid) {
        return { ok: false, reason: 'company_failed', steps,
          message: 'ServiceM8 would not create the client record.' };
      }
      companyUuid = r.uuid;
    }

    // 2 ── the contact. A job without one is a job nobody can ring.
    const contact = await post('companycontact.json',
      { ...plan.contact, company_uuid: companyUuid }, key, fetchImpl);
    note('contact.create', contact);

    // 3 ── the job
    const job = note('job.create',
      await post('job.json', { ...plan.job, company_uuid: companyUuid }, key, fetchImpl));
    if (!job.ok || !job.uuid) {
      return { ok: false, reason: 'job_failed', steps, companyUuid,
        message: 'The client was created but ServiceM8 would not create the job.' };
    }

    // 4 ── the line items
    for (const m of plan.materials) {
      note('material:' + m.name, await post('jobmaterial.json', {
        job_uuid: job.uuid, name: m.name, qty: m.quantity,
        price: m.priceIncGst, cost: 0, displayed_amount: m.priceIncGst
      }, key, fetchImpl));
    }

    // 5 ── the signature, attached where the office expects to find it
    for (const att of plan.attachments) {
      const bytes = dataUriBytes(att.dataUrl);
      if (!bytes) continue;
      const meta = note('attachment:' + att.kind, await post('attachment.json', {
        related_object: 'job', related_object_uuid: job.uuid,
        attachment_name: att.fileName, file_type: '.png', active: 1
      }, key, fetchImpl));
      if (!meta.ok || !meta.uuid) continue;
      // The bytes go to a second URL. A metadata record with no file behind it
      // shows in ServiceM8 as a broken paperclip, so a failure here is noted.
      const up = await fetchImpl(API + 'Attachment/' + meta.uuid + '.file', {
        method: 'POST',
        headers: { 'X-Api-Key': key, 'Content-Type': att.contentType },
        body: bytes
      });
      steps.push({ what: 'attachment.bytes:' + att.kind, status: up.status, ok: up.ok });
    }

    // 6 ── the job number a human can read, for the portal and the office
    let generatedJobId = null;
    const back = await get('job/' + job.uuid + '.json', key, fetchImpl);
    if (back.ok && back.json) generatedJobId = back.json.generated_job_id || null;

    return { ok: true, jobUuid: job.uuid, companyUuid, generatedJobId,
             contactUuid: contact.uuid || null,
             materialCount: plan.materials.length,
             attachmentCount: plan.attachments.length,
             createdAt: new Date().toISOString(), steps };
  } catch (e) {
    // The acceptance is already saved. This never throws into the customer's
    // request; it reports, and NAC retries from the portal.
    return { ok: false, reason: 'upstream_unavailable', steps,
      message: 'ServiceM8 could not be reached.' };
  }
}

module.exports = { createJob, newUuid, dataUriBytes, findCompany, API };
