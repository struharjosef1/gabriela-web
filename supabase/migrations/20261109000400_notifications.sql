begin;

alter table public.notification_deliveries add column lease_id uuid;
create index gab_delivery_due on public.notification_deliveries (next_attempt_at, id)
  where channel='email' and status in ('pending','failed');

-- Recheck the recipient's live membership and assignment immediately before delivery.
create function gabriela_private.recipient_can_read(t public.tickets, recipient uuid)
returns boolean language sql stable set search_path = '' as $$
  select t.archived_at is null and exists (
    select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id
    where o.id=t.organization_id and o.is_active and o.archived_at is null and m.status='active' and m.user_id=recipient and (
      m.role='organization_owner'
      or (m.role='resident' and t.reporter_user_id=recipient and t.visibility='public')
      or (m.role='manager' and exists(select 1 from public.building_manager_assignments a
        where a.organization_id=o.id and a.building_id=t.building_id and a.user_id=recipient and a.revoked_at is null))
      or (m.role='technician' and exists(select 1 from public.ticket_assignments a
        where a.organization_id=o.id and a.ticket_id=t.id and a.assignee_user_id=recipient and a.unassigned_at is null))
    )
  )
$$;

create or replace function gabriela_private.notify_ticket(t public.tickets, event text, label text)
returns void language sql set search_path = '' as $$
  with recipients as (
    select distinct m.user_id,coalesce(p.in_app_enabled,true) and coalesce(u.in_app_notifications,true) in_app,
      coalesce(p.email_enabled,true) and coalesce(u.email_notifications,true) email
    from public.organization_members m
    left join public.user_preferences u on u.user_id=m.user_id
    left join public.notification_preferences p on p.organization_id=m.organization_id and p.user_id=m.user_id and p.event_type=event
    where m.organization_id=t.organization_id and m.status='active' and m.user_id is distinct from auth.uid()
      and gabriela_private.recipient_can_read(t,m.user_id)
      and (event<>'ticket.overdue' or m.role in ('organization_owner','manager','technician'))
  ), delivered as (
    insert into public.notifications (organization_id,user_id,ticket_id,event_type,title,read_at,payload)
    select t.organization_id,user_id,t.id,event,label,case when not in_app then now() end,
      jsonb_build_object('visible_in_app',in_app)
    from recipients where in_app or email
    returning id,user_id
  )
  insert into public.notification_deliveries(organization_id,notification_id,channel,status,sent_at,next_attempt_at)
  select t.organization_id,d.id,ch.channel,
    case when ch.channel='in_app' then 'sent'::public.delivery_status else 'pending'::public.delivery_status end,
    case when ch.channel='in_app' then now() end,
    case when ch.channel='email' then now() end
  from delivered d join recipients r on r.user_id=d.user_id
  cross join lateral (values ('in_app'::public.notification_channel,r.in_app),('email'::public.notification_channel,r.email)) ch(channel,enabled)
  where ch.enabled
$$;

drop policy gab_notification_read on public.notifications;
create policy gab_notification_read on public.notifications for select to authenticated using (
  user_id=auth.uid() and public.current_user_is_org_member(organization_id)
  and (ticket_id is null or public.current_user_can_access_ticket(ticket_id))
  and coalesce(payload->>'visible_in_app','true')='true'
);

create function public.gab_set_notification_preferences(in_app boolean,email boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or in_app is null or email is null then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  insert into public.user_preferences(user_id,in_app_notifications,email_notifications)
    values(auth.uid(),in_app,email) on conflict(user_id) do update
    set in_app_notifications=excluded.in_app_notifications,email_notifications=excluded.email_notifications;
end $$;
revoke all on function public.gab_set_notification_preferences(boolean,boolean) from public,anon;
grant execute on function public.gab_set_notification_preferences(boolean,boolean) to authenticated;

create table gabriela_private.overdue_events (
  ticket_id uuid not null references public.tickets(id),
  due_at timestamptz not null,
  primary key(ticket_id,due_at)
);

create function public.gab_enqueue_overdue()
returns integer language plpgsql security definer set search_path = '' as $$
declare t public.tickets; n integer:=0;
begin
  for t in
    select x.* from public.tickets x join public.workflow_statuses w on w.id=x.status_id and w.organization_id=x.organization_id
    where x.archived_at is null and x.due_at<now() and not w.is_terminal and w.code not in ('closed','canceled','cancelled','rejected')
      and not exists(select 1 from gabriela_private.overdue_events e where e.ticket_id=x.id and e.due_at=x.due_at)
    order by x.due_at limit 100 for update of x skip locked
  loop
    insert into gabriela_private.overdue_events(ticket_id,due_at) values(t.id,t.due_at) on conflict do nothing;
    if found then
      perform gabriela_private.notify_ticket(t,'ticket.overdue','Požadavek je po termínu');
      n:=n+1;
    end if;
  end loop;
  return n;
end $$;

create function public.gab_claim_email()
returns table(id uuid,lease uuid,recipient text)
language plpgsql security definer set search_path = '' as $$
begin
  -- Cancel revoked memberships, changed preferences and invalid addresses.
  update public.notification_deliveries d set status='cancelled',last_error='recipient unavailable',lease_id=null
  from public.notifications n join public.tickets t on t.id=n.ticket_id
  where d.notification_id=n.id and d.channel='email' and d.status in ('pending','failed') and d.next_attempt_at<=now() and (
    not gabriela_private.recipient_can_read(t,n.user_id)
    or not exists(select 1 from auth.users u where u.id=n.user_id and u.email_confirmed_at is not null and u.email is not null)
    or exists(select 1 from public.user_preferences u where u.user_id=n.user_id and not u.email_notifications)
  );

  return query with chosen as (
    select d.id from public.notification_deliveries d
    where d.channel='email' and d.status in ('pending','failed') and d.next_attempt_at<=now() and d.attempt_count<8
    order by d.next_attempt_at,d.id limit 10 for update skip locked
  ), leased as (
    update public.notification_deliveries d set lease_id=gen_random_uuid(),attempt_count=attempt_count+1,
      next_attempt_at=now()+interval '5 minutes'
    from chosen c where d.id=c.id returning d.id,d.lease_id,d.notification_id
  )
  select l.id,l.lease_id,u.email::text from leased l
  join public.notifications n on n.id=l.notification_id join auth.users u on u.id=n.user_id;
end $$;

create function public.gab_finish_email(delivery uuid,lease uuid,success boolean,provider_id text,failure text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_deliveries d
  set status=case when success then 'sent'::public.delivery_status else 'failed'::public.delivery_status end,
    sent_at=case when success then now() end,lease_id=null,
    provider_message_id=case when success then left(provider_id,128) end,
    last_error=case when not success then left(failure,128) end,
    next_attempt_at=case when not success and d.attempt_count<8 then now()+make_interval(mins=>(2^least(d.attempt_count,7))::int) end
  where d.id=delivery and d.lease_id=lease and d.channel='email';
  return found;
end $$;

revoke all on function public.gab_enqueue_overdue(),public.gab_claim_email(),
  public.gab_finish_email(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.gab_enqueue_overdue(),public.gab_claim_email(),
  public.gab_finish_email(uuid,uuid,boolean,text,text) to service_role;

create function public.gab_delivery_overview(o uuid)
returns table(id uuid,title text,status public.delivery_status,attempt_count integer,last_error text,updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.id,n.title,d.status,d.attempt_count,d.last_error,d.updated_at
  from public.notification_deliveries d join public.notifications n on n.id=d.notification_id and n.organization_id=d.organization_id
  where d.organization_id=o and d.channel='email' and gabriela_private.is_owner(o)
  order by d.updated_at desc limit 50
$$;
revoke all on function public.gab_delivery_overview(uuid) from public,anon;
grant execute on function public.gab_delivery_overview(uuid) to authenticated;
commit;
