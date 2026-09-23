-- ─────────────────────────────────────────────────────────────────────────────
-- QUOTE PRESENTATION — ISSUED LINKS AND THE CONTENT LIBRARY
--
-- Two tables, both locked to the service role.
--
-- A customer quote link has to be openable by somebody who is not logged in —
-- the token IS the credential. That is exactly why the browser must never read
-- these tables directly: an anon-key read of `nac_quote_issues` with a
-- permissive policy would hand every issued quote to anyone holding the public
-- key. So there is no anon policy here at all, and the customer page reaches
-- this data only through /api/quote-view, which runs server-side with the
-- service-role key and returns one presentation for one token.
--
-- Nick: "An unauthenticated user attempting to open an NAC internal page should
-- not gain access to customer, pricing or design information."
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.nac_quote_issues (
  token        text primary key,
  design_id    text,
  quote_rev    integer not null default 1,
  status       text not null default 'issued',
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz,
  responded_at timestamptz,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);

create index if not exists nac_quote_issues_design_idx on public.nac_quote_issues (design_id);
create index if not exists nac_quote_issues_status_idx on public.nac_quote_issues (status);

-- The presentation content library: reviews, past installations, image assets,
-- trust copy, upgrades, payment terms, terms and conditions.
create table if not exists public.nac_presentation_content (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
-- Enabled with NO policies. In PostgreSQL that means every role except the
-- table owner and the service role is refused, which is the intent: nothing
-- reaches a browser except through a server-side endpoint.

alter table public.nac_quote_issues enable row level security;
alter table public.nac_presentation_content enable row level security;

revoke all on public.nac_quote_issues from anon, authenticated;
revoke all on public.nac_presentation_content from anon, authenticated;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
-- Expect rowsecurity = true and zero policies on both tables.
--
--   select relname, relrowsecurity from pg_class
--    where relname in ('nac_quote_issues','nac_presentation_content');
--
--   select tablename, policyname from pg_policies
--    where tablename in ('nac_quote_issues','nac_presentation_content');
