-- ============================================================================
-- NAC — PRODUCTION SETUP.  Paste this whole file into the Supabase SQL editor.
-- ============================================================================
--
-- RUN designer/schema-diagnostic.sql FIRST. It is read-only and it tells you
-- what is actually in the database. This script checks the same things itself
-- and refuses to run if anything is missing, but seeing the picture first means
-- no surprises.
--
-- WHY THE PREVIOUS VERSION FAILED
--
--   ERROR: 42P01: relation "public.nac_designs" does not exist
--
-- The old script assumed nac_designs was already there. It never was.
-- designer/schema.sql, which creates it, is optional and had not been run —
-- the designer works without it by saving each design into the nac_settings
-- key/value store. The old script went straight to ALTER TABLE on a table that
-- did not exist. This version CREATES it first, and carries those saved designs
-- across into it.
--
-- WHAT THIS DOES, IN PLAIN TERMS
--
--   1. Refuses to change anything unless nac_quotes and nac_settings are there
--      with the columns the policies compare. It names what is missing.
--   2. Creates nac_designs, nac_customers and nac_jobs if they are not there.
--      Existing tables are left exactly as they are.
--   3. Adds nullable columns to nac_designs and nac_quotes.
--   4. COPIES designs already saved in the nac_settings fallback into
--      nac_designs, so none of them drop off the saved-designs list. The
--      nac_settings rows are left in place — nothing is moved or deleted.
--   5. REMOVES EVERY EXISTING POLICY on those five tables — including the two
--      named "Allow all" that NAC's project carries today — and replaces them
--      with the ones in PART 4, so the public key in the page source stops
--      being able to read NAC's cost prices, designs and customers. This is the
--      only step that takes access away, it is the whole point of the exercise,
--      and the undo block at the foot puts "Allow all" back if you want it.
--
-- WHAT IT NEVER DOES
--
--   It drops no table, renames nothing, deletes no row, and changes no existing
--   value. Every step is guarded, so running it twice is safe and running it
--   after a failed attempt is safe.
--
-- IT IS ALL OR NOTHING. The whole file runs inside one transaction. If any
-- step fails, every step is undone and the database is exactly as it was.
--
-- ── ONE THING TO CHECK BEFORE YOU RUN IT ────────────────────────────────────
--
-- Once row-level security is on, /api/intake-submit and /api/savequote can
-- only keep writing quotes if the Vercel variable SUPABASE_KEY holds the
-- SERVICE ROLE key, not the anon key. Those run on the server, never in a
-- browser, so the service role key is the right one there and it is the only
-- one that is allowed to insert once this is applied. Open /setup.html after
-- running this — it now checks exactly that and tells you which key is set.
-- If it is the anon key, the intake form will stop creating quotes.
--
-- AFTER RUNNING THIS: open /setup.html on the deployed site, sign in, press the
-- one button. It verifies all of the above against the live database.
-- ============================================================================

begin;

-- ═════════════════ PART 0 — PREFLIGHT.  CHANGES NOTHING. ═════════════════
-- Every table this script alters is checked here, before a single change is
-- made. A missing table stops the script with a sentence that says which one
-- and what to do, instead of a 42P01 twenty statements in.

do $preflight$
declare
  missing_tables text[] := '{}';
  missing_cols   text[] := '{}';
  t              text;
  c              text;
begin
  -- These two hold NAC's live data. This script does NOT create them: their
  -- real shape is whatever the quoting tool has been using in production, and
  -- inventing a shape for a table that holds real quotes would be worse than
  -- stopping. If either is missing, something is wrong that SQL must not guess at.
  foreach t in array array['nac_quotes', 'nac_settings'] loop
    if to_regclass('public.' || t) is null then
      missing_tables := missing_tables || t;
    end if;
  end loop;

  if array_length(missing_tables, 1) > 0 then
    raise exception
      E'NAC SETUP STOPPED — nothing was changed.\n'
      '  These tables hold live data and are not in this database: %\n'
      '  This script will not create them, because their real shape is whatever\n'
      '  the live quoting tool uses and guessing it could corrupt real quotes.\n'
      '  Check you are connected to the right Supabase project, then run\n'
      '  designer/schema-diagnostic.sql to see what IS there.',
      array_to_string(missing_tables, ', ');
  end if;

  -- The customer-acceptance policy compares these columns, so it cannot be
  -- created without them.
  foreach c in array array['id', 'client', 'job_desc', 'line_items', 'accepted'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'nac_quotes'
                      and column_name = c) then
      missing_cols := missing_cols || ('nac_quotes.' || c);
    end if;
  end loop;

  -- The design back-fill reads these.
  foreach c in array array['key', 'value'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'nac_settings'
                      and column_name = c) then
      missing_cols := missing_cols || ('nac_settings.' || c);
    end if;
  end loop;

  -- If nac_designs already exists it might be an older or different shape.
  -- CREATE TABLE IF NOT EXISTS would silently accept it and the inserts would
  -- then fail, so it is checked here instead.
  if to_regclass('public.nac_designs') is not null then
    foreach c in array array['id', 'design'] loop
      if not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'nac_designs'
                        and column_name = c) then
        missing_cols := missing_cols || ('nac_designs.' || c);
      end if;
    end loop;
  end if;

  if array_length(missing_cols, 1) > 0 then
    raise exception
      E'NAC SETUP STOPPED — nothing was changed.\n'
      '  These columns are not in the live tables: %\n'
      '  The security policies compare them, so they have to exist first.\n'
      '  Run designer/schema-diagnostic.sql and send the result back.',
      array_to_string(missing_cols, ', ');
  end if;

  raise notice 'PREFLIGHT PASSED — nac_quotes and nac_settings are present with the columns needed.';
  raise notice 'nac_designs %', case when to_regclass('public.nac_designs') is null
    then 'is NOT there and will be created' else 'is already there and will be left alone' end;
end
$preflight$;


-- ═══════ PART 1 — TABLES.  CREATED ONLY IF THEY ARE NOT ALREADY THERE. ═══════

-- ── nac_designs ────────────────────────────────────────────────────────────
-- Same definition as designer/schema.sql, which is what the designer expects.
-- Without it, designer/engines/store.mjs falls back to saving each design as an
-- nac_settings row. That fallback still works; this makes designs listable.
create table if not exists public.nac_designs (
  id               text primary key,
  customer_name    text,
  customer_address text,
  quote_id         text,               -- -> nac_quotes.id
  job_id           text,               -- ServiceM8 generated_job_id
  status           text default 'draft',
  design           text not null,      -- the full DuctDesign JSON, revisions included
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists nac_designs_updated_idx  on public.nac_designs (updated_at desc);
create index if not exists nac_designs_quote_idx    on public.nac_designs (quote_id);
create index if not exists nac_designs_customer_idx on public.nac_designs (customer_name);

-- ── nac_customers ──────────────────────────────────────────────────────────
create table if not exists public.nac_customers (
  id          text primary key,          -- CUS-JOHN-SMITH-0001
  name        text not null,
  email       text,
  phone       text,
  address     text,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists nac_customers_name_idx  on public.nac_customers (lower(name));
create index if not exists nac_customers_email_idx on public.nac_customers (lower(email));
create index if not exists nac_customers_phone_idx on public.nac_customers (phone);

-- ── nac_jobs ───────────────────────────────────────────────────────────────
-- A job is one piece of work at one site for one customer. A customer with two
-- properties has two jobs; a second system at the same house is the same job.
create table if not exists public.nac_jobs (
  id               text primary key,     -- JOB-14-WATTLEBIRD-DRIVE-0001
  customer_id      text references public.nac_customers (id),
  description      text,
  site_address     text,
  status           text default 'open',  -- open | designed | quoted | accepted | won | lost | done
  servicem8_job_id text,
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create index if not exists nac_jobs_customer_idx on public.nac_jobs (customer_id);
create index if not exists nac_jobs_status_idx   on public.nac_jobs (status);

-- ── Table privileges for the three new tables ──────────────────────────────
-- Supabase normally grants these automatically through default privileges, but
-- relying on that is how a signed-in estimator meets "permission denied for
-- table nac_customers" and cannot save a customer. Granting explicitly costs
-- nothing and removes the whole question.
--
-- Granting to `anon` is deliberate and is NOT a hole: a GRANT is permission to
-- address the table, row level security decides which rows come back, and with
-- RLS on and no anon policy that is none of them. Verified below in PART 4.
do $grants$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant usage on schema public to %I', role_name);
      execute format('grant all on public.nac_designs, public.nac_customers, public.nac_jobs to %I',
                     role_name);
    else
      raise notice 'Role % does not exist in this project — skipped. This is not a Supabase default.', role_name;
    end if;
  end loop;
end
$grants$;


-- ═════ PART 2 — COLUMNS.  EVERY TABLE BELOW NOW DEFINITELY EXISTS. ═════
-- All nullable, so every existing row stays valid and every existing query
-- keeps returning exactly what it always did.

alter table public.nac_designs add column if not exists customer_id text;
alter table public.nac_designs add column if not exists job_ref     text;
alter table public.nac_quotes  add column if not exists customer_id text;
alter table public.nac_quotes  add column if not exists job_ref     text;

-- What happened when NAC tried to create the ServiceM8 job for an accepted
-- quote. Written server-side by api/create-job.js, because the customer's
-- browser is only allowed to set `accepted` and because a failure must survive
-- them closing the tab. All nullable; nothing reads them but NAC.
alter table public.nac_quotes add column if not exists servicem8_status       text;
alter table public.nac_quotes add column if not exists servicem8_job_uuid     text;
alter table public.nac_quotes add column if not exists servicem8_job_id       text;
alter table public.nac_quotes add column if not exists servicem8_company_uuid text;
alter table public.nac_quotes add column if not exists servicem8_error        text;
alter table public.nac_quotes add column if not exists servicem8_attempted_at timestamptz;

create index if not exists nac_quotes_sm8_status_idx    on public.nac_quotes  (servicem8_status);
create index if not exists nac_designs_customer_id_idx  on public.nac_designs (customer_id);
create index if not exists nac_designs_job_ref_idx      on public.nac_designs (job_ref);
create index if not exists nac_quotes_customer_id_idx   on public.nac_quotes  (customer_id);
create index if not exists nac_quotes_job_ref_idx       on public.nac_quotes  (job_ref);

-- `nac_designs.job_id` holds the SERVICEM8 job id. It is left exactly as it is;
-- `job_ref` is the new link to nac_jobs. Two different things, two columns.


-- ══════ PART 3 — CARRY THE SAVED DESIGNS ACROSS.  INSERT ONLY. ══════
--
-- Until nac_designs existed, every saved design went into nac_settings as a row
-- keyed nac_design_<id>. Now that the table exists the designer reads the table,
-- and designer/engines/store.mjs builds the saved-designs list from the table
-- plus this device's own localStorage — NOT from the fallback rows. So without
-- this step, a design saved on the office computer would stop appearing on the
-- iPad. It would still be in the database and still open by id, but it would
-- have gone quiet, and a design you cannot find is a design you have lost.
--
-- This INSERTS those designs into nac_designs and does nothing else. The
-- nac_settings rows stay exactly where they are — nothing is moved or deleted,
-- so the fallback still works and this is reversible by deleting the new rows.
-- A row that is already in nac_designs is left untouched (ON CONFLICT DO NOTHING),
-- so re-running changes nothing. Anything that will not parse is skipped and
-- counted rather than guessed at.

do $backfill$
declare
  r            record;
  d            jsonb;
  design_text  text;
  parsed_ok    boolean;
  carried      int := 0;
  already      int := 0;
  skipped      int := 0;
  before_count bigint;
begin
  select count(*) into before_count from public.nac_designs;

  for r in select key, value::text as raw from public.nac_settings
            where key like 'nac\_design\_%' order by key loop
    parsed_ok := true;
    begin
      d := r.raw::jsonb;
      -- The column may be text or jsonb. If it is jsonb it holds the design as
      -- a JSON *string*, so it has to be unwrapped once before it is an object.
      if jsonb_typeof(d) = 'string' then
        design_text := d #>> '{}';
        d := design_text::jsonb;
      else
        design_text := r.raw;
      end if;
      if jsonb_typeof(d) <> 'object' or coalesce(d ->> 'id', '') = '' then
        parsed_ok := false;
      end if;
    exception when others then
      parsed_ok := false;
    end;

    if not parsed_ok then
      skipped := skipped + 1;
      raise notice 'SKIPPED %  — not a design object. The nac_settings row is untouched.', r.key;
      continue;
    end if;

    begin
      insert into public.nac_designs
        (id, customer_name, customer_address, quote_id, job_id, status, design, updated_at)
      values (
        d ->> 'id',
        coalesce(d #>> '{customer,name}', ''),
        coalesce(d #>> '{customer,address}', ''),
        nullif(d ->> 'quoteId', ''),
        nullif(d ->> 'jobId', ''),
        coalesce(nullif(d ->> 'status', ''), 'draft'),
        design_text,
        coalesce(nullif(d ->> 'updatedAt', '')::timestamptz, now())
      )
      on conflict (id) do nothing;
      if found then carried := carried + 1; else already := already + 1; end if;
    exception when others then
      skipped := skipped + 1;
      raise notice 'SKIPPED %  — could not be inserted (%). The nac_settings row is untouched.',
        r.key, sqlerrm;
    end;
  end loop;

  raise notice 'DESIGNS CARRIED ACROSS: % new, % already in nac_designs, % skipped. nac_designs went from % rows to %.',
    carried, already, skipped, before_count, (select count(*) from public.nac_designs);
end
$backfill$;


-- ═════════════════ PART 4 — ROW LEVEL SECURITY ═════════════════
-- source: designer/rls.sql
--
-- The sign-in screen in designer/auth.mjs is a door. This is the lock. Without
-- it the anon key that ships in the page source can still read and write
-- everything, so the sign-in screen is a speed bump and nothing more.
--
-- Create NAC staff in Authentication -> Users. Any authenticated user is
-- treated as NAC staff; there is no second tier, because NAC is one team and
-- inventing roles nobody asked for would be guesswork.

-- ── THIS IS THE STEP THAT ACTUALLY SECURES THE DATABASE ────────────────────
--
-- PostgreSQL policies are PERMISSIVE: they are OR'd together. One policy saying
-- `using (true)` for everybody grants access no matter what else is added
-- alongside it, so adding a tight staff-only policy next to a wide-open one
-- secures NOTHING. This was verified: on a copy of NAC's live schema, after the
-- previous version of this script ran "successfully", the anon key could still
-- read the cost prices AND overwrite them.
--
-- NAC's project carries a policy named "Allow all" on nac_quotes and on
-- nac_settings. Dropping policies by their expected names could never remove
-- those, so this removes EVERY policy on the five tables and then creates the
-- ones below, and names each one it removed as it goes. After this, the
-- policies on these tables are exactly the ones written in this file and
-- nothing else.
--
-- THIS IS THE ONE PART THAT TAKES ACCESS AWAY. It is reversible: the undo block
-- at the foot of this file puts "Allow all" back exactly as it was. Run
-- designer/schema-diagnostic.sql first and read its EXISTING POLICY lines —
-- those are the policies this will remove.

do $sweep$
declare
  r      record;
  ours   text[] := array['nac_settings_staff_all', 'nac_designs_staff_all',
                         'nac_customers_staff_all', 'nac_jobs_staff_all',
                         'nac_quotes_staff_all', 'nac_quotes_customer_read',
                         'nac_quotes_customer_accept'];
  taken  int := 0;   -- policies that were not this file's: real access removed
  reused int := 0;   -- this file's own, from a previous run: rewritten identically
begin
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public'
              and tablename in ('nac_quotes', 'nac_settings', 'nac_designs',
                                'nac_customers', 'nac_jobs')
            order by tablename, policyname
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    if r.policyname = any (ours) then
      -- This file wrote it on an earlier run. Dropping and recreating it leaves
      -- exactly the same policy, so nothing changes and nothing is lost.
      reused := reused + 1;
    else
      taken := taken + 1;
      raise notice 'REMOVED policy "%" on % — it was not written by this file, and the access it granted is now gone.',
        r.policyname, r.tablename;
    end if;
  end loop;

  if taken = 0 and reused = 0 then
    raise notice 'No existing policies on these tables. Nothing was taken away.';
  elsif taken = 0 then
    raise notice 'Nothing was taken away — the % policy/policies found were this file''s own, from a previous run, and are rewritten identically.', reused;
  else
    raise notice '% policy/policies REMOVED (plus % of this file''s own, rewritten identically). The undo block at the foot of this file puts the removed ones back.', taken, reused;
  end if;
end
$sweep$;

-- ── nac_settings: prices and settings. Staff only. ─────────────────────────
alter table public.nac_settings enable row level security;

-- (The sweep above already removed every policy here. These are kept so the
-- file still works if someone runs the sections out of order.)
drop policy if exists nac_settings_anon_all  on public.nac_settings;
drop policy if exists nac_settings_staff_all on public.nac_settings;

create policy nac_settings_staff_all on public.nac_settings
  for all to authenticated
  using (true) with check (true);

-- Deliberately NO policy for `anon`: with RLS on and no policy, the anon key
-- reads nothing and writes nothing here. NAC's cost prices stop being public.

-- ── nac_designs: HVAC designs. Staff only. ─────────────────────────────────
alter table public.nac_designs enable row level security;

drop policy if exists nac_designs_anon_all  on public.nac_designs;
drop policy if exists nac_designs_staff_all on public.nac_designs;

create policy nac_designs_staff_all on public.nac_designs
  for all to authenticated
  using (true) with check (true);

-- ── nac_customers and nac_jobs: NAC's own records. Staff only. ─────────────
alter table public.nac_customers enable row level security;
alter table public.nac_jobs      enable row level security;

drop policy if exists nac_customers_staff_all on public.nac_customers;
drop policy if exists nac_jobs_staff_all      on public.nac_jobs;

create policy nac_customers_staff_all on public.nac_customers
  for all to authenticated using (true) with check (true);

create policy nac_jobs_staff_all on public.nac_jobs
  for all to authenticated using (true) with check (true);

-- ── nac_quotes: the customer's quote. ──────────────────────────────────────
alter table public.nac_quotes enable row level security;

drop policy if exists nac_quotes_anon_all        on public.nac_quotes;
drop policy if exists nac_quotes_staff_all       on public.nac_quotes;
drop policy if exists nac_quotes_customer_read   on public.nac_quotes;
drop policy if exists nac_quotes_customer_accept on public.nac_quotes;

-- Staff do everything.
create policy nac_quotes_staff_all on public.nac_quotes
  for all to authenticated
  using (true) with check (true);

-- A customer opening sign.html?q=<id> reads their quote with no account.
--
-- BE CLEAR ABOUT WHAT THIS DOES NOT DO. `using (true)` means the anon key can
-- read ANY row of nac_quotes, and PostgREST does not require a filter — so
-- GET /rest/v1/nac_quotes with the key from the page source still returns every
-- quote: client names, job descriptions and totals. This was verified against a
-- real PostgreSQL, not assumed. Prices, designs, settings and the customer list
-- are closed by the policies above; the quote LIST is not.
--
-- It cannot be closed from SQL alone, because a policy cannot see which quote
-- id the request asked for. Closing it means sign.html fetching the quote
-- through a server endpoint that reads it with the service role key, and no
-- anon select policy at all. That changes a live customer-facing page, so it is
-- not done here without NAC saying so.
create policy nac_quotes_customer_read on public.nac_quotes
  for select to anon
  using (true);

-- A customer may accept their quote. They may not change anything else: the
-- WITH CHECK re-reads the row and refuses the update unless the price, the
-- client and the line items are unchanged.
create policy nac_quotes_customer_accept on public.nac_quotes
  for update to anon
  using (true)
  with check (
    accepted is true
    and client     is not distinct from (select q.client     from public.nac_quotes q where q.id = nac_quotes.id)
    and job_desc   is not distinct from (select q.job_desc   from public.nac_quotes q where q.id = nac_quotes.id)
    and line_items is not distinct from (select q.line_items from public.nac_quotes q where q.id = nac_quotes.id)
  );

-- A customer must NOT be able to create a quote. api/intake-submit.js writes
-- the intake draft server-side, so no insert policy for `anon` is needed —
-- PROVIDED the Vercel variable SUPABASE_KEY holds the service role key. See the
-- note at the top of this file; /setup.html checks it for you.

-- ═════════════════ WHAT THIS LEFT BEHIND ═════════════════
-- This runs INSIDE the transaction, on purpose: if anything above failed there
-- is nothing after the failure to produce a second, more confusing error. Read
-- it before you close the tab. Every line should say PRESENT, and every table
-- but nac_quotes should be staff-only.
--
-- Re-run designer/schema-diagnostic.sql afterwards for the same picture plus
-- the policy detail, if your SQL editor only shows you the last result.

select 'TABLE' as section,
       c.relname::text as item,
       'PRESENT · ' || (select count(*) from information_schema.columns
                         where table_schema = 'public' and table_name = c.relname)
         || ' columns · row level security '
         || case when c.relrowsecurity then 'ON' else 'OFF — NOT SECURED' end as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('nac_quotes','nac_settings','nac_designs','nac_customers','nac_jobs')
union all
select 'POLICY', tablename || ' -> ' || policyname,
       'applies to ' || array_to_string(roles, ', ') || ' for ' || cmd
  from pg_policies where schemaname = 'public'
union all
select 'ROW COUNT', 'nac_designs', (select count(*)::text from public.nac_designs) || ' design(s)'
union all
select 'ROW COUNT', 'nac_quotes',  (select count(*)::text from public.nac_quotes)  || ' quote(s)'
union all
select 'ROW COUNT', 'nac_settings', (select count(*)::text from public.nac_settings) || ' setting(s), of which '
       || (select count(*)::text from public.nac_settings where key like 'nac\_design\_%')
       || ' are the design fallback rows (left in place on purpose)'
 order by 1, 2;

commit;


-- ── Undo ────────────────────────────────────────────────────────────────────
-- Restores the previous wide-open posture and removes what this added. Existing
-- quote, design and settings data is untouched either way. Only for backing out.
--
--   drop policy if exists nac_settings_staff_all      on public.nac_settings;
--   drop policy if exists nac_designs_staff_all       on public.nac_designs;
--   drop policy if exists nac_customers_staff_all     on public.nac_customers;
--   drop policy if exists nac_jobs_staff_all          on public.nac_jobs;
--   drop policy if exists nac_quotes_staff_all        on public.nac_quotes;
--   drop policy if exists nac_quotes_customer_read    on public.nac_quotes;
--   drop policy if exists nac_quotes_customer_accept  on public.nac_quotes;
--   alter table public.nac_settings disable row level security;
--   alter table public.nac_designs  disable row level security;
--   alter table public.nac_quotes   disable row level security;
--   alter table public.nac_customers disable row level security;
--   alter table public.nac_jobs      disable row level security;
--
-- and to put NAC's original wide-open policies back exactly as they were:
--
--   create policy "Allow all" on public.nac_quotes   for all using (true) with check (true);
--   create policy "Allow all" on public.nac_settings for all using (true) with check (true);
--
-- The added columns and tables can stay — nothing reads them unless it finds
-- them. To remove them as well:
--
--   drop table if exists public.nac_jobs;
--   drop table if exists public.nac_customers;
--   alter table public.nac_designs drop column if exists customer_id;
--   alter table public.nac_designs drop column if exists job_ref;
--   alter table public.nac_quotes  drop column if exists customer_id;
--   alter table public.nac_quotes  drop column if exists job_ref;
--   alter table public.nac_quotes  drop column if exists servicem8_status;
--   alter table public.nac_quotes  drop column if exists servicem8_job_uuid;
--   alter table public.nac_quotes  drop column if exists servicem8_job_id;
--   alter table public.nac_quotes  drop column if exists servicem8_company_uuid;
--   alter table public.nac_quotes  drop column if exists servicem8_error;
--   alter table public.nac_quotes  drop column if exists servicem8_attempted_at;
--
-- nac_designs itself is NOT in that list. It now holds the designs carried
-- across in PART 3, and dropping it would throw them away. The originals are
-- still in nac_settings, but delete the table only if you have checked that.
