import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetTotals } from '../src/budget.js';
import { DEFAULT_STATE } from '../src/data.js';
import { decryptJson, encryptJson } from '../src/crypto.js';
import { amapSearchUrl, mapsDirectionsUrl, mapsUrl, parseMoney, taxFreeBreakdown } from '../src/utils.js';
import { normalizeActivity, normalizeState, validateBackup } from '../src/validation.js';

test('parseMoney handles Chilean formatted strings', () => {
  assert.equal(parseMoney('$25.000'), 25000);
  assert.equal(parseMoney('no disponible'), 0);
});

test('Google Maps links encode places and routes safely', () => {
  assert.match(mapsUrl('Hotel Shimbashi, Tokyo'), /maps\/search\/\?api=1&query=Hotel%20Shimbashi%2C%20Tokyo/);
  assert.match(mapsDirectionsUrl('Tokyo Station', 'Haneda Airport'), /maps\/dir\/\?api=1&origin=Tokyo%20Station&destination=Haneda%20Airport/);
  assert.equal(amapSearchUrl('The Bund', 'SHANGHAI'), 'https://uri.amap.com/search?keyword=The%20Bund&city=SHANGHAI&view=map&src=asia-2026&callnative=1');
});

test('tax-free eligibility uses the tax-exclusive amount', () => {
  assert.equal(taxFreeBreakdown(5000, 10).eligible, false);
  assert.equal(taxFreeBreakdown(5500, 10).eligible, true);
  assert.equal(Math.round(taxFreeBreakdown(5400, 8).net), 5000);
});

test('budget keeps the original per-person lodging criterion', () => {
  const budget = budgetTotals(DEFAULT_STATE);
  assert.equal(budget.plannedActivities, 801760);
  assert.equal(budget.plannedTransport, 181080);
  assert.equal(budget.plannedStays, 637500);
  assert.equal(budget.planned, 1620340);
  assert.equal(budgetTotals({ ...DEFAULT_STATE, transportCosts: { legacy: { real: '21.000' } } }).actualTransport, 21000);
});

test('flight real costs also reserve the same amount in the planned budget', () => {
  const state = structuredClone(DEFAULT_STATE);
  state.flights[0].estimatedCost = 500000;
  state.flightDetails[state.flights[0].id] = { realCost: 475000 };
  const budget = budgetTotals(state);
  assert.equal(budget.plannedFlights, 475000);
  assert.equal(budget.actualFlights, 475000);
  assert.equal(budget.planned, 2095340);
  assert.equal(budget.registered, 475000);
});

test('legacy flight costs and bookingRef migrate to real spending and booking', () => {
  const candidate = structuredClone(DEFAULT_STATE);
  candidate.flightDetails[candidate.flights[0].id] = { cost: '180220', bookingRef: 'ABC123', confirmed: true };
  const normalized = normalizeState(candidate, DEFAULT_STATE);
  const budget = budgetTotals(normalized);
  assert.equal(normalized.flights[0].estimatedCost, undefined);
  assert.equal(normalized.flightDetails[candidate.flights[0].id].realCost, 180220);
  assert.equal(normalized.flightDetails[candidate.flights[0].id].booking, 'ABC123');
  assert.equal(normalized.flightDetails[candidate.flights[0].id].confirmed, true);
  assert.equal(budget.plannedFlights, 180220);
  assert.equal(budget.actualFlights, 180220);
  assert.equal(budget.planned, 1800560);
  assert.equal(budget.registered, 180220);
});

test('v31 local flight estimates recover as real costs', () => {
  const candidate = structuredClone(DEFAULT_STATE);
  candidate.flights[0].estimatedCost = 22033;
  candidate.flightDetails[candidate.flights[0].id] = { bookingRef: 'RECOVER' };
  const normalized = normalizeState(candidate, DEFAULT_STATE);
  assert.equal(normalized.flights[0].estimatedCost, undefined);
  assert.equal(normalized.flightDetails[candidate.flights[0].id].realCost, 22033);
  assert.equal(normalized.flightDetails[candidate.flights[0].id].booking, 'RECOVER');
});

test('normalization restores legacy transport budget metadata', () => {
  const candidate = structuredClone(DEFAULT_STATE);
  candidate.activities = candidate.activities.map(({ transportBudget, transportMode, transportFrom, transportTo, ...item }) => item);
  const restored = normalizeState(candidate, DEFAULT_STATE);
  const budget = budgetTotals(restored);
  assert.equal(restored.activities.filter(item => item.transportBudget).length, 8);
  assert.equal(budget.plannedActivities, 801760);
  assert.equal(budget.plannedTransport, 181080);
});

test('activities reject malformed required fields', () => {
  assert.throws(() => normalizeActivity({ id: 'x', date: 'tomorrow', time: '40:80', city: '', title: '' }));
});

test('backup validation rejects duplicate activity identifiers', () => {
  const candidate = structuredClone(DEFAULT_STATE);
  candidate.activities = [candidate.activities[0], candidate.activities[0]];
  assert.throws(() => validateBackup(candidate, DEFAULT_STATE), /duplicado/);
});

test('legacy flight dates migrate to ISO without breaking the UI', () => {
  const candidate = structuredClone(DEFAULT_STATE);
  candidate.flights[0].date = 'Viernes 21 de agosto de 2026';
  assert.equal(normalizeState(candidate, DEFAULT_STATE).flights[0].date, '2026-08-21');
});

test('backup encryption round-trips and rejects a wrong key', async () => {
  const payload = { state: { private: '<img src=x onerror=alert(1)>' } };
  const encrypted = await encryptJson(payload, 'una-clave-larga');
  assert.equal(encrypted.cipher, 'AES-256-GCM');
  assert.deepEqual(await decryptJson(encrypted, 'una-clave-larga'), payload);
  await assert.rejects(decryptJson(encrypted, 'clave-equivocada'));
});
