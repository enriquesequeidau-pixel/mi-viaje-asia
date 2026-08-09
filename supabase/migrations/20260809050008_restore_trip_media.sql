-- Restore private activity photos while preserving the legacy media table.

create table if not exists public.trip_media (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null,
  activity_id text,
  title text,
  storage_path text not null unique,
  mime_type text not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.trip_media alter column created_by set default auth.uid();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_media'::regclass
      and conname = 'trip_media_kind_check'
  ) then
    alter table public.trip_media
      add constraint trip_media_kind_check check (kind in ('photo', 'document'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_media'::regclass
      and conname = 'trip_media_storage_path_check'
  ) then
    alter table public.trip_media
      add constraint trip_media_storage_path_check
      check (storage_path like trip_id::text || '/%' and char_length(storage_path) <= 500);
  end if;
end;
$$;

create index if not exists trip_media_trip_activity_idx on public.trip_media (trip_id, activity_id, created_at);

alter table public.trip_media enable row level security;

drop policy if exists "trip members can read media metadata" on public.trip_media;
drop policy if exists "trip members can add media metadata" on public.trip_media;
drop policy if exists "trip members can delete media metadata" on public.trip_media;
drop policy if exists "members can read media metadata" on public.trip_media;
drop policy if exists "members can add media metadata" on public.trip_media;
drop policy if exists "members can delete media metadata" on public.trip_media;

create policy "members can read media metadata"
  on public.trip_media for select to authenticated
  using ((select private.is_trip_member(trip_id)));

create policy "members can add media metadata"
  on public.trip_media for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_trip_member(trip_id))
    and storage_path like trip_id::text || '/' || kind || '/%'
  );

create policy "members can delete media metadata"
  on public.trip_media for delete to authenticated
  using ((select private.is_trip_member(trip_id)));

revoke all on table public.trip_media from public, anon;
grant select, insert, delete on table public.trip_media to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-media',
  'trip-media',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members can read trip media" on storage.objects;
drop policy if exists "members can upload trip media" on storage.objects;
drop policy if exists "owners can update their trip media" on storage.objects;
drop policy if exists "owners can delete their trip media" on storage.objects;
drop policy if exists "trip members can read trip media" on storage.objects;
drop policy if exists "trip members can upload trip media" on storage.objects;
drop policy if exists "trip members can update trip media" on storage.objects;
drop policy if exists "trip members can delete trip media" on storage.objects;

create policy "members can read trip media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'trip-media'
    and exists (
      select 1 from public.trip_members member
      where member.trip_id::text = (storage.foldername(name))[1]
        and member.user_id = (select auth.uid())
    )
  );

create policy "members can upload trip media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'trip-media'
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[2] in ('photo', 'document')
    and exists (
      select 1 from public.trip_members member
      where member.trip_id::text = (storage.foldername(name))[1]
        and member.user_id = (select auth.uid())
    )
  );

create policy "members can delete trip media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'trip-media'
    and exists (
      select 1 from public.trip_members member
      where member.trip_id::text = (storage.foldername(name))[1]
        and member.user_id = (select auth.uid())
    )
  );
