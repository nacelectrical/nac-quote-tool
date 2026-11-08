// ─────────────────────────────────────────────────────────────────────────────
// /api/ops — THE OPERATIONS SURFACE NAC'S AI OPS ASSISTANT CALLS IN ON
//
// Nick, 4 November 2026: "I also have an AI operations assistant... Inspect any
// supplied assistant code or documentation first. Its current capabilities and
// access are not yet confirmed."
//
// NOTHING ABOUT THE ASSISTANT IS ASSUMED HERE. No assistant code or
// documentation was supplied — there is none in this repository — so this is
// only the half NAC owns: a documented, authenticated surface that an assistant
// (or Podium, or anything else NAC authorises) calls IN on. This application
// never calls out. There is no assistant client, no assistant endpoint and no
// assistant credential anywhere in it.
//
// ── WHAT IS LIVE AND WHAT IS NOT ────────────────────────────────────────────
//
// NOT LIVE. `NAC_OPS_KEYS` is unset, so every call here answers 503
// `integration_not_configured`. That is the honest state: no key has been
// issued, nothing has been connected, and no claim is being made that it works
// against a real assistant. What IS proven is the surface itself, against a
// real database, in tests/ops-surface-db.test.mjs.
//
// ── THE THREE CONTROLS THAT CANNOT BE ARGUED WITH ───────────────────────────
//
//   1. Nick approves the exact revision, in the application. There is no
//      approve operation here at all, and an approval is bound to a
//      fingerprint of the offer, so it cannot travel to a changed one.
//   2. No price comes in from outside. Every money field is refused by name.
//   3. An accepted or declined offer is not changed by an integration.
//
// ── CREDENTIALS ─────────────────────────────────────────────────────────────
//
// Keys live in `NAC_OPS_KEYS`, server-side environment configuration only.
// They are never sent to a browser, never logged, never echoed in a response,
// and compared with a timing-safe comparison. The service-role key is read
// from `SUPABASE_KEY` exactly as every other server endpoint reads it and goes
// nowhere near a response body.
//
// Each key carries only the scopes its integration needs. A delivery key
// cannot open a draft; a read key cannot write one; no key at all can approve.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');
const crypto = require('crypto');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';
const SETTINGS_KEY = 'nac_hvac_settings_v1';
const CALLS_TABLE = 'nac_integration_calls';

const str = (v) => (v === null || v === undefined) ? '' : String(v);
const trimmed = (v) => str(v).trim();

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

// ── THE KEYS ────────────────────────────────────────────────────────────────

/**
 * Integration keys, from server-side environment configuration.
 *
 * NAC_OPS_KEYS is a JSON array:
 *
 *   [{ "id": "ops-assistant", "name": "NAC AI ops assistant",
 *      "secret": "<long random string>",
 *      "scopes": ["enquiry:write","quote:read","quote:write",
 *                 "approval:request","delivery:read","booking:write"] }]
 *
 * Unset, or empty, and the whole surface is off. That is deliberate: this is
 * not a flag to be flipped because the code looks ready, it is off because
 * nobody has issued a key yet.
 */
function configuredKeys() {
  const raw = trimmed(process.env.NAC_OPS_KEYS);
  if (!raw) return [];
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { return []; }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .filter(k => k && trimmed(k.id) && trimmed(k.secret))
    .map(k => ({
      id: trimmed(k.id),
      name: trimmed(k.name) || trimmed(k.id),
      secret: String(k.secret),
      scopes: Array.isArray(k.scopes) ? k.scopes.map(trimmed).filter(Boolean) : []
    }));
}

/** Constant-time, so a wrong key cannot be narrowed down by how long it took. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    // Still compare something of equal length, so the length does not leak
    // through the timing either.
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

/** The key this request carries, or null. Never returns the secret. */
function presentedKey(req, keys) {
  const auth = str(req.headers?.authorization || req.headers?.Authorization);
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const header = str(req.headers?.['x-nac-ops-key']);
  const offered = trimmed(bearer || header);
  if (!offered) return null;
  for (const k of keys) {
    if (sameSecret(offered, k.secret)) return { id: k.id, name: k.name, scopes: k.scopes };
  }
  return null;
}

// ── THE CALL LOG, WHICH IS ALSO THE IDEMPOTENCY RECORD ──────────────────────

/**
 * Is the call log there?
 *
 * designer/ops-integration-schema.sql creates it. Until somebody applies that
 * migration, every operation that CHANGES something is refused — writing
 * without the record that makes a retry safe is how an integration ends up
 * with two customers, two drafts and two booking tasks. Reads are unaffected.
 */
async function callLogPresent(key) {
  const r = await supa('/rest/v1/' + CALLS_TABLE + '?select=id&limit=1', { key });
  return r.status === 200;
}

async function readCall(key, id) {
  const r = await supa('/rest/v1/' + CALLS_TABLE + '?id=eq.' + encodeURIComponent(id)
    + '&select=id,operation,request_hash,status,result,refusals&limit=1', { key });
  const row = Array.isArray(r.body) ? r.body[0] : null;
  return row || null;
}

async function writeCall(key, rec) {
  await supa('/rest/v1/' + CALLS_TABLE, { key, method: 'POST', body: rec,
    prefer: 'resolution=merge-duplicates,return=minimal' });
}

// ── STORAGE ─────────────────────────────────────────────────────────────────

const { DESIGN_SELECT, parseDesign, designUpdatedAt } = require('./design-row.js');

async function loadDraft(key, quoteId) {
  const r = await supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(quoteId)
    + '&select=' + DESIGN_SELECT + '&limit=1', { key });
  const row = Array.isArray(r.body) ? r.body[0] : null;
  return { row, draft: parseDesign(row), updatedAt: designUpdatedAt(row) };
}

async function saveDraft(key, quoteId, draft) {
  const now = new Date().toISOString();
  const r = await supa('/rest/v1/nac_designs', { key, method: 'POST',
    body: { id: quoteId, design: JSON.stringify({ ...draft, updatedAt: now }),
            updated_at: now },
    prefer: 'resolution=merge-duplicates,return=minimal' });
  return r.status >= 200 && r.status < 300;
}

async function loadContent(key) {
  const r = await supa('/rest/v1/nac_presentation_content?key=eq.library'
    + '&select=data&limit=1', { key });
  const row = Array.isArray(r.body) ? r.body[0] : null;
  return (row && row.data) || {};
}

async function loadSettings(key) {
  const r = await supa('/rest/v1/nac_settings?key=eq.' + SETTINGS_KEY
    + '&select=value&limit=1', { key });
  const row = Array.isArray(r.body) ? r.body[0] : null;
  const raw = row && row.value;
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
  catch (e) { return {}; }
}

/** Every issue of one quote, newest revision first. */
async function loadIssues(key, quoteId) {
  const r = await supa('/rest/v1/nac_quote_issues?design_id=eq.'
    + encodeURIComponent(quoteId)
    + '&select=token,quote_rev,status,issued_at,expires_at,responded_at,data', { key });
  const rows = Array.isArray(r.body) ? r.body : [];
  return rows.sort((a, b) => Number(b.quote_rev || 0) - Number(a.quote_rev || 0));
}

/** An id a person can read in a list, and that two calls cannot collide on. */
function readableId(prefix, label) {
  const slug = trimmed(label).toUpperCase().replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 28);
  const tail = crypto.randomBytes(3).toString('hex').toUpperCase();
  return prefix + '-' + (slug || 'NEW') + '-' + tail;
}

// ── THE OPERATIONS ──────────────────────────────────────────────────────────
//
// Each returns { status, body }. None of them returns a supplier cost, a
// margin, a markup, a job fee or an internal note: an integration coordinates
// the job, and what it may read is what a customer may read plus the status
// NAC needs to act on.

async function opEnquiryFindOrCreate(ctx) {
  const { key, body, ops } = ctx;
  const enquiry = {
    name: trimmed(body.name), phone: trimmed(body.phone), email: trimmed(body.email),
    siteAddress: trimmed(body.siteAddress) || trimmed(body.address)
  };
  if (!enquiry.name && !enquiry.phone && !enquiry.email) {
    return { status: 400, body: { error: 'enquiry_empty',
      message: 'An enquiry needs at least a name, a phone number or an email address.' } };
  }

  const cres = await supa('/rest/v1/nac_customers?select=id,name,email,phone,address',
    { key });
  if (cres.status !== 200) {
    return { status: 503, body: { error: 'customer_records_unavailable',
      message: 'NAC’s customer records are not reachable. '
        + 'designer/crm-schema.sql may not have been applied to this project yet.' } };
  }
  const customers = Array.isArray(cres.body) ? cres.body : [];
  const match = ops.matchCustomer(enquiry, customers);

  let customerId = match.customer?.id || null;
  let created = false;
  if (!customerId) {
    customerId = readableId('CUS', enquiry.name || enquiry.phone);
    const ins = await supa('/rest/v1/nac_customers', { key, method: 'POST',
      body: { id: customerId, name: enquiry.name || enquiry.phone || enquiry.email,
              email: enquiry.email || null, phone: enquiry.phone || null,
              address: enquiry.siteAddress || null,
              notes: trimmed(body.note) || null },
      prefer: 'return=minimal' });
    if (ins.status >= 300) {
      return { status: 502, body: { error: 'customer_not_created',
        message: 'The customer record could not be written. Nothing was changed.' } };
    }
    created = true;
  }

  // One job per site. A second system at the same house is the same job; a
  // second property is a second job.
  const jres = await supa('/rest/v1/nac_jobs?customer_id=eq.'
    + encodeURIComponent(customerId) + '&select=id,site_address,status', { key });
  const jobs = Array.isArray(jres.body) ? jres.body : [];
  const same = (a, b) => trimmed(a).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    === trimmed(b).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let job = jobs.find(j => enquiry.siteAddress && same(j.site_address, enquiry.siteAddress))
    || (!enquiry.siteAddress ? jobs.find(j => j.status === 'open') : null);
  let jobCreated = false;
  if (!job) {
    const jobId = readableId('JOB', enquiry.siteAddress || enquiry.name);
    const ins = await supa('/rest/v1/nac_jobs', { key, method: 'POST',
      body: { id: jobId, customer_id: customerId,
              site_address: enquiry.siteAddress || null,
              description: trimmed(body.source)
                ? ('Enquiry via ' + trimmed(body.source)) : 'Air conditioning enquiry',
              notes: trimmed(body.note) || null, status: 'open' },
      prefer: 'return=minimal' });
    if (ins.status >= 300) {
      return { status: 502, body: { error: 'job_not_created',
        message: 'The job record could not be written.' } };
    }
    job = { id: jobId };
    jobCreated = true;
  }

  return { status: 200, body: {
    customerId, jobId: job.id,
    created: created || jobCreated,
    matchedOn: match.matchedOn,
    // So an assistant can say something true about what it just did.
    note: created ? 'A new customer record was opened.'
      : 'An existing customer was matched on ' + match.matchedOn + '.'
  } };
}

async function opAttachPlan(ctx) {
  const { key, body, draftMod } = ctx;
  const jobId = trimmed(body.jobId);
  if (!jobId) return { status: 400, body: { error: 'job_required' } };

  const jres = await supa('/rest/v1/nac_jobs?id=eq.' + encodeURIComponent(jobId)
    + '&select=id,customer_id,site_address', { key });
  const job = Array.isArray(jres.body) ? jres.body[0] : null;
  if (!job) return { status: 404, body: { error: 'job_not_found' } };

  // The plan lives on the job's draft quote, because that is what reads it.
  // A job with no draft yet gets one; a job with one keeps it.
  const dres = await supa('/rest/v1/nac_designs?job_ref=eq.' + encodeURIComponent(jobId)
    + '&select=' + DESIGN_SELECT + '&limit=1', { key });
  let row = Array.isArray(dres.body) ? dres.body[0] : null;
  let draft = parseDesign(row);
  let quoteId = row?.id || null;

  if (!draft) {
    quoteId = readableId('Q', job.site_address || jobId);
    draft = draftMod.createQuoteDraft({ id: quoteId, siteAddress: job.site_address || '' });
  }

  // A PLAN REFERENCE, NOT A PLAN. What comes in is where the file is and what
  // is printed on it; the file itself is uploaded through the application, so
  // an integration cannot push megabytes of base64 through this surface and
  // cannot replace a plan an estimator has already read.
  const plan = body.plan || {};
  const next = draftMod.normaliseQuoteDraft({
    ...draft,
    plan: {
      ...(draft.plan || {}),
      name: trimmed(plan.name) || draft.plan?.name || '',
      mediaType: trimmed(plan.mediaType) || draft.plan?.mediaType || '',
      src: trimmed(plan.src) || draft.plan?.src || '',
      page: Number(plan.page) || draft.plan?.page || 1,
      notes: trimmed(plan.notes) || draft.plan?.notes || '',
      // Printed dimensions only. Nothing here derives a scale, and nothing
      // here may: Nick, "Never derive scale from cars, furniture or guessed
      // objects." An estimator confirms the scale in the application.
      printedFloorAreaSqM: Number(plan.printedFloorAreaSqM) || draft.plan?.printedFloorAreaSqM || null
    },
    siteNotes: trimmed(body.siteNotes) || draft.siteNotes || ''
  });

  const ok = await saveDraft(key, quoteId, next);
  if (!ok) return { status: 502, body: { error: 'not_saved' } };
  // Link the draft to the job if it was not linked already.
  await supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(quoteId),
    { key, method: 'PATCH', body: { job_ref: jobId, customer_id: job.customer_id } });

  return { status: 200, body: { jobId, quoteId, planAttached: true,
    note: 'The plan reference is on the draft. An estimator reads it, confirms the '
      + 'scale and corrects the rooms in the application.' } };
}

async function opCreateDraft(ctx) {
  const { key, body, draftMod } = ctx;
  const jobId = trimmed(body.jobId);
  if (!jobId) return { status: 400, body: { error: 'job_required' } };
  const jres = await supa('/rest/v1/nac_jobs?id=eq.' + encodeURIComponent(jobId)
    + '&select=id,customer_id,site_address', { key });
  const job = Array.isArray(jres.body) ? jres.body[0] : null;
  if (!job) return { status: 404, body: { error: 'job_not_found' } };

  let customer = body.customer || {};
  if (job.customer_id) {
    const cres = await supa('/rest/v1/nac_customers?id=eq.'
      + encodeURIComponent(job.customer_id) + '&select=name,email,phone,address&limit=1',
      { key });
    const c = Array.isArray(cres.body) ? cres.body[0] : null;
    if (c) customer = { name: c.name, email: c.email, phone: c.phone, address: c.address };
  }

  const quoteId = readableId('Q', job.site_address || jobId);
  const draft = draftMod.createQuoteDraft({
    id: quoteId,
    customer,
    siteAddress: trimmed(body.siteAddress) || job.site_address || '',
    proposalNumber: trimmed(body.proposalNumber),
    createdBy: ctx.integration.id
  });
  const ok = await saveDraft(key, quoteId, draft);
  if (!ok) return { status: 502, body: { error: 'not_saved' } };
  await supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(quoteId),
    { key, method: 'PATCH', body: { job_ref: jobId, customer_id: job.customer_id } });

  // NO EQUIPMENT AND NO PRICE. A draft opened by an integration is an empty
  // one: the systems, the models and the figures are the estimator's, out of
  // NAC's catalogue, in the application.
  return { status: 200, body: { quoteId, revision: 1, status: 'draft',
    note: 'An empty draft. Equipment and prices are set in the quote tool.' } };
}

/** What an integration is allowed to change on a draft. */
const PATCHABLE = ['siteAddress', 'siteNotes', 'summary', 'scope', 'rooms', 'sizing',
                   'inclusions', 'exclusions', 'customer', 'proposalNumber', 'plan'];

async function opUpdateDraft(ctx) {
  const { key, body, draftMod } = ctx;
  const quoteId = trimmed(body.quoteId);
  const { draft } = await loadDraft(key, quoteId);
  if (!draft) return { status: 404, body: { error: 'quote_not_found' } };

  const patch = body.patch || {};
  const applied = [];
  const refused = [];
  const next = { ...draft };
  for (const field of Object.keys(patch)) {
    if (PATCHABLE.includes(field)) { next[field] = patch[field]; applied.push(field); }
    else refused.push({ field, reason: 'not_patchable_by_integration' });
  }
  if (!applied.length) {
    return { status: 400, body: { error: 'nothing_to_change', refused,
      message: 'None of those fields is one an integration sets. It may change: '
        + PATCHABLE.join(', ') + '.' } };
  }

  const ok = await saveDraft(key, quoteId, draftMod.normaliseQuoteDraft(next));
  if (!ok) return { status: 502, body: { error: 'not_saved' } };
  return { status: 200, body: { quoteId, updated: applied, refused } };
}

async function opSizing(ctx) {
  const { key, body } = ctx;
  const quoteId = trimmed(body.quoteId);
  const { draft } = await loadDraft(key, quoteId);
  if (!draft) return { status: 404, body: { error: 'quote_not_found' } };

  const [sizingMod, settingsMod] = await Promise.all([
    import('../designer/engines/plan-sizing.mjs'),
    import('../designer/engines/settings.mjs')
  ]);
  // mergeSettings(base, override) — NAC's stored settings laid over the
  // defaults. Called with one argument it returns the stored row alone, which
  // has no `load` section at all and throws the moment a rule is read.
  const settings = settingsMod.mergeSettings(settingsMod.DEFAULT_SETTINGS,
    await loadSettings(key));
  const sizing = sizingMod.preliminarySizing(draft.rooms || [], {
    settings,
    method: draft.sizing?.method,
    ceilingHeightMm: draft.sizing?.ceilingHeightMm,
    override: draft.sizing?.override
  });
  const readiness = sizingMod.sizingReadiness(sizing);

  // EVERY FIGURE SAYS WHAT IT IS. Nick: "Do not present these rules as a
  // detailed engineering calculation or manufacturer performance data."
  return { status: 200, body: {
    quoteId,
    totalConditionedAreaSqM: sizing.totalConditionedAreaSqM,
    roomCount: sizing.roomCount,
    recommendedKw: sizing.recommendedKw,
    method: sizing.method,
    methodLabel: sizing.methodLabel,
    isEstimate: true,
    airflow: sizing.airflow,
    assumptions: sizing.assumptions,
    unmeasured: sizing.unmeasured,
    excluded: sizing.excluded,
    ready: readiness.ready,
    notes: readiness.notes,
    disclaimer: 'A preliminary estimate from ' + sizing.methodLabel
      + '. It is not a load calculation and it is not manufacturer performance data. '
      + 'An installer confirms it on site.'
  } };
}

async function opOptions(ctx) {
  const { key, body, draftMod } = ctx;
  const quoteId = trimmed(body.quoteId);
  const { draft } = await loadDraft(key, quoteId);
  if (!draft) return { status: 404, body: { error: 'quote_not_found' } };
  const content = await loadContent(key);
  const upgrades = content.upgrades || [];
  const source = draftMod.draftToQuoteSource(draft, { upgrades });

  // CUSTOMER PRICES ONLY. No supplier cost, no margin, no markup, no job fee.
  return { status: 200, body: {
    quoteId,
    currency: 'AUD', gstInclusive: true,
    chosenSystemId: draft.chosenSystemId || null,
    options: (source.systemOptions || []).map(o => ({
      id: o.id, brand: o.brand, model: o.model, outdoorModel: o.outdoorModel,
      capacityKw: o.capacityKw, phase: o.phase, priceIncGst: o.priceIncGst,
      warrantyYears: o.warrantyYears, recommended: !!o.recommended, note: o.note
    })),
    upgrades: (upgrades.filter(u => u && u.enabled !== false)).map(u => ({
      id: u.id, title: u.title, priceIncGst: u.priceIncGst ?? null,
      unitPriceIncGst: u.unitPriceIncGst ?? null, unitLabel: u.unitLabel || null,
      selected: (draft.selectedUpgradeIds || []).includes(u.id)
    })),
    controller: draft.controller?.name || draft.controller?.id
      ? { name: draft.controller.name || null, zones: draft.controller.zones ?? null,
          included: draft.controller.includedInPrice !== false }
      : null
  } };
}

async function opPreview(ctx) {
  const { key, body, draftMod } = ctx;
  const quoteId = trimmed(body.quoteId);
  const { draft } = await loadDraft(key, quoteId);
  if (!draft) return { status: 404, body: { error: 'quote_not_found' } };
  const content = await loadContent(key);
  const gate = draftMod.quoteDraftGate(draft, { upgrades: content.upgrades || [] });
  const chosen = draftMod.chosenSystem(draft);

  return { status: 200, body: {
    quoteId,
    canIssue: gate.ok,
    missing: gate.blockers.map(b => ({ code: b.code, message: b.message })),
    summary: {
      customer: trimmed(draft.customer?.name) || null,
      siteAddress: trimmed(draft.siteAddress) || null,
      system: chosen ? [chosen.brand, chosen.model].filter(Boolean).join(' ') : null,
      capacityKw: chosen?.capacityKw ?? null,
      priceIncGst: chosen?.priceIncGst ?? null,
      optionCount: (draft.systems || []).length
    },
    note: gate.ok
      ? 'Ready for Nick to approve. An integration cannot approve it.'
      : 'Not ready. The missing items above are the estimator’s to fill in.'
  } };
}

async function opRequestApproval(ctx) {
  const { key, body, draftMod, ops } = ctx;
  const quoteId = trimmed(body.quoteId);
  const { draft } = await loadDraft(key, quoteId);
  if (!draft) return { status: 404, body: { error: 'quote_not_found' } };
  const content = await loadContent(key);
  const gate = draftMod.quoteDraftGate(draft, { upgrades: content.upgrades || [] });

  const fingerprint = ops.draftOfferFingerprint(draft, 0);
  const at = new Date().toISOString();
  const next = draftMod.normaliseQuoteDraft({ ...draft });
  // Stored on the draft, so it shows up in NAC's own quote list. THIS DOES NOT
  // APPROVE ANYTHING: the state is 'requested', and only Nick ticking the
  // approval in the application moves it on.
  next.approvalRequest = {
    state: 'requested', at, by: ctx.integration.id,
    note: trimmed(body.note) || '', fingerprint,
    ready: gate.ok
  };
  const ok = await saveDraft(key, quoteId, next);
  if (!ok) return { status: 502, body: { error: 'not_saved' } };

  return { status: 200, body: { quoteId, fingerprint, state: 'requested', ready: gate.ok,
    event: 'quote.approval_requested',
    note: 'Nick has been asked to approve this revision, in the quote tool. '
      + 'Requesting approval is not approving it.' } };
}

async function opApprovedLink(ctx) {
  const { key, body } = ctx;
  const quoteId = trimmed(body.quoteId);
  const issues = await loadIssues(key, quoteId);
  const latest = issues[0] || null;
  if (!latest) {
    return { status: 409, body: { error: 'NOT_ISSUED',
      message: 'This quote has not been issued, so there is no customer link.' } };
  }
  const data = latest.data || {};
  const approvedBy = trimmed(data.approvedBy || data.offer?.approvedBy);
  if (!approvedBy) {
    return { status: 409, body: { error: 'NOT_APPROVED',
      message: 'The issued revision does not carry an approval. '
        + 'Nick approves it in the application.' } };
  }
  if (latest.status !== 'issued' && latest.status !== 'opened') {
    return { status: 409, body: { error: 'NOT_DELIVERABLE',
      message: 'Revision ' + latest.quote_rev + ' is ' + latest.status
        + '. There is nothing to deliver.' } };
  }

  const base = trimmed(process.env.NAC_PUBLIC_BASE_URL) || 'https://nac-quote-tool.vercel.app';
  return { status: 200, body: {
    quoteId, revision: latest.quote_rev,
    // The token is in the FRAGMENT, exactly as quote-issue mints it, so it
    // does not travel in a request line or into anybody's access log.
    url: base + '/quote.html#' + latest.token,
    expiresAt: latest.expires_at || null,
    approvedBy,
    // The token IS the link, so it is never logged. The call log below records
    // which revision was handed over, not the token.
    note: 'Deliver this link through Podium. This application sends nothing.'
  } };
}

/**
 * ── WHAT IS AT EACH STAGE, FOR THE ASSISTANT'S BRIEFING ──────────────────
 *
 * Nick, 8 November 2026, on where the one dashboard should live.
 *
 * The ops assistant (nacelectrical/nac-ops-assistant) already builds the daily
 * briefing — it has the ServiceM8, Xero and Podium connectors, the push
 * notifications and a freshness model that refuses to say "nothing to do"
 * unless every source behind a section is fresh. It is the right place for the
 * one operating picture.
 *
 * What it cannot see is everything BEFORE a job exists: drafts being worked
 * on, quotes waiting on Nick's approval, issued revisions nobody has answered,
 * acceptances that have not become jobs. Those live in this application's
 * database and always will, because this application owns them.
 *
 * So this is the join: ONE read-only operation the assistant polls, answering
 * in the stage vocabulary both sides can share. It is deliberately a summary
 * and not a data dump —
 *
 *   · NO internal costs, margins, supplier prices or pricing method. The
 *     assistant has no business with NAC's commercial workings and the
 *     customer-facing total is the only money here.
 *   · NO customer contact details. The assistant reaches customers through
 *     Podium and ServiceM8, where their details already are.
 *   · Counts are NULL when a source could not be read, never 0 — the same
 *     rule the assistant's own briefing applies, so an unreadable source
 *     cannot become "nothing to do" on either side of the join.
 */
async function opQuoteBoard(ctx) {
  const { key, body } = ctx;
  const asked = Number(body && body.limit);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 200) : 50;
  const wf = await import('../designer/engines/workflow.mjs');

  // Issued and accepted, out of the frozen records. A read failure is NOT an
  // empty list: it is reported as unreadable and the assistant's section goes
  // stale rather than quiet.
  let issued = null;
  try {
    const r = await supa('/rest/v1/nac_quote_issues?select=token,design_id,quote_rev,'
      + 'status,issued_at,expires_at,responded_at,data&order=issued_at.desc&limit=200',
      { key });
    if (Array.isArray(r.body)) {
      issued = r.body.map(row => {
        const d = row.data || {};
        const a = d.acceptance || null;
        return {
          token: row.token, designId: row.design_id,
          revision: Number(row.quote_rev || 1),
          status: row.status,
          customerName: (d.customer || {}).name || null,
          siteAddress: (d.job || {}).siteAddress || null,
          issuedAt: row.issued_at, expiresAt: row.expires_at,
          acceptedAt: a ? a.acceptedAt || null : null,
          acceptedBy: a ? a.customerName || null : null,
          quotedTotalIncGst: d.totalIncGst ?? null,
          acceptedTotalIncGst: a ? a.totalIncGst ?? null : null,
          viewCount: d.viewCount ?? 0
        };
      });
    }
  } catch (e) { issued = null; }

  const board = wf.dashboard({ issued, drafts: null, enquiries: null,
                               handovers: null, approvals: null });

  const strip = (rows) => rows.map(r => ({
    ref: r.id, stage: r.kind, name: r.name, site: r.detail || null,
    ageDays: r.ageDays ?? null,
    totalIncGst: r.totalIncGst ?? null,
    totalSource: r.totalSource ?? null,
    action: r.action || null
  }));

  const panel = (p) => ({
    available: p.available,
    // THE COUNT IS THE TRUE TOTAL, always. `limit` truncates the list it
    // returns and never the number: a briefing that says "3 quotes waiting"
    // because the page size was 3 is a briefing that under-reports the week.
    count: p.count,                       // null when unreadable. Never 0 for unknown.
    items: p.available ? strip(p.rows.slice(0, limit)) : [],
    truncated: p.available ? p.rows.length > limit : false
  });

  return { status: 200, body: {
    generatedAt: board.generatedAt,
    source: 'NAC quote tool. Issued revisions and acceptance records only.',
    stages: {
      awaitingResponse: panel(board.panels.awaiting),
      accepted: panel(board.panels.accepted)
    },
    // Drafts and approvals are deliberately absent until this surface is
    // live: they are the most sensitive thing here, and shipping a field the
    // assistant cannot yet be trusted with is how it ends up relied upon.
    notYetExposed: ['draftsInProgress', 'awaitingOwnerApproval', 'handovers'],
    money: {
      awaitingResponseIncGst: board.money.issuedIncGst,
      acceptedIncGst: board.money.acceptedIncGst,
      note: board.money.source
    }
  } };
}

async function opStatus(ctx) {
  const { key, body } = ctx;
  const quoteId = trimmed(body.quoteId);
  const issues = await loadIssues(key, quoteId);
  if (!issues.length) {
    const { draft } = await loadDraft(key, quoteId);
    if (!draft) return { status: 404, body: { error: 'quote_not_found' } };
    return { status: 200, body: { quoteId, status: 'draft', revision: 0,
      selections: null, totalIncGst: null, events: [] } };
  }
  const latest = issues[0];
  const data = latest.data || {};
  const acc = data.acceptance || null;
  return { status: 200, body: {
    quoteId,
    status: latest.status,
    revision: latest.quote_rev,
    issuedAt: latest.issued_at || null,
    expiresAt: latest.expires_at || null,
    respondedAt: latest.responded_at || null,
    selections: acc ? {
      systemId: acc.selectedOptionId || acc.systemId || null,
      upgradeIds: acc.selectedUpgradeIds || acc.upgradeIds || [],
      totalIncGst: acc.totalIncGst ?? null
    } : null,
    totalIncGst: acc?.totalIncGst ?? data.totalIncGst ?? null,
    supersededBy: issues.length > 1 && latest.status === 'issued' ? null
      : (data.supersededBy || null),
    events: issues.map(i => ({ revision: i.quote_rev, status: i.status,
      at: i.responded_at || i.issued_at }))
  } };
}

async function opBookingTask(ctx) {
  const { key, body } = ctx;
  const quoteId = trimmed(body.quoteId);
  const issues = await loadIssues(key, quoteId);
  const accepted = issues.find(i => i.status === 'accepted');
  if (!accepted) {
    return { status: 409, body: { error: 'NOT_ACCEPTED',
      message: 'A booking task is the step after a customer accepts. '
        + 'No revision of this quote has been accepted.' } };
  }

  // The task is a record on NAC's job, not an outward action. Nothing is sent
  // to a customer and nothing is pushed into ServiceM8 from here: Nick,
  // "Keep real customer messaging and automatic scheduling disabled until
  // approved and tested."
  const dres = await supa('/rest/v1/nac_designs?id=eq.' + encodeURIComponent(quoteId)
    + '&select=id,job_ref,customer_id&limit=1', { key });
  const row = Array.isArray(dres.body) ? dres.body[0] : null;
  const jobRef = trimmed(row?.job_ref);
  const taskId = readableId('BOOK', quoteId);
  if (jobRef) {
    await supa('/rest/v1/nac_jobs?id=eq.' + encodeURIComponent(jobRef),
      { key, method: 'PATCH', body: { status: 'accepted',
        notes: 'Booking and deposit task ' + taskId + ' opened '
          + new Date().toISOString() + ' for accepted revision '
          + accepted.quote_rev + '.' } });
  }
  return { status: 200, body: { taskId, created: true, quoteId, jobId: jobRef || null,
    revision: accepted.quote_rev,
    note: 'Recorded for NAC to action. No customer message was sent and no '
      + 'ServiceM8 job was created from here.' } };
}

const HANDLERS = {
  'enquiry.find_or_create': opEnquiryFindOrCreate,
  'enquiry.attach_plan': opAttachPlan,
  'quote.create_draft': opCreateDraft,
  'quote.update_draft': opUpdateDraft,
  'quote.sizing': opSizing,
  'quote.options': opOptions,
  'quote.preview': opPreview,
  'quote.request_approval': opRequestApproval,
  'quote.approved_link': opApprovedLink,
  'quote.status': opStatus,
  'quote.board': opQuoteBoard,
  'booking.create_task': opBookingTask
};

// ── THE DISCOVERY DOCUMENT ──────────────────────────────────────────────────

function discovery(ops, podium, configured) {
  return {
    service: 'NAC quote tool operations surface',
    version: 1,
    live: false,
    configured,
    // Said plainly, because the alternative is somebody reading this as a
    // working integration.
    status: configured
      ? 'Keys are configured. Nothing has been verified against a real assistant.'
      : 'NOT CONFIGURED. No integration key has been issued, so every operation '
        + 'answers 503. This is the interface, not a live integration.',
    responsibilities: {
      'quote tool': 'Sizing, equipment options, pricing, proposal revisions, '
        + 'customer acceptance.',
      podium: 'Customer conversations and message delivery.',
      'ops assistant': 'Coordinating tasks, approvals, follow-ups, and the '
        + 'handover to the next business step.'
    },
    scopes: ops.SCOPES,
    operations: Object.fromEntries(Object.entries(ops.OPERATIONS).map(([name, op]) => [
      name, { scope: op.scope, mutates: op.mutates, summary: op.summary,
              takes: op.takes, returns: op.returns }
    ])),
    statusEvents: ops.STATUS_EVENTS,
    identifiers: podium.INTEGRATION_BOUNDARY.identifiers,
    controls: [
      'Nick approves the exact revision, in the application. There is no approve '
        + 'operation on this surface.',
      'An approval is bound to a fingerprint of the offer, so it does not travel '
        + 'to a changed one.',
      'Every money field is refused on the way in, by name.',
      'An accepted or declined offer is not changed by an integration.',
      'Anything that changes something requires an idempotencyKey, so a retry '
        + 'cannot duplicate a customer, a quote or a booking task.'
    ],
    automation: {
      enabled: ops.AUTOMATION_ENABLED,
      schedulingOwner: ops.SCHEDULING_OWNER,
      note: 'Follow-up scheduling has no owner yet. Confirm whether that is Podium '
        + 'or the assistant before anything automatic is turned on, or both will send.'
    },
    required: podium.INTEGRATION_BOUNDARY.required
  };
}

// ── THE HANDLER ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const [ops, podium, draftMod] = await Promise.all([
    import('../designer/engines/ops-api.mjs'),
    import('../designer/engines/podium.mjs'),
    import('../designer/engines/quote-draft.mjs')
  ]);

  const keys = configuredKeys();
  const integration = presentedKey(req, keys);

  // ── THE DISCOVERY DOCUMENT ────────────────────────────────────────────
  // Readable with an integration key, and — because it holds no customer,
  // pricing or design information at all, only the shape of the interface —
  // also readable by a signed-in NAC user so the integration page can show it.
  if (req.method === 'GET') {
    if (!integration) {
      const staff = await signedInStaff(req);
      if (!staff) return res.status(401).json({ error: 'unauthorised' });
    }
    return res.status(200).json(discovery(ops, podium, keys.length > 0));
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // ── NOT CONFIGURED MEANS NOT CONFIGURED ───────────────────────────────
  if (!keys.length) {
    return res.status(503).json({
      error: 'integration_not_configured',
      message: 'This surface is not connected to anything. No integration key has '
        + 'been issued. GET /api/ops describes the interface; see '
        + 'docs/ops-integration.md for the connection details still needed.',
      live: false
    });
  }
  if (!integration) {
    // No detail about why. A caller learns whether its key works, nothing more.
    return res.status(401).json({ error: 'unauthorised' });
  }

  const KEY = process.env.SUPABASE_KEY;
  if (!KEY) return res.status(500).json({ error: 'server_not_configured' });

  const body = req.body || {};
  const operation = trimmed(body.operation);

  const auth = ops.authorise(operation, integration);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, message: auth.message,
      ...(auth.needs ? { needs: auth.needs } : {}) });
  }
  const op = ops.OPERATIONS[operation];

  // ── WHAT IS ALREADY STORED, FOR THE GUARDS TO JUDGE ───────────────────
  const quoteId = trimmed(body.quoteId);
  let state = {};
  if (quoteId) {
    const [{ draft }, issues] = await Promise.all([
      loadDraft(KEY, quoteId), loadIssues(KEY, quoteId)
    ]);
    const latest = issues[0] || null;
    const answered = issues.find(i => i.status === 'accepted' || i.status === 'declined');
    state = {
      quote: draft ? {
        // The same shape the fingerprint is taken over, plus the status the
        // guards judge. ops.guard() re-derives the fingerprint from this, so
        // it has to be the draft as stored and nothing else.
        systems: draft.systems || [], chosenSystemId: draft.chosenSystemId || '',
        selectedUpgradeIds: draft.selectedUpgradeIds || [],
        upgradeQuantities: draft.upgradeQuantities || {},
        scope: draft.scope || {}, inclusions: draft.inclusions || [],
        exclusions: draft.exclusions || [], controller: draft.controller || {},
        revision: latest?.quote_rev || 0,
        status: answered ? answered.status : (latest ? latest.status : 'draft') } : null,
      issue: latest ? { token: latest.token, status: latest.status } : null,
      approval: latest?.data?.approvedBy
        ? { state: 'approved', by: latest.data.approvedBy,
            fingerprint: latest.data.offerFingerprint || null }
        : null
    };
  }

  const g = ops.guard(operation, body, state);
  if (!g.ok) {
    // ── A REFUSAL IS SOMETHING THAT HAPPENED ──────────────────────────
    //
    // Nick: "Record actions and failures so NAC can see what happened and
    // retry safely." Refusals used to return here without reaching the log,
    // so the one kind of call NAC most needs to see — the assistant being
    // told no, and why — was the one kind that left no trace.
    //
    // Under its own id, NOT the idempotency key's: a refused call has not
    // been carried out, so it must not consume the key. The caller fixes the
    // request and retries with the same key, exactly as they should.
    await writeCall(KEY, {
      id: integration.id + ':refused:' + ops.requestHash(operation, body),
      integration: integration.id, operation,
      request_hash: ops.requestHash(operation, body),
      status: 'refused', result: null, refusals: g.refusals,
      quote_id: trimmed(body.quoteId) || null
    }).catch(() => {});
    return res.status(409).json({ error: 'refused', refusals: g.refusals });
  }

  // ── A RETRY IS NOT A SECOND REQUEST ───────────────────────────────────
  const idemKey = trimmed(body.idempotencyKey);
  const recordId = integration.id + ':' + idemKey;
  const hash = ops.requestHash(operation, body);
  let logPresent = true;
  if (op.mutates) {
    logPresent = await callLogPresent(KEY);
    if (!logPresent) {
      return res.status(503).json({
        error: 'call_log_missing',
        message: 'The integration call log is not in this project, so a retry could '
          + 'not be told from a second request and this operation is refused. Apply '
          + 'designer/ops-integration-schema.sql.' });
    }
    const prior = await readCall(KEY, recordId);
    const replay = ops.replayOf(recordId, operation, hash,
      prior ? { [recordId]: { operation: prior.operation, requestHash: prior.request_hash,
                              result: prior.result } } : {});
    if (replay.conflict) {
      return res.status(409).json({ error: 'idempotency_key_reused',
        message: replay.message });
    }
    if (replay.replay) {
      res.setHeader('X-Nac-Replay', 'true');
      return res.status(200).json({ ...(replay.result || {}), replayed: true });
    }
  }

  // ── DO IT ─────────────────────────────────────────────────────────────
  let out;
  try {
    out = await HANDLERS[operation]({ key: KEY, body, ops, podium, draftMod, integration });
  } catch (e) {
    // The message, never the key, never the stack.
    out = { status: 500, body: { error: 'operation_failed',
      message: 'The operation did not complete and nothing was recorded as done.' } };
    if (op.mutates && logPresent) {
      await writeCall(KEY, { id: recordId, integration: integration.id, operation,
        request_hash: hash, status: 'failed', result: null,
        refusals: [{ code: 'FAILED', message: String(e && e.message || e).slice(0, 400) }],
        quote_id: quoteId || null }).catch(() => {});
    }
    return res.status(500).json(out.body);
  }

  if (op.mutates && logPresent) {
    await writeCall(KEY, {
      id: recordId, integration: integration.id, operation, request_hash: hash,
      status: out.status < 300 ? 'ok' : 'refused',
      result: out.status < 300 ? out.body : null,
      refusals: out.status < 300 ? null : [out.body],
      quote_id: trimmed(out.body?.quoteId) || quoteId || null,
      customer_id: trimmed(out.body?.customerId) || null
    }).catch(() => {});
  }

  return res.status(out.status).json(out.body);
};

/** A signed-in NAC user, for the discovery document only. */
async function signedInStaff(req) {
  const auth = str(req.headers?.authorization || req.headers?.Authorization);
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  if (!token) return null;
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljbnpuamh3eWJyeWl6YmRxcmd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjIxMDksImV4cCI6MjA5ODIzODEwOX0.Y1URSkilExecDYF1ux2q7Xnk0I5ooDjREK0DD9Ae9nw';
  try {
    const r = await fetch('https://' + SUPA_HOST + '/auth/v1/user',
      { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const user = await r.json().catch(() => null);
    return user?.id ? (user.email || user.id) : null;
  } catch (e) { return null; }
}
