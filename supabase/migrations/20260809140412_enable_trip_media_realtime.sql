-- Keep shared activity photos live across every trip member's devices.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_media'
  ) then
    alter publication supabase_realtime add table public.trip_media;
  end if;
end;
$$;
