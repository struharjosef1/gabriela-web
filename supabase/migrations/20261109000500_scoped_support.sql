begin;
drop policy support_grants_select_owner on public.support_access_grants;
create policy gab_support_grant_read on public.support_access_grants for select to authenticated
  using (public.current_user_can_manage_org(organization_id)
    or (support_user_id=auth.uid() and auth.jwt()->>'aal'='aal2'
      and public.current_user_has_platform_role('support_operator')
      and status='active' and starts_at<=now() and ends_at>now()));

-- Raw tenant access stays disabled. Diagnostics are available through a bounded, audited operation.
create function public.gab_support_grant(o uuid,operator_email text,reason_text text,reference text,minutes int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare support_user uuid; grant_id uuid;
begin
  if not gabriela_private.is_owner(o) then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  if minutes is null or minutes not between 1 and 240 then raise exception 'GAB_INVALID' using errcode='22023'; end if;
  select u.id into support_user from auth.users u join public.platform_user_roles p on p.user_id=u.id
  where lower(u.email)=lower(btrim(operator_email)) and u.email_confirmed_at is not null and p.role='support_operator';
  if support_user is null then raise exception 'GAB_INVALID' using errcode='22023'; end if;
  insert into public.support_access_grants(organization_id,support_user_id,reason,support_ticket_reference,scope,ends_at,approved_by)
  values(o,support_user,gabriela_private.required(reason_text,500),gabriela_private.required(reference,80),
    '{"mode":"diagnostics"}',now()+make_interval(mins=>minutes),auth.uid()) returning id into grant_id;
  perform gabriela_private.audit(o,'support.grant','support',grant_id);
  return grant_id;
end $$;

create function public.gab_support_revoke(o uuid,g uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not gabriela_private.is_owner(o) then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  update public.support_access_grants set status='revoked',revoked_at=now(),revoked_by=auth.uid()
    where id=g and organization_id=o and status='active' and ends_at>now();
  if not found then raise exception 'GAB_INVALID' using errcode='22023'; end if;
  perform gabriela_private.audit(o,'support.revoke','support',g);
end $$;

create function public.gab_my_support_grants()
returns table(id uuid,organization_name text,support_ticket_reference text,ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select g.id,o.name,g.support_ticket_reference,g.ends_at
  from public.support_access_grants g join public.organizations o on o.id=g.organization_id
  where g.support_user_id=auth.uid() and public.current_user_has_platform_role('support_operator')
    and g.status='active' and now()>=g.starts_at and now()<g.ends_at and g.scope->>'mode'='diagnostics'
    and o.is_active and o.archived_at is null
$$;

create function public.gab_support_diagnostics(g uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare org uuid; result jsonb;
begin
  if coalesce(auth.jwt()->>'aal','')<>'aal2' or not public.current_user_has_platform_role('support_operator') then
    raise exception 'GAB_DENIED' using errcode='42501';
  end if;
  select a.organization_id into org from public.support_access_grants a join public.organizations o on o.id=a.organization_id
  where a.id=g and a.support_user_id=auth.uid() and a.status='active' and now()>=a.starts_at and now()<a.ends_at
    and a.scope->>'mode'='diagnostics' and o.is_active and o.archived_at is null
  for share of a;
  if org is null then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  select jsonb_build_object(
    'objects',(select count(*) from public.buildings where organization_id=org and archived_at is null),
    'units',(select count(*) from public.units where organization_id=org and archived_at is null),
    'tickets',(select count(*) from public.tickets where organization_id=org and archived_at is null),
    'email_errors',(select count(*) from public.notification_deliveries where organization_id=org and channel='email' and status='failed')
  ) into result;
  perform gabriela_private.audit(org,'support.diagnostics','support',g,null,jsonb_build_object('scope','diagnostics'));
  return result;
end $$;

create function public.gab_platform_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'aal','')<>'aal2' or not public.current_user_has_platform_role('platform_admin') then
    raise exception 'GAB_DENIED' using errcode='42501';
  end if;
  return jsonb_build_object(
    'organizations',(select count(*) from public.organizations where is_active and archived_at is null),
    'email_failures',(select count(*) from public.notification_deliveries where status='failed' and channel='email')
  );
end $$;

revoke all on function public.gab_support_grant(uuid,text,text,text,int),public.gab_support_revoke(uuid,uuid),
  public.gab_my_support_grants(),public.gab_support_diagnostics(uuid),public.gab_platform_summary() from public,anon;
grant execute on function public.gab_support_grant(uuid,text,text,text,int),public.gab_support_revoke(uuid,uuid),
  public.gab_my_support_grants(),public.gab_support_diagnostics(uuid),public.gab_platform_summary() to authenticated;

create or replace function gabriela_private.audit(o uuid, action text, entity text, target uuid, ticket uuid default null, info jsonb default '{}')
returns void language sql set search_path = '' as $$
  insert into public.audit_logs (organization_id,actor_user_id,actor_role,action,entity_type,entity_id,ticket_id,metadata)
  values (o,auth.uid(),coalesce(
    case when action='support.diagnostics' then 'support_operator' end,
    (select m.role::text from public.organization_members m where m.organization_id=o and m.user_id=auth.uid() and m.status='active'
      order by m.role limit 1)),action,entity,target::text,ticket,info)
$$;

create table gabriela_private.recorded_sessions (
  organization_id uuid not null,
  session_id uuid not null,
  actor uuid not null,
  primary key (organization_id,session_id)
);
create function public.gab_record_session()
returns void language plpgsql security definer set search_path = '' as $$
declare o uuid; sid uuid; a uuid:=auth.uid();
begin
  if a is null or coalesce(auth.jwt()->>'session_id','') !~ '^[0-9a-f-]{36}$' then return; end if;
  sid:=(auth.jwt()->>'session_id')::uuid;
  for o in select distinct m.organization_id from public.organization_members m
    where m.user_id=a and m.status='active'
  loop
    insert into gabriela_private.recorded_sessions(organization_id,session_id,actor) values(o,sid,a) on conflict do nothing;
    if found then perform gabriela_private.audit(o,'auth.login','account',a); end if;
  end loop;
end $$;
revoke all on function public.gab_record_session() from public,anon;
grant execute on function public.gab_record_session() to authenticated;
commit;
