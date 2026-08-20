import type { CrmClientCore, CrmDecimal, CrmVehicleCore } from "./crm-core";

type NewRequestVehicleCoreFields =
  | "id"
  | "plateNumber"
  | "vin"
  | "brand"
  | "model"
  | "year"
  | "mileageKm"
  | "engineName"
  | "engineVolumeCm3"
  | "fuelType"
  | "bodyType"
  | "driveType"
  | "vehicleType"
  | "turboLevClass"
  | "vehicleDataSource"
  | "vehicleDataConfidence";

/**
 * Client-card vehicle projection normalized by the New Request Wizard parser.
 * Shared vehicle identity/data fields come from the canonical CRM vehicle core;
 * lookup-only enrichment remains explicit on this read model.
 */
export type NewRequestClientVehicleContract = Pick<CrmVehicleCore, NewRequestVehicleCoreFields> & {
  grossWeightKg: number | null;
  priceCoefficient: CrmDecimal | null;
  classificationSource: string | null;
  classificationConfidence: number | null;
  manualClassOverride: boolean | null;
};

/**
 * Client lookup projection consumed by the New Request Wizard.
 * The parser normalizes the wire payload before it enters component state.
 */
export type NewRequestClientLookupContract = Pick<CrmClientCore, "id" | "name" | "phone"> & {
  vehicles: NewRequestClientVehicleContract[];
};
