begin;
-- Anonymous clients have no domain-data access. Login uses the separate Auth API.
revoke all on all tables in schema public from public, anon;
revoke all on all sequences in schema public from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.ticket_assignments from public, anon, authenticated;
-- RLS helpers remain callable by authenticated clients, never anonymously.
do $permissions$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'current_user_can_access_ticket','current_user_can_manage_org','current_user_has_active_support_grant',
      'current_user_has_org_role','current_user_has_platform_role','current_user_is_building_manager',
      'current_user_is_linked_person','current_user_is_org_member','current_user_is_ticket_assignee',
      'current_user_is_ticket_watcher','gab_can_manage_building','gab_can_manage_person',
      'gab_can_manage_ticket','gab_can_read_building','gab_can_read_unit')
  loop
    execute format('revoke all on function %s from public, anon',f);
    execute format('grant execute on function %s to authenticated, service_role',f);
  end loop;
end $permissions$;
alter table gabriela_private.overdue_events enable row level security;
alter table gabriela_private.recorded_sessions enable row level security;
commit;
