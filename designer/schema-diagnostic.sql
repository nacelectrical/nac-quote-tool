-- ============================================================================
-- NAC — SCHEMA DIAGNOSTIC.  Run this FIRST, in the Supabase SQL editor.
-- ============================================================================
--
-- READ ONLY. It creates nothing, changes nothing, deletes nothing. It answers
-- one question: what is actually in the live database right now, compared with
-- what the application expects.
--
-- Paste the whole file and press Run. The result is one table you can read top
-- to bottom. Send it back if anything says MISSING.
--
-- Columns:
--   SECTION  what part of the picture the row belongs to
--   ITEM     the thing being reported
--   DETAIL   what was found
-- ============================================================================

drop table if exists _nac_diag;
create temp table _nac_diag (ord int, section text, item text, detail text);

do $diag$
declare
  r           record;
  t           text;
  c           text;
  n           bigint;
  rls         boolean;
  has_table   boolean;
  ord         int := 0;
  wanted      text[] := array['nac_quotes', 'nac_settings', 'nac_designs',
                              'nac_customers', 'nac_jobs'];
  -- The policies designer/production-setup.sql writes. Anything else on those
  -- tables is somebody else's and will be removed by it.
  ours        text[] := array['nac_settings_staff_all', 'nac_designs_staff_all',
                              'nac_customers_staff_all', 'nac_jobs_staff_all',
                              'nac_quotes_staff_all', 'nac_quotes_customer_read',
                              'nac_quotes_customer_accept'];
  needed_cols text[];
begin
  -- ── 1. What the application expects, and whether it is there ─────────────
  foreach t in array wanted loop
    ord := ord + 1;
    has_table := to_regclass('public.' || t) is not null;
    if has_table then
      execute format('select count(*) from public.%I', t) into n;
      select relrowsecurity into rls from pg_class
        where oid = to_regclass('public.' || t);
      insert into _nac_diag values (100 + ord, 'EXPECTED TABLE', t,
        'PRESENT · ' || n || ' row(s) · row level security ' ||
        case when rls then 'ON' else 'OFF' end);
    else
      insert into _nac_diag values (100 + ord, 'EXPECTED TABLE', t,
        'MISSING · nothing in public is named this');
    end if;
  end loop;

  -- ── 2. Every other table in public, so a differently named one shows up ──
  ord := 0;
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p')
       and not (c.relname = any (wanted))
     order by c.relname
  loop
    ord := ord + 1;
    execute format('select count(*) from public.%I', t) into n;
    select relrowsecurity into rls from pg_class where oid = to_regclass('public.' || t);
    insert into _nac_diag values (200 + ord, 'OTHER TABLE IN PUBLIC', t,
      n || ' row(s) · row level security ' || case when rls then 'ON' else 'OFF' end);
  end loop;
  if ord = 0 then
    insert into _nac_diag values (201, 'OTHER TABLE IN PUBLIC', '(none)',
      'Nothing else is in the public schema.');
  end if;

  -- ── 3. The columns the setup script and the policies depend on ───────────
  -- A policy that compares a column cannot be created if the column is not
  -- there, so this is checked before anything is run, not after it fails.
  ord := 0;
  for t, needed_cols in
    select * from (values
      ('nac_quotes',   array['id','client','job_desc','line_items','accepted']),
      ('nac_settings', array['key','value']),
      ('nac_designs',  array['id','design'])
    ) as v(tbl, cols)
  loop
    if to_regclass('public.' || t) is null then
      ord := ord + 1;
      insert into _nac_diag values (300 + ord, 'REQUIRED COLUMN', t,
        'table is MISSING, so its columns could not be checked');
      continue;
    end if;
    foreach c in array needed_cols loop
      ord := ord + 1;
      insert into _nac_diag values (300 + ord, 'REQUIRED COLUMN', t || '.' || c,
        coalesce((select 'PRESENT · ' || data_type from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = c),
                 'MISSING'));
    end loop;
  end loop;

  -- ── 4. Columns the setup script would add ────────────────────────────────
  ord := 0;
  for t, c in
    select * from (values
      ('nac_designs','customer_id'), ('nac_designs','job_ref'),
      ('nac_quotes','customer_id'),  ('nac_quotes','job_ref'),
      ('nac_quotes','servicem8_status'), ('nac_quotes','servicem8_job_uuid'),
      ('nac_quotes','servicem8_job_id'), ('nac_quotes','servicem8_company_uuid'),
      ('nac_quotes','servicem8_error'),  ('nac_quotes','servicem8_attempted_at')
    ) as v(tbl, col)
  loop
    ord := ord + 1;
    insert into _nac_diag values (400 + ord, 'COLUMN TO BE ADDED', t || '.' || c,
      case when to_regclass('public.' || t) is null then 'table is MISSING'
           when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = t and column_name = c)
             then 'already there — the script will skip it'
           else 'not there — the script will add it (nullable, nothing is changed)'
      end);
  end loop;

  -- ── 5. Designs living in the key/value fallback ──────────────────────────
  -- Before nac_designs exists, designer/engines/store.mjs saves each design as
  -- an nac_settings row keyed nac_design_<id>. Those are real saved designs and
  -- the count below is how many would otherwise stop appearing in the list.
  if to_regclass('public.nac_settings') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='nac_settings' and column_name='key') then
    execute $q$select count(*) from public.nac_settings where key like 'nac\_design\_%'$q$ into n;
    insert into _nac_diag values (501, 'SAVED DESIGNS IN THE FALLBACK',
      'nac_settings rows keyed nac_design_*', n || ' design(s)');
    execute $q$select count(*) from public.nac_settings where key in ('nac_customers_v1','nac_jobs_v1')$q$ into n;
    insert into _nac_diag values (502, 'SAVED CUSTOMERS IN THE FALLBACK',
      'nac_settings rows nac_customers_v1 / nac_jobs_v1',
      n || ' row(s) — migrated by /setup.html, not by SQL');
  else
    insert into _nac_diag values (501, 'SAVED DESIGNS IN THE FALLBACK', 'nac_settings',
      'could not be counted — the table or its key column is MISSING');
  end if;

  -- ── 6. Policies that exist today, and what production-setup.sql does to them
  -- Policies are PERMISSIVE: they are OR'd together, so one policy granting
  -- everyone access defeats every tight policy added beside it. Anything listed
  -- here on one of the five app tables is REMOVED by production-setup.sql and
  -- replaced by the policies written in that file. Read this section before
  -- running it — this is the part that takes access away.
  ord := 0;
  for r in
    select tablename, policyname, roles, cmd, coalesce(qual, 'true') as qual
      from pg_policies where schemaname = 'public'
     order by tablename, policyname
  loop
    ord := ord + 1;
    insert into _nac_diag values (600 + ord, 'EXISTING POLICY',
      r.tablename || ' -> ' || r.policyname,
      'applies to ' || array_to_string(r.roles, ', ') || ' for ' || r.cmd || ' · ' ||
      case
        -- Written by production-setup.sql on an earlier run. Re-running rewrites
        -- it identically, so there is nothing to warn about.
        when r.policyname = any (ours)
          then 'written by production-setup.sql — already applied'
        when r.tablename <> all (wanted)
          then 'not an app table — production-setup.sql leaves it alone'
        else 'NOT written by production-setup.sql — it WILL BE REMOVED and the access it grants will be gone'
      end ||
      case
        -- The one deliberate open door: a customer with no account has to be
        -- able to read their quote. Say what it really costs rather than
        -- flagging it as a mistake.
        when r.policyname = 'nac_quotes_customer_read'
          then ' · this one is deliberate: it is how a customer opens sign.html with no account. '
               || 'It also means the public key can LIST every quote — see the note above it in production-setup.sql'
        when r.policyname <> all (ours) and r.qual = 'true'
             and ('public' = any (r.roles::text[]) or 'anon' = any (r.roles::text[]))
          then ' · WARNING: this grants access to everybody. While it exists, NOTHING on this table is secured, '
               || 'no matter what other policies are added beside it'
        else ''
      end);
  end loop;
  if ord = 0 then
    insert into _nac_diag values (601, 'EXISTING POLICY', '(none)',
      'No row level security policies exist in public.');
  end if;

  -- ── 7. Server version, for the record ────────────────────────────────────
  insert into _nac_diag values (700, 'SERVER', 'postgres', version());
end
$diag$;

select section, item, detail from _nac_diag order by ord;
