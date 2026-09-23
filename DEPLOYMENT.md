# NAC AI HVAC DESIGNER — deployment steps

Two things have to be done by hand, by someone holding NAC's credentials, and
neither of them can be done from inside a development session:

1. **the database migrations** — `designer/quote-presentation-schema.sql` and
   `designer/quote-media-buckets.sql`;
2. **the Vercel server key** — confirming `SUPABASE_KEY` is the service-role
   key so the intake form keeps creating quotes once row level security is on.

---

## STATUS — THESE HAVE NOT BEEN APPLIED

**The migrations have NOT been run.** No authorised database connection exists
in the development environment: there is no `SUPABASE_*`, no `DATABASE_URL` and
no `POSTGRES_*` in its environment, so nothing has been executed against the NAC
Supabase project from here, and nothing in this repository should be read as
saying it has been. The SQL files are written, reviewed and idempotent — running
them twice is safe — but they are waiting on someone with the credentials.

**Do not paste a key or a connection string into chat, into a file in this
repository, or into a commit.** Nothing below asks you to. Option A does not
require you to handle a credential at all.

---

# PART 1 — APPLY THE TWO MIGRATIONS

## Option A — the Supabase SQL editor (recommended)

No credential leaves the browser, and no tooling is needed.

1. Open <https://supabase.com/dashboard> and select the NAC project.
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `designer/quote-presentation-schema.sql` from this repository, copy the
   whole file, paste it in, press **Run**. Expect `Success. No rows returned`.
4. **New query** again. Copy the whole of `designer/quote-media-buckets.sql`,
   paste, **Run**. Expect `Success. No rows returned`.

Order matters only in that both must be applied before a quote is issued or a
photograph is uploaded. Either order is fine.

## Option B — `psql` from a machine that has it

Get the connection string from Supabase → **Project Settings** → **Database** →
**Connection string** → **URI**, and put it in your shell's environment. Do not
type it inline where it will land in shell history, and do not commit it.

```sh
# Paste the URI when prompted; it is not echoed and not stored in history.
read -rs -p 'Supabase connection URI: ' SUPABASE_DB_URL && export SUPABASE_DB_URL && echo

psql "$SUPABASE_DB_URL" --single-transaction --set ON_ERROR_STOP=1 \
     -f designer/quote-presentation-schema.sql

psql "$SUPABASE_DB_URL" --single-transaction --set ON_ERROR_STOP=1 \
     -f designer/quote-media-buckets.sql

unset SUPABASE_DB_URL
```

`ON_ERROR_STOP=1` with `--single-transaction` means a partial apply rolls back
rather than leaving the schema half-built.

> `quote-media-buckets.sql` writes to `storage.buckets` and creates policies on
> `storage.objects`. On a hosted Supabase project the pooled connection string
> has the rights for this; if a `must be owner of table objects` error appears,
> use Option A instead — the SQL editor runs with the rights it needs.

---

# PART 2 — VERIFY THE MIGRATIONS

Run each query in the SQL editor (or `psql "$SUPABASE_DB_URL" -c "..."`) and
check the result against **Expect**. A migration is not verified until all nine
pass.

### 2.1 The two tables exist

```sql
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('nac_quote_issues','nac_presentation_content')
 order by table_name;
```

**Expect** exactly 2 rows: `nac_presentation_content`, `nac_quote_issues`.

### 2.2 Their columns are the right shape

```sql
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('nac_quote_issues','nac_presentation_content')
 order by table_name, ordinal_position;
```

**Expect**

* `nac_presentation_content` — `key` text NOT NULL, `data` jsonb NOT NULL,
  `updated_at` timestamptz NOT NULL default `now()`.
* `nac_quote_issues` — `token` text NOT NULL, `design_id` text nullable,
  `quote_rev` integer NOT NULL default `1`, `status` text NOT NULL default
  `'issued'`, `issued_at` timestamptz NOT NULL default `now()`, `expires_at`
  and `responded_at` timestamptz nullable, `data` jsonb NOT NULL,
  `updated_at` timestamptz NOT NULL default `now()`.

`data` being NOT NULL on both is the constraint that matters: a quote issue
cannot exist without its presentation payload.

### 2.3 The primary keys are the natural keys

```sql
select tc.table_name, tc.constraint_type, kcu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name
 where tc.table_schema = 'public'
   and tc.table_name in ('nac_quote_issues','nac_presentation_content')
   and tc.constraint_type = 'PRIMARY KEY';
```

**Expect** `nac_quote_issues` → `token`, and `nac_presentation_content` → `key`.
The token being the primary key is what makes re-issuing a link idempotent.

### 2.4 Both indexes exist

```sql
select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'nac_quote_issues'
 order by indexname;
```

**Expect** 3 rows: `nac_quote_issues_design_idx`, `nac_quote_issues_pkey`,
`nac_quote_issues_status_idx`.

### 2.5 Row level security is ON

```sql
select relname, relrowsecurity
  from pg_class
 where relname in ('nac_quote_issues','nac_presentation_content');
```

**Expect** `relrowsecurity = true` on both. If either is `false`, stop — the
tables are readable with the public key and no quote may be issued.

### 2.6 There are NO policies on them

```sql
select tablename, policyname from pg_policies
 where tablename in ('nac_quote_issues','nac_presentation_content');
```

**Expect 0 rows.** RLS enabled with no policy refuses every role except the
service role, which is the design: these tables are reached only through
`/api/quote-view`, server-side.

### 2.7 The two buckets, and which one is public

```sql
select id, public, file_size_limit from storage.buckets
 where id in ('nac-quote-media','nac-quote-originals')
 order by id;
```

**Expect** `nac-quote-media` → `public = true`, limit `5242880` (5 MB);
`nac-quote-originals` → `public = false`, limit `26214400` (25 MB).
If `nac-quote-originals` shows `public = true`, stop and fix it before any
customer photograph is loaded — originals carry EXIF and GPS.

### 2.8 Four storage policies, and none of them names the private bucket

```sql
select policyname, cmd, roles from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'nac_quote_media%'
 order by policyname;
```

**Expect** 4 rows — `nac_quote_media_public_read` (SELECT, `{anon,authenticated}`),
`nac_quote_media_staff_write` (INSERT, `{authenticated}`),
`nac_quote_media_staff_update` (UPDATE, `{authenticated}`),
`nac_quote_media_staff_delete` (DELETE, `{authenticated}`).

```sql
select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (qual ilike '%nac-quote-originals%' or with_check ilike '%nac-quote-originals%');
```

**Expect 0 rows.** Nothing grants any role access to the originals bucket.

### 2.9 Nothing else was touched

```sql
select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
```

**Expect** the four `nac_quote_media*` policies plus whatever already existed
for `intake-uploads` and any other bucket — unchanged. The new policies are
scoped by `bucket_id`, so an existing bucket cannot be affected; this query
confirms it.

---

# PART 3 — VERIFY IT FROM OUTSIDE, SIGNED OUT

The queries above are run as the owner. These four are run as a stranger, which
is the population that matters. Do them in a private browsing window with no NAC
session.

1. **An anon read of the issues table is refused.**
   In a private window open the browser console on any page and run, with the
   project's *public* anon key (the one already in the site — this is safe to
   use here, and there is no reason to touch the service-role key):

   ```js
   fetch('https://icnznjhwybryizbdqrgx.supabase.co/rest/v1/nac_quote_issues?select=token&limit=1',
         { headers: { apikey: '<the public anon key>', Authorization: 'Bearer <the public anon key>' } })
     .then(r => r.json()).then(console.log)
   ```

   **Expect** an empty array or a permission error. **A token in the output is a
   failure** — it means every issued quote is readable by anyone.

2. **The same for the content library**, substituting
   `nac_presentation_content?select=key&limit=1`. Same expectation.

3. **A public link cannot enumerate private media.** Take any object path from
   `nac-quote-originals` and open
   `https://icnznjhwybryizbdqrgx.supabase.co/storage/v1/object/public/nac-quote-originals/<path>`
   signed out. **Expect 400 or 404.** If an image renders, the private bucket is
   not private — stop. Also confirm
   `.../storage/v1/object/list/nac-quote-originals` signed out returns an error
   rather than a file listing.

4. **A web derivative does load.** The same URL against `nac-quote-media` must
   return the image, signed out. That is what makes a customer's quote link work.

**Unapproved content is not served** — this one is enforced in code, not in SQL.
`/api/quote-view` returns only what the publish gate has passed, and the gate
drops any review or installation that is not explicitly `approved === true`
(a string `"false"` is rejected, not treated as truthy). It is covered by
`tests/publish-gate.test.mjs` and `tests/presentation.test.mjs`. To confirm it
end to end on the deployed site: mark a review unapproved in Quote Presentation,
issue a quote, open the customer link signed out, and confirm the review is
absent from the page and from the JSON the page fetched.

---

# PART 4 — THE VERCEL SERVER KEY (SIX STEPS)

The intake form and the splits quote builder write to `nac_quotes` with the
Vercel variable `SUPABASE_KEY`. Once `designer/production-setup.sql` is applied,
an INSERT by the public key is refused — so if `SUPABASE_KEY` holds the public
key, the intake form goes quiet and the first anyone hears is a customer saying
they filled the form in and never got a reply. These six steps settle it before
it happens.

1. **Open the Vercel project.** <https://vercel.com/dashboard> → the
   `nac-quote-tool` project.

2. **Verify the server-only environment variable.**
   **Settings** → **Environment Variables**. Confirm `SUPABASE_KEY` exists and
   is ticked for **Production**, **Preview** and **Development**. Its value must
   be the **service_role** key from Supabase → **Project Settings** → **API**.
   Do not reveal the value on screen, do not copy it anywhere else, and do not
   put it in a file in this repository. It is read only by `api/*.js` running on
   the server; no browser bundle references it, and
   `tests/client-secrets.test.mjs` fails the build if one ever does.

3. **Redeploy.** **Deployments** → the latest one → **⋯** → **Redeploy**.
   This step is not optional: an environment variable added or changed after a
   deploy does not reach the running functions until the next deploy.

4. **Sign in.** Open <https://nac-quote-tool.vercel.app/setup.html> and sign in
   with your NAC account. `/api/server-key-selftest` refuses anyone who is not
   signed in, so this has to come first.

5. **Run the self-test.** On `/setup.html`, press the server key check (it calls
   `/api/server-key-selftest` for you with your session). If you would rather
   call it directly it needs your bearer token, which `/setup.html` already has —
   use the page.

6. **Confirm pass or fail.**
   * **PASS** — `ready: true`, `willWrite: true`, and all three checks PASS.
     The server can write quotes and applying the security SQL will not stop the
     intake form.
   * **FAIL** — the failing check names the remedy: put the service_role key in
     `SUPABASE_KEY` for all environments and go back to step 3. **Do not issue a
     customer quote and do not apply `production-setup.sql` until this passes.**

The endpoint answers pass or fail and nothing more. It never returns a key, a
fragment of a key, a key length, a JWT, a token fragment or the name of the role
the server is configured with — `tests/server-key-selftest.test.mjs` asserts all
six of those, including that the FAIL response is byte-identical whichever
insufficient key is configured, so a reader cannot learn from a failure which
key is in Vercel.

---

# PART 5 — WHY NOTHING DEPLOYED BETWEEN 15 AND 23 SEPTEMBER

Vercel turns every file in `/api` into its own Serverless Function, and this
project's plan allows twelve in one deployment. The quote and presentation work
took `/api` from 11 files to 15, so from commit `bcf8eda` onwards **every build
failed** and the live site kept serving the code from 15 September. The GitHub
integration was never disconnected — it fired every time and the build is what
failed. `/api/quote-issue` answering 404 in production was the symptom.

The fix, in this commit:

* The five quote and presentation handlers, and the two selftests, moved to
  `/server`, where Vercel does not count them as functions.
* `api/quote.js` and `api/selftest.js` dispatch to them.
* `vercel.json` rewrites the seven original URLs to those two dispatchers, so
  `/api/quote-view`, `/api/quote-issue` and the rest answer exactly as before.
  A rewrite keeps the method, the body and the query string.
* `/api` now holds 11 function files.

`tests/api-function-budget.test.mjs` fails the build if the count goes over
twelve again, if a rewrite points at a handler that does not exist, or if any
`/api/` URL in the shipped HTML has nothing to answer it.

**Adding an endpoint from here on:** do not add a file to `/api`. Put the
handler in `/server`, add a line to the `ROUTES` table in `api/quote.js`, and
add a rewrite to `vercel.json`. The budget test checks all three agree.

If a deployment ever fails again, the build log says why:
`https://vercel.com/nacelectricals-projects/nac-quote-tool` → the failed
deployment → **Build Logs**.

---

# ORDER

1. Part 1 — apply both migrations.
2. Part 2 — nine verification queries.
3. Part 4 — the six Vercel steps, to a PASS.
4. `designer/production-setup.sql`, if it has not been applied.
5. Part 3 — the signed-out checks, which only mean something once the security
   is on.
6. Only then issue a real customer quote.
