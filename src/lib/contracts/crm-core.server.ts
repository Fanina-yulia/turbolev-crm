import "server-only";

import type {
  ClientDirectoryItem,
  CrmDecimal,
  VehicleDirectoryItem,
  VehicleWorkflowIndicator,
  WorkOrderReference,
} from "./crm-core";

type DateLike = Date | string;

type ServerWorkOrderReference = {
  id: string;
  status: string;
  createdAt: DateLike;
  updatedAt: DateLike;
  closedAt: DateLike | null;
};

type ServerClientDirectoryItem = {
  id: string;
  name: string | null;
  phone: string;
  createdAt: DateLike;
  updatedAt: DateLike;
  _count: { vehicles: number; workOrders: number; diagnosticRequests: number };
  workOrders: ServerWorkOrderReference[];
  vehicles: Array<{
    id: string;
    plateNumber: string | null;
    vin: string | null;
    brand: string | null;
    model: string | null;
    year: number | null;
  }>;
};

type ServerVehicleDirectoryItem = {
  id: string;
  clientId: string;
  plateNumber: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  engineName: string | null;
  engineVolumeCm3: number | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  vehicleType: string | null;
  turboLevClass: string | null;
  priceCoefficient: unknown;
  vehicleDataSource: string | null;
  vehicleDataConfidence: number | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  exteriorPaintCode: string | null;
  exteriorColorSource: string | null;
  exteriorColorConfirmed: boolean;
  createdAt: DateLike;
  updatedAt: DateLike;
  client: { id: string; name: string | null; phone: string };
  _count: { workOrders: number; diagnosticRequests: number };
};

function iso(value: DateLike): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function nullableIso(value: DateLike | null): string | null {
  return value == null ? null : iso(value);
}

function decimal(value: unknown): CrmDecimal {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return value.toString();
  }
  return "0";
}

function toWorkOrderReference(row: ServerWorkOrderReference): WorkOrderReference {
  return {
    id: row.id,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    closedAt: nullableIso(row.closedAt),
  };
}

export function toClientDirectoryItem(row: ServerClientDirectoryItem): ClientDirectoryItem {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    _count: row._count,
    workOrders: row.workOrders.map(toWorkOrderReference),
    vehicles: row.vehicles,
  };
}

export function toVehicleDirectoryItem(row: ServerVehicleDirectoryItem, workflow: VehicleWorkflowIndicator): VehicleDirectoryItem {
  return {
    id: row.id,
    clientId: row.clientId,
    plateNumber: row.plateNumber,
    vin: row.vin,
    brand: row.brand,
    model: row.model,
    year: row.year,
    mileageKm: row.mileageKm,
    engineName: row.engineName,
    engineVolumeCm3: row.engineVolumeCm3,
    fuelType: row.fuelType,
    bodyType: row.bodyType,
    driveType: row.driveType,
    vehicleType: row.vehicleType,
    turboLevClass: row.turboLevClass,
    priceCoefficient: decimal(row.priceCoefficient),
    vehicleDataSource: row.vehicleDataSource,
    vehicleDataConfidence: row.vehicleDataConfidence,
    exteriorColorName: row.exteriorColorName,
    exteriorColorHex: row.exteriorColorHex,
    exteriorPaintCode: row.exteriorPaintCode,
    exteriorColorSource: row.exteriorColorSource,
    exteriorColorConfirmed: row.exteriorColorConfirmed,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    client: row.client,
    _count: row._count,
    workflow,
  };
}
