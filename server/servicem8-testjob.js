// ─────────────────────────────────────────────────────────────────────────────
// POST /api/servicem8-testjob — PROVE THE WRITE PATH, ONCE, ON PURPOSE
//
// /api/servicem8-selftest is READ ONLY. It can tell you the key is accepted and
// that jobs and contacts can be read; it cannot tell you that a job can be
// CREATED, and creating one is the entire point of the integration. A key with
// read access passes every check in that file and still produces nothing when
// a customer accepts.
//
// So this creates one real job in NAC's real ServiceM8 account, through the
// SAME mapping and the SAME sending code a real acceptance uses — not a
// simplified version of it, because a test that exercises different code
// proves nothing about the code it is standing in for.
//
// THREE THINGS KEEP IT SAFE:
//
//   IT IS NEVER AUTOMATIC. Nothing calls this. A signed-in NAC user presses a
//   button, and that press is the consent — this writes to a live business
//   system and is not something to do on anybody's behalf.
//
//   IT IS UNMISTAKABLE. The client is named so nobody mistakes it for a
//   customer, the job carries a Quote status rather than Work Order so it
//   never looks like won work, and the description says in its first line
//   that it is a test and can be deleted.
//
//   IT TELLS YOU WHAT IT MADE. The job number comes back so it can be found
//   and removed, and so can the client record.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { requireStaff } = require('./staff-auth.js');
const { createJob } = require('./servicem8-job.js');

/** Unmistakable in a job list, and sorts together. */
const TEST_CLIENT = 'ZZ TEST — NAC Quote Tool (safe to delete)';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const who = await requireStaff(req, res, 'the ServiceM8 write test');
  if (!who) return;

  const key = process.env.SERVICEM8_API_KEY;
  if (!key) {
    return res.status(200).json({
      ok: false, reason: 'no_api_key',
      message: 'SERVICEM8_API_KEY is not set on this deployment, so nothing was created. '
        + 'Add it to the Vercel project environment variables (all environments) and '
        + 'redeploy — a variable added after a deploy does not reach the running '
        + 'functions until the next one.'
    });
  }

  try {
    const mapper = await import('../designer/engines/servicem8-job.mjs');

    // An accepted quote, shaped exactly as a real one is after acceptance, so
    // buildJobPlan() runs on the real thing. The numbers are obviously a test
    // and the description says so.
    const at = new Date().toISOString();
    const issue = {
      token: 'TESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTES',
      quoteRevision: 1, status: 'accepted',
      proposalNumber: 'NAC-TEST-' + at.slice(0, 10),
      customer: { name: TEST_CLIENT, email: '', phone: '',
                  address: 'Test record — created by the NAC Quote Tool' },
      job: { siteAddress: 'Test record — created by the NAC Quote Tool' },
      chosenSystemId: 'test',
      selectedOptionIds: ['test-upgrade'],
      acceptance: {
        customerName: 'NAC Quote Tool write test', acknowledgedTerms: true,
        signature: null, acceptedAt: at, quoteRevision: 1, totalIncGst: 1,
        chosenSystemId: 'test',
        selectedOptions: [{ id: 'test-upgrade', title: 'Test line — delete this job',
                            quantity: 1, unitPriceIncGst: null, unitLabel: null,
                            priceIncGst: 1 }]
      }
    };
    const presentation = {
      system: { brand: 'TEST', model: 'WRITE-PATH-CHECK', capacityKw: null },
      zoneCount: null,
      investment: { baseIncGst: 0, totalIncGst: 1, deposit: null }
    };

    const plan = mapper.buildJobPlan(issue, presentation,
      // Quote, not Work Order: a test must never look like won work on a
      // dispatch board.
      { status: mapper.JOB_STATUS.QUOTE });
    if (!plan.ok) {
      return res.status(500).json({ ok: false, reason: 'plan_failed', blockers: plan.blockers });
    }
    plan.job.job_description =
      'THIS IS A TEST JOB CREATED BY THE NAC QUOTE TOOL. IT IS SAFE TO DELETE.\n\n'
      + 'It exists to prove that the API key can create a job, a contact, line items '
      + 'and an attachment — which the read-only selftest cannot check.\n\n'
      + 'Created ' + at + ' by ' + who + '.\n\n'
      + plan.job.job_description;

    const out = await createJob(plan, { key });

    if (!out.ok) {
      return res.status(200).json({
        ok: false, reason: out.reason, message: out.message || null, steps: out.steps || [],
        note: 'Nothing usable was created. If a client record was made before the failure '
          + 'it is named "' + TEST_CLIENT + '" and can be removed.'
      });
    }

    return res.status(200).json({
      ok: true,
      jobId: out.generatedJobId || null,
      jobUuid: out.jobUuid,
      companyUuid: out.companyUuid,
      materialCount: out.materialCount,
      attachmentCount: out.attachmentCount,
      steps: out.steps,
      message: 'ServiceM8 accepted a job, a contact and ' + out.materialCount
        + ' line item(s). The write path works.',
      cleanup: 'DELETE IT: job ' + (out.generatedJobId ? '#' + out.generatedJobId : out.jobUuid)
        + ', and the client "' + TEST_CLIENT + '" if nothing else is under it.'
    });
  } catch (e) {
    return res.status(502).json({ ok: false, reason: 'upstream_unavailable',
      message: 'ServiceM8 could not be reached.' });
  }
};

module.exports.TEST_CLIENT = TEST_CLIENT;
