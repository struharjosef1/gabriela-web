-- GABRIELA 2026
-- Migration 004: Files, Notifications, Audit
-- Depends on: 001 Foundation, 002 Properties & Persons, 003 Ticketing Core

begin;

do $$ begin
  create type public.file_scan_status as enum ('pending','clean','infected','failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_channel as enum ('in_app','email');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.delivery_status as enum ('pending','sent','failed','cancelled');
exception when duplicate_object then null;
end $$;

-- =========================================================
-- FILE METADATA + TICKET ATTACHMENTS
-- =========================================================

create table if not exists public.file_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_name text not null default 'gabriela-private',
  object_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  scan_status public.file_scan_status not null default 'pending',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint file_objects_path_not_blank check (btrim(object_path) <> ''),
  constraint file_objects_filename_not_blank check (btrim(original_filename) <> ''),
  constraint file_objects_size_nonnegative check (size_bytes is null or size_bytes >= 0),
  constraint file_objects_unique_path unique (bucket_name, object_path)
);

create index if not exists file_objects_org_idx
  on public.file_objects (organization_id, created_at desc);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  file_object_id uuid not null references public.file_objects(id) on delete restrict,
  message_id uuid references public.ticket_messages(id) on delete cascade,
  visibility public.ticket_visibility not null default 'public',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ticket_attachments_unique unique (ticket_id, file_object_id)
);

create index if not exists ticket_attachments_ticket_idx
  on public.ticket_attachments (ticket_id, created_at);

-- =========================================================
-- NOTIFICATIONS
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_event_not_blank check (btrim(event_type) <> ''),
  constraint notifications_title_not_blank check (btrim(title) <> '')
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel public.notification_channel not null,
  status public.delivery_status not null default 'pending',
  attempt_count integer not null default 0,
  provider_message_id text,
  last_error text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_attempt_nonnegative check (attempt_count >= 0),
  constraint notification_deliveries_unique_channel unique (notification_id, channel)
);

create index if not exists notification_deliveries_queue_idx
  on public.notification_deliveries (status, next_attempt_at);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  in_app_enabled boolean not null default true,
  email_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_event_not_blank check (btrim(event_type) <> ''),
  constraint notification_preferences_unique unique (organization_id, user_id, event_type)
);

-- =========================================================
-- AUDIT
-- =========================================================

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  ticket_id uuid references public.tickets(id) on delete set null,
  request_id text,
  ip_address inet,
  user_agent text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (btrim(action) <> ''),
  constraint audit_logs_entity_type_not_blank check (btrim(entity_type) <> '')
);

create index if not exists audit_logs_org_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_ticket_idx
  on public.audit_logs (ticket_id, created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_user_id, created_at desc);

-- =========================================================
-- UPDATED_AT
-- =========================================================

drop trigger if exists trg_notification_deliveries_updated_at on public.notification_deliveries;
create trigger trg_notification_deliveries_updated_at
before update on public.notification_deliveries
for each row execute function public.set_updated_at();

drop trigger if exists trg_notification_preferences_updated_at on public.notification_preferences;
create trigger trg_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

-- =========================================================
-- RLS
-- =========================================================

alter table public.file_objects enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_logs enable row level security;

alter table public.file_objects force row level security;
alter table public.ticket_attachments force row level security;
alter table public.notifications force row level security;
alter table public.notification_deliveries force row level security;
alter table public.notification_preferences force row level security;
alter table public.audit_logs force row level security;

-- File metadata: managers/support or uploader.
drop policy if exists file_objects_select_scoped on public.file_objects;
create policy file_objects_select_scoped on public.file_objects
for select to authenticated using (
  public.current_user_can_manage_org(organization_id)
  or uploaded_by = auth.uid()
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists file_objects_insert_member on public.file_objects;
create policy file_objects_insert_member on public.file_objects
for insert to authenticated with check (
  public.current_user_is_org_member(organization_id)
  and (uploaded_by is null or uploaded_by = auth.uid())
);

-- Ticket attachments inherit ticket scope and visibility.
drop policy if exists ticket_attachments_select_scoped on public.ticket_attachments;
create policy ticket_attachments_select_scoped on public.ticket_attachments
for select to authenticated using (
  public.current_user_can_access_ticket(ticket_id)
  and (
    visibility = 'public'
    or public.current_user_can_manage_org(organization_id)
    or public.current_user_is_ticket_assignee(ticket_id)
    or public.current_user_has_active_support_grant(organization_id)
  )
);

drop policy if exists ticket_attachments_insert_scoped on public.ticket_attachments;
create policy ticket_attachments_insert_scoped on public.ticket_attachments
for insert to authenticated with check (
  public.current_user_can_access_ticket(ticket_id)
  and (
    visibility = 'public'
    or public.current_user_can_manage_org(organization_id)
    or public.current_user_is_ticket_assignee(ticket_id)
  )
  and (created_by is null or created_by = auth.uid())
);

-- Notifications: recipient only.
drop policy if exists notifications_select_self on public.notifications;
create policy notifications_select_self on public.notifications
for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_update_self on public.notifications;
create policy notifications_update_self on public.notifications
for update to authenticated using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Delivery queue is server-side only. No authenticated RLS policy.

-- Notification preferences: self only, within active tenant membership.
drop policy if exists notification_preferences_select_self on public.notification_preferences;
create policy notification_preferences_select_self on public.notification_preferences
for select to authenticated using (
  user_id = auth.uid()
  and public.current_user_is_org_member(organization_id)
);

drop policy if exists notification_preferences_manage_self on public.notification_preferences;
create policy notification_preferences_manage_self on public.notification_preferences
for all to authenticated using (
  user_id = auth.uid()
  and public.current_user_is_org_member(organization_id)
)
with check (
  user_id = auth.uid()
  and public.current_user_is_org_member(organization_id)
);

-- Audit is read-only to tenant owner/manager and active support grant.
-- No client INSERT/UPDATE/DELETE: application/server writes audit.
drop policy if exists audit_logs_select_authorized on public.audit_logs;
create policy audit_logs_select_authorized on public.audit_logs
for select to authenticated using (
  organization_id is not null
  and (
    public.current_user_can_manage_org(organization_id)
    or public.current_user_has_active_support_grant(organization_id)
  )
);

-- =========================================================
-- PRIVILEGES
-- =========================================================

grant select, insert on public.file_objects to authenticated;
grant select, insert on public.ticket_attachments to authenticated;
grant select, update on public.notifications to authenticated;
revoke all on public.notification_deliveries from anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant select on public.audit_logs to authenticated;

commit;