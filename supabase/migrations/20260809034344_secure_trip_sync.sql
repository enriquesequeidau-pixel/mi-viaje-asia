-- Secure, item-level synchronization for Mi Viaje Asia.
-- Apply with `supabase db push` after linking the intended project.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Upgrade the legacy cloud schema in place. Renaming the table preserves its
-- primary key, policies and foreign keys, so existing trips and memberships survive.
do $$
begin
  if to_regclass('public.trips') is null and to_regclass('public.trip_trips') is not null then
    alter table public.trip_trips rename to trips;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trips' and column_name = 'name'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trips' and column_name = 'title'
  ) then
    alter table public.trips rename column name to title;
  end if;
end $$;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  join_code_digest bytea not null unique,
  max_members smallint not null default 2 check (max_members between 1 and 10),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

alter table public.trips add column if not exists title text;
alter table public.trips add column if not exists join_code_digest bytea;
alter table public.trips add column if not exists max_members smallint default 2;
alter table public.trips add column if not exists created_by uuid;
alter table public.trips add column if not exists created_at timestamptz default now();
alter table public.trips add column if not exists updated_at timestamptz default now();
alter table public.trip_members add column if not exists joined_at timestamptz not null default now();

-- Older data did not distinguish an owner. Promote the earliest member of each
-- ownerless trip, then derive the new ownership column from that membership.
with ranked_members as (
  select tm.trip_id, tm.user_id,
         row_number() over (partition by tm.trip_id order by coalesce(tm.joined_at, now()), tm.user_id) as position
  from public.trip_members tm
), ownerless as (
  select t.id from public.trips t
  where not exists (select 1 from public.trip_members tm where tm.trip_id = t.id and tm.role = 'owner')
)
update public.trip_members tm
set role = 'owner'
from ranked_members ranked, ownerless trip
where tm.trip_id = trip.id and tm.trip_id = ranked.trip_id and tm.user_id = ranked.user_id and ranked.position = 1;

update public.trips t
set created_by = (
  select tm.user_id from public.trip_members tm
  where tm.trip_id = t.id
  order by (tm.role = 'owner') desc, tm.joined_at, tm.user_id
  limit 1
) 
where t.created_by is null;

-- Preserve existing invite codes as one-way digests, then remove their plaintext
-- representation from the retired legacy table.
do $$
begin
  if to_regclass('public.trip_invites') is not null then
    update public.trips t
    set join_code_digest = extensions.digest(invite.code, 'sha256')
    from public.trip_invites invite
    where invite.trip_id = t.id and t.join_code_digest is null;

    update public.trip_invites
    set code = encode(extensions.digest(code, 'sha256'), 'hex')
    where code !~ '^[0-9a-f]{64}$';
  end if;
end $$;

update public.trips
set title = coalesce(nullif(trim(title), ''), 'Asia 2026'),
    join_code_digest = coalesce(join_code_digest, extensions.digest(encode(gen_random_bytes(24), 'hex'), 'sha256')),
    max_members = greatest(coalesce(max_members, 2), (select count(*) from public.trip_members tm where tm.trip_id = trips.id))::smallint,
    updated_at = coalesce(updated_at, now());

alter table public.trips alter column title set not null;
alter table public.trips alter column join_code_digest set not null;
alter table public.trips alter column max_members set not null;
alter table public.trips alter column max_members set default 2;
alter table public.trips alter column created_by set not null;
alter table public.trips alter column created_at set not null;
alter table public.trips alter column created_at set default now();
alter table public.trips alter column updated_at set not null;
alter table public.trips alter column updated_at set default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trips_join_code_digest_key' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_join_code_digest_key unique (join_code_digest);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trips_created_by_fkey' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_created_by_fkey foreign key (created_by) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trips_title_length_check' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_title_length_check check (char_length(title) between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trips_max_members_check' and conrelid = 'public.trips'::regclass) then
    alter table public.trips add constraint trips_max_members_check check (max_members between 1 and 10);
  end if;
end $$;

create sequence if not exists public.trip_item_revision_seq as bigint;

create table if not exists public.trip_items (
  trip_id uuid not null references public.trips(id) on delete cascade,
  item_type text not null check (item_type ~ '^[a-z_]{1,40}$'),
  item_id text not null check (char_length(item_id) between 1 and 100),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 262144),
  revision bigint not null default nextval('public.trip_item_revision_seq'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz,
  primary key (trip_id, item_type, item_id)
);

create index if not exists trip_items_trip_revision_idx on public.trip_items (trip_id, revision);
create index if not exists trip_members_user_idx on public.trip_members (user_id, trip_id);

create table if not exists private.join_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_user_time_idx on private.join_attempts (user_id, attempted_at desc);

create or replace function private.is_trip_member(target_trip_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id and user_id = target_user_id
  );
$$;

create or replace function private.is_trip_owner(target_trip_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1 from public.trip_members
    where trip_id = target_trip_id and user_id = target_user_id and role = 'owner'
  );
$$;

revoke all on function private.is_trip_member(uuid, uuid) from public;
revoke all on function private.is_trip_owner(uuid, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_trip_member(uuid, uuid) to authenticated;
grant execute on function private.is_trip_owner(uuid, uuid) to authenticated;

create or replace function private.bump_trip_item_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := nextval('public.trip_item_revision_seq');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trip_items_revision_trigger on public.trip_items;
create trigger trip_items_revision_trigger
before insert or update on public.trip_items
for each row execute function private.bump_trip_item_revision();

create or replace function public.create_trip(trip_title text, join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_trip_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if char_length(trim(trip_title)) not between 1 and 100 then raise exception 'invalid trip title'; end if;
  if char_length(join_code) not between 16 and 64 then raise exception 'join code must contain 16 to 64 characters'; end if;

  insert into public.trips (title, join_code_digest, created_by)
  values (trim(trip_title), extensions.digest(join_code, 'sha256'), current_user_id)
  returning id into new_trip_id;
  insert into public.trip_members (trip_id, user_id, role) values (new_trip_id, current_user_id, 'owner');
  return new_trip_id;
end;
$$;

create or replace function public.join_trip(join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_trip public.trips%rowtype;
  current_user_id uuid := auth.uid();
  recent_attempts integer;
begin
  if current_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if char_length(join_code) not between 16 and 64 then raise exception 'invalid join code'; end if;

  delete from private.join_attempts where attempted_at < now() - interval '1 day';
  select count(*) into recent_attempts from private.join_attempts
    where user_id = current_user_id and attempted_at > now() - interval '15 minutes';
  if recent_attempts >= 10 then raise exception 'too many attempts; try again later' using errcode = 'P0001'; end if;
  insert into private.join_attempts (user_id) values (current_user_id);

  select * into selected_trip from public.trips
    where join_code_digest = extensions.digest(join_code, 'sha256')
    for update;
  if selected_trip.id is null then raise exception 'invalid join code' using errcode = 'P0001'; end if;

  if (select count(*) from public.trip_members where trip_id = selected_trip.id) >= selected_trip.max_members
     and not exists (select 1 from public.trip_members where trip_id = selected_trip.id and user_id = current_user_id)
  then raise exception 'trip member limit reached' using errcode = 'P0001'; end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (selected_trip.id, current_user_id, 'member')
  on conflict (trip_id, user_id) do nothing;
  return selected_trip.id;
end;
$$;

revoke all on function public.create_trip(text, text) from public, anon;
revoke all on function public.join_trip(text) from public, anon;
grant execute on function public.create_trip(text, text) to authenticated;
grant execute on function public.join_trip(text) to authenticated;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_items enable row level security;

drop policy if exists "members can read trips" on public.trips;
create policy "members can read trips" on public.trips for select to authenticated
using ((select private.is_trip_member(id)));
drop policy if exists "owners can update trips" on public.trips;
create policy "owners can update trips" on public.trips for update to authenticated
using ((select private.is_trip_owner(id))) with check ((select private.is_trip_owner(id)));

drop policy if exists "members can read memberships" on public.trip_members;
create policy "members can read memberships" on public.trip_members for select to authenticated
using ((select private.is_trip_member(trip_id)));
drop policy if exists "owners can remove memberships" on public.trip_members;
create policy "owners can remove memberships" on public.trip_members for delete to authenticated
using ((select private.is_trip_owner(trip_id)) or user_id = (select auth.uid()));

drop policy if exists "members can read items" on public.trip_items;
create policy "members can read items" on public.trip_items for select to authenticated
using ((select private.is_trip_member(trip_id)));
drop policy if exists "members can insert items" on public.trip_items;
create policy "members can insert items" on public.trip_items for insert to authenticated
with check ((select private.is_trip_member(trip_id)) and updated_by = (select auth.uid()));
drop policy if exists "members can update items" on public.trip_items;
create policy "members can update items" on public.trip_items for update to authenticated
using ((select private.is_trip_member(trip_id)))
with check ((select private.is_trip_member(trip_id)) and updated_by = (select auth.uid()));

revoke all on table public.trips, public.trip_members, public.trip_items from anon;
revoke all on table public.trips, public.trip_members, public.trip_items from authenticated;
grant select on table public.trips, public.trip_members to authenticated;
grant update (title, updated_at) on table public.trips to authenticated;
grant delete on table public.trip_members to authenticated;
grant select, insert, update on table public.trip_items to authenticated;
grant usage, select on sequence public.trip_item_revision_seq to authenticated;

-- Convert the legacy whole-state JSON into independently synchronized records.
-- Existing item records win, which makes this block safe to rerun.
do $$
begin
  if to_regclass('public.trip_state') is not null then
    insert into public.trip_items (trip_id, item_type, item_id, data)
    select state.trip_id, 'activity', activity.value->>'id',
           activity.value || jsonb_build_object(
             'date', to_char(to_date(day.value->>'date', 'DD/MM/YYYY'), 'YYYY-MM-DD'),
             'city', replace(coalesce(activity.value->>'city', ''), '_', ' '),
             'cost', coalesce(nullif(regexp_replace(coalesce(activity.value->>'cost', ''), '[^0-9]', '', 'g'), ''), '0')::bigint,
             'type', case activity.value->>'type'
               when 'Plane' then 'Vuelo' when 'Train' then 'Transporte' when 'Camera' then 'Visita'
               when 'ShoppingBag' then 'Compras' when 'Utensils' then 'Comida' when 'Hotel' then 'Estadía'
               else coalesce(activity.value->>'type', 'Otro') end,
             'from', activity.value->'transportFrom', 'to', activity.value->'transportTo'
           )
    from public.trip_state state
    cross join lateral jsonb_array_elements(coalesce(state.data->'itineraryData', '[]'::jsonb)) day(value)
    cross join lateral jsonb_array_elements(coalesce(day.value->'activities', '[]'::jsonb)) activity(value)
    where nullif(activity.value->>'id', '') is not null
    on conflict (trip_id, item_type, item_id) do nothing;

    insert into public.trip_items (trip_id, item_type, item_id, data)
    select state.trip_id, 'stay', stay.value->>'id',
           stay.value || jsonb_build_object(
             'checkIn', case when stay.value->>'checkIn' ~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$'
               then to_char(to_timestamp(stay.value->>'checkIn', 'DD/MM/YYYY HH24:MI'), 'YYYY-MM-DD"T"HH24:MI')
               else stay.value->>'checkIn' end,
             'checkOut', case when stay.value->>'checkOut' ~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$'
               then to_char(to_timestamp(stay.value->>'checkOut', 'DD/MM/YYYY HH24:MI'), 'YYYY-MM-DD"T"HH24:MI')
               else stay.value->>'checkOut' end
           )
    from public.trip_state state
    cross join lateral jsonb_array_elements(coalesce(state.data->'initialStaysData', '[]'::jsonb)) stay(value)
    where nullif(stay.value->>'id', '') is not null
    on conflict (trip_id, item_type, item_id) do nothing;

    insert into public.trip_items (trip_id, item_type, item_id, data)
    select state.trip_id, 'flight', flight.value->>'id',
           flight.value || jsonb_build_object('date', case flight.value->>'id'
             when 'flight-1' then '2026-08-21' when 'flight-2' then '2026-08-23'
             when 'flight-3' then '2026-08-31' when 'flight-4' then '2026-08-31'
             when 'flight-5' then '2026-09-10' when 'flight-6' then '2026-09-10'
             else flight.value->>'date' end)
    from public.trip_state state
    cross join lateral jsonb_array_elements(coalesce(state.data->'flightsData', '[]'::jsonb)) flight(value)
    where nullif(flight.value->>'id', '') is not null
    on conflict (trip_id, item_type, item_id) do nothing;

    insert into public.trip_items (trip_id, item_type, item_id, data)
    select state.trip_id, 'expense', coalesce(nullif(expense.value->>'id', ''), 'legacy-expense-' || expense.ordinality), expense.value
    from public.trip_state state
    cross join lateral jsonb_array_elements(coalesce(state.data->'extraExpenses', '[]'::jsonb)) with ordinality expense(value, ordinality)
    on conflict (trip_id, item_type, item_id) do nothing;

    insert into public.trip_items (trip_id, item_type, item_id, data)
    select state.trip_id, section.item_type, entry.key, entry.value
    from public.trip_state state
    cross join lateral (values
      ('checked', state.data->'checked'),
      ('details', state.data->'details'),
      ('stay_detail', state.data->'stays'),
      ('transport_cost', state.data->'transportCosts'),
      ('flight_detail', state.data->'flightDetails')
    ) section(item_type, content)
    cross join lateral jsonb_each(case when jsonb_typeof(section.content) = 'object' then section.content else '{}'::jsonb end) entry
    on conflict (trip_id, item_type, item_id) do nothing;

    insert into public.trip_items (trip_id, item_type, item_id, data)
    select state.trip_id, 'setting', 'rates', state.data->'rates'
    from public.trip_state state
    where jsonb_typeof(state.data->'rates') = 'object'
    on conflict (trip_id, item_type, item_id) do nothing;
  end if;
end $$;

-- Retire the former whole-state API and plaintext invite endpoint after migration.
drop function if exists public.trip_join(text);
do $$
begin
  if to_regclass('public.trip_state') is not null then
    alter table public.trip_state enable row level security;
    revoke all on table public.trip_state from anon, authenticated;
  end if;
  if to_regclass('public.trip_invites') is not null then
    alter table public.trip_invites enable row level security;
    revoke all on table public.trip_invites from anon, authenticated;
  end if;
  if to_regclass('public.trip_media') is not null then
    alter table public.trip_media enable row level security;
    revoke all on table public.trip_media from anon, authenticated;
  end if;
  if to_regprocedure('public.trip_normalize_state_order()') is not null then
    revoke all on function public.trip_normalize_state_order() from public, anon, authenticated;
  end if;
end $$;

-- Private Storage bucket. File paths must start with the trip UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-media', 'trip-media', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members can read trip media" on storage.objects;
create policy "members can read trip media" on storage.objects for select to authenticated
using (bucket_id = 'trip-media' and exists (
  select 1 from public.trip_members tm
  where tm.trip_id::text = (storage.foldername(name))[1] and tm.user_id = (select auth.uid())
));
drop policy if exists "members can upload trip media" on storage.objects;
create policy "members can upload trip media" on storage.objects for insert to authenticated
with check (bucket_id = 'trip-media' and owner_id = (select auth.uid()::text) and exists (
  select 1 from public.trip_members tm
  where tm.trip_id::text = (storage.foldername(name))[1] and tm.user_id = (select auth.uid())
));
drop policy if exists "owners can update their trip media" on storage.objects;
create policy "owners can update their trip media" on storage.objects for update to authenticated
using (bucket_id = 'trip-media' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'trip-media' and owner_id = (select auth.uid()::text) and exists (
  select 1 from public.trip_members tm
  where tm.trip_id::text = (storage.foldername(name))[1] and tm.user_id = (select auth.uid())
));
drop policy if exists "owners can delete their trip media" on storage.objects;
create policy "owners can delete their trip media" on storage.objects for delete to authenticated
using (bucket_id = 'trip-media' and owner_id = (select auth.uid()::text));

do $$
begin
  alter publication supabase_realtime add table public.trip_items;
exception when duplicate_object then null;
end $$;
