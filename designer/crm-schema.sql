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
