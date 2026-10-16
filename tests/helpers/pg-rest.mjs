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
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

// ── ONE DATABASE PER TEST FILE ─────────────────────────────────────────────
//
// `node --test tests/*.test.mjs` runs each FILE in its own process, in
// parallel, and every database suite used to share the single `nacquote`
// database. They each truncate it on setup and then insert their own
// `nac_presentation_content` row under the key 'library' — so one suite
// truncated while another was mid-insert, or both inserted and the second got
// a duplicate key.
//
// That showed up as a suite failing on a schema every other suite could see
// perfectly well, which reads like a product defect and is not one. It was
// never flaky in the sense of random: it is a collision, and it happens
// whenever those files run together.
//
// `nacquote` is now a TEMPLATE nobody connects to, and each process clones it.
// A clone is a file copy inside PostgreSQL and costs a fraction of a second,
// which is cheaper than two suites reading each other's rows.
const TEMPLATE = 'nacquote';
const DB = 'nacquote_t' + process.pid;

// The container is restarted between sessions and the server does not come back
// with it, so the suite brings its own database up rather than failing with a
// socket error that looks like a broken test.
let ensured = false;
function ensureServer() {
  if (ensured) return;
  ensured = true;
  try {
    execFileSync(ROOT + '/tools/test-db.sh', ['up'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { /* the suites skip on their own when psql is missing */ }
  waitForSchema();
  cloneDatabase();
}

/** Run one statement against a named database, swallowing failure. */
function admin(text, db = 'postgres') {
  try {
    execFileSync(PSQL, ['-d', db, '-tAX', '-c', text],
      { env: ENV, encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (e) { return false; }
}

function cloneDatabase() {
  // Another process may be cloning the same template at the same moment, and
  // PostgreSQL refuses `create database ... template` while anything is
  // CONNECTED to the source — which is exactly what the first process to
  // arrive is doing while it loads the schema into it. So the loser retries.
  //
  // ── AND IF IT NEVER WINS, IT SAYS SO ──────────────────────────────────
  // This used to give up after forty attempts and return as though it had
  // succeeded. Every later statement then ran against a database that does
  // not exist, `sql()` swallowed the failure, and the suite failed on an
  // assertion about missing data — which reads as a product defect and is a
  // test-harness problem. Two database suites running together made it
  // intermittent, which is the worst of both worlds.
  let last = '';
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync(PSQL, ['-d', 'postgres', '-tAX', '-c',
        'create database "' + DB + '" template "' + TEMPLATE + '"'],
        { env: ENV, encoding: 'utf8', stdio: 'pipe' });
      return;
    } catch (e) {
      last = String((e && e.stderr) || (e && e.message) || '').trim();
      // Already there from an earlier run in this same process id: usable.
      if (/already exists/i.test(last)) return;
      const until = Date.now() + 250;
      while (Date.now() < until) { /* wait */ }
    }
  }
  throw new Error('could not clone ' + TEMPLATE + ' into ' + DB
    + ' after 60 attempts over 15s. Last error: ' + last);
}

// The clone is this process's, and it goes when the process does. Without
// this, a day of test runs leaves a few hundred databases behind.
let dropped = false;
function dropDatabase() {
  if (dropped) return;
  dropped = true;
  admin('drop database if exists "' + DB + '" with (force)');
}
process.on('exit', dropDatabase);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { dropDatabase(); process.exit(1); });
}

// ── `up` RETURNING IS NOT THE SAME AS READY ────────────────────────────────
//
// `node --test tests/*.test.mjs` runs each FILE in its own process, and every
// database suite calls `up` as it starts. The flag above stops the repeats
// within one file and can do nothing about five processes arriving together:
// one of them creates the database and loads the schema, and the others get a
// pg_ctl that says "another server might be running", return successfully, and
// start querying a database whose tables are still being created.
//
// That surfaced once as a single suite failing on a schema every other suite
// could see perfectly well — which reads like a product defect and is not one.
//
// The obvious fix is a lock around the script. It does not work: pg_ctl
// daemonises postgres, the server INHERITS the open lock file descriptor, and
// the lock is then held for as long as the database runs — so every later
// arrival blocks until it is killed. Waiting for the thing we actually care
// about is both simpler and correct.
function waitForSchema({ tries = 60, waitMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const out = execFileSync(PSQL,
        ['-d', TEMPLATE, '-tAX', '-c',
         "select count(*) from information_schema.tables "
         + "where table_schema='public' and table_name in "
         + "('nac_designs','nac_quote_issues','nac_presentation_content','nac_settings')"],
        { env: ENV, encoding: 'utf8', stdio: 'pipe' });
      if (parseInt(String(out).trim(), 10) === 4) return;
    } catch (e) { /* still starting, or still loading */ }
    // A busy wait, deliberately: this runs once per test process, at startup,
    // and pulling in a sleep helper to save a quarter of a second of CPU in a
    // test harness is not a trade worth making.
    const until = Date.now() + waitMs;
    while (Date.now() < until) { /* wait */ }
  }
  // Fall through rather than throw. The suites already skip with a reason when
  // the database is not there, and a thrown error here would turn a missing
  // PostgreSQL into a wall of failures instead of a wall of skips.
}

// A design is hundreds of kilobytes of JSON, which is past what an argument
// list will carry — psql is fed from a file, not from -c.
const SCRATCH = mkdtempSync(join(tmpdir(), 'nac-pgrest-'));
let seq = 0;

/** Run SQL, return stdout. Throws with Postgres's own message on error. */
export function sql(text, db = DB) {
  ensureServer();
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
export function row(text, db = DB) {
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

      // ── A CONDITIONAL UPDATE HAS TO BE CONDITIONAL HERE TOO ──────────────
      //
      // quote-respond.js makes its write conditional on the status it read, so
      // two simultaneous acceptances cannot both land. The whole point is that
      // the LOSER is told it changed nothing — which PostgREST reports by
      // returning an empty array under `Prefer: return=representation`. A shim
      // that always answered 204 would make the race look won by both, and the
      // guard would be tested by nothing.
      const prefer = String(req.headers.prefer || '');
      if (/return=representation/.test(prefer)) {
        // UPDATE is not allowed in a FROM subquery — it has to be a CTE.
        const out = sql('with upd as (update public.' + table + ' set ' + sets + whereSql
          + ' returning *) select coalesce(json_agg(upd), \'[]\'::json) from upd');
        return done(200, JSON.parse(out.trim() || '[]'));
      }
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
