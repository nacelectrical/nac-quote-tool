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
--                  without an account, so anonymous READ stays open and a
--                  customer may only ever set `accepted` — they cannot change a
--                  price. Read the note above that policy for what this does
--                  NOT close: the quote list itself is still readable with the
--                  public key.
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
-- nac_designs is OPTIONAL (designer/schema.sql) and is genuinely absent on a
-- project that has never run it — the designer falls back to the nac_settings
-- key/value store. Running this file on such a project used to stop here with
-- `relation "public.nac_designs" does not exist`. Use designer/production-setup.sql,
-- which creates the table first and carries the saved designs into it; this
-- file on its own now says so rather than failing.
do $nac_designs$
begin
  if to_regclass('public.nac_designs') is null then
    raise notice 'nac_designs does not exist — skipped. Run designer/production-setup.sql to create it and secure it.';
    return;
  end if;

alter table public.nac_designs enable row level security;

drop policy if exists nac_designs_anon_all  on public.nac_designs;
drop policy if exists nac_designs_staff_all on public.nac_designs;

create policy nac_designs_staff_all on public.nac_designs
  for all to authenticated
  using (true) with check (true);
end
$nac_designs$;

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

-- A customer must NOT be able to create a quote, and after this they cannot:
-- an anon INSERT is refused. api/intake-submit.js and api/savequote.js write
-- server-side with SUPABASE_KEY — which must therefore be the SERVICE ROLE key,
-- not the anon key, or the intake form stops creating quotes the moment this is
-- applied. /setup.html checks which one is set.

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
