-- One-time preparation for the verified empty April 2026 prototype.
-- On a fresh/current database this migration does nothing.
-- Retains every legacy table and enum; refuses to run if any legacy row exists.
begin;
do $archive$
declare t text; occupied boolean;
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='id')
     and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='user_id') then
    create schema gabriela_legacy_20261110;
    revoke all on schema gabriela_legacy_20261110 from public, anon, authenticated;
    foreach t in array array['profiles','properties','units','memberships','manager_assignments','tickets','ticket_messages','audit_logs','notifications'] loop
      execute format('lock table public.%I in access exclusive mode',t);
      execute format('select exists(select 1 from public.%I)',t) into occupied;
      if occupied then raise exception 'Legacy table % is not empty; manual data migration required',t; end if;
    end loop;
    foreach t in array array['profiles','properties','units','memberships','manager_assignments','tickets','ticket_messages','audit_logs','notifications'] loop
      execute format('alter table public.%I enable row level security',t);
      execute format('revoke all on public.%I from public, anon, authenticated',t);
      execute format('alter table public.%I set schema gabriela_legacy_20261110',t);
    end loop;
    alter type public.ticket_priority set schema gabriela_legacy_20261110;
    alter type public.ticket_status set schema gabriela_legacy_20261110;
    alter type public.user_role set schema gabriela_legacy_20261110;
  end if;
end $archive$;
commit;
