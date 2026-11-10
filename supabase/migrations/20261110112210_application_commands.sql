begin;

create function gabriela_private.required(value text, maximum int)
returns text language plpgsql immutable set search_path = '' as $$
begin
  value := btrim(value);
  if value is null or length(value) not between 1 and maximum then
    raise exception 'GAB_INVALID' using errcode='22023';
  end if;
  return value;
end $$;

create function gabriela_private.catalog(o uuid)
returns void language plpgsql set search_path = '' as $$
begin
  insert into public.workflow_statuses (organization_id,code,name,sort_order,is_initial,is_terminal)
  select o, code, name, ord, code='new', code in ('closed','canceled','rejected') from (
    values ('new','Nové',1),('accepted','Přijato',2),('assessment','Čeká na posouzení',3),
      ('in_progress','Pracuje se na tom',4),('waiting_vendor','Čeká na dodavatele',5),
      ('waiting_user','Čeká na uživatele',6),('resolved','Vyřešeno',7),('closed','Uzavřeno',8),
      ('rejected','Zamítnuto',9),('canceled','Stornováno',10)
  ) v(code,name,ord) where code <> 'new' or not exists (
    select 1 from public.workflow_statuses w where w.organization_id=o and w.is_initial and w.code<>'new'
  ) on conflict (organization_id,code) do nothing;
  insert into public.priorities (organization_id,code,name,rank)
  values (o,'low','Nízká',1),(o,'normal','Běžná',2),(o,'high','Vysoká',3),(o,'urgent','Urgentní',4),(o,'emergency','Havárie',5)
  on conflict do nothing;
  insert into public.ticket_categories (organization_id,name)
  select o,name from unnest(array['Voda a odpady','Elektřina','Topení','Výtah','Společné prostory','Ostatní']) name
  on conflict do nothing;
end $$;

create function gabriela_private.audit(o uuid, action text, entity text, target uuid, ticket uuid default null, info jsonb default '{}')
returns void language sql set search_path = '' as $$
  insert into public.audit_logs (organization_id,actor_user_id,action,entity_type,entity_id,ticket_id,metadata)
  values (o,auth.uid(),action,entity,target::text,ticket,info)
$$;

create function gabriela_private.notify_ticket(t public.tickets, event text, label text)
returns void language sql set search_path = '' as $$
  with delivered as (
    insert into public.notifications (organization_id,user_id,ticket_id,event_type,title)
    select t.organization_id,m.user_id,t.id,event,label from public.organization_members m
    left join public.notification_preferences p on p.organization_id=m.organization_id and p.user_id=m.user_id and p.event_type=event
    where m.organization_id=t.organization_id and m.status='active' and m.user_id<>auth.uid()
      and coalesce(p.in_app_enabled,true)
      and (m.role='organization_owner'
        or (m.role='resident' and t.visibility='public' and t.reporter_user_id=m.user_id)
        or (m.role='manager' and exists (select 1 from public.building_manager_assignments a
          where a.organization_id=t.organization_id and a.building_id=t.building_id and a.user_id=m.user_id and a.revoked_at is null))
        or (m.role='technician' and exists (select 1 from public.ticket_assignments a
          where a.organization_id=t.organization_id and a.ticket_id=t.id and a.assignee_user_id=m.user_id and a.unassigned_at is null)))
    group by m.user_id
    returning id,user_id
  )
  insert into public.notification_deliveries(organization_id,notification_id,channel,status,sent_at)
  select t.organization_id,id,'in_app','sent',now() from delivered
$$;

create function public.gab_list_invitations(o uuid)
returns table(id uuid,email text,role public.organization_member_role,expires_at timestamptz,accepted_at timestamptz,revoked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id,i.email,i.role,i.expires_at,i.accepted_at,i.revoked_at
  from public.organization_invitations i
  where i.organization_id=o and gabriela_private.is_owner(o)
  order by i.created_at desc
$$;

create function public.gab_pending_invitations()
returns table(id uuid,organization_id uuid,organization_name text,role public.organization_member_role)
language sql stable security definer set search_path = '' as $$
  select i.id,o.id,o.name,i.role from public.organization_invitations i
  join public.organizations o on o.id=i.organization_id and o.is_active and o.archived_at is null
  join auth.users u on u.id=auth.uid() and lower(u.email)=i.email and u.email_confirmed_at is not null
  where i.accepted_at is null and i.revoked_at is null and i.expires_at>now()
$$;

-- Initial organization creation is an operator action. An account cannot self-promote.
create function public.gab_provision_organization(owner_user uuid, name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  if not exists(select 1 from auth.users where id=owner_user and email_confirmed_at is not null) then
    raise exception 'GAB_INVALID_OWNER' using errcode='22023';
  end if;
  insert into public.organizations(name,slug) values (gabriela_private.required(name,160),'gab-'||gen_random_uuid()) returning id into o;
  insert into public.organization_members(organization_id,user_id,role,status,joined_at)
    values(o,owner_user,'organization_owner','active',now());
  insert into public.organization_settings(organization_id,support_access_enabled) values(o,false);
  perform gabriela_private.catalog(o);
  perform gabriela_private.audit(o,'organization.provision','organization',o);
  return o;
end $$;

create function public.gab_command(operation text, o uuid, payload jsonb, request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target uuid;
  b uuid := nullif(payload->>'building_id','')::uuid;
  u uuid := nullif(payload->>'unit_id','')::uuid;
  person uuid := nullif(payload->>'person_id','')::uuid;
  assignee uuid := nullif(payload->>'user_id','')::uuid;
  i uuid := nullif(payload->>'id','')::uuid;
  category uuid := nullif(payload->>'category_id','')::uuid;
  priority uuid := nullif(payload->>'priority_id','')::uuid;
  invitation public.organization_invitations;
  assigned_role public.organization_member_role;
  affected_user uuid;
  ticket public.tickets;
  owner boolean;
  manages boolean;
  current_code text;
  next_code text;
  next_status uuid;
  reason text;
  label text;
  answer jsonb;
  prior_hash text;
  fingerprint text := md5(payload::text);
  internal_note boolean;
  notice text;
  date_from date;
  date_to date;
begin
  if actor is null or request_id is null or o is null then
    raise exception 'GAB_DENIED' using errcode='42501';
  end if;
  if not exists(select 1 from public.organizations x where x.id=o and x.is_active and x.archived_at is null) then
    raise exception 'GAB_DENIED' using errcode='42501';
  end if;
  owner := gabriela_private.is_owner(o);
  if operation <> 'invitation.accept' and not public.current_user_is_org_member(o) then
    raise exception 'GAB_DENIED' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(o::text||actor::text||request_id::text,0));
  select response_body,request_hash into answer,prior_hash from public.idempotency_keys
    where organization_id=o and idempotency_key=actor::text||':'||request_id::text and idempotency_keys.operation=gab_command.operation;
  if found then
    if prior_hash<>fingerprint then raise exception 'GAB_CONFLICT' using errcode='23505'; end if;
    return answer;
  end if;

  if operation='invitation.accept' then
    select * into invitation from public.organization_invitations inv
    where inv.id=i and inv.organization_id=o and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at>now()
      and exists(select 1 from auth.users x where x.id=actor and lower(x.email)=inv.email and x.email_confirmed_at is not null)
    for update;
    if not found then raise exception 'GAB_DENIED' using errcode='42501'; end if;
    insert into public.organization_members(organization_id,user_id,role,status,joined_at,created_by)
    values(o,actor,invitation.role,'active',now(),invitation.invited_by)
    on conflict(organization_id,user_id,role) do update set status='active',joined_at=now();
    if invitation.role='manager' then
      insert into public.building_manager_assignments(organization_id,building_id,user_id,assigned_by)
      values(o,invitation.building_id,actor,invitation.invited_by)
      on conflict(organization_id,building_id,user_id) do update set revoked_at=null,revoked_by=null;
    elsif invitation.role='resident' then
      insert into public.person_user_links(organization_id,person_id,user_id,linked_by)
      values(o,invitation.person_id,actor,invitation.invited_by)
      on conflict(organization_id,person_id,user_id) do update set unlinked_at=null;
    end if;
    update public.organization_invitations set accepted_at=now() where id=i;
    target:=i;
  elsif operation='notification.read' then
    update public.notifications set read_at=coalesce(read_at,now()) where id=i and organization_id=o and user_id=actor
      and (ticket_id is null or public.current_user_can_access_ticket(ticket_id)) returning id into target;
  elsif operation='invitation.create' and owner then
    assigned_role:=(payload->>'role')::public.organization_member_role;
    label:=lower(gabriela_private.required(payload->>'email',254));
    if assigned_role is null or assigned_role='organization_owner' or label !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or (assigned_role='manager' and not exists(select 1 from public.buildings x where x.id=b and x.organization_id=o and x.archived_at is null))
      or (assigned_role='resident' and not exists(select 1 from public.persons x where x.id=person and x.organization_id=o and x.archived_at is null))
    then raise exception 'GAB_INVALID' using errcode='22023'; end if;
    insert into public.organization_invitations(organization_id,email,role,building_id,person_id,invited_by)
    values(o,label,assigned_role,case when assigned_role='manager' then b end,case when assigned_role='resident' then person end,actor)
    returning id into target;
  elsif operation='invitation.revoke' and owner then
    update public.organization_invitations set revoked_at=now() where id=i and organization_id=o and accepted_at is null returning id into target;
  elsif operation='member.revoke' and owner then
    update public.organization_members set status='revoked'
    where id=i and organization_id=o and role<>'organization_owner' and user_id<>actor
    returning id,user_id,role into target,affected_user,assigned_role;
    if target is not null then
      update public.organization_invitations inv set revoked_at=now() where inv.organization_id=o
        and inv.role=assigned_role and inv.accepted_at is null and inv.revoked_at is null
        and inv.email=(select lower(x.email) from auth.users x where x.id=affected_user);
      if assigned_role='manager' then
        update public.building_manager_assignments set revoked_at=now(),revoked_by=actor
          where organization_id=o and user_id=affected_user and revoked_at is null;
      elsif assigned_role='technician' then
        update public.ticket_assignments set unassigned_at=now(),unassigned_by=actor
          where organization_id=o and assignee_user_id=affected_user and unassigned_at is null;
      elsif assigned_role='resident' then
        update public.person_user_links set unlinked_at=now()
          where organization_id=o and user_id=affected_user and unlinked_at is null;
      end if;
    end if;
  elsif operation='manager.assign' and owner then
    if not exists(select 1 from public.buildings x where x.id=b and x.organization_id=o and x.archived_at is null)
      or not exists(select 1 from public.organization_members m where m.organization_id=o and m.user_id=assignee and m.role='manager' and m.status='active')
    then raise exception 'GAB_INVALID' using errcode='22023'; end if;
    insert into public.building_manager_assignments(organization_id,building_id,user_id,assigned_by)
    values(o,b,assignee,actor) on conflict(organization_id,building_id,user_id) do update set revoked_at=null,revoked_by=null
    returning id into target;
  elsif operation='manager.unassign' and owner then
    update public.building_manager_assignments set revoked_at=now(),revoked_by=actor
      where id=i and organization_id=o and revoked_at is null returning id into target;
  elsif operation='organization.update' and owner then
    update public.organizations set name=gabriela_private.required(payload->>'name',160) where id=o returning id into target;
  elsif operation='catalog.init' and owner then
    perform gabriela_private.catalog(o);
    target:=o;
  elsif operation='category.save' and owner then
    label:=gabriela_private.required(payload->>'name',80);
    if i is null then
      insert into public.ticket_categories(organization_id,name) values(o,label) returning id into target;
    else
      update public.ticket_categories set name=label,is_active=coalesce((payload->>'active')::boolean,true)
        where id=i and organization_id=o returning id into target;
    end if;
  elsif operation='priority.sla' and owner then
    update public.priorities set response_minutes=nullif(payload->>'response','')::integer,
      resolution_minutes=nullif(payload->>'resolution','')::integer where id=i and organization_id=o returning id into target;
  elsif operation='building.save' then
    if i is null and owner then
      insert into public.buildings(organization_id,name,street,city,postal_code,code,created_by)
      values(o,gabriela_private.required(payload->>'name',180),left(payload->>'street',180),left(payload->>'city',120),
        left(payload->>'postal_code',20),nullif(left(payload->>'code',40),''),actor) returning id into target;
    elsif i is not null and public.gab_can_manage_building(o,i) then
      update public.buildings set name=gabriela_private.required(payload->>'name',180),
        street=left(payload->>'street',180),city=left(payload->>'city',120),postal_code=left(payload->>'postal_code',20),
        code=nullif(left(payload->>'code',40),'') where id=i and organization_id=o and archived_at is null returning id into target;
    end if;
  elsif operation='building.archive' and owner then
    if exists(select 1 from public.units x where x.organization_id=o and x.building_id=i and x.archived_at is null)
      or exists(select 1 from public.tickets x where x.organization_id=o and x.building_id=i and x.archived_at is null)
    then raise exception 'GAB_DEPENDENCIES' using errcode='23503'; end if;
    update public.buildings set archived_at=now(),is_active=false where id=i and organization_id=o returning id into target;
  elsif operation='unit.save' then
    if exists(select 1 from public.buildings x where x.id=b and x.organization_id=o and x.archived_at is null)
      and public.gab_can_manage_building(o,b) then
      if i is null then
        insert into public.units(organization_id,building_id,unit_number,floor_label,unit_type,area_m2,created_by)
        values(o,b,gabriela_private.required(payload->>'name',120),left(payload->>'floor',40),
          left(payload->>'unit_type',80),nullif(payload->>'area','')::numeric,actor) returning id into target;
      else
        update public.units set unit_number=gabriela_private.required(payload->>'name',120),floor_label=left(payload->>'floor',40),
          unit_type=left(payload->>'unit_type',80),area_m2=nullif(payload->>'area','')::numeric
        where id=i and organization_id=o and building_id=b and archived_at is null returning id into target;
      end if;
    end if;
  elsif operation='unit.archive' then
    if exists(select 1 from public.tickets x where x.organization_id=o and x.unit_id=i and x.archived_at is null) then
      raise exception 'GAB_DEPENDENCIES' using errcode='23503';
    end if;
    update public.units set archived_at=now(),status='archived' where id=i and organization_id=o
      and public.gab_can_manage_building(o,building_id) returning id into target;
  elsif operation='person.save' then
    label:=gabriela_private.required(payload->>'name',200);
    if i is null and (owner or exists(select 1 from public.units x where x.id=u and x.organization_id=o
      and x.archived_at is null and public.gab_can_manage_building(o,x.building_id))) then
      insert into public.persons(organization_id,display_name,email,phone,person_type,created_by)
      values(o,label,nullif(left(payload->>'email',254),''),nullif(left(payload->>'phone',40),''),
        coalesce(nullif(payload->>'person_type',''),'natural'),actor) returning id into target;
      if u is not null then
        insert into public.unit_occupancies(organization_id,unit_id,person_id,created_by)
        select o,x.id,target,actor from public.units x where x.id=u and x.organization_id=o and x.archived_at is null
          and public.gab_can_manage_building(o,x.building_id);
        if not found then raise exception 'GAB_DENIED' using errcode='42501'; end if;
      end if;
    elsif i is not null and public.gab_can_manage_person(o,i) then
      update public.persons set display_name=label,email=nullif(left(payload->>'email',254),''),phone=nullif(left(payload->>'phone',40),''),
        person_type=coalesce(nullif(payload->>'person_type',''),'natural')
      where id=i and organization_id=o and archived_at is null returning id into target;
    end if;
  elsif operation='person.archive' and owner then
    update public.persons set archived_at=now(),is_active=false where id=i and organization_id=o and archived_at is null returning id into target;
    if target is not null then
      update public.person_user_links set unlinked_at=now() where organization_id=o and person_id=i and unlinked_at is null;
    end if;
  elsif operation='relation.add' then
    if not exists(select 1 from public.units x where x.id=u and x.organization_id=o and x.archived_at is null
        and public.gab_can_manage_building(o,x.building_id))
      or not exists(select 1 from public.persons x where x.id=person and x.organization_id=o and x.archived_at is null
        and public.gab_can_manage_person(o,x.id))
    then raise exception 'GAB_DENIED' using errcode='42501'; end if;
    date_from:=coalesce(nullif(payload->>'valid_from','')::date,current_date);
    date_to:=nullif(payload->>'valid_to','')::date;
    if payload->>'kind'='owner' then
      insert into public.unit_ownerships(organization_id,unit_id,person_id,ownership_share,valid_from,valid_to,created_by)
      values(o,u,person,coalesce(nullif(payload->>'share','')::numeric,1),date_from,date_to,actor) returning id into target;
    else
      insert into public.unit_occupancies(organization_id,unit_id,person_id,occupancy_type,valid_from,valid_to,created_by)
      values(o,u,person,(payload->>'kind')::public.occupancy_type,date_from,date_to,actor) returning id into target;
    end if;
  elsif operation='relation.end' then
    date_to:=coalesce(nullif(payload->>'valid_to','')::date,current_date);
    if payload->>'kind'='owner' then
      update public.unit_ownerships r set valid_to=date_to where r.id=i and r.organization_id=o and exists(
        select 1 from public.units x where x.id=r.unit_id and public.gab_can_manage_building(o,x.building_id)) returning r.id into target;
    else
      update public.unit_occupancies r set valid_to=date_to where r.id=i and r.organization_id=o and exists(
        select 1 from public.units x where x.id=r.unit_id and public.gab_can_manage_building(o,x.building_id)) returning r.id into target;
    end if;
  elsif operation='ticket.create' then
    if not exists(select 1 from public.buildings x where x.id=b and x.organization_id=o and x.archived_at is null)
      or (u is not null and not exists(select 1 from public.units x where x.id=u and x.building_id=b and x.organization_id=o and x.archived_at is null))
      or not (public.gab_can_manage_building(o,b) or (u is not null and public.gab_can_read_unit(o,u)))
      or not exists(select 1 from public.ticket_categories c where c.id=category and c.organization_id=o and c.is_active)
      or not exists(select 1 from public.priorities p where p.id=priority and p.organization_id=o and p.is_active)
    then raise exception 'GAB_DENIED' using errcode='42501'; end if;
    select id into next_status from public.workflow_statuses w where w.organization_id=o and w.code='new' and w.is_active;
    if next_status is null then raise exception 'GAB_CATALOG' using errcode='22023'; end if;
    select l.person_id into person from public.person_user_links l
    where l.organization_id=o and l.user_id=actor and l.unlinked_at is null
    order by l.is_primary desc,l.linked_at desc,l.id limit 1;
    insert into public.tickets(organization_id,building_id,unit_id,reporter_user_id,reporter_person_id,category_id,priority_id,status_id,title,description,created_by,due_at)
    values(o,b,u,actor,person,category,priority,next_status,gabriela_private.required(payload->>'title',200),
      gabriela_private.required(payload->>'description',10000),actor,
      (select now()+make_interval(mins=>p.resolution_minutes) from public.priorities p where p.id=priority and p.resolution_minutes is not null))
    returning * into ticket;
    target:=ticket.id;
    insert into public.ticket_status_history(organization_id,ticket_id,to_status_id,changed_by)
    values(o,target,next_status,actor);
    notice:='Nový požadavek';
  elsif operation in ('ticket.transition','ticket.assign','ticket.schedule','ticket.message','ticket.confirm','ticket.dispute') then
    select * into ticket from public.tickets t where t.id=i and t.organization_id=o and t.archived_at is null for update;
    if not found or not public.current_user_can_access_ticket(i) then raise exception 'GAB_DENIED' using errcode='42501'; end if;
    manages:=public.gab_can_manage_building(o,ticket.building_id);
    select code into current_code from public.workflow_statuses where id=ticket.status_id and organization_id=o;
    current_code:=case when current_code='cancelled' then 'canceled' else current_code end;
    if operation='ticket.assign' and manages and current_code not in ('closed','canceled','rejected') then
      if not exists(select 1 from public.organization_members m where m.organization_id=o and m.user_id=assignee and m.role='technician' and m.status='active')
      then raise exception 'GAB_INVALID' using errcode='22023'; end if;
      update public.ticket_assignments set unassigned_at=now(),unassigned_by=actor
      where ticket_id=i and organization_id=o and unassigned_at is null and assignment_role='primary' and assignee_user_id<>assignee;
      insert into public.ticket_assignments(organization_id,ticket_id,assignee_user_id,assigned_by)
      values(o,i,assignee,actor) on conflict(ticket_id,assignee_user_id,assignment_role)
      do update set unassigned_at=null,unassigned_by=null,assigned_at=now(),assigned_by=actor;
      notice:='Změna přiřazení požadavku';
    elsif operation='ticket.schedule' and manages and current_code not in ('closed','canceled','rejected') then
      if priority is not null and not exists(select 1 from public.priorities p where p.id=priority and p.organization_id=o and p.is_active)
      then raise exception 'GAB_INVALID' using errcode='22023'; end if;
      update public.tickets set due_at=nullif(payload->>'due_at','')::timestamptz, priority_id=coalesce(priority,priority_id) where id=i;
      notice:='Změna termínu nebo priority';
    elsif operation='ticket.message' then
      internal_note:=coalesce((payload->>'internal')::boolean,false);
      if internal_note and not manages then raise exception 'GAB_DENIED' using errcode='42501'; end if;
      insert into public.ticket_messages(organization_id,ticket_id,author_user_id,visibility,body,technician_visible)
      values(o,i,actor,case when internal_note then 'internal'::public.ticket_visibility else 'public'::public.ticket_visibility end,
        gabriela_private.required(payload->>'body',10000),internal_note and coalesce((payload->>'technician_visible')::boolean,false));
      if not internal_note then notice:='Nová zpráva u požadavku'; end if;
    elsif operation in ('ticket.confirm','ticket.dispute') and current_code='resolved' and ticket.reporter_user_id=actor then
      if operation='ticket.confirm' then
        update public.tickets set resolution_confirmed_at=now(),resolution_disputed_at=null where id=i;
        notice:='Výsledek byl potvrzen';
      else
        reason:=gabriela_private.required(payload->>'reason',2000);
        select id into next_status from public.workflow_statuses where organization_id=o and code='in_progress';
        update public.tickets set resolution_disputed_at=now(),resolution_confirmed_at=null,status_id=next_status,resolved_at=null where id=i;
        insert into public.ticket_status_history(organization_id,ticket_id,from_status_id,to_status_id,changed_by,change_reason)
        values(o,i,ticket.status_id,next_status,actor,reason);
        insert into public.ticket_messages(organization_id,ticket_id,author_user_id,body) values(o,i,actor,reason);
        notice:='Výsledek byl rozporován';
      end if;
    elsif operation='ticket.transition' then
      next_code:=payload->>'status';
      reason:=nullif(btrim(left(payload->>'reason',2000)),'');
      if next_code is null or not (
        (manages and (current_code,next_code) in (('new','accepted'),('new','rejected'),('new','canceled'),
          ('accepted','assessment'),('accepted','in_progress'),('accepted','waiting_user'),('accepted','waiting_vendor'),
          ('assessment','in_progress'),('assessment','waiting_user'),('assessment','waiting_vendor'),('assessment','rejected'),
          ('in_progress','waiting_user'),('in_progress','waiting_vendor'),('in_progress','resolved'),
          ('waiting_user','in_progress'),('waiting_user','resolved'),('waiting_vendor','in_progress'),('waiting_vendor','resolved'),
          ('resolved','closed'),('resolved','in_progress')))
        or (owner and current_code in ('closed','rejected','canceled') and next_code='in_progress')
        or (public.current_user_is_ticket_assignee(i) and current_code='in_progress' and next_code='resolved'))
      then raise exception 'GAB_TRANSITION' using errcode='22023'; end if;
      if (next_code in ('rejected','canceled','resolved') or current_code in ('closed','rejected','canceled','assessment','waiting_user','waiting_vendor')
          or (next_code='closed' and ticket.resolution_confirmed_at is null)) and reason is null
      then raise exception 'GAB_REASON' using errcode='22023'; end if;
      if next_code in ('waiting_user','waiting_vendor') and nullif(payload->>'due_at','') is null
      then raise exception 'GAB_DUE' using errcode='22023'; end if;
      select id into next_status from public.workflow_statuses where organization_id=o and code=next_code and is_active;
      if next_status is null then raise exception 'GAB_CATALOG' using errcode='22023'; end if;
      update public.tickets set status_id=next_status,
        resolution_summary=case when next_code='resolved' then reason else resolution_summary end,
        resolved_at=case when next_code='resolved' then now() when next_code='in_progress' then null else resolved_at end,
        resolution_confirmed_at=case when next_code in ('resolved','in_progress') then null else resolution_confirmed_at end,
        resolution_disputed_at=case when next_code='resolved' then null else resolution_disputed_at end,
        closed_at=case when next_code='closed' then now() when next_code='in_progress' then null else closed_at end,
        due_at=coalesce(nullif(payload->>'due_at','')::timestamptz,due_at)
      where id=i;
      insert into public.ticket_status_history(organization_id,ticket_id,from_status_id,to_status_id,changed_by,change_reason)
      values(o,i,ticket.status_id,next_status,actor,reason);
      notice:='Změna stavu požadavku';
    else raise exception 'GAB_DENIED' using errcode='42501';
    end if;
    target:=i;
  elsif operation='audit.export' and (owner or auth.jwt()->>'aal'='aal2' and public.current_user_has_org_role(o,'manager')) then
    target:=o;
  else raise exception 'GAB_DENIED' using errcode='42501';
  end if;

  if target is null then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  if operation<>'notification.read' then
    perform gabriela_private.audit(o,operation,split_part(operation,'.',1),target,ticket.id,
      case when operation='ticket.transition' then jsonb_build_object('from',current_code,'to',next_code)
           when operation='audit.export' then jsonb_build_object('format',left(payload->>'format',8),'count',left(payload->>'count',12))
           else '{}'::jsonb end);
  end if;
  if notice is not null then
    perform gabriela_private.notify_ticket(ticket,operation,notice);
  end if;
  answer:=jsonb_build_object('id',target);
  insert into public.idempotency_keys(organization_id,user_id,idempotency_key,operation,request_hash,response_body,status,expires_at,completed_at)
  values(o,actor,actor::text||':'||request_id::text,operation,fingerprint,answer,'completed',now()+interval '7 days',now());
  return answer;
end $$;

revoke all on function public.gab_command(text,uuid,jsonb,uuid), public.gab_pending_invitations(),
  public.gab_list_invitations(uuid), public.gab_provision_organization(uuid,text) from public, anon, authenticated;
grant execute on function public.gab_command(text,uuid,jsonb,uuid), public.gab_pending_invitations(),public.gab_list_invitations(uuid) to authenticated;
grant execute on function public.gab_provision_organization(uuid,text) to service_role;

-- Target identities are exposed only to management and only in the selected organization.
create function public.gab_member_directory(o uuid)
returns table (id uuid,user_id uuid,email text,role public.organization_member_role,status public.membership_status)
language sql stable security definer set search_path = '' as $$
  select m.id,m.user_id,u.email::text,m.role,m.status
  from public.organization_members m join auth.users u on u.id=m.user_id
  where m.organization_id=o and (gabriela_private.is_owner(o) or
    (auth.jwt()->>'aal'='aal2' and m.role='technician' and m.status='active'
    and public.current_user_has_org_role(o,'manager')
    and exists(select 1 from public.building_manager_assignments a
      where a.organization_id=o and a.user_id=auth.uid() and a.revoked_at is null)))
  order by u.email
$$;
revoke all on function public.gab_member_directory(uuid) from public,anon;
grant execute on function public.gab_member_directory(uuid) to authenticated;

-- Tenant-specific relation rows also follow the building assignment.
drop policy unit_occupancies_select_scoped on public.unit_occupancies;
create policy gab_occupancy_read on public.unit_occupancies for select to authenticated using (
  exists(select 1 from public.units u where u.id=unit_id and u.organization_id=unit_occupancies.organization_id
    and public.gab_can_manage_building(u.organization_id,u.building_id))
  or (public.current_user_has_org_role(organization_id,'resident') and public.current_user_is_linked_person(person_id))
);
drop policy unit_ownerships_select_scoped on public.unit_ownerships;
create policy gab_ownership_read on public.unit_ownerships for select to authenticated using (
  exists(select 1 from public.units u where u.id=unit_id and u.organization_id=unit_ownerships.organization_id
    and public.gab_can_manage_building(u.organization_id,u.building_id))
  or (public.current_user_has_org_role(organization_id,'resident') and public.current_user_is_linked_person(person_id))
);

commit;
