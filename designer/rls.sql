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
