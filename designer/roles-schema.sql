-- ───────────────────────────────────────────────────────────────────────────
-- NAC — WHO IS AN OWNER. STEP 1 OF 2.
--
-- ADDITIVE AND SAFE. This file creates a table and two functions. It changes
-- no policy and closes nothing, so applying it on its own cannot lock anybody
-- out of anything.
--
-- STEP 2 is designer/roles-rls.sql, which is the file that actually restricts
-- nac_settings to owners. DO NOT APPLY STEP 2 UNTIL THE VERIFY QUERY AT THE
-- FOOT OF THIS FILE RETURNS YOUR OWN EMAIL AS AN OWNER. In that order, the
-- change is invisible to you; in the other order, you lock yourself out of
-- your own pricing screen and have to come back here to fix it.
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────────────
--
-- designer/rls.sql says, correctly for the time it was written: "Any
-- authenticated user is treated as NAC staff; there is no second tier, because
-- NAC is one team and inventing roles nobody asked for would be guesswork."
--
-- NAC has now asked. Every signed-in user could read nac_settings, which holds
-- the supplier cost prices, the job fee — which IS the margin on NAC's pricing
-- method — the installation allowances and the contingency percentage. The
-- browser reads that table directly over PostgREST with the signed-in user's
-- token, so hiding the fields in the page would have been theatre: the data is
-- one fetch away in the page the technician is already holding.
--
-- ── IT STILL IS NOT GUESSWORK ──────────────────────────────────────────────
--
-- Nobody is seeded as an owner by this file. It ships with NO rows. Who is an
-- owner is a decision only NAC can make, so it is made in the INSERT below,
-- by hand, with a real email address.
-- ───────────────────────────────────────────────────────────────────────────

-- ── THE TABLE ──────────────────────────────────────────────────────────────
--
-- Keyed on the email the user signs in with, lower-cased, because that is the
-- one identifier a Supabase JWT always carries and the one Nick can read in
-- Authentication → Users without looking up a uuid.
create table if not exists public.nac_staff_roles (
  user_email  text primary key,
  role        text not null,
  -- Why this person has this role, for whoever reads the table in a year.
  note        text,
  created_at  timestamptz not null default now(),

  constraint nac_staff_roles_known_role check (role in ('owner', 'admin', 'technician')),
  -- Lower-cased on the way in, so 'Nick@…' and 'nick@…' cannot be two rows
  -- that disagree about the same person.
  constraint nac_staff_roles_lower_email check (user_email = lower(user_email))
);

-- ── THE TWO FUNCTIONS THE POLICIES USE ─────────────────────────────────────
--
-- SECURITY DEFINER on purpose: the policy on nac_settings has to be able to
-- read nac_staff_roles to decide, and a technician cannot be allowed to read
-- that table freely (it would tell them whose account to go after). The
-- functions see it; the user does not.
--
-- `search_path` is pinned, because a SECURITY DEFINER function without a
-- pinned search_path can be redirected at a table somebody else controls.
create or replace function public.nac_role_of(p_email text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.nac_staff_roles where user_email = lower(p_email)
$$;

create or replace function public.nac_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    -- 1. Supabase app_metadata, which only a Supabase admin can write. The
    --    user_metadata twin IS user-writable and is deliberately not read.
    nullif(auth.jwt() -> 'app_metadata' ->> 'nac_role', '') in ('owner', 'admin'),
    false
  ) or coalesce(
    -- 2. This table.
    public.nac_role_of(auth.jwt() ->> 'email') in ('owner', 'admin'),
    false
  )
$$;

-- The table itself is readable only by an owner. A technician has no business
-- knowing who the owners are.
alter table public.nac_staff_roles enable row level security;

drop policy if exists nac_staff_roles_owner_read on public.nac_staff_roles;

create policy nac_staff_roles_owner_read on public.nac_staff_roles
  for select to authenticated
  using (public.nac_is_owner());

-- No insert/update/delete policy at all: roles are granted here, in the SQL
-- editor, or with the service-role key. Nothing in the application can promote
-- an account, which means a bug in the application cannot either.

-- ───────────────────────────────────────────────────────────────────────────
-- ── NOW NAME THE OWNERS. THIS IS THE PART ONLY NAC CAN DO. ────────────────
-- ───────────────────────────────────────────────────────────────────────────
--
-- Replace the address with the email you sign in to the NAC portal with — the
-- one in Supabase → Authentication → Users. Then run it.
--
--   insert into public.nac_staff_roles (user_email, role, note)
--   values (lower('you@example.com'), 'owner', 'Business owner')
--   on conflict (user_email) do update set role = excluded.role;
--
-- Add the technicians the same way. They do not strictly need a row — anybody
-- without one is treated as a technician — but a row makes the list readable:
--
--   insert into public.nac_staff_roles (user_email, role, note)
--   values (lower('tech@example.com'), 'technician', 'Install crew')
--   on conflict (user_email) do update set role = excluded.role;

-- ── VERIFY, BEFORE APPLYING STEP 2 ─────────────────────────────────────────
--
-- Run this SIGNED IN AS YOURSELF (the Supabase SQL editor runs as the service
-- role and will answer for that, so use /db-selftest.html or the app):
--
--   select public.nac_is_owner();          -- must be `t` for you
--
-- And from the SQL editor, to see the list:
--
--   select user_email, role from public.nac_staff_roles order by role, user_email;
--
-- At least one `owner` row must exist. If it does not, STOP — applying
-- designer/roles-rls.sql now would close nac_settings to everybody including
-- you.

-- ── UNDO ───────────────────────────────────────────────────────────────────
--   drop policy if exists nac_staff_roles_owner_read on public.nac_staff_roles;
--   drop function if exists public.nac_is_owner();
--   drop function if exists public.nac_role_of(text);
--   drop table if exists public.nac_staff_roles;
