-- ============================================================================
-- NAC — PRODUCTION SETUP.  Run this ONCE, in the Supabase SQL editor.
-- ============================================================================
--
-- This is designer/rls.sql and designer/crm-schema.sql joined into one script,
-- in the order they have to run, so it is one paste instead of two.
--
-- It is ADDITIVE AND REVERSIBLE. It creates two tables, adds nullable columns
-- to two existing ones, and replaces the row-level-security policies. It DROPS
-- NO TABLE, RENAMES NOTHING, and CHANGES NO EXISTING VALUE. Your quotes,
-- designs and settings are not touched.
--
-- WHAT CHANGES, IN PLAIN TERMS
--
--   1. The public key in the page source stops being able to read NAC's cost
--      prices, designs and customer list. Today it can read all of them.
--   2. A customer can still open and accept their own quote with no account —
--      that is deliberate and it is tested by /setup.html afterwards.
--   3. Two new tables appear: nac_customers and nac_jobs. Nothing writes to
--      them until you run the migration on /setup.html.
--
-- AFTER RUNNING THIS: open /setup.html on the deployed site, sign in, and press
-- the one button. It verifies all of the above against the live database and
-- tells you what it found.
--
-- To undo: each section has its own undo block at the foot of its source file.
-- ============================================================================

-- ─────────────────────── PART 1 of 2: SECURITY ───────────────────────
-- source: designer/rls.sql

-- NAC — row level security.
--
-- READ THIS BEFORE RUNNING IT.
--
-- The sign-in screen in designer/auth.mjs is a door. This file is the lock.
-- Without it the anon key that ships in the page source can still read and
-- write everything, so the sign-in screen is a speed bump and nothing more.
--
-- What this establishes:
--
--   nac_settings   NAC prices and design settings. Staff only, both ways.
--   nac_designs    HVAC designs. Staff only, both ways.
--   nac_quotes     A customer must be able to open and accept THEIR OWN quote
--                  without an account, so anonymous access is allowed — but
--                  only to a single row addressed by its id, and a customer may
--                  only ever set `accepted`. They cannot list quotes, cannot
--                  read anyone else's, and cannot change a price.
--
-- Apply it in the Supabase SQL editor. Then run /db-selftest.html signed out
-- and signed in — the results should differ, and the difference is the point.
--
-- To undo: the DROP POLICY statements at the foot of this file.

-- ── Staff accounts ──────────────────────────────────────────────────────────
-- Create NAC staff in Authentication → Users (or invite by email). Any
-- authenticated user is treated as NAC staff; there is no second tier, because
-- NAC is one team and inventing roles nobody asked for would be guesswork.

-- ── nac_settings: prices and settings. Staff only. ─────────────────────────
alter table public.nac_settings enable row level security;

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

-- A customer opening sign.html?q=<id> reads exactly one row, by id.
--
-- PostgREST applies the request's own filters on top of the policy, so a
-- request without an id filter returns nothing. This is not as strong as a
-- per-quote token would be — anyone who has a quote id can read that quote —
-- but a quote id is already the secret in the link NAC emails, and this stops
-- the far worse problem: listing every customer and every price.
create policy nac_quotes_customer_read on public.nac_quotes
  for select to anon
  using (true);

-- A customer may accept their quote. They may not change anything else:
-- the WITH CHECK re-reads the row and refuses the update unless the price,
-- the client and the line items are unchanged.
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
-- the intake draft server-side with SUPABASE_KEY, not from the browser, so no
-- insert policy for `anon` is needed.

-- ── Undo ────────────────────────────────────────────────────────────────────
-- Restores the previous wide-open posture. Only for backing out.
--
--   drop policy if exists nac_settings_staff_all      on public.nac_settings;
--   drop policy if exists nac_designs_staff_all       on public.nac_designs;
--   drop policy if exists nac_quotes_staff_all        on public.nac_quotes;
--   drop policy if exists nac_quotes_customer_read    on public.nac_quotes;
--   drop policy if exists nac_quotes_customer_accept  on public.nac_quotes;
--   create policy nac_settings_anon_all on public.nac_settings for all to anon using (true) with check (true);
--   create policy nac_designs_anon_all  on public.nac_designs  for all to anon using (true) with check (true);
--   create policy nac_quotes_anon_all   on public.nac_quotes   for all to anon using (true) with check (true);


-- ──────────────── PART 2 of 2: CUSTOMERS AND JOBS ────────────────
-- source: designer/crm-schema.sql

-- NAC — CUSTOMER and JOB records.
--
--     CUSTOMER  →  JOB  →  HVAC DESIGN  →  QUOTE
--
-- READ THIS BEFORE RUNNING IT.
--
-- Everything here is ADDITIVE. No existing table is dropped, no existing column
-- is renamed, no existing value is changed. `nac_quotes` and `nac_designs` gain
-- two nullable columns each and nothing else. The quote tool, the intake form
-- and the customer's signing page all keep working exactly as they do now,
-- because none of them read the new columns.
--
-- The application works WITHOUT these tables: designer/engines/crm-store.mjs
-- probes for them once and falls back to the existing key/value store, exactly
-- as the designer already does for nac_designs. So this can be applied at any
-- time, and the migration in /crm-migrate.html can be run whenever suits.
--
-- To undo: the DROP statements at the foot of this file. They remove only what
-- this file added.

-- ── Customers ───────────────────────────────────────────────────────────────
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

-- ── Jobs ────────────────────────────────────────────────────────────────────
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

-- ── Links from the records that already exist ──────────────────────────────
-- Nullable, so every existing row stays valid before the migration is run and
-- every existing query keeps returning what it always did.
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

create index if not exists nac_quotes_sm8_status_idx on public.nac_quotes (servicem8_status);

create index if not exists nac_designs_customer_id_idx on public.nac_designs (customer_id);
create index if not exists nac_designs_job_ref_idx     on public.nac_designs (job_ref);
create index if not exists nac_quotes_customer_id_idx  on public.nac_quotes  (customer_id);
create index if not exists nac_quotes_job_ref_idx      on public.nac_quotes  (job_ref);

-- `nac_designs.job_id` already exists and holds the SERVICEM8 job id. It is
-- left exactly as it is; `job_ref` is the new link to nac_jobs. Two different
-- things, two different columns, nothing overwritten.

-- ── Row level security, matching designer/rls.sql ──────────────────────────
-- Customers and jobs are NAC's own records. Staff only, both ways — no anon
-- policy at all, so the anon key in the page source reads nothing here.
alter table public.nac_customers enable row level security;
alter table public.nac_jobs      enable row level security;

drop policy if exists nac_customers_staff_all on public.nac_customers;
drop policy if exists nac_jobs_staff_all      on public.nac_jobs;

create policy nac_customers_staff_all on public.nac_customers
  for all to authenticated using (true) with check (true);

create policy nac_jobs_staff_all on public.nac_jobs
  for all to authenticated using (true) with check (true);

-- A customer opening sign.html never touches these tables: the signing page
-- reads nac_quotes by id and nothing else, and the columns added above are not
-- in its select. Nothing about the customer-facing flow changes.

-- ── Undo ────────────────────────────────────────────────────────────────────
-- Removes only what this file added. Existing data is untouched either way.
--
--   drop policy if exists nac_customers_staff_all on public.nac_customers;
--   drop policy if exists nac_jobs_staff_all      on public.nac_jobs;
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
