-- Run once in your Supabase project's SQL Editor. No existing tables are dropped.
begin;

create schema if not exists health_private;
revoke all on schema health_private from public, anon, authenticated;

create table public.monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  url text not null check (length(url) <= 2048 and url ~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(:443)?(/[^[:space:]#]*)?$'),
  interval_minutes integer not null default 10 check (interval_minutes in (5,10,15,30,60)),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  next_check_at timestamptz not null default now(),
  last_started_at timestamptz,
  last_checked_at timestamptz,
  last_status text check (last_status in ('up','down')),
  last_http_code integer,
  lease_id uuid,
  lease_until timestamptz
);

create table public.health_checks (
  id bigint generated always as identity primary key,
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('up','down')),
  http_code integer check (http_code between 100 and 599),
  response_ms integer check (response_ms >= 0),
  error text check (length(error) <= 350)
);

create table public.scheduler_status (
  id boolean primary key default true check (id),
  last_run_at timestamptz
);
insert into public.scheduler_status(id) values(true);

create index monitors_user_id_idx on public.monitors(user_id);
create index monitors_due_idx on public.monitors(next_check_at) where enabled;
create index health_checks_user_time_idx on public.health_checks(user_id, checked_at desc);
create index health_checks_monitor_time_idx on public.health_checks(monitor_id, checked_at desc);

alter table public.monitors enable row level security;
alter table public.health_checks enable row level security;
alter table public.scheduler_status enable row level security;

create policy monitors_select_own on public.monitors for select to authenticated using ((select auth.uid()) = user_id);
create policy monitors_insert_own on public.monitors for insert to authenticated with check ((select auth.uid()) = user_id);
create policy monitors_update_own on public.monitors for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy monitors_delete_own on public.monitors for delete to authenticated using ((select auth.uid()) = user_id);
create policy health_checks_select_own on public.health_checks for select to authenticated using ((select auth.uid()) = user_id);
create policy scheduler_status_read on public.scheduler_status for select to authenticated using (true);

revoke all on public.monitors, public.health_checks, public.scheduler_status from public, anon, authenticated;
grant select, delete on public.monitors to authenticated;
grant insert(user_id, name, url, interval_minutes, enabled) on public.monitors to authenticated;
grant update(name, url, interval_minutes, enabled) on public.monitors to authenticated;
grant select on public.health_checks, public.scheduler_status to authenticated;
grant all on public.monitors, public.health_checks, public.scheduler_status to service_role;
grant usage, select on sequence public.health_checks_id_seq to service_role;

create function health_private.prepare_monitor() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
    if (select count(*) from public.monitors where user_id = new.user_id) >= 10 then
      raise exception 'Your workspace supports up to 10 endpoints. Remove an endpoint before adding another.';
    end if;
  elsif new.url is distinct from old.url or new.interval_minutes is distinct from old.interval_minutes or new.enabled is distinct from old.enabled then
    new.next_check_at := now();
    -- Cancel an in-flight result when its URL or configuration changes.
    new.lease_id := null;
    new.lease_until := null;
    if new.url is distinct from old.url then
      new.last_checked_at := null;
      new.last_status := null;
      new.last_http_code := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function health_private.prepare_monitor() from public, anon, authenticated;
create trigger prepare_monitor before insert or update on public.monitors for each row execute function health_private.prepare_monitor();

-- Only the authenticated internal worker can claim and record checks.
-- Each claim has a lease, preventing overlapping workers from checking the same URL.
create function public.claim_health_checks(p_monitor_id uuid default null, p_user_id uuid default null)
returns table(id uuid, url text, lease_id uuid)
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with due as (
    select m.id from public.monitors m
    where (p_monitor_id is null and m.enabled and m.next_check_at <= now()
      or p_monitor_id is not null and m.id = p_monitor_id and m.user_id = p_user_id
        and (m.last_started_at is null or m.last_started_at < now() - interval '1 minute'))
      and (m.lease_until is null or m.lease_until < now())
    order by m.next_check_at
    limit 5
    for update skip locked
  )
  update public.monitors m set
    lease_id = gen_random_uuid(), lease_until = now() + interval '2 minutes',
    last_started_at = now(), next_check_at = now() + make_interval(mins => m.interval_minutes)
  from due where m.id = due.id
  returning m.id, m.url, m.lease_id;
end;
$$;
revoke all on function public.claim_health_checks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_health_checks(uuid, uuid) to service_role;

create function public.complete_health_check(p_monitor_id uuid, p_lease_id uuid, p_status text, p_http_code integer, p_response_ms integer, p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid;
begin
  update public.monitors set last_checked_at = now(), last_status = p_status, last_http_code = p_http_code,
    lease_id = null, lease_until = null
  where id = p_monitor_id and lease_id = p_lease_id
  returning user_id into owner_id;
  if owner_id is null then return false; end if;
  insert into public.health_checks(monitor_id, user_id, status, http_code, response_ms, error)
  values(p_monitor_id, owner_id, p_status, p_http_code, p_response_ms, p_error);
  return true;
end;
$$;
revoke all on function public.complete_health_check(uuid, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.complete_health_check(uuid, uuid, text, integer, integer, text) to service_role;

notify pgrst, 'reload schema';
commit;
