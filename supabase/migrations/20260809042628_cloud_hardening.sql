-- Follow-up hardening after importing the legacy cloud schema.

create index if not exists trip_items_updated_by_idx
  on public.trip_items (updated_by);

create index if not exists trips_created_by_idx
  on public.trips (created_by);

alter table private.join_attempts
  add column if not exists id bigint generated always as identity;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'private.join_attempts'::regclass
      and contype = 'p'
  ) then
    alter table private.join_attempts
      add constraint join_attempts_pkey primary key (id);
  end if;
end;
$$;

-- Remove permissive read policies left by the previous application version.
drop policy if exists "users can read own memberships" on public.trip_members;
drop policy if exists "trip members can read trip" on public.trips;

-- The legacy invite table is retained only for rollback/audit compatibility.
-- It has no grants and this explicit deny policy keeps that intent visible.
do $$
begin
  if to_regclass('public.trip_invites') is not null then
    execute 'drop policy if exists "legacy invites are retired" on public.trip_invites';
    execute $policy$
      create policy "legacy invites are retired"
        on public.trip_invites
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
  end if;
end;
$$;
