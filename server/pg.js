// ─────────────────────────────────────────────────────────────────────────────
// ONE PostgREST CALLER FOR THE NEW ENDPOINTS
//
// There are already four hand-rolled copies of this helper in server/ —
// quote-list, ops, roles and quote-issue each grew their own. They work and
// they are not being rewritten here, because a refactor of four live endpoints
// is a separate change with its own risk. What is NOT happening is a fifth and
// a sixth copy: the enquiry and handover endpoints share this one.
//
// Two things it does that a bare `fetch` does not:
//
//   · it reads the STATUS. `fetch` resolves on a 404 and on a 400, so a
//     rejected read looks exactly like an empty result unless somebody checks
//     — which is the bug that hid the `nac_designs.design` / `.data` mismatch
//     for weeks.
//   · it tells a MISSING TABLE apart from a FAILED READ. A table that has not
//     been created yet is a deployment step and the caller can carry on
//     without it; a read that failed is unknown data and the caller must say
//     so rather than show nothing.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');

const SUPA_HOST = 'icnznjhwybryizbdqrgx.supabase.co';

/**
 * @param {string} path  a /rest/v1/… path, already encoded
 * @param {object} opts  { method, key, body, prefer }
 * @returns {Promise<{status:number, body:any, text:string}>}
 */
function supa(path, { method = 'GET', key, body = null, prefer = null } = {}) {
  const payload = body === null ? null : JSON.stringify(body);
  return new Promise((resolve) => {
    const headers = {
      apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json'
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (prefer) headers.Prefer = prefer;

    const r = https.request({ hostname: SUPA_HOST, path, method, headers }, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = null; }
        resolve({ status: resp.statusCode, body: parsed, text: data });
      });
    });
    // A transport failure is status 0, which is neither a missing table nor an
    // empty result. Callers report it as unreadable.
    r.on('error', () => resolve({ status: 0, body: null, text: '' }));
    if (payload) r.write(payload);
    r.end();
  });
}

/**
 * Does this response mean "that table has not been created yet"?
 *
 * NARROWLY. The first version of this matched /does not exist/ on any 400,
 * which also matches `column "customer_name" does not exist` — so a reader
 * that asked for a column the table did not have would have been told the
 * TABLE was missing, carried on without it, and reported a successful read of
 * nothing. That is the `nac_designs.design` / `.data` bug wearing a different
 * hat, and it would have hidden exactly the same class of mistake.
 *
 * A missing table is a 404, or a 400 carrying PostgREST's own undefined-table
 * code (42P01) or its schema-cache wording. Anything else is a failed read and
 * the caller must say so.
 */
function tableMissing(r) {
  if (!r) return false;
  if (r.status === 404) return true;
  if (r.status !== 400) return false;
  const text = r.text || '';
  // The relation wording is matched loosely on purpose: the message arrives
  // JSON-encoded, so the quotes around the table name are escaped and a
  // pattern expecting a bare `"` after `relation ` never matches.
  return /42P01/.test(text) || /in the schema cache/i.test(text)
    || /relation\s+.*does not exist/i.test(text);
}

/** Did the read succeed and hand back rows — including zero of them? */
function readOk(r) {
  return !!r && r.status >= 200 && r.status < 300 && Array.isArray(r.body);
}

module.exports = { supa, tableMissing, readOk, SUPA_HOST };
