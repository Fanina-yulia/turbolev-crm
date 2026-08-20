import type {
  ClientDirectoryItem,
  VehicleCardContract,
  VehicleDirectoryItem,
} from "./crm-core";
import {
  isRecord,
  parseClientDirectoryItem,
  parseVehicleCard,
  parseVehicleDirectoryItem,
  payloadMessage,
} from "./crm-core.parsers";

export type ClientDirectoryPayload = {
  ok: true;
  total: number;
  page: number;
  limit: number;
  pages: number;
  clients: ClientDirectoryItem[];
};

export type VehicleDirectoryPayload = {
  ok: true;
  total: number;
  page: number;
  limit: number;
  pages: number;
  vehicles: VehicleDirectoryItem[];
};

function finiteInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
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

export function parseClientDirectoryPayload(value: unknown): ClientDirectoryPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const total = finiteInteger(value.total);
  const page = finiteInteger(value.page);
  const limit = finiteInteger(value.limit);
  const pages = finiteInteger(value.pages);
  const clients = parseArrayStrict(value.clients, parseClientDirectoryItem);
  if (total == null || page == null || limit == null || pages == null || !clients) return null;
  return { ok: true, total, page, limit, pages, clients };
}

export function parseClientDirectoryItemPayload(value: unknown): ClientDirectoryItem | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return parseClientDirectoryItem(value.client);
}

export function parseVehicleDirectoryPayload(value: unknown): VehicleDirectoryPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const total = finiteInteger(value.total);
  const page = finiteInteger(value.page);
  const limit = finiteInteger(value.limit);
  const pages = finiteInteger(value.pages);
  const vehicles = parseArrayStrict(value.vehicles, parseVehicleDirectoryItem);
  if (total == null || page == null || limit == null || pages == null || !vehicles) return null;
  return { ok: true, total, page, limit, pages, vehicles };
}

export function parseVehicleCardPayload(value: unknown): VehicleCardContract | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return parseVehicleCard(value.vehicle);
}

export { payloadMessage };
