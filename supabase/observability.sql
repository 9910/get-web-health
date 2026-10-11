begin;
create table public.telemetry_apps (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80), key_hash text not null unique check(key_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), last_received_at timestamptz,
 quota_hour timestamptz, quota_used integer not null default 0
);
create index telemetry_apps_owner on public.telemetry_apps(user_id);
create table public.request_events (
 id bigint generated always as identity primary key, app_id uuid not null references public.telemetry_apps(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, received_at timestamptz not null default now(),
 method text not null, route text not null check(length(route)<=200), status_code integer not null check(status_code between 100 and 599),
 duration_ms integer not null check(duration_ms between 0 and 600000), error_type text check(length(error_type)<=80)
);
create index request_events_owner_time on public.request_events(user_id,received_at desc);
create index request_events_app_time on public.request_events(app_id,received_at desc);
create table public.alert_acknowledgements (
 user_id uuid not null references auth.users(id) on delete cascade, check_id bigint not null references public.health_checks(id) on delete cascade,
 acknowledged_at timestamptz not null default now(), primary key(user_id,check_id)
);
create table public.status_pages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 slug text not null unique default replace(gen_random_uuid()::text,'-',''), title text not null check(length(title) between 1 and 80),
 published boolean not null default false
);
create table public.status_components (
 page_id uuid not null references public.status_pages(id) on delete cascade,
 monitor_id uuid not null references public.monitors(id) on delete cascade, primary key(page_id,monitor_id)
);
create index status_pages_owner on public.status_pages(user_id);
create index status_components_monitor on public.status_components(monitor_id);
create index acknowledgements_check on public.alert_acknowledgements(check_id);
alter table public.telemetry_apps enable row level security;
alter table public.request_events enable row level security;
alter table public.alert_acknowledgements enable row level security;
alter table public.status_pages enable row level security;
alter table public.status_components enable row level security;
create policy telemetry_apps_owner on public.telemetry_apps for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy requests_owner on public.request_events for select to authenticated using(user_id=(select auth.uid()));
create policy acknowledgements_owner on public.alert_acknowledgements for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.health_checks where id=check_id and user_id=(select auth.uid())));
create policy pages_owner on public.status_pages for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy components_owner on public.status_components for all to authenticated using(exists(select 1 from public.status_pages where id=page_id and user_id=(select auth.uid()))) with check(exists(select 1 from public.status_pages where id=page_id and user_id=(select auth.uid())) and exists(select 1 from public.monitors where id=monitor_id and user_id=(select auth.uid())));
revoke all on public.telemetry_apps,public.request_events,public.alert_acknowledgements,public.status_pages,public.status_components from public,anon,authenticated;
grant select(id,user_id,name,created_at,last_received_at) on public.telemetry_apps to authenticated;
grant insert(user_id,name,key_hash),update(name,key_hash),delete on public.telemetry_apps to authenticated;
grant select on public.request_events to authenticated;
grant select,insert(user_id,check_id),delete on public.alert_acknowledgements to authenticated;
grant select,insert(user_id,title),update(title,published),delete on public.status_pages to authenticated;
grant select,insert,delete on public.status_components to authenticated;
grant all on public.telemetry_apps,public.request_events,public.alert_acknowledgements,public.status_pages,public.status_components to service_role;
grant usage,select on sequence public.request_events_id_seq to service_role;
create function health_private.limit_owned_resources() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,1));
 if tg_table_name='telemetry_apps' and (select count(*) from public.telemetry_apps where user_id=new.user_id)>=5 then raise exception 'Up to five telemetry apps are supported.'; end if;
 if tg_table_name='status_pages' and (select count(*) from public.status_pages where user_id=new.user_id)>=3 then raise exception 'Up to three status pages are supported.'; end if;
 return new;
end; $$;
revoke all on function health_private.limit_owned_resources() from public,anon,authenticated;
create trigger limit_telemetry before insert on public.telemetry_apps for each row execute function health_private.limit_owned_resources();
create trigger limit_status_pages before insert on public.status_pages for each row execute function health_private.limit_owned_resources();
create function public.record_telemetry(p_app_id uuid,p_events jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare owner_id uuid; used integer; bucket timestamptz; n integer; begin
 n:=jsonb_array_length(p_events); if n<1 or n>50 then raise exception 'Invalid batch size'; end if;
 select user_id,quota_used,quota_hour into owner_id,used,bucket from public.telemetry_apps where id=p_app_id for update;
 if owner_id is null then raise exception 'Unknown app'; end if;
 if bucket is distinct from date_trunc('hour',now()) then used:=0; end if;
 if used+n>1000 then return -1; end if;
 insert into public.request_events(app_id,user_id,method,route,status_code,duration_ms,error_type)
 select p_app_id,owner_id,x.method,x.route,x.status_code,x.duration_ms,x.error_type from jsonb_to_recordset(p_events) as x(method text,route text,status_code integer,duration_ms integer,error_type text);
 update public.telemetry_apps set last_received_at=now(),quota_hour=date_trunc('hour',now()),quota_used=used+n where id=p_app_id;
 return n;
end; $$;
revoke all on function public.record_telemetry(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_telemetry(uuid,jsonb) to service_role;
create function public.set_status_components(p_page_id uuid,p_monitor_ids uuid[]) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.status_pages where id=p_page_id and user_id=(select auth.uid())) then raise exception 'Page not found'; end if;
 if cardinality(p_monitor_ids)>10 then raise exception 'Maximum ten endpoints'; end if;
 delete from public.status_components where page_id=p_page_id;
 insert into public.status_components(page_id,monitor_id) select p_page_id,id from (select distinct unnest(p_monitor_ids) as id) as ids;
end; $$;
revoke all on function public.set_status_components(uuid,uuid[]) from public,anon;
grant execute on function public.set_status_components(uuid,uuid[]) to authenticated;
commit;
