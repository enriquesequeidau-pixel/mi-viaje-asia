-- Keep privileged implementations outside PostgREST's exposed public schema.

create or replace function private.create_trip_impl(trip_title text, join_code text)
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

  insert into public.trip_members (trip_id, user_id, role)
  values (new_trip_id, current_user_id, 'owner');

  return new_trip_id;
end;
$$;

create or replace function private.join_trip_impl(join_code text)
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
  select count(*) into recent_attempts
  from private.join_attempts
  where user_id = current_user_id and attempted_at > now() - interval '15 minutes';

  if recent_attempts >= 10 then
    raise exception 'too many attempts; try again later' using errcode = 'P0001';
  end if;

  insert into private.join_attempts (user_id) values (current_user_id);

  select * into selected_trip
  from public.trips
  where join_code_digest = extensions.digest(join_code, 'sha256')
  for update;

  if selected_trip.id is null then raise exception 'invalid join code' using errcode = 'P0001'; end if;

  if (select count(*) from public.trip_members where trip_id = selected_trip.id) >= selected_trip.max_members
     and not exists (
       select 1 from public.trip_members
       where trip_id = selected_trip.id and user_id = current_user_id
     )
  then
    raise exception 'trip member limit reached' using errcode = 'P0001';
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (selected_trip.id, current_user_id, 'member')
  on conflict (trip_id, user_id) do nothing;

  return selected_trip.id;
end;
$$;

revoke all on function private.create_trip_impl(text, text) from public, anon;
revoke all on function private.join_trip_impl(text) from public, anon;
grant execute on function private.create_trip_impl(text, text) to authenticated;
grant execute on function private.join_trip_impl(text) to authenticated;

create or replace function public.create_trip(trip_title text, join_code text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_trip_impl(trip_title, join_code);
$$;

create or replace function public.join_trip(join_code text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.join_trip_impl(join_code);
$$;

revoke all on function public.create_trip(text, text) from public, anon;
revoke all on function public.join_trip(text) from public, anon;
grant execute on function public.create_trip(text, text) to authenticated;
grant execute on function public.join_trip(text) to authenticated;
