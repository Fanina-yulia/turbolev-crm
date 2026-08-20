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

export type VehicleLifecyclePayload = {
  code: string;
  label: string;
  tone: string;
  order: number;
  active: boolean;
  flags: string[];
  source: string;
  appointmentId: string | null;
  diagnosticRequestId: string | null;
  workOrderId: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  arrivalAt: string | null;
  updatedAt: string | null;
};

export type VehicleDirectoryLifecycleItem = VehicleDirectoryItem & {
  lifecycle: VehicleLifecyclePayload | null;
};

export type VehicleCardLifecycleContract = VehicleCardContract & {
  lifecycle: VehicleLifecyclePayload | null;
};

export type ClientDirectoryLifecycleItem = Omit<ClientDirectoryItem, "vehicles"> & {
  vehicles: Array<ClientDirectoryItem["vehicles"][number] & { lifecycle: VehicleLifecyclePayload | null }>;
};

export type ClientDirectoryPayload = {
  ok: true;
  total: number;
  page: number;
  limit: number;
  pages: number;
  clients: ClientDirectoryLifecycleItem[];
};

export type VehicleDirectoryPayload = {
  ok: true;
  total: number;
  page: number;
  limit: number;
  pages: number;
  vehicles: VehicleDirectoryLifecycleItem[];
  statusCounts: Record<string, number>;
  status: string;
  sort: string;
};

export type VehicleAppearancePatch = Pick<
  VehicleCardContract,
  | "id"
  | "brand"
  | "model"
  | "exteriorColorName"
  | "exteriorColorHex"
  | "exteriorPaintCode"
  | "exteriorColorSource"
  | "exteriorColorConfirmed"
  | "updatedAt"
>;

function finiteInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
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

function parseLifecycle(value: unknown): VehicleLifecyclePayload | null {
  if (!isRecord(value)) return null;
  const code = requiredString(value.code);
  const label = requiredString(value.label);
  const tone = requiredString(value.tone);
  const source = requiredString(value.source);
  const order = finiteInteger(value.order);
  if (!code || !label || !tone || !source || order == null || typeof value.active !== "boolean") return null;
  return {
    code,
    label,
    tone,
    order,
    active: value.active,
    flags: Array.isArray(value.flags) ? value.flags.filter((item): item is string => typeof item === "string") : [],
    source,
    appointmentId: nullableString(value.appointmentId),
    diagnosticRequestId: nullableString(value.diagnosticRequestId),
    workOrderId: nullableString(value.workOrderId),
    plannedStartAt: nullableString(value.plannedStartAt),
    plannedEndAt: nullableString(value.plannedEndAt),
    arrivalAt: nullableString(value.arrivalAt),
    updatedAt: nullableString(value.updatedAt),
  };
}

function parseVehicleDirectoryLifecycleItem(value: unknown): VehicleDirectoryLifecycleItem | null {
  const vehicle = parseVehicleDirectoryItem(value);
  if (!vehicle || !isRecord(value)) return null;
  return { ...vehicle, lifecycle: value.lifecycle == null ? null : parseLifecycle(value.lifecycle) };
}

function parseClientDirectoryLifecycleItem(value: unknown): ClientDirectoryLifecycleItem | null {
  const client = parseClientDirectoryItem(value);
  if (!client || !isRecord(value)) return null;
  const rawVehicles = Array.isArray(value.vehicles) ? value.vehicles : [];
  const rawById = new Map(rawVehicles.flatMap((item) => isRecord(item) && typeof item.id === "string" ? [[item.id, item] as const] : []));
  return {
    ...client,
    vehicles: client.vehicles.map((vehicle) => {
      const raw = rawById.get(vehicle.id);
      return { ...vehicle, lifecycle: raw?.lifecycle == null ? null : parseLifecycle(raw.lifecycle) };
    }),
  };
}

export function parseClientDirectoryPayload(value: unknown): ClientDirectoryPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const total = finiteInteger(value.total);
  const page = finiteInteger(value.page);
  const limit = finiteInteger(value.limit);
  const pages = finiteInteger(value.pages);
  const clients = parseArrayStrict(value.clients, parseClientDirectoryLifecycleItem);
  if (total == null || page == null || limit == null || pages == null || !clients) return null;
  return { ok: true, total, page, limit, pages, clients };
}

export function parseClientDirectoryItemPayload(value: unknown): ClientDirectoryLifecycleItem | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return parseClientDirectoryLifecycleItem(value.client);
}

export function parseVehicleDirectoryPayload(value: unknown): VehicleDirectoryPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const total = finiteInteger(value.total);
  const page = finiteInteger(value.page);
  const limit = finiteInteger(value.limit);
  const pages = finiteInteger(value.pages);
  const vehicles = parseArrayStrict(value.vehicles, parseVehicleDirectoryLifecycleItem);
  if (total == null || page == null || limit == null || pages == null || !vehicles) return null;
  const rawCounts = isRecord(value.statusCounts) ? value.statusCounts : {};
  const statusCounts: Record<string, number> = {};
  for (const [key, count] of Object.entries(rawCounts)) {
    const parsed = finiteInteger(count);
    if (parsed != null) statusCounts[key] = parsed;
  }
  return {
    ok: true,
    total,
    page,
    limit,
    pages,
    vehicles,
    statusCounts,
    status: requiredString(value.status) || "ALL",
    sort: requiredString(value.sort) || "UPDATED_DESC",
  };
}

export function parseVehicleCardPayload(value: unknown): VehicleCardLifecycleContract | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.vehicle)) return null;
  const vehicle = parseVehicleCard(value.vehicle);
  if (!vehicle) return null;
  return {
    ...vehicle,
    lifecycle: value.vehicle.lifecycle == null ? null : parseLifecycle(value.vehicle.lifecycle),
  };
}

export function parseVehicleAppearancePayload(value: unknown): VehicleAppearancePatch | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.vehicle)) return null;
  const vehicle = value.vehicle;
  const id = requiredString(vehicle.id);
  const updatedAt = requiredString(vehicle.updatedAt);
  if (!id || !updatedAt || typeof vehicle.exteriorColorConfirmed !== "boolean") return null;
  return {
    id,
    brand: nullableString(vehicle.brand),
    model: nullableString(vehicle.model),
    exteriorColorName: nullableString(vehicle.exteriorColorName),
    exteriorColorHex: nullableString(vehicle.exteriorColorHex),
    exteriorPaintCode: nullableString(vehicle.exteriorPaintCode),
    exteriorColorSource: nullableString(vehicle.exteriorColorSource),
    exteriorColorConfirmed: vehicle.exteriorColorConfirmed,
    updatedAt,
  };
}

export function parseVehicleImageRefreshPayload(value: unknown) {
  if (!isRecord(value) || value.ok !== true) return null;
  return {
    ok: true as const,
    fallback: value.fallback === true,
  };
}

export { payloadMessage };
