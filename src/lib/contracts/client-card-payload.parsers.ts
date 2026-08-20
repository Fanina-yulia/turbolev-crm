import type {
  ClientCardContract,
  ClientCardGetPayload,
  ClientCardPhoneContract,
  ClientCardSavePayload,
  ClientCardServiceHistoryContract,
  ClientCardVehicleContract,
  ClientCardVehicleSavePayload,
} from "./client-card";
import { isRecord, payloadMessage } from "./crm-core.parsers";

function requiredString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function nullableString(value: unknown) {
  return value == null ? null : typeof value === "string" ? value : undefined;
}

function nullableInteger(value: unknown) {
  if (value == null) return null;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function dateString(value: unknown) {
  const text = requiredString(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function nullableDateString(value: unknown) {
  if (value == null) return null;
  const text = dateString(value);
  return text ?? undefined;
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

function parsePhone(value: unknown): ClientCardPhoneContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const phone = requiredString(value.phone);
  const phoneNormalized = requiredString(value.phoneNormalized);
  const label = nullableString(value.label);
  const isPrimary = typeof value.isPrimary === "boolean" ? value.isPrimary : null;
  if (!id || !phone || !phoneNormalized || label === undefined || isPrimary == null) return null;
  return { id, phone, phoneNormalized, label, isPrimary };
}

function parseVehicle(value: unknown): ClientCardVehicleContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const plateNumber = nullableString(value.plateNumber);
  const vin = nullableString(value.vin);
  const brand = nullableString(value.brand);
  const model = nullableString(value.model);
  const year = nullableInteger(value.year);
  const engineName = nullableString(value.engineName);
  const fuelType = nullableString(value.fuelType);
  const driveType = nullableString(value.driveType);
  const vehicleDataSource = nullableString(value.vehicleDataSource);
  const vehicleDataConfidence = nullableInteger(value.vehicleDataConfidence);
  if (
    !id || plateNumber === undefined || vin === undefined || brand === undefined || model === undefined ||
    year === undefined || engineName === undefined || fuelType === undefined || driveType === undefined ||
    vehicleDataSource === undefined || vehicleDataConfidence === undefined
  ) return null;
  return {
    id,
    plateNumber,
    vin,
    brand,
    model,
    year,
    engineName,
    fuelType,
    driveType,
    vehicleDataSource,
    vehicleDataConfidence,
  };
}

function parseHistory(value: unknown): ClientCardServiceHistoryContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const vehicleId = requiredString(value.vehicleId);
  const status = requiredString(value.status);
  const createdAt = dateString(value.createdAt);
  const updatedAt = dateString(value.updatedAt);
  const closedAt = nullableDateString(value.closedAt);
  if (!id || !vehicleId || !status || !createdAt || !updatedAt || closedAt === undefined) return null;
  return { id, vehicleId, status, createdAt, updatedAt, closedAt };
}

export function parseClientCard(value: unknown): ClientCardContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = nullableString(value.name);
  const phone = requiredString(value.phone);
  const phones = parseArrayStrict(value.phones, parsePhone);
  const vehicles = parseArrayStrict(value.vehicles, parseVehicle);
  const serviceHistory = parseArrayStrict(value.serviceHistory, parseHistory);
  if (!id || name === undefined || !phone || !phones || !vehicles || !serviceHistory) return null;
  return { id, name, phone, phones, vehicles, serviceHistory };
}

export function parseClientCardGetPayload(value: unknown): ClientCardGetPayload | null {
  if (!isRecord(value)) return null;
  if (value.client == null) return { client: null };
  const client = parseClientCard(value.client);
  return client ? { client } : null;
}

export function parseClientCardSavePayload(value: unknown): ClientCardSavePayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const client = parseClientCard(value.client);
  return client ? { ok: true, client } : null;
}

export function parseClientCardVehicleSavePayload(value: unknown): ClientCardVehicleSavePayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const client = parseClientCard(value.client);
  const vehicle = parseVehicle(value.vehicle);
  return client && vehicle ? { ok: true, client, vehicle } : null;
}

export function clientCardPayloadMessage(value: unknown, fallback = "Не вдалося завантажити карту клієнта") {
  return payloadMessage(value, fallback);
}
