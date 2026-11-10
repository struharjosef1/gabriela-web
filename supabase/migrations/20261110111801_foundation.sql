-- GABRIELA 2026
-- Migration 001: Foundation (tenant -> auth -> role -> RLS)
-- Baseline: Finalni sjednocena specifikace v4.0
-- Purpose: organizations, profiles, memberships, support grants, settings,
--          helper authorization functions and deny-by-default RLS.

begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1. ENUMS
-- =========================================================

do $$ begin
  create type public.organization_member_role as enum (
    'organization_owner',
    'manager',
    'resident',
    'technician'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.platform_role as enum (
    'platform_admin',
    'support_operator'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.membership_status as enum (
    'invited',
    'active',
    'suspended',
    'revoked'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.support_grant_status as enum (
    'pending',
    'active',
    'expired',
    'revoked'
  );
exception
  when duplicate_object then null;
end $$;

-- =========================================================
-- 2. IDENTITY
-- =========================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  locale text not null default 'cs-CZ',
  timezone text not null default 'Europe/Prague',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_notifications boolean not null default true,
  in_app_notifications boolean not null default true,
  compact_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platform role is intentionally separate from tenant membership.
create table if not exists public.platform_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.platform_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  primary key (user_id, role)
);

-- =========================================================
-- 3. TENANTS
-- =========================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint organizations_name_not_blank check (btrim(name) <> ''),
  constraint organizations_slug_format check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint organizations_slug_unique unique (slug)
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_member_role not null,
  status public.membership_status not null default 'active',
  invited_at timestamptz,
  joined_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint organization_members_unique_user_role
    unique (organization_id, user_id, role)
);

create index if not exists organization_members_organization_id_idx
  on public.organization_members (organization_id);

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);

create index if not exists organization_members_active_lookup_idx
  on public.organization_members (organization_id, user_id, status);

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  display_name text,
  default_locale text not null default 'cs-CZ',
  default_timezone text not null default 'Europe/Prague',
  ticket_prefix text not null default 'TKT',
  support_access_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 4. SUPPORT ACCESS
-- =========================================================

create table if not exists public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  support_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  support_ticket_reference text,
  scope jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  status public.support_grant_status not null default 'active',
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint support_access_reason_not_blank check (btrim(reason) <> ''),
  constraint support_access_valid_window check (ends_at > starts_at),
  constraint support_access_max_4h check (ends_at <= starts_at + interval '4 hours')
);

create index if not exists support_access_grants_org_idx
  on public.support_access_grants (organization_id);

create index if not exists support_access_grants_support_user_idx
  on public.support_access_grants (support_user_id);

create index if not exists support_access_grants_active_window_idx
  on public.support_access_grants (organization_id, support_user_id, starts_at, ends_at);

-- =========================================================
-- 5. UPDATED_AT TRIGGER
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_preferences_updated_at on public.user_preferences;
create trigger trg_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_members_updated_at on public.organization_members;
create trigger trg_organization_members_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

drop trigger if exists trg_organization_settings_updated_at on public.organization_settings;
create trigger trg_organization_settings_updated_at
before update on public.organization_settings
for each row execute function public.set_updated_at();

-- =========================================================
-- 6. AUTHORIZATION HELPERS
-- =========================================================

create or replace function public.current_user_has_platform_role(required_role public.platform_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_user_roles pur
    where pur.user_id = auth.uid()
      and pur.role = required_role
  );
$$;

create or replace function public.current_user_is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.current_user_has_org_role(
  target_organization_id uuid,
  required_role public.organization_member_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = auth.uid()
      and om.role = required_role
      and om.status = 'active'
  );
$$;

create or replace function public.current_user_has_active_support_grant(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.support_access_grants sag
    where sag.organization_id = target_organization_id
      and sag.support_user_id = auth.uid()
      and sag.status = 'active'
      and now() >= sag.starts_at
      and now() < sag.ends_at
      and public.current_user_has_platform_role('support_operator'::public.platform_role)
  );
$$;

-- =========================================================
-- 7. RLS - ENABLED EVERYWHERE
-- =========================================================

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.platform_user_roles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_settings enable row level security;
alter table public.support_access_grants enable row level security;

-- Force RLS for normal table owners too; service_role still bypasses RLS by design.
alter table public.profiles force row level security;
alter table public.user_preferences force row level security;
alter table public.platform_user_roles force row level security;
alter table public.organizations force row level security;
alter table public.organization_members force row level security;
alter table public.organization_settings force row level security;
alter table public.support_access_grants force row level security;

-- =========================================================
-- 8. RLS POLICIES
-- =========================================================

-- Profiles: user sees/updates self only.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Preferences: self only.
drop policy if exists user_preferences_select_self on public.user_preferences;
create policy user_preferences_select_self
on public.user_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists user_preferences_update_self on public.user_preferences;
create policy user_preferences_update_self
on public.user_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Platform roles: no ordinary client read/write.
-- Intentionally no authenticated policies.

-- Organizations: tenant members may read their organization;
-- platform_admin does NOT get tenant data implicitly.
drop policy if exists organizations_select_member_or_support on public.organizations;
create policy organizations_select_member_or_support
on public.organizations
for select
to authenticated
using (
  public.current_user_is_org_member(id)
  or public.current_user_has_active_support_grant(id)
);

-- Only organization_owner can update own organization.
drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner
on public.organizations
for update
to authenticated
using (
  public.current_user_has_org_role(id, 'organization_owner'::public.organization_member_role)
)
with check (
  public.current_user_has_org_role(id, 'organization_owner'::public.organization_member_role)
);

-- Members: active members can read membership rows within their org.
drop policy if exists organization_members_select_same_org on public.organization_members;
create policy organization_members_select_same_org
on public.organization_members
for select
to authenticated
using (
  public.current_user_is_org_member(organization_id)
  or public.current_user_has_active_support_grant(organization_id)
);

-- Membership mutation is deliberately server-only for now.
-- No INSERT/UPDATE/DELETE policy for authenticated clients.

-- Organization settings: members may read; owners may update.
drop policy if exists organization_settings_select_member_or_support on public.organization_settings;
create policy organization_settings_select_member_or_support
on public.organization_settings
for select
to authenticated
using (
  public.current_user_is_org_member(organization_id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists organization_settings_update_owner on public.organization_settings;
create policy organization_settings_update_owner
on public.organization_settings
for update
to authenticated
using (
  public.current_user_has_org_role(
    organization_id,
    'organization_owner'::public.organization_member_role
  )
)
with check (
  public.current_user_has_org_role(
    organization_id,
    'organization_owner'::public.organization_member_role
  )
);

-- Support grants:
-- org owner can inspect grants for own organization.
drop policy if exists support_grants_select_owner on public.support_access_grants;
create policy support_grants_select_owner
on public.support_access_grants
for select
to authenticated
using (
  public.current_user_has_org_role(
    organization_id,
    'organization_owner'::public.organization_member_role
  )
  or support_user_id = auth.uid()
);

-- Support grant creation/revocation remains server-controlled.
-- No authenticated INSERT/UPDATE/DELETE policy.

-- =========================================================
-- 9. DEFAULT PRIVILEGES / HARDENING
-- =========================================================

revoke all on public.platform_user_roles from anon, authenticated;
revoke insert, update, delete on public.support_access_grants from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.user_preferences to authenticated;
grant select, update on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select, update on public.organization_settings to authenticated;
grant select on public.support_access_grants to authenticated;

-- No direct client writes yet for tenant membership/support grants.
-- Creation and privileged operations will go through vetted server-side services.

commit;