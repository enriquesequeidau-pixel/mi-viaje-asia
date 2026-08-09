import { cleanText, parseMoney, validIsoDate, validTime } from './utils.js';

const MAX_ITEMS = 2500;
const TYPES = new Set(['Visita', 'Comida', 'Compras', 'Transporte', 'Vuelo', 'Estadía', 'Otro']);

export function normalizeActivity(value) {
  if (!value || typeof value !== 'object') throw new Error('Actividad inválida.');
  const item = {
    id: cleanText(value.id, 100), date: cleanText(value.date, 10), time: cleanText(value.time, 5),
    city: cleanText(value.city, 60).toUpperCase(), title: cleanText(value.title, 180),
    location: cleanText(value.location, 240), cost: parseMoney(value.cost),
    type: TYPES.has(value.type) ? value.type : 'Otro'
  };
  if (!item.id || !validIsoDate(item.date) || !validTime(item.time) || !item.city || !item.title) {
    throw new Error('Cada actividad necesita identificador, fecha, hora, ciudad y título válidos.');
  }
  for (const field of ['flightId', 'from', 'to', 'transportMode', 'transportFrom', 'transportTo']) {
    if (value[field]) item[field] = cleanText(value[field], 160);
  }
  if (value.transportBudget) item.transportBudget = true;
  return item;
}

export function normalizeFlightDetail(value, recoveredRealCost = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const {
    cost: legacyCost, realCost, bookingRef, booking, confirmed,
    ...rest
  } = value;
  const next = { ...rest };
  const normalizedBooking = cleanText(booking ?? bookingRef, 80);
  const normalizedCost = realCost ?? legacyCost ?? recoveredRealCost;
  if (normalizedBooking) next.booking = normalizedBooking;
  if (String(normalizedCost ?? '').trim()) next.realCost = parseMoney(normalizedCost);
  if ('confirmed' in value) next.confirmed = confirmed === true || confirmed === 'true';
  return next;
}

export function normalizeState(candidate, fallback) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('El respaldo no contiene un estado válido.');
  if (!Array.isArray(candidate.activities) || candidate.activities.length > MAX_ITEMS) throw new Error('La lista de actividades no es válida.');
  const fallbackActivities = new Map(fallback.activities.map(item => [item.id, item]));
  // Some early v7 builds stripped transportBudget while normalizing local or
  // cloud state. Merge known itinerary metadata back before validating so the
  // original budget categories recover without overwriting user edits.
  const activities = candidate.activities.map(value => normalizeActivity({
    ...(fallbackActivities.get(value?.id) || {}),
    ...value
  }));
  const ids = new Set();
  for (const item of activities) {
    if (ids.has(item.id)) throw new Error(`Identificador duplicado: ${item.id}`);
    ids.add(item.id);
  }
  const expenses = Array.isArray(candidate.extraExpenses) ? candidate.extraExpenses.slice(0, MAX_ITEMS).map(expense => ({
    id: cleanText(expense.id, 100) || crypto.randomUUID(),
    name: cleanText(expense.name, 180) || 'Gasto', amount: parseMoney(expense.amount),
    category: cleanText(expense.category, 80) || 'Otros', date: validIsoDate(expense.date) ? expense.date : new Date().toISOString().slice(0, 10)
  })) : [];
  const objectOrEmpty = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyFlightDetails = objectOrEmpty(candidate.flightDetails);
  const fallbackFlights = new Map(fallback.flights.map(item => [item.id, item]));
  const fallbackStays = new Map(fallback.stays.map(item => [item.id, item]));
  const flights = Array.isArray(candidate.flights) ? candidate.flights.slice(0, 100).map(value => {
    const original = fallbackFlights.get(value.id) || {};
    return {
      ...original, id: cleanText(value.id, 100),
      date: validIsoDate(value.date) ? value.date : original.date,
      from: cleanText(value.from, 100) || original.from, fromCode: cleanText(value.fromCode, 5) || original.fromCode,
      to: cleanText(value.to, 100) || original.to, toCode: cleanText(value.toCode, 5) || original.toCode,
      flight: cleanText(value.flight, 30), airline: cleanText(value.airline, 100),
      time: validTime(value.time) ? value.time : original.time, needsCheck: Boolean(value.needsCheck)
    };
  }).filter(value => value.id && value.date) : structuredClone(fallback.flights);
  const stays = Array.isArray(candidate.stays) ? candidate.stays.slice(0, 100).map(value => {
    const original = fallbackStays.get(value.id) || {};
    const estTotal = parseMoney(value.estTotal ?? original.estTotal);
    return {
      ...original, id: cleanText(value.id, 100), country: cleanText(value.country, 60) || original.country,
      city: cleanText(value.city, 60) || original.city,
      checkIn: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.checkIn) ? value.checkIn : original.checkIn,
      checkOut: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.checkOut) ? value.checkOut : original.checkOut,
      nights: Math.min(60, parseMoney(value.nights ?? original.nights)), estTotal,
      estPerPerson: parseMoney(value.estPerPerson ?? original.estPerPerson ?? (estTotal / 2)),
      defaultLocation: cleanText(value.defaultLocation, 240) || original.defaultLocation
    };
  }).filter(value => value.id && value.city) : structuredClone(fallback.stays);
  const flightDetails = Object.fromEntries(Object.entries(legacyFlightDetails).map(([id, detail]) => [id, normalizeFlightDetail(detail)]));
  // Recover data persisted by the short-lived v31 preview, which temporarily
  // interpreted the original real flight cost as an estimate. Supabase itself
  // was never rewritten, but this protects any local state opened meanwhile.
  for (const value of Array.isArray(candidate.flights) ? candidate.flights : []) {
    if (!value?.id || flightDetails[value.id]?.realCost != null) continue;
    const recovered = parseMoney(value.estimatedCost ?? value.plannedCost);
    if (recovered) flightDetails[value.id] = normalizeFlightDetail(flightDetails[value.id] || {}, recovered);
  }
  return {
    ...structuredClone(fallback), version: 8, activities,
    stays, flights,
    checked: objectOrEmpty(candidate.checked), details: objectOrEmpty(candidate.details), stayDetails: objectOrEmpty(candidate.stayDetails),
    transportCosts: objectOrEmpty(candidate.transportCosts), flightDetails, extraExpenses: expenses,
    rates: { jpy: Math.max(.01, Number(candidate.rates?.jpy) || fallback.rates.jpy), cny: Math.max(.01, Number(candidate.rates?.cny) || fallback.rates.cny) },
    preferences: objectOrEmpty(candidate.preferences)
  };
}

export function validateBackup(value, fallback) {
  if (!value || typeof value !== 'object') throw new Error('Archivo de respaldo inválido.');
  const state = value.state || value;
  return normalizeState(state, fallback);
}
