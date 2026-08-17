import { TRIP_END, TRIP_START, PHRASES } from './data.js';
import { budgetTotals } from './budget.js';
import { cloud } from './cloud.js';
import {
  clearActivityPhotos, clearPrivateDb, deleteActivityPhoto, deleteDocument,
  listActivityPhotos, listDocuments, saveActivityPhoto, saveDocument, store
} from './store.js';
import { decryptJson, encryptJson } from './crypto.js';
import { cleanText, dateLabel, downloadBlob, el, groupBy, mapsDirectionsUrl, mapsUrl, money, parseMoney, shortDate, taxFreeBreakdown, uid, validIsoDate, validTime } from './utils.js';
import { validateBackup } from './validation.js';

const $ = selector => document.querySelector(selector);
const dom = {
  today: $('#today'), summary: $('#desktop-summary'), list: $('#itinerary-list'), progress: $('#progress-pill'),
  filterSummary: $('#filter-summary'), city: $('#city-filter'), type: $('#type-filter'), search: $('#search-input'),
  tools: $('#tools-panel'), more: $('#more-button'), dialog: $('#app-dialog'), dialogTitle: $('#dialog-title'),
  dialogEyebrow: $('#dialog-eyebrow'), dialogContent: $('#dialog-content'), toast: $('#toast-region'),
  syncButton: $('#sync-button'), syncDot: $('#sync-dot'), syncLabel: $('#sync-label'), banner: $('#connection-banner'),
  backupStatus: $('#backup-status'), importFile: $('#import-file')
};

let filters = { query: '', city: 'ALL', type: 'ALL' };
let deferredInstall = null;
let currentCloud = cloud.snapshot();
let activePhotoView = null;

function iconFor(type) {
  return ({ Vuelo: '✈', Transporte: '↗', Comida: '♨', Compras: '◇', Estadía: '⌂', Visita: '◎', Otro: '•' })[type] || '•';
}

function toast(message, error = false) {
  const node = el('div', { class: `toast${error ? ' is-error' : ''}`, text: message });
  dom.toast.append(node);
  setTimeout(() => node.remove(), 4200);
}

function openDialog(title, eyebrow, content) {
  activePhotoView = null;
  dom.dialogTitle.textContent = title;
  dom.dialogEyebrow.textContent = eyebrow;
  dom.dialogContent.replaceChildren(content);
  if (!dom.dialog.open) dom.dialog.showModal();
  requestAnimationFrame(() => dom.dialogContent.querySelector('input,select,textarea,button,a')?.focus());
}

function closeDialog() { if (dom.dialog.open) dom.dialog.close(); }

function field(label, name, value = '', options = {}) {
  const input = options.type === 'select'
    ? el('select', { name, required: options.required }, (options.choices || []).map(choice => el('option', { value: choice, selected: choice === value }, choice)))
    : options.type === 'textarea'
      ? el('textarea', { name, maxlength: options.max || 1000, required: options.required }, value)
      : el('input', { name, value, type: options.type || 'text', min: options.min, max: options.max, step: options.step, minlength: options.minlength, required: options.required, autocomplete: options.autocomplete || 'off' });
  const wrapper = el('label', { class: `field${options.full ? ' full' : ''}` }, el('span', { text: label }), input);
  if (options.help) wrapper.append(el('small', { text: options.help }));
  return wrapper;
}

function buttons(...items) { return el('div', { class: 'form-actions' }, items); }

function submitButton(label = 'Guardar') { return el('button', { class: 'primary-button', type: 'submit', text: label }); }

function optionalMoney(data, name) {
  const raw = String(data.get(name) ?? '').trim();
  return raw ? parseMoney(raw) : null;
}

function getActivity(id) { return store.get().activities.find(item => item.id === id); }

function mapLink(label, query, className = 'secondary-button map-link', visibleText = label) {
  return el('a', {
    class: className, href: mapsUrl(query), target: '_blank', rel: 'noopener noreferrer',
    'aria-label': label, text: visibleText
  });
}

function stayMapQuery(stay, detail = {}) {
  return [detail.address || detail.hotel || stay.defaultLocation, stay.city, stay.country].filter(Boolean).join(', ');
}

function progressData() {
  const state = store.get();
  const total = state.activities.length;
  const done = state.activities.filter(item => state.checked[item.id]).length;
  return { total, done, percent: total ? Math.round(done / total * 100) : 0 };
}

function relevantActivity() {
  const items = [...store.get().activities].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const now = new Date();
  return items.find(item => new Date(`${item.date}T${item.time}:00`).getTime() >= now.getTime()) || items.at(-1);
}

function renderToday() {
  const now = new Date();
  const start = new Date(TRIP_START);
  const end = new Date(TRIP_END);
  const days = Math.max(0, Math.ceil((start - now) / 86400000));
  const underway = now >= start && now <= end;
  const finished = now > end;
  const next = relevantActivity();
  const headline = underway ? 'Tu viaje está en marcha' : finished ? 'Un viaje para recordar' : 'China y Japón, bien organizados';
  const lead = underway ? 'Todo el itinerario, gastos y reservas en un mismo lugar.' : finished ? 'El itinerario y tus registros siguen disponibles en este dispositivo.' : 'Del 21 de agosto al 10 de septiembre · 2 viajeros · 21 días.';
  const hero = el('div', { class: 'hero' },
    el('p', { class: 'eyebrow', text: underway ? 'En viaje' : finished ? 'Viaje finalizado' : 'Asia · 2026' }),
    el('h1', { id: 'today-title', text: headline }), el('p', { text: lead })
  );
  if (!finished) hero.append(el('div', { class: 'countdown' }, el('strong', { text: underway ? 'Ahora' : days }), !underway && el('span', { text: days === 1 ? 'día para partir' : 'días para partir' })));
  if (next) hero.append(el('button', { class: 'next-card', type: 'button', dataset: { activity: next.id } },
    el('p', { class: 'eyebrow', text: finished ? 'Última actividad' : 'Próxima actividad' }),
    el('h2', { text: next.title }), el('p', { class: 'meta', text: `${dateLabel(next.date)} · ${next.time} · ${next.location}` })
  ));
  dom.today.replaceChildren(hero);
}

function renderSummary() {
  const state = store.get();
  const progress = progressData();
  const budget = budgetTotals(state);
  const route = [...new Set(state.activities.map(item => item.city))];
  dom.summary.replaceChildren(
    el('div', { class: 'summary-card' }, el('h2', { text: 'Avance del viaje' }),
      el('progress', { class: 'progress-track', value: progress.percent, max: 100, 'aria-label': `${progress.percent}% completado` }),
      el('div', { class: 'summary-stat' }, el('span', { text: 'Completado' }), el('strong', { text: `${progress.done} / ${progress.total}` })),
      el('div', { class: 'summary-stat' }, el('span', { text: 'Ciudades' }), el('strong', { text: route.length })),
      el('div', { class: 'summary-stat' }, el('span', { text: 'Vuelos' }), el('strong', { text: state.flights.length }))
    ),
    el('div', { class: 'summary-card' }, el('h2', { text: 'Presupuesto' }),
      el('div', { class: 'summary-stat' }, el('span', { text: 'Planificado por persona' }), el('strong', { text: money(budget.planned) })),
      el('div', { class: 'summary-stat' }, el('span', { text: 'Registrado' }), el('strong', { text: money(budget.registered) })),
      el('button', { class: 'secondary-button', type: 'button', dataset: { action: 'budget' }, text: 'Ver detalle' })
    )
  );
}

function renderFilters() {
  const state = store.get();
  const cities = [...new Set(state.activities.map(item => item.city))].sort();
  const types = [...new Set(state.activities.map(item => item.type))].sort();
  const fill = (select, values, all) => {
    const selected = select.value || 'ALL';
    select.replaceChildren(el('option', { value: 'ALL', text: all }), ...values.map(value => el('option', { value, text: value })));
    select.value = values.includes(selected) ? selected : 'ALL';
  };
  fill(dom.city, cities, 'Todas las ciudades'); fill(dom.type, types, 'Todos los tipos');
}

function filteredActivities() {
  const query = filters.query.toLocaleLowerCase('es');
  return store.get().activities.filter(item =>
    (filters.city === 'ALL' || item.city === filters.city) &&
    (filters.type === 'ALL' || item.type === filters.type) &&
    (!query || `${item.title} ${item.location} ${item.city}`.toLocaleLowerCase('es').includes(query))
  ).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

function renderItinerary() {
  const state = store.get();
  const items = filteredActivities();
  const groups = groupBy(items, item => item.date);
  const fragment = document.createDocumentFragment();
  for (const [date, activities] of groups) {
    const collapsed = Boolean(state.preferences?.collapsedDays?.[date]);
    const bodyId = `day-${date}`;
    const body = el('div', { class: 'activity-list', id: bodyId, hidden: collapsed });
    for (const item of activities) {
      const done = Boolean(state.checked[item.id]);
      const photos = Number(state.details[item.id]?.photosCount) || 0;
      body.append(el('article', { class: `activity-row${done ? ' is-done' : ''}` },
        el('time', { class: 'activity-time', datetime: `${item.date}T${item.time}`, text: item.time }),
        el('button', { class: 'check-button', type: 'button', 'aria-pressed': done, 'aria-label': done ? `Marcar ${item.title} como pendiente` : `Marcar ${item.title} como completada`, dataset: { check: item.id }, text: '✓' }),
        el('button', { class: 'activity-copy', type: 'button', dataset: { activity: item.id } }, el('h3', { text: item.title }), el('p', { text: `${iconFor(item.type)} ${item.location}${item.cost ? ` · ${money(item.cost)}` : ''}${photos ? ` · 📷 ${photos}` : ''}` })),
        mapLink(`Abrir ${item.title} en Google Maps`, `${item.location}, ${item.city}`, 'detail-button map-shortcut', '↗')
      ));
    }
    fragment.append(el('section', { class: 'day-card' }, el('h2', {},
      el('button', { class: 'day-toggle', type: 'button', 'aria-expanded': !collapsed, 'aria-controls': bodyId, dataset: { day: date } },
        el('span', { class: 'day-label' }, el('strong', { text: shortDate(date) }), el('span', { text: dateLabel(date) })),
        el('span', { class: 'day-count', text: `${activities.length} ${activities.length === 1 ? 'actividad' : 'actividades'} ${collapsed ? '＋' : '−'}` })
      )), body));
  }
  if (!items.length) fragment.append(el('div', { class: 'empty-state' }, el('h2', { text: 'No encontramos actividades' }), el('p', { text: 'Prueba otra búsqueda o limpia los filtros.' })));
  dom.list.replaceChildren(fragment);
  dom.filterSummary.textContent = `${items.length} de ${state.activities.length} actividades`;
}

function renderStatus() {
  const progress = progressData();
  dom.progress.textContent = `${progress.percent}%`;
  dom.progress.setAttribute('aria-label', `${progress.percent}% del itinerario completado`);
  const pending = store.outbox().length;
  const backup = store.backupState();
  dom.backupStatus.textContent = backup.dirty
    ? 'Hay cambios sin un respaldo exportado.'
    : backup.lastExportedAt ? `Último respaldo: ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(backup.lastExportedAt))}.` : 'Tus cambios se guardan automáticamente en este dispositivo.';
  const info = {
    local: ['Solo local', ''], 'signed-out': ['Sin sesión', ''], syncing: ['Sincronizando', 'is-pending'],
    pending: [`${pending} pendiente${pending === 1 ? '' : 's'}`, 'is-pending'], synced: ['Sincronizado', 'is-online'],
    offline: ['Sin conexión', 'is-pending'], error: ['Error de sync', 'is-error'], confirmation: ['Confirma email', 'is-pending']
  }[currentCloud.status] || ['Solo local', ''];
  if (currentCloud.status === 'synced' && currentCloud.photoPending) {
    info[0] = `${currentCloud.photoPending} foto(s) pendiente(s)`;
    info[1] = 'is-pending';
  }
  dom.syncLabel.textContent = info[0]; dom.syncDot.className = `status-dot ${info[1]}`;
  const offline = !navigator.onLine;
  dom.banner.hidden = !offline && currentCloud.status !== 'error' && !currentCloud.photoPending;
  dom.banner.textContent = offline
    ? 'Sin conexión. Puedes seguir editando; los cambios se enviarán al volver la red.'
    : currentCloud.error || currentCloud.photoError || '';
}

function renderAll() { renderToday(); renderSummary(); renderFilters(); renderItinerary(); renderStatus(); }

function openActivity(id, edit = false) {
  const item = getActivity(id);
  if (!item) return;
  if (edit) return activityForm(item);
  const detail = store.get().details[id] || {};
  const photoGrid = el('div', { class: 'photo-grid', dataset: { photoGrid: id } });
  const photoStatus = el('p', { class: 'muted photo-status', text: 'Buscando fotos guardadas…' });
  const photoInput = el('input', {
    class: 'sr-only', type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif', multiple: true,
    onchange: async event => {
      const input = event.currentTarget;
      await addActivityPhotos(id, input.files, photoGrid, photoStatus);
      input.value = '';
    }
  });
  const photoSection = el('section', { class: 'activity-photos' },
    el('div', { class: 'row photo-heading' }, el('div', {}, el('h3', { text: 'Fotos del lugar' }), photoStatus),
      el('button', { class: 'secondary-button', type: 'button', onclick: () => photoInput.click(), text: '＋ Añadir fotos' })),
    photoInput,
    photoGrid
  );
  const content = el('div', {},
    el('div', { class: 'metric-grid' },
      el('div', { class: 'metric' }, el('span', { text: 'Fecha' }), el('strong', { text: shortDate(item.date) })),
      el('div', { class: 'metric' }, el('span', { text: 'Hora' }), el('strong', { text: item.time })),
      el('div', { class: 'metric' }, el('span', { text: 'Tipo' }), el('strong', { text: item.type })),
      el('div', { class: 'metric' }, el('span', { text: 'Estimado' }), el('strong', { text: money(item.cost) }))
    ),
    el('h3', { text: 'Ubicación' }), el('p', { text: item.location }),
    el('a', { href: mapsUrl(`${item.location}, ${item.city}`), target: '_blank', rel: 'noopener noreferrer', text: 'Abrir en Google Maps ↗' }),
    photoSection,
    el('h3', { text: 'Notas y gasto real' }),
    el('form', { class: 'form-grid', onsubmit: event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      store.setMap('details', id, { ...detail, notes: cleanText(form.get('notes'), 2000), realCost: parseMoney(form.get('realCost')) });
      toast('Detalle guardado.'); closeDialog();
    } },
      field('Notas', 'notes', detail.notes || '', { type: 'textarea', full: true, max: 2000 }),
      field('Gasto real (CLP)', 'realCost', detail.realCost || '', { type: 'number', min: 0 }),
      buttons(el('button', { class: 'danger-button', type: 'button', dataset: { deleteActivity: id }, text: 'Eliminar' }), el('button', { class: 'secondary-button', type: 'button', dataset: { editActivity: id }, text: 'Editar evento' }), submitButton())
    )
  );
  openDialog(item.title, item.city, content);
  activePhotoView = { activityId: id, grid: photoGrid, status: photoStatus };
  renderActivityPhotos(id, photoGrid, photoStatus).catch(error => {
    photoStatus.textContent = 'No se pudieron cargar las fotos.';
    toast(error.message, true);
  });
}

function photoKey(photo) {
  return photo.cloudMediaId ? `cloud:${photo.cloudMediaId}` : `local:${photo.id}`;
}

function openPhotoViewer(activityId, photo) {
  const item = getActivity(activityId);
  openDialog('Foto del lugar', item?.title || 'Actividad', el('div', { class: 'photo-viewer' },
    el('img', { src: photo.image, alt: `Foto de ${item?.title || 'la actividad'}` }),
    buttons(el('button', { class: 'secondary-button', type: 'button', onclick: () => openActivity(activityId), text: 'Volver a la actividad' }))
  ));
}

async function removeActivityPhoto(activityId, photo, grid, status) {
  if (!window.confirm('¿Eliminar esta foto?')) return;
  try {
    if (photo.cloudMediaId) {
      if (!currentCloud.user) throw new Error('Inicia sesión para eliminar también la copia compartida.');
      await cloud.deleteActivityPhoto(photo);
    }
    if (photo.id !== undefined) await deleteActivityPhoto(photo.id);
    toast('Foto eliminada.');
    await renderActivityPhotos(activityId, grid, status);
  } catch (error) { toast(error.message, true); }
}

async function renderActivityPhotos(activityId, grid, status) {
  const localPhotos = await listActivityPhotos(activityId);
  let remotePhotos = [];
  let cloudError = null;
  if (currentCloud.user && navigator.onLine) {
    try { remotePhotos = await cloud.listActivityPhotos(activityId); }
    catch (error) { cloudError = error; }
  }
  const localCloudIds = new Set(localPhotos.map(photo => photo.cloudMediaId).filter(Boolean));
  const photos = [...localPhotos, ...remotePhotos.filter(photo => !localCloudIds.has(photo.cloudMediaId))];
  const unique = [...new Map(photos.map(photo => [photoKey(photo), photo])).values()];

  grid.replaceChildren(...unique.map(photo => el('div', { class: 'photo-card' },
    el('button', { class: 'photo-preview', type: 'button', onclick: () => openPhotoViewer(activityId, photo), 'aria-label': 'Abrir foto' },
      el('img', { src: photo.image, alt: '', loading: 'lazy' })),
    el('button', { class: 'photo-delete', type: 'button', onclick: () => removeActivityPhoto(activityId, photo, grid, status), 'aria-label': 'Eliminar foto', text: '×' })
  )));
  if (!unique.length) grid.append(el('div', { class: 'empty-state photo-empty', text: 'Aún no hay fotos en esta actividad.' }));

  const detail = store.get().details[activityId] || {};
  if (Number(detail.photosCount || 0) !== unique.length) store.setMap('details', activityId, { ...detail, photosCount: unique.length });
  const remoteIds = new Set(remotePhotos.map(photo => photo.cloudMediaId));
  const localOnly = localPhotos.filter(photo =>
    !photo.cloudMediaId || (currentCloud.user && navigator.onLine && !remoteIds.has(photo.cloudMediaId))
  ).length;
  status.textContent = cloudError
    ? `${unique.length} foto(s) · no se pudo comprobar la nube: ${cloudError.message}`
    : !currentCloud.user
      ? `${unique.length} foto(s) · solo en este dispositivo; tu pareja aún no puede verla(s)`
      : !navigator.onLine
        ? `${unique.length} foto(s) · sin conexión; lo pendiente se compartirá al volver la red`
        : localOnly
          ? `${unique.length} foto(s) · ${localOnly} pendiente(s) de subir; tu pareja aún no la(s) ve`
          : `${unique.length} foto(s) · compartida(s) en privado con integrantes del viaje`;
}

async function addActivityPhotos(activityId, fileList, grid, status) {
  const files = [...(fileList || [])].slice(0, 12);
  if (!files.length) return;
  status.textContent = 'Guardando fotos…';
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { toast(`${file.name}: supera 10 MB.`, true); continue; }
    if (!/^image\/(?:jpeg|png|webp|gif|heic|heif)$/i.test(file.type)) { toast(`${file.name}: formato no permitido.`, true); continue; }
    try {
      const compatibleFile = await compatiblePhotoFile(file);
      let record = await saveActivityPhoto({ activityId, image: await fileAsDataUrl(compatibleFile) });
      if (currentCloud.user && navigator.onLine) {
        try {
          const media = await cloud.uploadActivityPhoto(activityId, compatibleFile);
          record = await saveActivityPhoto({ ...record, cloudMediaId: media.id, cloudPath: media.storage_path });
        } catch (error) {
          toast(`No se pudo compartir “${file.name}”: ${error.message}. Quedó guardada localmente.`, true);
        }
      }
    } catch (error) { toast(`${file.name}: ${error.message}`, true); }
  }
  await renderActivityPhotos(activityId, grid, status);
  toast(files.length === 1 ? 'Foto guardada.' : 'Fotos guardadas.');
}

function activityForm(item = null) {
  const isEdit = Boolean(item);
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = {
      ...(item || {}),
      id: item?.id || uid('activity'), date: String(data.get('date')), time: String(data.get('time')),
      city: cleanText(data.get('city'), 60).toUpperCase(), title: cleanText(data.get('title'), 180),
      location: cleanText(data.get('location'), 240), cost: parseMoney(data.get('cost')), type: String(data.get('type'))
    };
    if (!validIsoDate(value.date) || !validTime(value.time) || !value.city || !value.title) return toast('Completa fecha, hora, ciudad y título.', true);
    store.upsert('activities', value); closeDialog(); toast(isEdit ? 'Evento actualizado.' : 'Evento agregado.');
  } },
    field('Título', 'title', item?.title, { required: true, full: true }),
    field('Fecha', 'date', item?.date || '2026-08-21', { type: 'date', required: true }),
    field('Hora', 'time', item?.time || '09:00', { type: 'time', required: true }),
    field('Ciudad', 'city', item?.city, { required: true }),
    field('Tipo', 'type', item?.type || 'Visita', { type: 'select', choices: ['Visita','Comida','Compras','Transporte','Vuelo','Estadía','Otro'] }),
    field('Ubicación', 'location', item?.location, { full: true }),
    field('Costo estimado (CLP)', 'cost', item?.cost || 0, { type: 'number', min: 0 }),
    buttons(el('button', { class: 'secondary-button', type: 'button', onclick: closeDialog, text: 'Cancelar' }), submitButton(isEdit ? 'Guardar cambios' : 'Agregar'))
  );
  openDialog(isEdit ? 'Editar evento' : 'Nuevo evento', 'Itinerario', form);
}

function confirmDeleteActivity(id) {
  const item = getActivity(id); if (!item) return;
  openDialog('Eliminar evento', 'Confirmación', el('div', {}, el('p', { text: `Se eliminará “${item.title}”. El cambio también se sincronizará si usas la nube.` }), buttons(el('button', { class: 'secondary-button', type: 'button', onclick: () => openActivity(id), text: 'Cancelar' }), el('button', { class: 'danger-button', type: 'button', onclick: () => { store.remove('activities', id); closeDialog(); toast('Evento eliminado.'); }, text: 'Eliminar' }))));
}

function openBudget() {
  const state = store.get();
  const budget = budgetTotals(state);
  const categories = groupBy(state.extraExpenses, item => item.category);
  const content = el('div', {},
    el('div', { class: 'metric-grid' },
      el('div', { class: 'metric' }, el('span', { text: 'Planificado por persona' }), el('strong', { text: money(budget.planned) })),
      el('div', { class: 'metric' }, el('span', { text: 'Registrado' }), el('strong', { text: money(budget.registered) })),
      el('div', { class: 'metric' }, el('span', { text: 'Diferencia' }), el('strong', { class: budget.difference >= 0 ? 'money-positive' : 'money-negative', text: money(budget.difference) })),
      el('div', { class: 'metric' }, el('span', { text: 'Estadías / persona' }), el('strong', { text: money(budget.plannedStays) }))
    ),
    el('h3', { text: 'Distribución' }),
    el('div', { class: 'stack-list' },
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Actividades planificadas' }), el('span', { text: money(budget.plannedActivities) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Estadías planificadas / persona' }), el('span', { text: money(budget.plannedStays) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Traslados planificados' }), el('span', { text: money(budget.plannedTransport) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Vuelos incluidos en planificado (costo real)' }), el('span', { text: money(budget.plannedFlights) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Actividades registradas' }), el('span', { text: money(budget.actualActivities) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Estadías registradas' }), el('span', { text: money(budget.actualStays) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Traslados registrados' }), el('span', { text: money(budget.actualTransport) }))),
      el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: 'Vuelos registrados' }), el('span', { text: money(budget.actualFlights) }))),
      ...[...categories].map(([category, items]) => el('div', { class: 'info-card' }, el('div', { class: 'row' }, el('strong', { text: category }), el('span', { text: money(items.reduce((sum, item) => sum + item.amount, 0)) }))))
    ),
    buttons(el('button', { class: 'secondary-button', type: 'button', dataset: { action: 'expenses' }, text: 'Gestionar gastos extra' }))
  );
  openDialog('Presupuesto', 'Criterio original por persona · CLP', content);
}

function openExpenses() {
  const state = store.get();
  const list = el('div', { class: 'stack-list' }, ...state.extraExpenses.map(expense => el('div', { class: 'info-card' },
    el('div', { class: 'row' }, el('div', {}, el('strong', { text: expense.name }), el('p', { text: `${expense.category} · ${dateLabel(expense.date)}` })), el('strong', { text: money(expense.amount) })),
    el('button', { class: 'text-button', type: 'button', dataset: { deleteExpense: expense.id }, text: 'Eliminar' })
  )));
  if (!state.extraExpenses.length) list.append(el('div', { class: 'empty-state', text: 'Todavía no hay gastos adicionales.' }));
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    store.upsert('extraExpenses', { id: uid('expense'), name: cleanText(data.get('name'), 180), category: cleanText(data.get('category'), 80), date: String(data.get('date')), amount: parseMoney(data.get('amount')) });
    toast('Gasto agregado.'); openExpenses();
  } }, field('Descripción', 'name', '', { required: true, full: true }), field('Categoría', 'category', 'Otros', { type: 'select', choices: ['Comida','Transporte','Compras','Entradas','Otros'] }), field('Fecha', 'date', new Date().toISOString().slice(0,10), { type: 'date', required: true }), field('Monto (CLP)', 'amount', '', { type: 'number', min: 0, required: true }), buttons(submitButton('Agregar gasto')));
  openDialog('Gastos adicionales', 'Presupuesto', el('div', {}, list, el('h3', { text: 'Nuevo gasto' }), form));
}

function openStays() {
  const state = store.get();
  const list = el('div', { class: 'stack-list' }, ...state.stays.map(stay => {
    const detail = state.stayDetails[stay.id] || {};
    return el('article', { class: 'info-card record-card' },
      el('div', { class: 'row' }, el('div', {}, el('strong', { text: stay.city }), el('p', { text: `${stay.country} · ${stay.nights ? `${stay.nights} noches` : 'Paseo de día'}` })), el('span', { class: 'status-chip', text: detail.confirmation ? 'Confirmado ✓' : 'Pendiente' })),
      el('p', { text: detail.hotel || stay.defaultLocation || 'Alojamiento por definir' }),
      el('p', { class: 'record-costs', text: `Estimado por persona: ${money(stay.estPerPerson)}` }),
      buttons(
        mapLink('Abrir alojamiento en Google Maps ↗', stayMapQuery(stay, detail)),
        el('button', { class: 'secondary-button', type: 'button', onclick: () => openStay(stay.id), text: 'Reserva y gasto real' }),
        el('button', { class: 'text-button', type: 'button', onclick: () => stayForm(stay), text: 'Editar estimado' }),
        el('button', { class: 'text-button danger-text', type: 'button', onclick: () => confirmDeleteStay(stay.id), text: 'Eliminar' })
      )
    );
  }));
  if (!state.stays.length) list.append(el('div', { class: 'empty-state', text: 'Todavía no hay estadías planificadas.' }));
  const content = el('div', {},
    buttons(el('button', { class: 'primary-button', type: 'button', onclick: () => stayForm(), text: '+ Agregar estadía' })),
    el('p', { class: 'muted manager-note', text: 'El estimado alimenta el presupuesto; el gasto real se registra aparte al pagar.' }),
    list
  );
  openDialog('Estadías', `${state.stays.reduce((sum, stay) => sum + stay.nights, 0)} noches`, content);
}

function stayForm(stay = null) {
  const isEdit = Boolean(stay);
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checkIn = String(data.get('checkIn'));
    const checkOut = String(data.get('checkOut'));
    const country = cleanText(data.get('country'), 60);
    const city = cleanText(data.get('city'), 60).toUpperCase();
    if (!country || !city || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(checkOut) || checkOut < checkIn) {
      return toast('Completa país, ciudad y un rango de fechas válido.', true);
    }
    const estPerPerson = parseMoney(data.get('estPerPerson'));
    store.upsert('stays', {
      ...(stay || {}), id: stay?.id || uid('stay'), country, city, checkIn, checkOut,
      nights: Math.min(60, parseMoney(data.get('nights'))),
      estPerPerson, estTotal: estPerPerson * 2,
      defaultLocation: cleanText(data.get('defaultLocation'), 240)
    });
    toast(isEdit ? 'Estadía actualizada.' : 'Estadía agregada.');
    openStays();
  } },
    field('País', 'country', stay?.country || '', { required: true }),
    field('Ciudad', 'city', stay?.city || '', { required: true }),
    field('Check-in', 'checkIn', stay?.checkIn || '2026-08-21T15:00', { type: 'datetime-local', required: true }),
    field('Check-out', 'checkOut', stay?.checkOut || '2026-08-22T11:00', { type: 'datetime-local', required: true }),
    field('Noches', 'nights', stay?.nights ?? 1, { type: 'number', min: 0, max: 60, required: true }),
    field('Estimado por persona (CLP)', 'estPerPerson', stay?.estPerPerson ?? '', { type: 'number', min: 0, required: true, help: 'Se mantiene separado del costo real.' }),
    field('Zona o alojamiento previsto', 'defaultLocation', stay?.defaultLocation || '', { full: true }),
    buttons(el('button', { class: 'secondary-button', type: 'button', onclick: openStays, text: 'Cancelar' }), submitButton(isEdit ? 'Guardar cambios' : 'Agregar estadía'))
  );
  openDialog(isEdit ? 'Editar estadía' : 'Nueva estadía', 'Presupuesto estimado', form);
}

function confirmDeleteStay(id) {
  const stay = store.get().stays.find(item => item.id === id); if (!stay) return;
  openDialog('Eliminar estadía', 'Confirmación', el('div', {},
    el('p', { text: `Se eliminará la estadía de ${stay.city}, su reserva y su gasto real asociado.` }),
    buttons(
      el('button', { class: 'secondary-button', type: 'button', onclick: openStays, text: 'Cancelar' }),
      el('button', { class: 'danger-button', type: 'button', onclick: () => {
        store.remove('stays', id); store.setMap('stayDetails', id, null);
        toast('Estadía eliminada.'); openStays();
      }, text: 'Eliminar estadía' })
    )
  ));
}

function openStay(id) {
  const stay = store.get().stays.find(item => item.id === id); if (!stay) return;
  const detail = store.get().stayDetails[id] || {};
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const next = { ...detail, hotel: cleanText(data.get('hotel'), 180), address: cleanText(data.get('address'), 240), confirmation: cleanText(data.get('confirmation'), 100), notes: cleanText(data.get('notes'), 1000) };
    const realCost = optionalMoney(data, 'realCost');
    if (realCost === null) delete next.realCost; else next.realCost = realCost;
    store.setMap('stayDetails', id, next);
    toast('Estadía actualizada.'); openStays();
  } }, field('Hotel o alojamiento', 'hotel', detail.hotel || '', { full: true }), field('Dirección', 'address', detail.address || '', { full: true }), field('Confirmación', 'confirmation', detail.confirmation || ''), field('Costo real por persona (CLP)', 'realCost', detail.realCost ?? '', { type: 'number', min: 0, help: 'Déjalo vacío hasta realizar el pago.' }), field('Notas', 'notes', detail.notes || '', { type: 'textarea', full: true }), buttons(el('button', { class: 'secondary-button', type: 'button', onclick: openStays, text: 'Volver' }), submitButton()));
  openDialog(stay.city, `${stay.country} · ${stay.nights} noches`, el('div', {},
    el('div', { class: 'notice', text: `Check-in ${stay.checkIn.replace('T',' ')} · Check-out ${stay.checkOut.replace('T',' ')} · Estimado por persona ${money(stay.estPerPerson)}.` }),
    mapLink('Abrir alojamiento en Google Maps ↗', stayMapQuery(stay, detail)),
    el('h3', { text: 'Reserva y gasto real' }), form));
}

function openFlights() {
  const state = store.get();
  const list = el('div', { class: 'stack-list' }, ...state.flights.map(flight => {
    const detail = state.flightDetails[flight.id] || {};
    return el('article', { class: 'info-card record-card' },
      el('div', { class: 'row' }, el('strong', { text: `${flight.fromCode} → ${flight.toCode}` }), el('strong', { text: flight.flight })),
      el('p', { text: `${shortDate(flight.date)} · ${flight.time} · ${flight.airline}${flight.needsCheck ? ' · Fecha por confirmar' : ''}` }),
      el('p', { class: 'record-costs', text: detail.realCost != null ? `Costo real: ${money(detail.realCost)}` : 'Costo real pendiente' }),
      detail.booking && el('p', { text: `Reserva ${detail.booking}${detail.confirmed ? ' · Confirmada ✓' : ''}` }),
      buttons(
        el('button', { class: 'secondary-button', type: 'button', onclick: () => openFlight(flight.id), text: 'Reserva y costo real' }),
        el('button', { class: 'text-button', type: 'button', onclick: () => flightForm(flight), text: 'Editar vuelo' }),
        el('button', { class: 'text-button danger-text', type: 'button', onclick: () => confirmDeleteFlight(flight.id), text: 'Eliminar' })
      )
    );
  }));
  if (!state.flights.length) list.append(el('div', { class: 'empty-state', text: 'Todavía no hay vuelos planificados.' }));
  openDialog('Vuelos', `${state.flights.length} tramos`, el('div', {},
    buttons(el('button', { class: 'primary-button', type: 'button', onclick: () => flightForm(), text: '+ Agregar vuelo' })),
    el('p', { class: 'muted manager-note', text: 'En vuelos solo registramos el costo real del tramo; no existe monto estimado.' }),
    !currentCloud.user && cloud.configured && el('div', { class: 'notice sync-notice' },
      el('strong', { text: 'Esta vista está sin sesión' }),
      el('p', { text: 'Inicia sesión para cargar desde la nube tus costos reales, localizadores y reservas confirmadas.' }),
      buttons(el('button', { class: 'secondary-button', type: 'button', onclick: openAccount, text: 'Iniciar sesión y sincronizar' }))
    ),
    list
  ));
}

function flightForm(flight = null) {
  const isEdit = Boolean(flight);
  const { estimatedCost: _discardedEstimate, plannedCost: _discardedPlan, ...baseFlight } = flight || {};
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const value = {
      ...baseFlight, id: flight?.id || uid('flight'), date: String(data.get('date')), time: String(data.get('time')),
      from: cleanText(data.get('from'), 100), fromCode: cleanText(data.get('fromCode'), 5).toUpperCase(),
      to: cleanText(data.get('to'), 100), toCode: cleanText(data.get('toCode'), 5).toUpperCase(),
      airline: cleanText(data.get('airline'), 100), flight: cleanText(data.get('flight'), 30).toUpperCase(),
      needsCheck: data.get('status') === 'Por confirmar'
    };
    if (!validIsoDate(value.date) || !validTime(value.time) || !value.from || !value.to || !value.fromCode || !value.toCode) return toast('Completa fecha, hora, origen y destino.', true);
    store.upsert('flights', value);
    toast(isEdit ? 'Vuelo actualizado.' : 'Vuelo agregado.'); openFlights();
  } },
    field('Origen', 'from', flight?.from || '', { required: true }),
    field('Código origen', 'fromCode', flight?.fromCode || '', { required: true }),
    field('Destino', 'to', flight?.to || '', { required: true }),
    field('Código destino', 'toCode', flight?.toCode || '', { required: true }),
    field('Fecha', 'date', flight?.date || '2026-08-21', { type: 'date', required: true }),
    field('Hora', 'time', flight?.time || '09:00', { type: 'time', required: true }),
    field('Aerolínea', 'airline', flight?.airline || ''),
    field('Número de vuelo', 'flight', flight?.flight || ''),
    field('Estado de fecha', 'status', flight?.needsCheck ? 'Por confirmar' : 'Confirmada', { type: 'select', choices: ['Confirmada', 'Por confirmar'], full: true }),
    buttons(el('button', { class: 'secondary-button', type: 'button', onclick: openFlights, text: 'Cancelar' }), submitButton(isEdit ? 'Guardar cambios' : 'Agregar vuelo'))
  );
  openDialog(isEdit ? 'Editar vuelo' : 'Nuevo vuelo', 'Planificación', form);
}

function confirmDeleteFlight(id) {
  const flight = store.get().flights.find(item => item.id === id); if (!flight) return;
  openDialog('Eliminar vuelo', 'Confirmación', el('div', {},
    el('p', { text: `Se eliminará el vuelo ${flight.flight || `${flight.fromCode} → ${flight.toCode}`} y sus datos de reserva y gasto real.` }),
    buttons(
      el('button', { class: 'secondary-button', type: 'button', onclick: openFlights, text: 'Cancelar' }),
      el('button', { class: 'danger-button', type: 'button', onclick: () => {
        store.remove('flights', id); store.setMap('flightDetails', id, null);
        toast('Vuelo eliminado.'); openFlights();
      }, text: 'Eliminar vuelo' })
    )
  ));
}

function openFlight(id) {
  const flight = store.get().flights.find(item => item.id === id); if (!flight) return;
  const detail = store.get().flightDetails[id] || {};
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const { cost: _legacyCost, bookingRef: _legacyBookingRef, ...preserved } = detail;
    const next = { ...preserved, booking: cleanText(data.get('booking'), 80), confirmed: data.get('confirmed') === 'Sí', terminal: cleanText(data.get('terminal'), 60), seats: cleanText(data.get('seats'), 60), notes: cleanText(data.get('notes'), 1000) };
    const realCost = optionalMoney(data, 'realCost');
    if (realCost === null) delete next.realCost; else next.realCost = realCost;
    store.setMap('flightDetails', id, next);
    toast('Vuelo actualizado.'); openFlights();
  } }, field('Código de reserva', 'booking', detail.booking || detail.bookingRef || ''), field('Reserva confirmada', 'confirmed', detail.confirmed ? 'Sí' : 'No', { type: 'select', choices: ['Sí', 'No'] }), field('Terminal', 'terminal', detail.terminal || ''), field('Asientos', 'seats', detail.seats || ''), field('Costo real (CLP)', 'realCost', detail.realCost ?? detail.cost ?? '', { type: 'number', min: 0 }), field('Notas', 'notes', detail.notes || '', { type: 'textarea', full: true }), buttons(el('button', { class: 'secondary-button', type: 'button', onclick: openFlights, text: 'Volver' }), submitButton()));
  openDialog(`${flight.fromCode} → ${flight.toCode}`, `${flight.flight} · ${flight.airline}`, el('div', {}, el('div', { class: 'notice', text: `${shortDate(flight.date)} · ${flight.time} · En vuelos se registra únicamente el costo real.` }), el('h3', { text: 'Reserva y costo real' }), form));
}

function openTransport() {
  const state = store.get();
  const items = state.activities.filter(item => item.transportBudget);
  const list = el('div', { class: 'stack-list' }, ...items.map(item => {
    const actual = state.transportCosts[item.id];
    const actualAmount = actual && typeof actual === 'object' ? actual.real ?? actual.amount : actual;
    const form = el('form', { class: 'info-card', dataset: { transportForm: item.id }, onsubmit: event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const amount = optionalMoney(data, 'amount');
      store.setMap('transportCosts', item.id, amount); toast('Costo real actualizado.'); openTransport();
    } }, el('div', { class: 'row' }, el('div', {}, el('strong', { text: item.title }), el('p', { text: `${shortDate(item.date)} · ${item.transportMode || 'Traslado'} · ${item.transportFrom || item.from || item.location}${item.transportTo || item.to ? ` → ${item.transportTo || item.to}` : ''}` })), el('span', { text: money(item.cost) })), field('Costo real por persona (CLP)', 'amount', actualAmount ?? '', { type: 'number', min: 0, help: 'Déjalo vacío hasta realizar el pago.' }), buttons(
      el('a', { class: 'secondary-button map-link', href: mapsDirectionsUrl(item.transportFrom || item.from || item.location, item.transportTo || item.to || item.location), target: '_blank', rel: 'noopener noreferrer', text: 'Ver ruta en Maps ↗' }),
      el('button', { class: 'text-button', type: 'button', onclick: () => transportForm(item), text: 'Editar estimado' }),
      el('button', { class: 'text-button danger-text', type: 'button', onclick: () => confirmDeleteTransport(item.id), text: 'Eliminar' }),
      submitButton('Guardar real')
    ));
    return form;
  }));
  if (!items.length) list.append(el('div', { class: 'empty-state', text: 'Todavía no hay traslados presupuestados.' }));
  openDialog('Traslados', `${items.length} tramos planificados`, el('div', {},
    buttons(el('button', { class: 'primary-button', type: 'button', onclick: () => transportForm(), text: '+ Agregar traslado' })),
    el('p', { class: 'muted manager-note', text: 'El monto de cada tarjeta es estimado. Ingresa el real solo después de pagarlo.' }),
    list
  ));
}

function transportForm(item = null) {
  const isEdit = Boolean(item);
  const form = el('form', { class: 'form-grid', onsubmit: event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const from = cleanText(data.get('from'), 160); const to = cleanText(data.get('to'), 160);
    const value = {
      ...(item || {}), id: item?.id || uid('transport'), date: String(data.get('date')), time: String(data.get('time')),
      city: cleanText(data.get('city'), 60).toUpperCase(), title: cleanText(data.get('title'), 180),
      type: 'Transporte', transportBudget: true, transportMode: cleanText(data.get('mode'), 160),
      transportFrom: from, transportTo: to, from, to, location: from && to ? `${from} → ${to}` : from || to,
      cost: parseMoney(data.get('cost'))
    };
    if (!validIsoDate(value.date) || !validTime(value.time) || !value.city || !value.title || !from || !to) return toast('Completa fecha, hora, ciudad, título, origen y destino.', true);
    store.upsert('activities', value); toast(isEdit ? 'Traslado actualizado.' : 'Traslado agregado.'); openTransport();
  } },
    field('Título', 'title', item?.title || '', { required: true, full: true }),
    field('Fecha', 'date', item?.date || '2026-08-21', { type: 'date', required: true }),
    field('Hora', 'time', item?.time || '09:00', { type: 'time', required: true }),
    field('Ciudad', 'city', item?.city || '', { required: true }),
    field('Medio', 'mode', item?.transportMode || '', { required: true }),
    field('Origen', 'from', item?.transportFrom || item?.from || '', { required: true }),
    field('Destino', 'to', item?.transportTo || item?.to || '', { required: true }),
    field('Costo estimado por persona (CLP)', 'cost', item?.cost ?? '', { type: 'number', min: 0, required: true }),
    buttons(el('button', { class: 'secondary-button', type: 'button', onclick: openTransport, text: 'Cancelar' }), submitButton(isEdit ? 'Guardar cambios' : 'Agregar traslado'))
  );
  openDialog(isEdit ? 'Editar traslado' : 'Nuevo traslado', 'Presupuesto estimado', form);
}

function confirmDeleteTransport(id) {
  const item = getActivity(id); if (!item) return;
  openDialog('Eliminar traslado', 'Confirmación', el('div', {},
    el('p', { text: `Se eliminará “${item.title}” y su gasto real asociado.` }),
    buttons(
      el('button', { class: 'secondary-button', type: 'button', onclick: openTransport, text: 'Cancelar' }),
      el('button', { class: 'danger-button', type: 'button', onclick: () => {
        store.remove('activities', id); store.setMap('transportCosts', id, null); store.setMap('details', id, null);
        toast('Traslado eliminado.'); openTransport();
      }, text: 'Eliminar traslado' })
    )
  ));
}

function openCurrency() {
  const rates = store.get().rates;
  const result = el('div', { class: 'notice', text: 'Ingresa un monto para convertirlo.' });
  const form = el('form', { class: 'form-grid', oninput: event => {
    const data = new FormData(event.currentTarget); const amount = Math.max(0, Number(data.get('amount')) || 0); const currency = data.get('currency');
    const rate = currency === 'JPY' ? Number(data.get('jpy')) : Number(data.get('cny'));
    result.textContent = `${new Intl.NumberFormat('es-CL').format(amount)} ${currency} ≈ ${money(amount * rate)}`;
  }, onsubmit: event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    store.updateSection('rates', { jpy: Math.max(.01, Number(data.get('jpy')) || rates.jpy), cny: Math.max(.01, Number(data.get('cny')) || rates.cny) }); toast('Tipos de cambio guardados.');
  } }, field('Monto', 'amount', 1000, { type: 'number', min: 0 }), field('Moneda', 'currency', 'JPY', { type: 'select', choices: ['JPY','CNY'] }), field('1 JPY en CLP', 'jpy', rates.jpy, { type: 'number', min: .01, step: .01 }), field('1 CNY en CLP', 'cny', rates.cny, { type: 'number', min: .01, step: .01 }), result, buttons(submitButton('Guardar tasas')));
  const taxResult = el('div', { class: 'notice', text: 'El mínimo se calcula sobre el precio sin impuesto.' });
  const taxForm = el('form', { class: 'form-grid', oninput: event => {
    const data = new FormData(event.currentTarget); const calc = taxFreeBreakdown(data.get('gross'), Number(data.get('rate')));
    taxResult.textContent = `Base sin impuesto: ¥${Math.round(calc.net).toLocaleString('es-CL')} · Impuesto: ¥${Math.round(calc.tax).toLocaleString('es-CL')} · ${calc.eligible ? 'Supera el mínimo tax-free de ¥5.000 netos.' : 'Aún no alcanza ¥5.000 netos.'}`;
  } }, field('Total con impuesto (JPY)', 'gross', 5500, { type: 'number', min: 0 }), field('Tasa', 'rate', '10', { type: 'select', choices: ['10','8'] }), taxResult);
  openDialog('Monedas y tax-free', 'Herramientas', el('div', {}, el('h3', { text: 'Conversor' }), form, el('h3', { text: 'Calculadora tax-free Japón' }), taxForm, el('p', { class: 'muted', text: 'Para este viaje (antes del 1 de noviembre de 2026), el régimen vigente usa compra mínima de ¥5.000 sin impuesto en una misma tienda y día. En consumibles existe un máximo de ¥500.000 sin impuesto. Verifica categorías y elegibilidad en la tienda.' })));
}

function openPhrases() {
  const content = el('div', { class: 'stack-list' }, ...PHRASES.map(([es, zh, ja]) => el('div', { class: 'info-card' }, el('strong', { text: es }), el('p', { text: `🇨🇳 ${zh}` }), el('p', { text: `🇯🇵 ${ja}` }))));
  openDialog('Frases útiles', 'China · Japón', content);
}

let vaultPassphrase = null;

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
}

async function compatiblePhotoFile(file) {
  if (!/^image\/(?:heic|heif)$/i.test(file.type)) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 2560 / longestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
    if (!blob) throw new Error('No se pudo convertir la foto HEIC.');
    return new File([blob], file.name.replace(/\.(?:heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
  } catch {
    throw new Error('No se pudo convertir la foto HEIC. En el iPhone selecciona una versión JPEG o usa Cámara > Formatos > Más compatible.');
  } finally { URL.revokeObjectURL(objectUrl); }
}

async function openDocuments() {
  const docs = await listDocuments();
  const list = el('div', { class: 'stack-list' }, ...docs.map(doc => el('div', { class: 'info-card' },
    el('div', { class: 'row' }, el('div', {}, el('strong', { text: doc.name }), el('p', { text: `${doc.type || 'Archivo'} · cifrado en este dispositivo` })), el('span', { text: '🔒' })),
    el('div', {}, el('button', { class: 'text-button', type: 'button', dataset: { openDoc: doc.id }, text: 'Abrir' }), el('button', { class: 'text-button', type: 'button', dataset: { deleteDoc: doc.id }, text: 'Eliminar' }))
  )));
  if (!docs.length) list.append(el('div', { class: 'empty-state', text: 'No hay documentos guardados.' }));
  const form = el('form', { class: 'form-grid', onsubmit: async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget); const file = data.get('file'); const passphrase = String(data.get('passphrase'));
    if (!(file instanceof File) || !file.size) return toast('Selecciona un archivo.', true);
    if (file.size > 5 * 1024 * 1024) return toast('El límite por documento es 5 MB.', true);
    try {
      const envelope = await encryptJson({ name: cleanText(data.get('name'), 180) || file.name, type: file.type, data: await fileAsDataUrl(file) }, passphrase);
      vaultPassphrase = passphrase;
      await saveDocument({ id: uid('doc'), name: cleanText(data.get('name'), 180) || file.name, type: file.type, envelope, createdAt: new Date().toISOString() });
      toast('Documento cifrado y guardado.'); await openDocuments();
    } catch (error) { toast(error.message, true); }
  } }, field('Nombre', 'name', '', { full: true }), field('Archivo (máx. 5 MB)', 'file', '', { type: 'file', required: true, full: true }), field('Clave privada', 'passphrase', '', { type: 'password', required: true, full: true, autocomplete: 'new-password', help: 'Mínimo 8 caracteres. No podemos recuperarla.' }), buttons(submitButton('Cifrar y guardar')));
  openDialog('Documentos privados', `${docs.length} archivos`, el('div', {}, el('div', { class: 'notice', text: 'Los documentos pueden contener datos sensibles. Se cifran antes de guardarse en IndexedDB y no se incluyen en la sincronización. No olvides la clave.' }), el('h3', { text: 'Guardados' }), list, el('h3', { text: 'Agregar documento' }), form));
}

async function openEncryptedDocument(id) {
  const doc = (await listDocuments()).find(item => item.id === id); if (!doc) return;
  const showForm = el('form', { class: 'form-grid', onsubmit: async event => {
    event.preventDefault(); const passphrase = String(new FormData(event.currentTarget).get('passphrase'));
    try {
      const payload = await decryptJson(doc.envelope, passphrase); vaultPassphrase = passphrase;
      const anchor = el('a', { href: payload.data, download: payload.name, text: 'Descargar documento descifrado' });
      openDialog(doc.name, 'Documento descifrado', el('div', {}, el('div', { class: 'notice', text: 'El archivo se descifra solo en memoria. Evita abrirlo en equipos compartidos.' }), el('p', {}, anchor)));
    } catch (error) { toast(error.message, true); }
  } }, field('Clave privada', 'passphrase', vaultPassphrase || '', { type: 'password', required: true, full: true, autocomplete: 'current-password' }), buttons(submitButton('Descifrar')));
  openDialog(doc.name, 'Documento privado', showForm);
}

function openExport() {
  const form = el('form', { class: 'form-grid', onsubmit: async event => {
    event.preventDefault(); const passphrase = String(new FormData(event.currentTarget).get('passphrase'));
    try {
      const envelope = await encryptJson({ app: 'mi-viaje-asia', exportedAt: new Date().toISOString(), state: store.get() }, passphrase);
      downloadBlob(new Blob([JSON.stringify(envelope)], { type: 'application/json' }), `asia-2026-${new Date().toISOString().slice(0,10)}.asia-backup`);
      store.markBackedUp(); renderStatus(); closeDialog(); toast('Respaldo cifrado exportado.');
    } catch (error) { toast(error.message, true); }
  } }, field('Clave del respaldo', 'passphrase', '', { type: 'password', required: true, full: true, autocomplete: 'new-password', help: 'Mínimo 8 caracteres. Guárdala aparte: no se puede recuperar.' }), field('Repite la clave', 'confirmation', '', { type: 'password', required: true, full: true, autocomplete: 'new-password' }), buttons(submitButton('Descargar respaldo')));
  form.addEventListener('submit', event => {
    const data = new FormData(form);
    if (data.get('passphrase') !== data.get('confirmation')) { event.preventDefault(); event.stopImmediatePropagation(); toast('Las claves no coinciden.', true); }
  }, true);
  openDialog('Exportar respaldo', 'Cifrado AES-256-GCM', el('div', {}, el('div', { class: 'notice', text: 'El respaldo incluye itinerario, gastos y reservas, pero no documentos privados ni fotos. Las fotos se conservan localmente y se copian al bucket privado al iniciar sesión.' }), form));
}

async function importBackup(file) {
  if (!file || file.size > 10 * 1024 * 1024) return toast('Archivo inválido o mayor a 10 MB.', true);
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { return toast('El archivo no contiene JSON válido.', true); }
  const complete = payload => {
    try { store.replace(validateBackup(payload, store.defaults())); closeDialog(); toast('Respaldo importado y validado.'); }
    catch (error) { toast(error.message, true); }
  };
  if (parsed.format === 'asia-backup') {
    const form = el('form', { class: 'form-grid', onsubmit: async event => {
      event.preventDefault(); try { complete(await decryptJson(parsed, String(new FormData(event.currentTarget).get('passphrase')))); } catch (error) { toast(error.message, true); }
    } }, field('Clave del respaldo', 'passphrase', '', { type: 'password', required: true, full: true, autocomplete: 'current-password' }), buttons(submitButton('Descifrar e importar')));
    openDialog('Importar respaldo', 'Archivo cifrado', form);
  } else {
    openDialog('Importar JSON antiguo', 'Confirmación', el('div', {}, el('div', { class: 'notice', text: 'Este archivo no está cifrado. La app validará su estructura y reemplazará los datos locales actuales.' }), buttons(el('button', { class: 'secondary-button', type: 'button', onclick: closeDialog, text: 'Cancelar' }), el('button', { class: 'danger-button', type: 'button', onclick: () => complete(parsed), text: 'Validar y reemplazar' }))));
  }
}

function accountForms() {
  const tabs = el('div', { class: 'dialog-tabs' });
  const body = el('div');
  const select = mode => {
    tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-selected', button.dataset.tab === mode));
    if (mode === 'login') {
      body.replaceChildren(el('form', { class: 'form-grid', onsubmit: async event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        try { await cloud.signIn(String(data.get('email')), String(data.get('password'))); closeDialog(); toast('Sesión iniciada.'); }
        catch (error) { toast(error.message, true); }
      } }, field('Email', 'email', '', { type: 'email', required: true, full: true, autocomplete: 'email' }), field('Contraseña', 'password', '', { type: 'password', required: true, full: true, autocomplete: 'current-password' }), buttons(submitButton('Entrar'))));
    } else {
      body.replaceChildren(el('form', { class: 'form-grid', onsubmit: async event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        try { const immediate = await cloud.signUp(String(data.get('email')), String(data.get('password'))); if (immediate) { closeDialog(); toast('Cuenta creada.'); } else toast('Revisa tu correo para confirmar la cuenta.'); }
        catch (error) { toast(error.message, true); }
      } }, field('Email', 'email', '', { type: 'email', required: true, full: true, autocomplete: 'email' }), field('Contraseña', 'password', '', { type: 'password', required: true, minlength: 10, full: true, autocomplete: 'new-password', help: 'Usa al menos 10 caracteres.' }), buttons(submitButton('Crear cuenta'))));
    }
  };
  for (const [mode, label] of [['login','Entrar'],['signup','Crear cuenta']]) tabs.append(el('button', { type: 'button', dataset: { tab: mode }, 'aria-selected': mode === 'login', onclick: () => select(mode), text: label }));
  select('login');
  return el('div', {}, tabs, body);
}

function openTripCloud() {
  const currentTrip = store.cloudMeta().tripId;
  const suggestedCode = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  const createForm = el('form', { class: 'form-grid', onsubmit: async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await cloud.createTrip(cleanText(data.get('title'), 100), String(data.get('code'))); closeDialog(); toast('Viaje creado y datos sincronizados.'); } catch (error) { toast(error.message, true); }
  } }, field('Nombre del viaje', 'title', 'Asia 2026', { required: true, full: true }), field('Código para compartir', 'code', suggestedCode, { required: true, minlength: 16, full: true, help: 'Usa el código aleatorio sugerido y compártelo por un canal seguro.' }), buttons(submitButton('Crear viaje compartido')));
  const joinForm = el('form', { class: 'form-grid', onsubmit: async event => {
    event.preventDefault(); try { await cloud.joinTrip(String(new FormData(event.currentTarget).get('code'))); closeDialog(); toast('Te uniste al viaje.'); } catch (error) { toast(error.message, true); }
  } }, field('Código de invitación', 'code', '', { type: 'password', required: true, full: true }), buttons(submitButton('Unirme')));
  openDialog(currentTrip ? 'Viaje conectado' : 'Conectar viaje', 'Sincronización', currentTrip ? el('div', {}, el('div', { class: 'notice', text: 'Este dispositivo ya está asociado a un viaje. Los cambios pendientes se sincronizan automáticamente.' }), buttons(el('button', { class: 'primary-button', type: 'button', onclick: () => cloud.sync().then(() => toast('Sincronización completada.')).catch(error => toast(error.message, true)), text: 'Sincronizar ahora' }))) : el('div', {}, el('h3', { text: 'Crear un viaje' }), createForm, el('h3', { text: 'Unirme a uno existente' }), joinForm));
}

function openAccount() {
  if (!cloud.configured) {
    return openDialog('Nube no configurada', 'Solo local', el('div', {}, el('div', { class: 'notice', text: 'La aplicación funciona completa de forma local. Para sincronizar, copia config.example.js como config.js e ingresa la URL del proyecto y una clave publicable de Supabase.' }), el('p', { text: 'Nunca pongas una secret key o service_role en el navegador.' })));
  }
  if (!currentCloud.user) return openDialog('Cuenta y sincronización', 'Supabase', accountForms());
  openDialog('Cuenta', currentCloud.user.email || 'Sesión activa', el('div', {},
    el('div', { class: 'notice', text: currentCloud.status === 'synced' ? 'Los cambios locales están sincronizados.' : `${store.outbox().length} cambios esperan sincronización.` }),
    buttons(el('button', { class: 'primary-button', type: 'button', onclick: openTripCloud, text: store.cloudMeta().tripId ? 'Ver viaje conectado' : 'Conectar un viaje' })),
    el('div', { class: 'danger-zone' }, el('h3', { text: 'Cerrar sesión' }), el('p', { text: 'Puedes conservar los datos para usar la app offline o borrar itinerario, fotos y documentos de este dispositivo.' }), buttons(el('button', { class: 'secondary-button', type: 'button', onclick: async () => { await cloud.signOut(); closeDialog(); toast('Sesión cerrada; datos locales conservados.'); }, text: 'Conservar datos' }), el('button', { class: 'danger-button', type: 'button', onclick: async () => { await cloud.signOut(); store.clearAll(); await Promise.all([clearPrivateDb(), clearActivityPhotos()]); closeDialog(); toast('Sesión cerrada y datos locales borrados.'); }, text: 'Cerrar y borrar local' })))
  ));
}

function openSettings() {
  const confirmReset = () => openDialog('Confirmar restablecimiento', 'Acción local', el('div', {},
    el('p', { text: 'Se reemplazarán actividades, gastos, reservas y preferencias locales por el plan inicial.' }),
    buttons(
      el('button', { class: 'secondary-button', type: 'button', onclick: openSettings, text: 'Cancelar' }),
      el('button', { class: 'danger-button', type: 'button', onclick: () => { store.reset(); closeDialog(); toast('Itinerario local restablecido.'); }, text: 'Restablecer' })
    )
  ));
  const content = el('div', {},
    el('h3', { text: 'Instalación' }),
    el('p', { text: window.matchMedia('(display-mode: standalone)').matches ? 'La aplicación ya está instalada.' : 'Puedes instalarla para abrirla como una app y usar el itinerario sin conexión.' }),
    buttons(el('button', { class: 'secondary-button', type: 'button', dataset: { action: 'install' }, text: 'Instalar aplicación' })),
    el('div', { class: 'danger-zone' },
      el('h3', { text: 'Restablecer itinerario' }),
      el('p', { text: 'Restaura el plan original. Esta acción no borra automáticamente la copia en la nube.' }),
      buttons(el('button', { class: 'danger-button', type: 'button', onclick: confirmReset, text: 'Restablecer plan local' }))
    )
  );
  openDialog('Ajustes', 'Datos y aplicación', content);
}

const ACTIONS = [
  ['stays','⌂','Estadías'], ['transport','↗','Traslados'], ['flights','✈','Vuelos'], ['budget','$','Presupuesto'],
  ['expenses','＋','Gastos'], ['currency','¥','Monedas'], ['documents','▣','Documentos'], ['phrases','文','Frases'],
  ['add-activity','＋','Nuevo evento'], ['settings','⚙','Ajustes']
];

function renderActions() {
  $('#quick-actions').replaceChildren(...ACTIONS.map(([action, icon, label]) => el('button', { class: 'quick-action', type: 'button', dataset: { action } }, el('span', { text: icon }), el('strong', { text: label }))));
}

function handleAction(action) {
  const handlers = {
    'add-activity': () => activityForm(), budget: openBudget, expenses: openExpenses, stays: openStays,
    transport: openTransport, flights: openFlights, currency: openCurrency, documents: () => openDocuments().catch(error => toast(error.message, true)),
    phrases: openPhrases, settings: openSettings, export: openExport, import: () => dom.importFile.click(), account: openAccount,
    more: () => { dom.tools.hidden = false; dom.more.setAttribute('aria-expanded', 'true'); dom.tools.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    install: async () => {
      if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; closeDialog(); }
      else toast('En iPhone usa Compartir → Agregar a inicio. En otros navegadores busca “Instalar aplicación” en el menú.');
    }
  };
  handlers[action]?.();
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button,a'); if (!target) return;
  if (target.dataset.action) return handleAction(target.dataset.action);
  if (target.dataset.activity) return openActivity(target.dataset.activity);
  if (target.dataset.editActivity) return activityForm(getActivity(target.dataset.editActivity));
  if (target.dataset.deleteActivity) return confirmDeleteActivity(target.dataset.deleteActivity);
  if (target.dataset.check) return store.setMap('checked', target.dataset.check, !store.get().checked[target.dataset.check]);
  if (target.dataset.day) {
    const state = store.get(); const collapsedDays = { ...(state.preferences?.collapsedDays || {}) };
    collapsedDays[target.dataset.day] = !collapsedDays[target.dataset.day];
    store.updateSection('preferences', { ...state.preferences, collapsedDays }); return;
  }
  if (target.dataset.stay) return openStay(target.dataset.stay);
  if (target.dataset.flight) return openFlight(target.dataset.flight);
  if (target.dataset.deleteExpense) { store.remove('extraExpenses', target.dataset.deleteExpense); toast('Gasto eliminado.'); return openExpenses(); }
  if (target.dataset.openDoc) return openEncryptedDocument(target.dataset.openDoc).catch(error => toast(error.message, true));
  if (target.dataset.deleteDoc) { await deleteDocument(target.dataset.deleteDoc); toast('Documento eliminado del dispositivo.'); return openDocuments(); }
  if (target.dataset.nav) {
    document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('is-active', button === target));
    document.getElementById(target.dataset.nav)?.scrollIntoView({ behavior: 'smooth' });
  }
});

dom.more.addEventListener('click', () => {
  const open = dom.tools.hidden;
  dom.tools.hidden = !open;
  dom.more.setAttribute('aria-expanded', String(open));
});
dom.syncButton.addEventListener('click', openAccount);
$('#dialog-close').addEventListener('click', closeDialog);
dom.dialog.addEventListener('click', event => { if (event.target === dom.dialog) closeDialog(); });
dom.dialog.addEventListener('close', () => { activePhotoView = null; dom.dialogContent.replaceChildren(); });
dom.search.addEventListener('input', event => { filters.query = event.target.value.trim(); renderItinerary(); });
dom.city.addEventListener('change', event => { filters.city = event.target.value; renderItinerary(); });
dom.type.addEventListener('change', event => { filters.type = event.target.value; renderItinerary(); });
dom.importFile.addEventListener('change', event => { importBackup(event.target.files?.[0]); event.target.value = ''; });

function updateClocks() {
  const format = timeZone => new Intl.DateTimeFormat('es-CL', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  $('#clock-santiago').textContent = format('America/Santiago');
  $('#clock-shanghai').textContent = format('Asia/Shanghai');
  $('#clock-tokyo').textContent = format('Asia/Tokyo');
}

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; });
window.addEventListener('appinstalled', () => { deferredInstall = null; toast('Aplicación instalada.'); });
window.addEventListener('online', renderStatus);
window.addEventListener('offline', renderStatus);
store.subscribe(renderAll);
cloud.subscribe(async snapshot => {
  const mediaChanged = snapshot.mediaVersion !== currentCloud.mediaVersion;
  currentCloud = snapshot;
  renderStatus();
  if (mediaChanged) {
    try {
      if (snapshot.mediaDeletedId) {
        const localPhotos = await listActivityPhotos();
        await Promise.all(localPhotos
          .filter(photo => photo.cloudMediaId === snapshot.mediaDeletedId)
          .map(photo => deleteActivityPhoto(photo.id)));
      }
      if (activePhotoView &&
          (!snapshot.mediaActivityId || snapshot.mediaActivityId === activePhotoView.activityId)) {
        const { activityId, grid, status } = activePhotoView;
        await renderActivityPhotos(activityId, grid, status);
      }
    } catch (error) {
      if (activePhotoView) activePhotoView.status.textContent = 'No se pudieron actualizar las fotos compartidas.';
      console.error(error);
    }
  }
});

renderActions(); renderAll(); updateClocks(); setInterval(updateClocks, 30000);
cloud.init().catch(error => { console.error(error); toast('No fue posible iniciar la sincronización.', true); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker:', error.message)));
}
