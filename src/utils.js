export const clone = value => structuredClone(value);

export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'hidden') node[key] = Boolean(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function safeJson(raw, fallback) {
  if (typeof raw !== 'string') return clone(fallback);
  try { return JSON.parse(raw); } catch { return clone(fallback); }
}

export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const normalized = String(value ?? '').replace(/[^0-9-]/g, '');
  const parsed = Number.parseInt(normalized || '0', 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export const money = amount => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0
}).format(Number(amount) || 0);

export function dateLabel(iso, options = {}) {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', ...options }).format(date);
}

export function shortDate(iso) {
  return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`)).replace('.', '').toUpperCase();
}

export function uid(prefix = 'item') {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function cleanText(value, max = 180) {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function validIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

export function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }

export function mapsUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanText(location, 300))}`;
}

export function mapsDirectionsUrl(origin, destination) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(cleanText(origin, 300))}&destination=${encodeURIComponent(cleanText(destination, 300))}`;
}

export function taxFreeBreakdown(grossYen, taxRate = 10) {
  const gross = Math.max(0, Number(grossYen) || 0);
  const rate = taxRate === 8 ? 8 : 10;
  const net = gross / (1 + rate / 100);
  return { gross, net, tax: gross - net, eligible: net >= 5000, rate };
}

export function groupBy(items, keyFn) {
  return items.reduce((map, item) => {
    const key = keyFn(item);
    const current = map.get(key) || [];
    current.push(item);
    map.set(key, current);
    return map;
  }, new Map());
}

export function downloadBlob(blob, filename) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
}
