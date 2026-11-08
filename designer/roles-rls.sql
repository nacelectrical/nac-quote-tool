-- ───────────────────────────────────────────────────────────────────────────
-- NAC — CLOSING THE COST PRICES. STEP 2 OF 2.
--
-- ⚠ DO NOT RUN THIS UNTIL designer/roles-schema.sql HAS BEEN APPLIED AND ITS
--   VERIFY QUERY RETURNS AN OWNER ROW FOR YOUR OWN ACCOUNT.
--
-- This is the file that actually restricts NAC's commercial figures. Run it
-- with no owner named and nac_settings closes to EVERY account, including
-- Nick's, and the pricing screen reads as broken. The guard below refuses to
-- run in that state rather than leaving you to find out.
--
-- ── WHAT IT CLOSES, AND WHY IT HAS TO BE HERE ──────────────────────────────
--
-- nac_settings holds, in its key/value rows:
--
--   nac_brands_v4             supplier cost prices (the MMEM trade list)
--   nac_ctrl_v4               zone kit costs
--   nac_hvac_settings_v1      commercial.jobFee — which IS the margin on NAC's
--                             cost-plus-fee method — the installation
--                             allowances, and the contingency percentage
--
-- The BROWSER reads that table directly over PostgREST with the signed-in
-- user's own token (designer/engines/store.mjs). So a technician who is signed
-- in can read every cost price with one fetch from the page they are already
-- holding, whatever the screen chooses to display. Hiding the fields is not a
-- control. This is the control.
--
-- ── WHAT IT DOES NOT CLOSE ─────────────────────────────────────────────────
--
-- Everything a technician needs to do their job:
--
--   nac_designs      drafts and assessments — staff, both ways, unchanged.
--   nac_quotes       unchanged, including the customer's own anonymous read
--                    and accept policies from designer/rls.sql.
--   nac_enquiries    staff read.
--   nac_handovers    staff read.
--
-- A permission model that stops the crew working gets switched off within a
-- week, and then there is no permission model.
-- ───────────────────────────────────────────────────────────────────────────

-- ── THE GUARD ──────────────────────────────────────────────────────────────
do $guard$
begin
  if to_regclass('public.nac_staff_roles') is null then
    raise exception 'Apply designer/roles-schema.sql first — nac_staff_roles does not exist.';
  end if;
  if not exists (select 1 from public.nac_staff_roles where role in ('owner', 'admin')) then
    raise exception
      'No owner is named in nac_staff_roles. Insert one (see the bottom of '
      'designer/roles-schema.sql) before running this file, or nac_settings '
      'closes to everybody including you.';
  end if;
end
$guard$;

-- ── nac_settings: owners only, both ways ───────────────────────────────────
alter table public.nac_settings enable row level security;

-- The October policy. It gave every authenticated user full access, which is
-- exactly the finding being fixed, so it goes.
drop policy if exists nac_settings_staff_all on public.nac_settings;
drop policy if exists nac_settings_anon_all  on public.nac_settings;
drop policy if exists nac_settings_owner_all on public.nac_settings;

create policy nac_settings_owner_all on public.nac_settings
  for all to authenticated
  using (public.nac_is_owner())
  with check (public.nac_is_owner());

-- Still deliberately NO policy for `anon`: the key in the page source reads
-- nothing here, as before.

-- ── VERIFY ─────────────────────────────────────────────────────────────────
-- The point of the exercise is that these two differ. Run both through the app
-- or /db-selftest.html, not the SQL editor (which runs as the service role and
-- bypasses RLS, so it answers for neither account):
--
--   signed in as an OWNER:       select count(*) from public.nac_settings;  -- rows
--   signed in as a TECHNICIAN:   select count(*) from public.nac_settings;  -- 0
--
-- And in the application: /api/whoami reports your role, and /settings.html
-- shows the pricing fields to an owner and an explanation to a technician.

-- ── UNDO ───────────────────────────────────────────────────────────────────
-- Restores the previous posture: every signed-in user sees the cost prices.
--
--   drop policy if exists nac_settings_owner_all on public.nac_settings;
--   create policy nac_settings_staff_all on public.nac_settings
--     for all to authenticated using (true) with check (true);
