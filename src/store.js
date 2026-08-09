import { DEFAULT_STATE } from './data.js';
import { clone, parseMoney, safeJson } from './utils.js';
import { normalizeActivity, normalizeFlightDetail, normalizeState } from './validation.js';

const STATE_KEY = 'asiaTripState2026.v7';
const OUTBOX_KEY = 'asiaTripOutbox2026.v1';
const META_KEY = 'asiaTripCloudMeta2026.v1';
const BACKUP_KEY = 'asiaTripBackupState2026';
const listeners = new Set();

function migrateLegacy() {
  const itinerary = safeJson(localStorage.getItem('asiaItineraryData2026'), null);
  const activities = Array.isArray(itinerary) ? itinerary.flatMap(day => (day.activities || []).map(item => ({
    ...item,
    date: String(day.date || '').split('/').reverse().join('-'),
    cost: parseMoney(item.cost),
    type: ({ Plane: 'Vuelo', Train: 'Transporte', Camera: 'Visita', ShoppingBag: 'Compras', Utensils: 'Comida', Hotel: 'Estadía' })[item.type] || 'Otro'
  }))) : DEFAULT_STATE.activities;
  return {
    ...clone(DEFAULT_STATE), activities,
    flights: safeJson(localStorage.getItem('asiaFlightsData2026'), DEFAULT_STATE.flights),
    stays: safeJson(localStorage.getItem('asiaStaysData2026'), DEFAULT_STATE.stays),
    checked: safeJson(localStorage.getItem('asiaTripChecked2026'), {}),
    details: safeJson(localStorage.getItem('asiaTripDetails2026'), {}),
    stayDetails: safeJson(localStorage.getItem('asiaStaysUser2026'), {}),
    transportCosts: safeJson(localStorage.getItem('asiaTransportCosts2026'), {}),
    flightDetails: safeJson(localStorage.getItem('asiaFlightDetails2026'), {}),
    extraExpenses: safeJson(localStorage.getItem('asiaExtraExpenses2026'), []),
    rates: safeJson(localStorage.getItem('asiaRates'), DEFAULT_STATE.rates)
  };
}

function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  try { return raw ? normalizeState(JSON.parse(raw), DEFAULT_STATE) : normalizeState(migrateLegacy(), DEFAULT_STATE); }
  catch (error) {
    console.warn('Se ignoró un estado local dañado:', error.message);
    return clone(DEFAULT_STATE);
  }
}

let state = loadState();
let outbox = safeJson(localStorage.getItem(OUTBOX_KEY), []);
if (!Array.isArray(outbox)) outbox = [];
let cloudMeta = safeJson(localStorage.getItem(META_KEY), { tripId: null, revision: 0 });
// Schema v8 restores legacy flight bookingRef/cost fields. Force one complete
// pull when there are no pending local writes so a previously incomplete local
// snapshot cannot hide records that still exist in Supabase.
if (cloudMeta.schemaVersion !== state.version && outbox.length === 0) {
  cloudMeta = { ...cloudMeta, revision: 0, schemaVersion: state.version };
  localStorage.setItem(META_KEY, JSON.stringify(cloudMeta));
}

function persist(markDirty = true) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  if (markDirty) localStorage.setItem(BACKUP_KEY, JSON.stringify({ dirty: true, lastChangedAt: new Date().toISOString() }));
  for (const listener of listeners) listener(state);
}

function entityFor(section, id, value) {
  const singular = {
    activities: 'activity', stays: 'stay', flights: 'flight', extraExpenses: 'expense',
    stayDetails: 'stay_detail', transportCosts: 'transport_cost', flightDetails: 'flight_detail'
  }[section] || section;
  return { item_type: singular, item_id: id, data: value, deleted: value === null, queued_at: new Date().toISOString() };
}

function queue(entity) {
  const index = outbox.findIndex(item => item.item_type === entity.item_type && item.item_id === entity.item_id);
  if (index >= 0) outbox[index] = entity; else outbox.push(entity);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  window.dispatchEvent(new CustomEvent('asia:outbox'));
}

export const store = {
  get: () => state,
  defaults: () => clone(DEFAULT_STATE),
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  replace(next, { remote = false } = {}) { state = normalizeState(next, DEFAULT_STATE); persist(!remote); },
  updateSection(section, value, { remote = false } = {}) {
    state = { ...state, [section]: value };
    persist(!remote);
    if (!remote) queue(entityFor('setting', section, value));
  },
  upsert(section, value, { remote = false } = {}) {
    const list = state[section];
    if (!Array.isArray(list)) throw new Error(`Sección no editable: ${section}`);
    let nextValue = section === 'activities'
      ? normalizeActivity({ ...(DEFAULT_STATE.activities.find(item => item.id === value.id) || {}), ...value })
      : value;
    const index = list.findIndex(item => item.id === nextValue.id);
    const next = [...list];
    if (index >= 0) next[index] = nextValue; else next.push(nextValue);
    state = { ...state, [section]: next };
    persist(!remote);
    if (!remote) queue(entityFor(section, nextValue.id, nextValue));
  },
  remove(section, id, { remote = false } = {}) {
    state = { ...state, [section]: state[section].filter(item => item.id !== id) };
    persist(!remote);
    if (!remote) queue(entityFor(section, id, null));
  },
  setMap(section, id, value, { remote = false } = {}) {
    const next = { ...(state[section] || {}) };
    if (value === undefined || value === null || value === false) delete next[id]; else next[id] = value;
    state = { ...state, [section]: next };
    persist(!remote);
    if (!remote) queue(entityFor(section, id, value || null));
  },
  reset() {
    state = clone(DEFAULT_STATE);
    outbox = [];
    cloudMeta = { tripId: cloudMeta.tripId || null, revision: 0, schemaVersion: state.version };
    localStorage.setItem(OUTBOX_KEY, '[]');
    localStorage.setItem(META_KEY, JSON.stringify(cloudMeta));
    persist(true);
  },
  clearAll() {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('asia'));
    keys.forEach(key => localStorage.removeItem(key));
    state = clone(DEFAULT_STATE); outbox = []; cloudMeta = { tripId: null, revision: 0, schemaVersion: state.version };
    persist(false);
  },
  outbox: () => [...outbox],
  acknowledge(keys) {
    const acknowledged = new Set(keys);
    outbox = outbox.filter(item => !acknowledged.has(`${item.item_type}:${item.item_id}`));
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  },
  cloudMeta: () => ({ ...cloudMeta }),
  setCloudMeta(meta) { cloudMeta = { ...cloudMeta, ...meta }; localStorage.setItem(META_KEY, JSON.stringify(cloudMeta)); },
  markBackedUp() { localStorage.setItem(BACKUP_KEY, JSON.stringify({ dirty: false, lastExportedAt: new Date().toISOString() })); },
  backupState: () => safeJson(localStorage.getItem(BACKUP_KEY), { dirty: false })
};

export function applyRemoteItem(record) {
  const mapSection = {
    activity: 'activities', stay: 'stays', flight: 'flights', expense: 'extraExpenses',
    stay_detail: 'stayDetails', transport_cost: 'transportCosts', flight_detail: 'flightDetails'
  };
  const section = mapSection[record.item_type] || record.item_type;
  if (record.item_type === 'flight_detail' && !record.deleted_at) {
    store.setMap('flightDetails', record.item_id, normalizeFlightDetail(record.data), { remote: true });
    return;
  }
  if (Array.isArray(state[section])) {
    if (record.deleted_at) store.remove(section, record.item_id, { remote: true });
    else store.upsert(section, record.data, { remote: true });
  } else if (record.item_type === 'setting') {
    if (!record.deleted_at) store.updateSection(record.item_id, record.data, { remote: true });
  } else {
    store.setMap(section, record.item_id, record.deleted_at ? null : record.data, { remote: true });
  }
}

let dbPromise;
export function openPrivateDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('AsiaTripPrivate', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

let legacyMediaDbPromise;
export function openLegacyMediaDb() {
  if (legacyMediaDbPromise) return legacyMediaDbPromise;
  legacyMediaDbPromise = new Promise((resolve, reject) => {
    // Keep using the original database so existing photos remain available after
    // the application upgrade. Opening without a version also tolerates a newer
    // legacy database instead of throwing VersionError.
    const request = indexedDB.open('AsiaTripDB');
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      legacyMediaDbPromise = null;
      reject(request.error);
    };
  });
  return legacyMediaDbPromise;
}

export async function listActivityPhotos(activityId = null) {
  const db = await openLegacyMediaDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos').objectStore('photos').getAll();
    request.onsuccess = () => resolve(activityId === null
      ? request.result
      : request.result.filter(photo => photo.activityId === activityId));
    request.onerror = () => reject(request.error);
  });
}

export async function saveActivityPhoto(record) {
  const db = await openLegacyMediaDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction('photos', 'readwrite').objectStore('photos');
    const request = record.id === undefined ? store.add(record) : store.put(record);
    request.onsuccess = () => resolve({ ...record, id: request.result });
    request.onerror = () => reject(request.error);
  });
}

export async function deleteActivityPhoto(id) {
  const db = await openLegacyMediaDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos', 'readwrite').objectStore('photos').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearActivityPhotos() {
  const db = await openLegacyMediaDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos', 'readwrite').objectStore('photos').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function listDocuments() {
  const db = await openPrivateDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocument(record) {
  const db = await openPrivateDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readwrite').objectStore('documents').put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDocument(id) {
  const db = await openPrivateDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readwrite').objectStore('documents').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearPrivateDb() {
  const db = await openPrivateDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readwrite').objectStore('documents').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
