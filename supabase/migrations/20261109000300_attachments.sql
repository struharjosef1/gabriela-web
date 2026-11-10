begin;
drop policy file_objects_select_scoped on public.file_objects;
create policy gab_file_metadata_read on public.file_objects for select to authenticated
  using (archived_at is null and scan_status='clean' and public.current_user_is_org_member(organization_id)
    and (public.current_user_can_manage_org(organization_id) or exists (
      select 1 from public.ticket_attachments a where a.file_object_id=file_objects.id and a.organization_id=file_objects.organization_id
        and public.current_user_can_access_ticket(a.ticket_id)
        and (a.visibility='public' or public.gab_can_manage_ticket(a.ticket_id)))));

create function public.gab_attach_scanned_file(
  o uuid,t uuid,actor uuid,assurance text,object_key text,file_name text,media_type text,file_size bigint,digest text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare f uuid; a uuid;
begin
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'aal',assurance)::text,true);
  if auth.uid() is distinct from actor
    or not exists(select 1 from public.tickets x where x.id=t and x.organization_id=o and x.archived_at is null for update)
    or not public.current_user_can_access_ticket(t)
    or split_part(object_key,'/',1)<>o::text or split_part(object_key,'/',2)<>t::text
    or file_size not between 1 and 20971520 or digest !~ '^[0-9a-f]{64}$'
    or media_type not in ('application/pdf','image/jpeg','image/png','image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  insert into public.file_objects(organization_id,object_path,original_filename,mime_type,size_bytes,sha256,scan_status,uploaded_by)
  values(o,object_key,gabriela_private.required(file_name,180),media_type,file_size,digest,'clean',actor) returning id into f;
  insert into public.ticket_attachments(organization_id,ticket_id,file_object_id,created_by)
  values(o,t,f,actor) returning id into a;
  perform gabriela_private.audit(o,'attachment.add','attachment',a,t);
  return a;
end $$;
revoke all on function public.gab_attach_scanned_file(uuid,uuid,uuid,text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.gab_attach_scanned_file(uuid,uuid,uuid,text,text,text,text,bigint,text) to service_role;

create function public.gab_download_file(o uuid,t uuid,a uuid)
returns table(object_path text,original_filename text) language plpgsql security definer set search_path = '' as $$
begin
  if not public.current_user_can_access_ticket(t) then raise exception 'GAB_DENIED' using errcode='42501'; end if;
  return query select f.object_path,f.original_filename from public.ticket_attachments x
  join public.file_objects f on f.id=x.file_object_id and f.organization_id=x.organization_id
  where x.id=a and x.ticket_id=t and x.organization_id=o and f.archived_at is null and f.scan_status='clean'
    and f.bucket_name='gabriela-private' and (x.visibility='public' or public.gab_can_manage_ticket(t));
  if found then perform gabriela_private.audit(o,'attachment.download','attachment',a,t); end if;
end $$;
revoke all on function public.gab_download_file(uuid,uuid,uuid) from public,anon;
grant execute on function public.gab_download_file(uuid,uuid,uuid) to authenticated;
commit;
