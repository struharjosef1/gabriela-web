-- GABRIELA 2026
-- Migration 002: Properties and Persons
-- Depends on: Migration 001 Foundation
-- Purpose:
--   buildings, manager assignments, units, persons,
--   person-user links, occupancies, ownerships, contacts,
--   indexes and tenant-safe RLS.

begin;

-- =========================================================
-- 1. ENUMS
-- =========================================================

do $$ begin
  create type public.unit_status as enum (
    'active',
    'inactive',
    'archived'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.occupancy_type as enum (
    'resident',
    'tenant',
    'subtenant',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.contact_relation_type as enum (
    'emergency_contact',
    'family',
    'proxy',
    'caretaker',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

-- =========================================================
-- 2. BUILDINGS
-- =========================================================

create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  street text,
  city text,
  postal_code text,
  country_code text not null default 'CZ',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  constraint buildings_name_not_blank check (btrim(name) <> ''),
  constraint buildings_code_unique_per_org unique (organization_id, code)
);

create index if not exists buildings_org_idx
  on public.buildings (organization_id);

create index if not exists buildings_active_idx
  on public.buildings (organization_id, is_active);

create table if not exists public.building_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint building_manager_assignment_unique
    unique (organization_id, building_id, user_id)
);

create index if not exists building_manager_assignments_org_idx
  on public.building_manager_assignments (organization_id);

create index if not exists building_manager_assignments_building_idx
  on public.building_manager_assignments (building_id);

create index if not exists building_manager_assignments_user_idx
  on public.building_manager_assignments (user_id);

-- =========================================================
-- 3. UNITS
-- =========================================================

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  building_id uuid not null references public.buildings(id) on delete cascade,
  unit_number text not null,
  floor_label text,
  entrance_label text,
  unit_type text,
  area_m2 numeric(10,2),
  status public.unit_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  constraint units_number_not_blank check (btrim(unit_number) <> ''),
  constraint units_area_nonnegative check (area_m2 is null or area_m2 >= 0),
  constraint units_unique_per_building unique (building_id, unit_number)
);

create index if not exists units_org_idx
  on public.units (organization_id);

create index if not exists units_building_idx
  on public.units (building_id);

create index if not exists units_status_idx
  on public.units (organization_id, status);

-- =========================================================
-- 4. PERSONS
-- =========================================================

create table if not exists public.persons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone text,
  date_of_birth date,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  constraint persons_name_present check (
    coalesce(nullif(btrim(display_name), ''), nullif(btrim(first_name), ''), nullif(btrim(last_name), '')) is not null
  )
);

create index if not exists persons_org_idx
  on public.persons (organization_id);

create index if not exists persons_email_idx
  on public.persons (organization_id, email);

create index if not exists persons_phone_idx
  on public.persons (organization_id, phone);

create table if not exists public.person_user_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_primary boolean not null default true,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint person_user_links_unique
    unique (organization_id, person_id, user_id)
);

create index if not exists person_user_links_person_idx
  on public.person_user_links (person_id);

create index if not exists person_user_links_user_idx
  on public.person_user_links (user_id);

-- =========================================================
-- 5. OCCUPANCIES / OWNERSHIPS / CONTACTS
-- =========================================================

create table if not exists public.unit_occupancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  occupancy_type public.occupancy_type not null default 'resident',
  valid_from date not null default current_date,
  valid_to date,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint unit_occupancies_valid_range check (valid_to is null or valid_to >= valid_from)
);

create index if not exists unit_occupancies_org_idx
  on public.unit_occupancies (organization_id);

create index if not exists unit_occupancies_unit_idx
  on public.unit_occupancies (unit_id);

create index if not exists unit_occupancies_person_idx
  on public.unit_occupancies (person_id);

create table if not exists public.unit_ownerships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  ownership_share numeric(8,6) not null default 1.0,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint unit_ownerships_share_range check (
    ownership_share > 0 and ownership_share <= 1
  ),
  constraint unit_ownerships_valid_range check (
    valid_to is null or valid_to >= valid_from
  )
);

create index if not exists unit_ownerships_org_idx
  on public.unit_ownerships (organization_id);

create index if not exists unit_ownerships_unit_idx
  on public.unit_ownerships (unit_id);

create index if not exists unit_ownerships_person_idx
  on public.unit_ownerships (person_id);

create table if not exists public.unit_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  person_id uuid not null references public.persons(id) on delete cascade,
  relation_type public.contact_relation_type not null default 'other',
  is_primary boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint unit_contacts_unique
    unique (organization_id, unit_id, person_id, relation_type)
);

create index if not exists unit_contacts_org_idx
  on public.unit_contacts (organization_id);

create index if not exists unit_contacts_unit_idx
  on public.unit_contacts (unit_id);

create index if not exists unit_contacts_person_idx
  on public.unit_contacts (person_id);

-- =========================================================
-- 6. UPDATED_AT TRIGGERS
-- =========================================================

drop trigger if exists trg_buildings_updated_at on public.buildings;
create trigger trg_buildings_updated_at
before update on public.buildings
for each row execute function public.set_updated_at();

drop trigger if exists trg_units_updated_at on public.units;
create trigger trg_units_updated_at
before update on public.units
for each row execute function public.set_updated_at();

drop trigger if exists trg_persons_updated_at on public.persons;
create trigger trg_persons_updated_at
before update on public.persons
for each row execute function public.set_updated_at();

drop trigger if exists trg_unit_occupancies_updated_at on public.unit_occupancies;
create trigger trg_unit_occupancies_updated_at
before update on public.unit_occupancies
for each row execute function public.set_updated_at();

drop trigger if exists trg_unit_ownerships_updated_at on public.unit_ownerships;
create trigger trg_unit_ownerships_updated_at
before update on public.unit_ownerships
for each row execute function public.set_updated_at();

drop trigger if exists trg_unit_contacts_updated_at on public.unit_contacts;
create trigger trg_unit_contacts_updated_at
before update on public.unit_contacts
for each row execute function public.set_updated_at();

-- =========================================================
-- 7. AUTHORIZATION HELPERS
-- =========================================================

create or replace function public.current_user_is_building_manager(target_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.building_manager_assignments bma
    where bma.building_id = target_building_id
      and bma.user_id = auth.uid()
      and bma.revoked_at is null
  );
$$;

create or replace function public.current_user_is_linked_person(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.person_user_links pul
    where pul.person_id = target_person_id
      and pul.user_id = auth.uid()
      and pul.unlinked_at is null
  );
$$;

create or replace function public.current_user_can_manage_org(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_has_org_role(
      target_organization_id,
      'organization_owner'::public.organization_member_role
    )
    or public.current_user_has_org_role(
      target_organization_id,
      'manager'::public.organization_member_role
    );
$$;

-- =========================================================
-- 8. RLS ENABLE / FORCE
-- =========================================================

alter table public.buildings enable row level security;
alter table public.building_manager_assignments enable row level security;
alter table public.units enable row level security;
alter table public.persons enable row level security;
alter table public.person_user_links enable row level security;
alter table public.unit_occupancies enable row level security;
alter table public.unit_ownerships enable row level security;
alter table public.unit_contacts enable row level security;

alter table public.buildings force row level security;
alter table public.building_manager_assignments force row level security;
alter table public.units force row level security;
alter table public.persons force row level security;
alter table public.person_user_links force row level security;
alter table public.unit_occupancies force row level security;
alter table public.unit_ownerships force row level security;
alter table public.unit_contacts force row level security;

-- =========================================================
-- 9. RLS POLICIES
-- =========================================================

-- Buildings
drop policy if exists buildings_select_org_member on public.buildings;
create policy buildings_select_org_member
on public.buildings
for select
to authenticated
using (
  public.current_user_is_org_member(organization_id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists buildings_insert_manager on public.buildings;
create policy buildings_insert_manager
on public.buildings
for insert
to authenticated
with check (
  public.current_user_can_manage_org(organization_id)
);

drop policy if exists buildings_update_manager on public.buildings;
create policy buildings_update_manager
on public.buildings
for update
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
)
with check (
  public.current_user_can_manage_org(organization_id)
);

-- Building manager assignments
drop policy if exists building_manager_assignments_select_org_member
on public.building_manager_assignments;
create policy building_manager_assignments_select_org_member
on public.building_manager_assignments
for select
to authenticated
using (
  public.current_user_is_org_member(organization_id)
  or public.current_user_has_active_support_grant(organization_id)
);

-- mutation intentionally server-controlled for now

-- Units
drop policy if exists units_select_org_member on public.units;
create policy units_select_org_member
on public.units
for select
to authenticated
using (
  public.current_user_is_org_member(organization_id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists units_insert_manager on public.units;
create policy units_insert_manager
on public.units
for insert
to authenticated
with check (
  public.current_user_can_manage_org(organization_id)
);

drop policy if exists units_update_manager on public.units;
create policy units_update_manager
on public.units
for update
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
)
with check (
  public.current_user_can_manage_org(organization_id)
);

-- Persons
drop policy if exists persons_select_scoped on public.persons;
create policy persons_select_scoped
on public.persons
for select
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
  or public.current_user_is_linked_person(id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists persons_insert_manager on public.persons;
create policy persons_insert_manager
on public.persons
for insert
to authenticated
with check (
  public.current_user_can_manage_org(organization_id)
);

drop policy if exists persons_update_scoped on public.persons;
create policy persons_update_scoped
on public.persons
for update
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
  or public.current_user_is_linked_person(id)
)
with check (
  public.current_user_can_manage_org(organization_id)
  or public.current_user_is_linked_person(id)
);

-- Person-user links
drop policy if exists person_user_links_select_scoped on public.person_user_links;
create policy person_user_links_select_scoped
on public.person_user_links
for select
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
  or user_id = auth.uid()
  or public.current_user_has_active_support_grant(organization_id)
);

-- Occupancies
drop policy if exists unit_occupancies_select_scoped on public.unit_occupancies;
create policy unit_occupancies_select_scoped
on public.unit_occupancies
for select
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
  or public.current_user_is_linked_person(person_id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists unit_occupancies_mutate_manager on public.unit_occupancies;
create policy unit_occupancies_mutate_manager
on public.unit_occupancies
for all
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
)
with check (
  public.current_user_can_manage_org(organization_id)
);

-- Ownerships
drop policy if exists unit_ownerships_select_scoped on public.unit_ownerships;
create policy unit_ownerships_select_scoped
on public.unit_ownerships
for select
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
  or public.current_user_is_linked_person(person_id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists unit_ownerships_mutate_manager on public.unit_ownerships;
create policy unit_ownerships_mutate_manager
on public.unit_ownerships
for all
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
)
with check (
  public.current_user_can_manage_org(organization_id)
);

-- Unit contacts
drop policy if exists unit_contacts_select_scoped on public.unit_contacts;
create policy unit_contacts_select_scoped
on public.unit_contacts
for select
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
  or public.current_user_is_linked_person(person_id)
  or public.current_user_has_active_support_grant(organization_id)
);

drop policy if exists unit_contacts_mutate_manager on public.unit_contacts;
create policy unit_contacts_mutate_manager
on public.unit_contacts
for all
to authenticated
using (
  public.current_user_can_manage_org(organization_id)
)
with check (
  public.current_user_can_manage_org(organization_id)
);

-- =========================================================
-- 10. PRIVILEGES
-- =========================================================

grant select, insert, update on public.buildings to authenticated;
grant select on public.building_manager_assignments to authenticated;
grant select, insert, update on public.units to authenticated;
grant select, insert, update on public.persons to authenticated;
grant select on public.person_user_links to authenticated;
grant select, insert, update, delete on public.unit_occupancies to authenticated;
grant select, insert, update, delete on public.unit_ownerships to authenticated;
grant select, insert, update, delete on public.unit_contacts to authenticated;

commit;