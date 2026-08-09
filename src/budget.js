import { parseMoney } from './utils.js';

// Keep the criterion used by the original application: only the itinerary
// entries explicitly marked for the transport budget belong to Traslados.
// Small local rides remain part of Actividades even when their visual type is
// "Transporte".
const isBudgetTransport = item => Boolean(item?.transportBudget);

function plannedTransport(activities) {
  return activities.reduce((total, item) => {
    if (!isBudgetTransport(item)) return total;
    return total + parseMoney(item.cost);
  }, 0);
}

function actualTransport(transportCosts) {
  return Object.values(transportCosts || {}).reduce((total, value) => {
    const amount = value && typeof value === 'object' ? value.real ?? value.amount : value;
    return total + parseMoney(amount);
  }, 0);
}

export function budgetTotals(state, travellers = 2) {
  const activities = state.activities || [];
  const activityById = new Map(activities.map(item => [item.id, item]));
  const plannedActivities = activities.reduce((total, item) => total + (isBudgetTransport(item) ? 0 : parseMoney(item.cost)), 0);
  const plannedTransportTotal = plannedTransport(activities);
  const plannedStays = (state.stays || []).reduce((total, stay) => {
    const perPerson = stay.estPerPerson ?? (parseMoney(stay.estTotal) / Math.max(1, travellers));
    return total + parseMoney(perPerson);
  }, 0);
  const actualFlights = Object.values(state.flightDetails || {}).reduce((total, detail) => {
    return total + parseMoney(detail?.realCost ?? detail?.cost);
  }, 0);
  // Flights have no separate estimate in this trip. Their confirmed real cost
  // is also the amount reserved in the per-person plan.
  const plannedFlights = actualFlights;
  const actualActivities = Object.entries(state.details || {}).reduce((total, [id, detail]) => {
    return total + (isBudgetTransport(activityById.get(id)) ? 0 : parseMoney(detail?.realCost));
  }, 0);
  const actualStays = Object.values(state.stayDetails || {}).reduce((total, detail) => total + parseMoney(detail?.realCost), 0);
  const actualTransportTotal = actualTransport(state.transportCosts);
  const extras = (state.extraExpenses || []).reduce((total, expense) => total + parseMoney(expense.amount), 0);
  const planned = plannedActivities + plannedTransportTotal + plannedStays + plannedFlights;
  const registered = actualActivities + actualStays + actualTransportTotal + actualFlights + extras;

  return {
    travellers,
    planned,
    registered,
    difference: planned - registered,
    plannedActivities,
    plannedTransport: plannedTransportTotal,
    plannedStays,
    actualActivities,
    actualStays,
    actualTransport: actualTransportTotal,
    plannedFlights,
    actualFlights,
    extras
  };
}
