// ─────────────────────────────────────────────────────────────────────────────
// A REAL DATABASE BEHIND THE REAL ENDPOINTS
//
// Every browser suite in this repository stubs the REST call. That is why a
// bug as basic as "the column is called `design`, not `data`" survived: no test
// ever asked a database whether the column existed.
//
// This runs the endpoints unmodified against a real PostgreSQL carrying the
// schema from designer/schema.sql and designer/quote-presentation-schema.sql.
// Two pieces:
//
//   1. A small HTTP server speaking the slice of PostgREST that the endpoints
//      actually use, translating each request into SQL and running it through
//      psql. It does NOT paper over anything: a select naming a column the
//      table does not have reaches Postgres and comes back 400, exactly as
//      PostgREST would answer.
//
//   2. An interceptor on node's https.request, so api/server code that posts
//      to the Supabase host is answered by that server. The endpoint's own URL
//      building, headers, status handling and JSON parsing all run for real.
//
// It is a test harness, not a PostgREST implementation. Values are quoted for
// SQL, but the inputs are the suite's own.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PSQL = '/usr/lib/postgresql/16/bin/psql';
const ENV = { ...process.env, PGHOST: '/var/run/nacpg', PGPORT: '5433', PGUSER: 'postgres' };

// A design is hundreds of kilobytes of JSON, which is past what an argument
// list will carry — psql is fed from a file, not from -c.
const SCRATCH = mkdtempSync(join(tmpdir(), 'nac-pgrest-'));
let seq = 0;

/** Run SQL, return stdout. Throws with Postgres's own message on error. */
export function sql(text, db = 'nacquote') {
  const file = join(SCRATCH, 'q' + (seq++) + '.sql');
  writeFileSync(file, text + '\n');
  try {
    return execFileSync(PSQL, ['-d', db, '-tAX', '-v', 'ON_ERROR_STOP=1', '-f', file],
      { env: ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    const err = new Error((e.stderr || e.message || '').trim());
    err.pg = true;
    throw err;
  }
}

/** One row as an object, or null. */
export function row(text, db = 'nacquote') {
  const out = sql('select coalesce(json_agg(t), \'[]\') from (' + text + ') t', db).trim();
  const list = JSON.parse(out || '[]');
  return list[0] || null;
}

const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
/** A JSON literal Postgres will accept whatever is inside it. */
const jsonLit = (v) => '$nacjson$' + JSON.stringify(v) + '$nacjson$';

const TABLES = new Set(['nac_designs', 'nac_quote_issues', 'nac_presentation_content',
                        'nac_settings']);
const JSONB = { nac_quote_issues: new Set(['data']), nac_presentation_content: new Set(['data']) };

function parseFilters(params) {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    const m = /^(eq|neq)\.(.*)$/s.exec(v);
    if (!m) continue;
    where.push('"' + k.replace(/"/g, '') + '" ' + (m[1] === 'eq' ? '=' : '<>') + ' ' + q(m[2]));
  }
  return where;
}

function handle(req, body, done) {
  const url = new URL(req.url, 'http://x');
  const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
  if (!m) return done(404, { message: 'no route' });
  const table = m[1];
  if (!TABLES.has(table)) {
    // What PostgREST says for a table that is not exposed.
    return done(404, { message: 'Could not find the table \'public.' + table
      + '\' in the schema cache', code: 'PGRST205' });
  }

  const params = [...url.searchParams.entries()];
  const where = parseFilters(params);
  const whereSql = where.length ? ' where ' + where.join(' and ') : '';
  const limit = url.searchParams.get('limit');
  const limitSql = limit ? ' limit ' + (parseInt(limit, 10) || 1) : '';

  try {
    if (req.method === 'GET') {
      const sel = url.searchParams.get('select') || '*';
      const cols = sel === '*' ? '*'
        : sel.split(',').map(c => '"' + c.trim().replace(/"/g, '') + '"').join(', ');
      const text = 'select coalesce(json_agg(t), \'[]\'::json) from (select ' + cols
        + ' from public.' + table + whereSql + limitSql + ') t';
      return done(200, JSON.parse(sql(text).trim() || '[]'));
    }

    if (req.method === 'POST') {
      const payload = body ? JSON.parse(body) : {};
      const recs = Array.isArray(payload) ? payload : [payload];
      const prefer = String(req.headers.prefer || '');
      for (const rec of recs) {
        const keys = Object.keys(rec);
        const cols = keys.map(k => '"' + k.replace(/"/g, '') + '"').join(', ');
        const vals = keys.map(k => {
          const v = rec[k];
          if (v === null || v === undefined) return 'null';
          if (JSONB[table] && JSONB[table].has(k)) return jsonLit(v) + '::jsonb';
          if (typeof v === 'object') return jsonLit(v) + '::jsonb';
          return q(v);
        }).join(', ');
        let text = 'insert into public.' + table + ' (' + cols + ') values (' + vals + ')';
        if (/merge-duplicates/.test(prefer)) {
          const pk = table === 'nac_quote_issues' ? 'token'
            : (table === 'nac_designs' ? 'id' : 'key');
          const sets = keys.filter(k => k !== pk)
            .map(k => '"' + k + '" = excluded."' + k + '"').join(', ');
          text += ' on conflict (' + pk + ') do update set ' + sets;
        }
        sql(text);
      }
      return done(201, /return=minimal/.test(prefer) ? null : recs);
    }

    if (req.method === 'PATCH') {
      const rec = body ? JSON.parse(body) : {};
      const sets = Object.keys(rec).map(k => {
        const v = rec[k];
        const col = '"' + k.replace(/"/g, '') + '"';
        if (v === null || v === undefined) return col + ' = null';
        if ((JSONB[table] && JSONB[table].has(k)) || typeof v === 'object') {
          return col + ' = ' + jsonLit(v) + '::jsonb';
        }
        return col + ' = ' + q(v);
      }).join(', ');
      if (!sets) return done(400, { message: 'nothing to update' });
      sql('update public.' + table + ' set ' + sets + whereSql);
      return done(204, null);
    }

    return done(405, { message: 'method not allowed' });
  } catch (e) {
    // Postgres's own complaint, in the shape PostgREST reports it. This is the
    // path that catches a column the schema does not have.
    return done(400, { message: String(e.message || e).replace(/^ERROR:\s*/, ''),
                       code: '42703' });
  }
}

/**
 * Start the shim and point https.request at it. Returns a stop function that
 * puts https.request back.
 */
export async function startRest() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      handle(req, body, (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload === null ? '' : JSON.stringify(payload));
      });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const realRequest = https.request;
  https.request = function (options, cb) {
    const o = typeof options === 'string' ? { path: options } : { ...options };
    // Only the Supabase host is diverted; anything else still goes out.
    if (o.hostname && !/supabase\.co$/.test(o.hostname)) return realRequest.call(https, options, cb);
    return http.request({ host: '127.0.0.1', port, path: o.path,
                          method: o.method || 'GET', headers: o.headers || {} }, cb);
  };

  return async function stop() {
    https.request = realRequest;
    await new Promise(r => server.close(r));
  };
}

/** Empty every table, so each suite starts from a known database. */
export function reset() {
  sql('truncate public.nac_quote_issues, public.nac_designs, '
    + 'public.nac_presentation_content, public.nac_settings');
}
