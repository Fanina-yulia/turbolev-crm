import type {
  ClientVehiclesClientContract,
  ClientVehiclesVehicleContract,
  ClientsVehiclesPayload,
} from "./clients-vehicles";
import type { WorkOrderReference } from "./crm-core";
import {
  isRecord,
  parseCrmClientCore,
  parseCrmVehicleCore,
  parseWorkOrderReference,
  payloadMessage,
} from "./crm-core.parsers";

function nonNegativeInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  return integer >= 0 ? integer : null;
}

function positiveInteger(value: unknown) {
  const integer = nonNegativeInteger(value);
  return integer != null && integer > 0 ? integer : null;
}

function parseArrayStrict<T>(value: unknown, parser: (item: unknown) => T | null) {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const item of value) {
    const parsed = parser(item);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

function parseCounts(value: unknown) {
  if (!isRecord(value)) return null;
  const workOrders = nonNegativeInteger(value.workOrders);
  const diagnosticRequests = nonNegativeInteger(value.diagnosticRequests);
  if (workOrders == null || diagnosticRequests == null) return null;
  return { workOrders, diagnosticRequests };
}

function parseVehicle(value: unknown): ClientVehiclesVehicleContract | null {
  if (!isRecord(value)) return null;
  const core = parseCrmVehicleCore(value);
  const count = parseCounts(value._count);
  if (!core || !count) return null;
  return { ...core, _count: count };
}

function parseClient(value: unknown): ClientVehiclesClientContract | null {
  if (!isRecord(value)) return null;
  const core = parseCrmClientCore(value);
  if (!core || !isRecord(value._count)) return null;

  const vehicles = nonNegativeInteger(value._count.vehicles);
  const workOrdersCount = nonNegativeInteger(value._count.workOrders);
  const diagnosticRequests = nonNegativeInteger(value._count.diagnosticRequests);
  if (vehicles == null || workOrdersCount == null || diagnosticRequests == null) return null;

  const workOrders = parseArrayStrict<WorkOrderReference>(value.workOrders, parseWorkOrderReference);
  const vehicleItems = parseArrayStrict(value.vehicles, parseVehicle);
  if (!workOrders || !vehicleItems) return null;

  return {
    ...core,
    _count: {
      vehicles,
      workOrders: workOrdersCount,
      diagnosticRequests,
    },
    workOrders,
    vehicles: vehicleItems,
  };
}

export function parseClientsVehiclesPayload(value: unknown): ClientsVehiclesPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const total = nonNegativeInteger(value.total);
  const offset = nonNegativeInteger(value.offset);
  const limit = positiveInteger(value.limit);
  const clients = parseArrayStrict(value.clients, parseClient);
  if (total == null || offset == null || limit == null || !clients) return null;
  return { ok: true, total, offset, limit, clients };
}

export function clientsVehiclesPayloadMessage(value: unknown, fallback = "Не вдалося завантажити клієнтів та автомобілі") {
  return payloadMessage(value, fallback);
}
