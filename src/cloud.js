import { createClient } from '@supabase/supabase-js';
import { applyRemoteItem, listActivityPhotos, saveActivityPhoto, store } from './store.js';

const config = window.ASIA_TRIP_CONFIG || {};
function isBrowserSafeKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')) return true;
  if (!/^eyJ[A-Za-z0-9_-]+\./.test(key || '')) return false;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch { return false; }
}
const configured = /^https:\/\/[^/]+\.supabase\.co$/.test(config.supabaseUrl || '') && isBrowserSafeKey(config.supabaseKey || '');
let client = null;
let channel = null;
let state = {
  status: configured ? 'signed-out' : 'local', user: null, error: null,
  pending: store.outbox().length, mediaVersion: 0, mediaActivityId: null, mediaDeletedId: null
};
const listeners = new Set();
let flushing = false;

function emit(patch = {}) {
  state = { ...state, ...patch, pending: store.outbox().length };
  listeners.forEach(listener => listener({ ...state }));
}

function requireClient() {
  if (!configured) throw new Error('La nube aún no está configurada. Agrega window.ASIA_TRIP_CONFIG en config.js.');
  if (!client) client = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

async function getTripId() {
  const local = store.cloudMeta().tripId;
  if (local) return local;
  const { data, error } = await requireClient().from('trip_members').select('trip_id').limit(1).maybeSingle();
  if (error) throw error;
  if (data?.trip_id) store.setCloudMeta({ tripId: data.trip_id });
  return data?.trip_id || null;
}

async function subscribe(tripId) {
  if (channel) await requireClient().removeChannel(channel);
  if (!tripId) return;
  channel = requireClient().channel(`trip:${tripId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_items', filter: `trip_id=eq.${tripId}` }, payload => {
      const record = payload.new;
      if (record?.revision > store.cloudMeta().revision) {
        applyRemoteItem(record);
        store.setCloudMeta({ revision: record.revision });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_media' }, payload => {
      const media = payload.new?.trip_id ? payload.new : payload.old;
      if (media?.trip_id && media.trip_id !== tripId) return;
      emit({
        mediaVersion: state.mediaVersion + 1,
        mediaActivityId: media?.activity_id || null,
        mediaDeletedId: payload.eventType === 'DELETE' ? media?.id || null : null
      });
    })
    .subscribe();
}

function mediaExtension(mimeType) {
  return ({
    'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/heic': 'heic', 'image/heif': 'heif'
  })[mimeType] || 'jpg';
}

async function uploadActivityPhoto(activityId, image) {
  const tripId = await getTripId();
  if (!state.user || !tripId) throw new Error('Inicia sesión y vincula un viaje para compartir fotos.');
  const blob = await (await fetch(image)).blob();
  if (blob.size > 10 * 1024 * 1024) throw new Error('La foto supera el máximo de 10 MB.');
  if (!/^image\/(?:jpeg|png|webp|gif|heic|heif)$/i.test(blob.type)) throw new Error('Formato de foto no permitido.');
  const storagePath = `${tripId}/photo/${crypto.randomUUID()}.${mediaExtension(blob.type)}`;
  const supabase = requireClient();
  const { error: uploadError } = await supabase.storage.from('trip-media').upload(storagePath, blob, {
    contentType: blob.type,
    upsert: false
  });
  if (uploadError) throw uploadError;

  const { data, error: metadataError } = await supabase.from('trip_media').insert({
    trip_id: tripId,
    kind: 'photo',
    activity_id: activityId,
    storage_path: storagePath,
    mime_type: blob.type,
    created_by: state.user.id
  }).select('id,activity_id,storage_path,mime_type,created_at').single();
  if (metadataError) {
    await supabase.storage.from('trip-media').remove([storagePath]);
    throw metadataError;
  }
  return data;
}

async function remoteActivityPhotos(activityId) {
  const tripId = await getTripId();
  if (!state.user || !tripId) return [];
  const supabase = requireClient();
  const { data, error } = await supabase.from('trip_media')
    .select('id,activity_id,storage_path,mime_type,created_at')
    .eq('trip_id', tripId).eq('kind', 'photo').eq('activity_id', activityId).order('created_at');
  if (error) throw error;
  const signedPhotos = await Promise.all((data || []).map(async media => {
    const { data: signed, error: signedError } = await supabase.storage.from('trip-media').createSignedUrl(media.storage_path, 3600);
    if (signedError || !signed?.signedUrl) {
      console.warn('No se pudo abrir una foto compartida:', signedError?.message || media.id);
      return null;
    }
    return { ...media, cloudMediaId: media.id, cloudPath: media.storage_path, image: signed.signedUrl };
  }));
  return signedPhotos.filter(Boolean);
}

async function deleteRemotePhoto(photo) {
  if (!state.user || !photo.cloudMediaId || !photo.cloudPath) return;
  const supabase = requireClient();
  const { error: metadataError } = await supabase.from('trip_media').delete().eq('id', photo.cloudMediaId);
  if (metadataError) throw metadataError;
  const { error: storageError } = await supabase.storage.from('trip-media').remove([photo.cloudPath]);
  if (storageError) throw storageError;
}

async function syncPendingPhotos() {
  if (!state.user || !navigator.onLine) return 0;
  const tripId = await getTripId();
  if (!tripId) return 0;
  const { data: remoteMedia, error: remoteError } = await requireClient().from('trip_media')
    .select('id').eq('trip_id', tripId).eq('kind', 'photo');
  if (remoteError) throw remoteError;
  const remoteIds = new Set((remoteMedia || []).map(media => media.id));
  const localPhotos = await listActivityPhotos();
  let uploaded = 0;
  for (const photo of localPhotos.filter(item => !item.cloudMediaId || !remoteIds.has(item.cloudMediaId))) {
    const media = await uploadActivityPhoto(photo.activityId, photo.image);
    await saveActivityPhoto({ ...photo, cloudMediaId: media.id, cloudPath: media.storage_path });
    uploaded += 1;
  }
  return uploaded;
}

export const cloud = {
  configured,
  subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
  snapshot: () => ({ ...state }),
  async init() {
    if (!configured) { emit({ status: 'local' }); return; }
    const supabase = requireClient();
    const { data } = await supabase.auth.getSession();
    state.user = data.session?.user || null;
    state.status = state.user ? 'syncing' : 'signed-out';
    supabase.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      emit({ status: state.user ? 'syncing' : 'signed-out', user: state.user });
      if (state.user) setTimeout(() => cloud.sync(), 0);
    });
    emit();
    if (state.user) await this.sync();
  },
  async signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    emit({ user: data.user, status: 'syncing', error: null });
    await this.sync();
  },
  async signUp(email, password) {
    const { data, error } = await requireClient().auth.signUp({ email, password });
    if (error) throw error;
    emit({ user: data.user, status: data.session ? 'syncing' : 'confirmation', error: null });
    if (data.session) await this.sync();
    return Boolean(data.session);
  },
  async signOut() {
    if (channel) await requireClient().removeChannel(channel);
    const { error } = await requireClient().auth.signOut({ scope: 'local' });
    if (error) throw error;
    emit({ user: null, status: 'signed-out' });
  },
  async createTrip(title, joinCode) {
    const { data, error } = await requireClient().rpc('create_trip', { trip_title: title, join_code: joinCode });
    if (error) throw error;
    store.setCloudMeta({ tripId: data, revision: 0 });
    await this.seed();
    return data;
  },
  async joinTrip(joinCode) {
    const { data, error } = await requireClient().rpc('join_trip', { join_code: joinCode });
    if (error) throw error;
    store.setCloudMeta({ tripId: data, revision: 0 });
    await this.sync();
    return data;
  },
  listActivityPhotos: remoteActivityPhotos,
  uploadActivityPhoto,
  deleteActivityPhoto: deleteRemotePhoto,
  async syncPhotos() {
    const uploaded = await syncPendingPhotos();
    if (uploaded) emit({ mediaVersion: state.mediaVersion + 1, mediaActivityId: null, mediaDeletedId: null });
  },
  async seed() {
    const snapshot = store.get();
    for (const section of ['activities', 'stays', 'flights', 'extraExpenses']) for (const item of snapshot[section]) store.upsert(section, item);
    for (const section of ['checked', 'details', 'stayDetails', 'transportCosts', 'flightDetails']) for (const [id, value] of Object.entries(snapshot[section])) store.setMap(section, id, value);
    for (const section of ['rates', 'preferences']) store.updateSection(section, snapshot[section]);
    await this.flush();
  },
  async pull() {
    const tripId = await getTripId();
    if (!tripId) return;
    let revision = store.cloudMeta().revision || 0;
    while (true) {
      const { data, error } = await requireClient().from('trip_items').select('trip_id,item_type,item_id,data,revision,deleted_at').eq('trip_id', tripId).gt('revision', revision).order('revision').limit(500);
      if (error) throw error;
      for (const record of data || []) { applyRemoteItem(record); revision = Math.max(revision, Number(record.revision)); }
      store.setCloudMeta({ revision });
      if (!data || data.length < 500) break;
    }
    await subscribe(tripId);
  },
  async flush() {
    if (flushing || !state.user || !navigator.onLine) return;
    const tripId = await getTripId();
    if (!tripId) return;
    const queued = store.outbox();
    if (!queued.length) return;
    flushing = true; emit({ status: 'syncing', error: null });
    try {
      for (const item of queued) {
        const payload = { trip_id: tripId, item_type: item.item_type, item_id: item.item_id, data: item.deleted ? {} : item.data, deleted_at: item.deleted ? new Date().toISOString() : null };
        const { data, error } = await requireClient().from('trip_items').upsert(payload, { onConflict: 'trip_id,item_type,item_id' }).select('revision').single();
        if (error || !data) throw error || new Error('La nube no confirmó el cambio.');
        store.acknowledge([`${item.item_type}:${item.item_id}`]);
        store.setCloudMeta({ revision: Math.max(store.cloudMeta().revision || 0, Number(data.revision)) });
      }
      emit({ status: 'synced', error: null });
    } finally { flushing = false; emit(); }
  },
  async sync() {
    if (!state.user || !navigator.onLine) return;
    emit({ status: 'syncing', error: null });
    try { await this.pull(); await this.flush(); await this.syncPhotos(); emit({ status: 'synced' }); }
    catch (error) { console.error(error); emit({ status: 'error', error: error.message }); throw error; }
  }
};

window.addEventListener('online', () => cloud.sync().catch(() => {}));
window.addEventListener('offline', () => emit({ status: 'offline' }));
window.addEventListener('asia:outbox', () => { emit({ status: state.user ? 'pending' : state.status }); if (state.user) cloud.flush().catch(() => {}); });
