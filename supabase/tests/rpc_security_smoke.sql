\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values (
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'rpc-owner@example.test',
  now(),
  now(),
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  created_trip_id uuid;
begin
  created_trip_id := public.create_trip(
    'RPC smoke test',
    '0123456789abcdef'
  );

  if not exists (
    select 1
    from public.trip_members
    where trip_id = created_trip_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'create_trip did not create the owner membership';
  end if;
end;
$$;

reset role;

insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
values (
  '20000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'rpc-member@example.test',
  now(),
  now(),
  now()
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);

do $$
declare
  joined_trip_id uuid;
begin
  joined_trip_id := public.join_trip('0123456789abcdef');

  if not exists (
    select 1
    from public.trip_members
    where trip_id = joined_trip_id
      and user_id = auth.uid()
      and role = 'member'
  ) then
    raise exception 'join_trip did not create the member membership';
  end if;
end;
$$;

reset role;
rollback;
