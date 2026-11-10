begin;
create schema if not exists gabriela_private;
revoke all on schema gabriela_private from public, anon, authenticated;

-- The client may read through RLS. All domain writes go through guarded commands.
do $$
declare t text;
begin
  foreach t in array array['organizations','organization_members','organization_settings','support_access_grants',
    'buildings','building_manager_assignments','units','persons','person_user_links','unit_occupancies','unit_ownerships','unit_contacts',
    'tickets','ticket_assignments','ticket_watchers','ticket_status_history','ticket_messages','ticket_categories','priorities',
    'workflow_statuses','file_objects','ticket_attachments','audit_logs','notifications','notification_preferences']
  loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public, anon, authenticated',t);
  end loop;
end $$;

alter table public.persons add column person_type text not null default 'natural' check (person_type in ('natural','legal'));
alter table public.tickets add column resolution_summary text;
alter table public.tickets add column resolution_confirmed_at timestamptz;
alter table public.tickets add column resolution_disputed_at timestamptz;
alter table public.ticket_messages add column technician_visible boolean not null default false;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email text not null check (email = lower(btrim(email))),
  role public.organization_member_role not null,
  building_id uuid references public.buildings(id),
  person_id uuid references public.persons(id),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '7 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);
alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;
revoke all on public.organization_invitations from public, anon, authenticated;

create or replace function public.current_user_is_org_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.organization_id=target_organization_id and m.user_id=auth.uid() and m.status='active'
      and o.is_active and o.archived_at is null)
$$;

create or replace function public.current_user_has_org_role(target_organization_id uuid,required_role public.organization_member_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_members m join public.organizations o on o.id=m.organization_id
    where m.organization_id=target_organization_id and m.user_id=auth.uid() and m.status='active' and m.role=required_role
      and o.is_active and o.archived_at is null)
$$;

create or replace function public.current_user_is_building_manager(target_building_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.building_manager_assignments a
    join public.buildings b on b.id=a.building_id and b.organization_id=a.organization_id
    where a.building_id=target_building_id and a.user_id=auth.uid() and a.revoked_at is null
      and public.current_user_has_org_role(b.organization_id,'manager')
      and auth.jwt()->>'aal'='aal2'
  )
$$;

create function gabriela_private.is_owner(o uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal'='aal2',false) and public.current_user_has_org_role(o,'organization_owner')
$$;

create or replace function public.current_user_can_manage_org(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select gabriela_private.is_owner(target_organization_id)
$$;

-- Legacy grants did not enforce their scope. Access remains closed until scoped support operations exist.
create or replace function public.current_user_has_active_support_grant(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$ select false $$;

create function public.gab_can_manage_building(o uuid,b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select gabriela_private.is_owner(o) or exists (
    select 1 from public.buildings x where x.id=b and x.organization_id=o
      and public.current_user_is_building_manager(x.id)
  )
$$;

create function public.gab_can_read_unit(o uuid,u uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_has_org_role(o,'resident') and exists (
    select 1 from public.units x
    join public.unit_occupancies a on a.unit_id=x.id and a.organization_id=x.organization_id
    join public.person_user_links l on l.person_id=a.person_id and l.organization_id=x.organization_id
    where x.id=u and x.organization_id=o and x.archived_at is null and l.user_id=auth.uid() and l.unlinked_at is null
      and current_date between a.valid_from and coalesce(a.valid_to,'infinity'::date)
    union all
    select 1 from public.units x
    join public.unit_ownerships a on a.unit_id=x.id and a.organization_id=x.organization_id
    join public.person_user_links l on l.person_id=a.person_id and l.organization_id=x.organization_id
    where x.id=u and x.organization_id=o and x.archived_at is null and l.user_id=auth.uid() and l.unlinked_at is null
      and current_date between a.valid_from and coalesce(a.valid_to,'infinity'::date)
  )
$$;

create function public.gab_can_read_building(o uuid,b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.gab_can_manage_building(o,b) or exists (
    select 1 from public.units u where u.organization_id=o and u.building_id=b
      and public.gab_can_read_unit(o,u.id)
  )
$$;

create function public.gab_can_manage_person(o uuid,p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select gabriela_private.is_owner(o) or exists (
    select 1 from public.unit_occupancies a join public.units u on u.id=a.unit_id and u.organization_id=a.organization_id
    where a.organization_id=o and a.person_id=p and public.current_user_is_building_manager(u.building_id)
    union all
    select 1 from public.unit_ownerships a join public.units u on u.id=a.unit_id and u.organization_id=a.organization_id
    where a.organization_id=o and a.person_id=p and public.current_user_is_building_manager(u.building_id)
  )
$$;

create or replace function public.current_user_is_ticket_assignee(target_ticket_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ticket_assignments a
    join public.tickets t on t.id=a.ticket_id and t.organization_id=a.organization_id
    where t.id=target_ticket_id and a.assignee_user_id=auth.uid() and a.unassigned_at is null
      and public.current_user_has_org_role(t.organization_id,'technician')
  )
$$;

create or replace function public.current_user_can_access_ticket(target_ticket_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tickets t where t.id=target_ticket_id and t.archived_at is null and (
      public.gab_can_manage_building(t.organization_id,t.building_id)
      or public.current_user_is_ticket_assignee(t.id)
      or (public.current_user_has_org_role(t.organization_id,'resident')
          and t.visibility='public' and t.reporter_user_id=auth.uid())
    )
  )
$$;

create function public.gab_can_manage_ticket(i uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tickets t where t.id=i and t.archived_at is null
    and public.gab_can_manage_building(t.organization_id,t.building_id))
$$;

drop policy buildings_select_org_member on public.buildings;
create policy gab_building_read on public.buildings for select to authenticated
  using (archived_at is null and public.gab_can_read_building(organization_id,id));
drop policy units_select_org_member on public.units;
create policy gab_unit_read on public.units for select to authenticated
  using (archived_at is null and (public.gab_can_manage_building(organization_id,building_id) or public.gab_can_read_unit(organization_id,id)));
drop policy persons_select_scoped on public.persons;
create policy gab_person_read on public.persons for select to authenticated
  using (archived_at is null and (public.gab_can_manage_person(organization_id,id)
    or (public.current_user_has_org_role(organization_id,'resident') and public.current_user_is_linked_person(id))));
drop policy organization_members_select_same_org on public.organization_members;
create policy gab_members_read on public.organization_members for select to authenticated
  using (user_id=auth.uid() or public.current_user_can_manage_org(organization_id));
drop policy building_manager_assignments_select_org_member on public.building_manager_assignments;
create policy gab_building_managers_read on public.building_manager_assignments for select to authenticated
  using (public.gab_can_manage_building(organization_id,building_id));
drop policy tickets_select_scoped on public.tickets;
create policy gab_ticket_read on public.tickets for select to authenticated using (public.current_user_can_access_ticket(id));
drop policy ticket_messages_select_scoped on public.ticket_messages;
create policy gab_message_read on public.ticket_messages for select to authenticated using (
  archived_at is null and public.current_user_can_access_ticket(ticket_id)
  and (visibility='public' or public.gab_can_manage_ticket(ticket_id)
    or (technician_visible and public.current_user_is_ticket_assignee(ticket_id)))
);
drop policy ticket_attachments_select_scoped on public.ticket_attachments;
create policy gab_attachment_read on public.ticket_attachments for select to authenticated using (
  public.current_user_can_access_ticket(ticket_id) and (visibility='public' or public.gab_can_manage_ticket(ticket_id))
);
drop policy notifications_select_self on public.notifications;
create policy gab_notification_read on public.notifications for select to authenticated
  using (user_id=auth.uid() and public.current_user_is_org_member(organization_id)
    and (ticket_id is null or public.current_user_can_access_ticket(ticket_id)));
-- Access to raw audit and history stays limited to managers of the particular record.
drop policy audit_logs_select_authorized on public.audit_logs;
create policy gab_audit_read on public.audit_logs for select to authenticated
  using (public.current_user_can_manage_org(organization_id) or public.gab_can_manage_ticket(ticket_id));
drop policy ticket_status_history_select_scoped on public.ticket_status_history;
create policy gab_history_read on public.ticket_status_history for select to authenticated
  using (public.gab_can_manage_ticket(ticket_id));
drop policy ticket_watchers_select_scoped on public.ticket_watchers;
drop policy ticket_watchers_manage on public.ticket_watchers;

-- Only server-side quarantine and download endpoints may access attachment bytes.
drop policy gabriela_private_select on storage.objects;
drop policy gabriela_private_insert on storage.objects;
commit;
