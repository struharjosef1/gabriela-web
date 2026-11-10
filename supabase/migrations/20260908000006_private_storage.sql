-- GABRIELA 2026
-- Migration 006: private Storage baseline
-- Aligns repository with v4.0: private bucket, 20 MB, explicit MIME allowlist.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gabriela-private',
  'gabriela-private',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gabriela_private_select on storage.objects;
create policy gabriela_private_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'gabriela-private'
  and exists (
    select 1
    from public.file_objects fo
    left join public.ticket_attachments ta on ta.file_object_id = fo.id
    where fo.bucket_name = bucket_id
      and fo.object_path = name
      and (
        fo.uploaded_by = auth.uid()
        or public.current_user_can_manage_org(fo.organization_id)
        or public.current_user_has_active_support_grant(fo.organization_id)
        or (
          ta.ticket_id is not null
          and public.current_user_can_access_ticket(ta.ticket_id)
          and (
            ta.visibility = 'public'
            or public.current_user_can_manage_org(ta.organization_id)
            or public.current_user_is_ticket_assignee(ta.ticket_id)
            or public.current_user_has_active_support_grant(ta.organization_id)
          )
        )
      )
  )
);

drop policy if exists gabriela_private_insert on storage.objects;
create policy gabriela_private_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'gabriela-private'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
