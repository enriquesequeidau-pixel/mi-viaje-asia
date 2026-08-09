-- Legacy projects already enforce storage_path uniqueness with the original
-- trip_media_storage_path_key constraint index.
drop index if exists public.trip_media_storage_path_idx;
