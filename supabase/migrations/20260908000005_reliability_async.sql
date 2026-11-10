-- GABRIELA 2026
-- Migration 005: Reliability & Async Infrastructure
-- Depends on: 001-004
-- Purpose: transactional outbox, idempotency protection, retry metadata.

begin;

do $$ begin
  create type public.outbox_status as enum (
    'pending',
    'processing',
    'processed',
    'failed',
    'dead_letter'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.idempotency_status as enum (
    'in_progress',
    'completed',
    'failed'
  );
exception when duplicate_object then null;
end $$;

-- =========================================================
-- OUTBOX EVENTS
-- =========================================================

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  headers jsonb not null default '{}'::jsonb,
  status public.outbox_status not null default 'pending',
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempt_count integer not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outbox_aggregate_type_not_blank check (btrim(aggregate_type) <> ''),
  constraint outbox_event_type_not_blank check (btrim(event_type) <> ''),
  constraint outbox_attempt_nonnegative check (attempt_count >= 0)
);

create index if not exists outbox_events_queue_idx
  on public.outbox_events (status, available_at, created_at);

create index if not exists outbox_events_org_idx
  on public.outbox_events (organization_id, created_at desc);

create index if not exists outbox_events_aggregate_idx
  on public.outbox_events (aggregate_type, aggregate_id, created_at);

-- =========================================================
-- IDEMPOTENCY KEYS
-- =========================================================

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  operation text not null,
  request_hash text,
  response_code integer,
  response_body jsonb,
  status public.idempotency_status not null default 'in_progress',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint idempotency_operation_not_blank check (btrim(operation) <> ''),
  constraint idempotency_expiry_future check (expires_at > created_at),
  constraint idempotency_unique_scope unique (organization_id, idempotency_key, operation)
);

create index if not exists idempotency_keys_lookup_idx
  on public.idempotency_keys (organization_id, idempotency_key, operation);

create index if not exists idempotency_keys_expiry_idx
  on public.idempotency_keys (expires_at);

drop trigger if exists trg_idempotency_keys_updated_at on public.idempotency_keys;
create trigger trg_idempotency_keys_updated_at
before update on public.idempotency_keys
for each row execute function public.set_updated_at();

-- =========================================================
-- RLS
-- =========================================================

alter table public.outbox_events enable row level security;
alter table public.idempotency_keys enable row level security;

alter table public.outbox_events force row level security;
alter table public.idempotency_keys force row level security;

-- Both are infrastructure tables. No direct client access.
revoke all on public.outbox_events from anon, authenticated;
revoke all on public.idempotency_keys from anon, authenticated;

-- =========================================================
-- SERVER-SIDE HELPERS
-- =========================================================

create or replace function public.enqueue_outbox_event(
  p_organization_id uuid,
  p_aggregate_type text,
  p_aggregate_id text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_headers jsonb default '{}'::jsonb,
  p_available_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.outbox_events (
    organization_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    headers,
    available_at
  )
  values (
    p_organization_id,
    p_aggregate_type,
    p_aggregate_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(p_headers, '{}'::jsonb),
    coalesce(p_available_at, now())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_outbox_event(
  uuid, text, text, text, jsonb, jsonb, timestamptz
) from public, anon, authenticated;

-- =========================================================
-- SIMPLE RETENTION HELPERS
-- =========================================================

create or replace function public.cleanup_expired_idempotency_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.idempotency_keys
  where expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cleanup_expired_idempotency_keys()
from public, anon, authenticated;

commit;