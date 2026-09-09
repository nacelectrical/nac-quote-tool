-- NAC AI HVAC DESIGNER — optional Supabase table.
--
-- The designer works WITHOUT this table: it falls back to the existing
-- `nac_settings` key/value store (and localStorage on the iPad). Create this
-- table when you want designs listed, searchable and joined to quotes/jobs.
--
-- Nothing in the existing schema is modified. `nac_quotes` and `nac_settings`
-- are untouched.

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

-- Match whatever RLS posture nac_quotes / nac_settings already use in this
-- project. The designer authenticates with the same anon key as the rest of
-- the tool, so the policy below mirrors the existing tables.
alter table public.nac_designs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'nac_designs' and policyname = 'nac_designs_anon_all') then
    create policy nac_designs_anon_all on public.nac_designs
      for all to anon using (true) with check (true);
  end if;
end $$;

-- Design revisions are stored inside the `design` JSON (DuctDesign.revisions),
-- so history survives even when only the settings fallback is available.
