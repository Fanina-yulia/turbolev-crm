import type { CrmClientCore, CrmVehicleCore, WorkOrderReference } from "./crm-core";

export type ClientCardPhoneContract = {
  id: string;
  phone: string;
  phoneNormalized: string;
  label: string | null;
  isPrimary: boolean;
};

export type ClientCardVehicleContract = Pick<
  CrmVehicleCore,
  | "id"
  | "plateNumber"
  | "vin"
  | "brand"
  | "model"
  | "year"
  | "engineName"
  | "fuelType"
  | "driveType"
  | "vehicleDataSource"
  | "vehicleDataConfidence"
>;

export type ClientCardServiceHistoryContract = Pick<
  WorkOrderReference,
  "id" | "status" | "createdAt" | "updatedAt" | "closedAt"
> & {
  vehicleId: string;
};

export type ClientCardContract = Pick<CrmClientCore, "id" | "name" | "phone"> & {
  phones: ClientCardPhoneContract[];
  vehicles: ClientCardVehicleContract[];
  serviceHistory: ClientCardServiceHistoryContract[];
};

export type ClientCardGetPayload = {
  client: ClientCardContract | null;
};

export type ClientCardSavePayload = {
  ok: true;
  client: ClientCardContract;
};

export type ClientCardVehicleSavePayload = {
  ok: true;
  client: ClientCardContract;
  vehicle: ClientCardVehicleContract;
};
