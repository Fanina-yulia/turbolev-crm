import type { TurboLevClass, VehicleType } from "@/src/domain/vehicle-intelligence";
import type {
  NewRequestClientLookupContract,
  NewRequestClientVehicleContract,
} from "@/src/lib/contracts/new-request-wizard";

export type LookupState = "idle" | "searching" | "found" | "not-found" | "unavailable";
export type VehicleDataStatus = "UNKNOWN" | "AUTO" | "MANUAL" | "CONFIRMED";

export type PreliminaryWork = {
  id?: string;
  name: string;
  quantity?: number;
  total?: number;
  manual?: boolean;
};

export type RequestForm = {
  customerName: string;
  phone: string;
  source: string;
  responsible: string;
  plate: string;
  vin: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  engine: string;
  engineVolume: string;
  fuelType: string;
  bodyType: string;
  grossWeight: string;
  driveType: string;
  vehicleType: VehicleType;
  turboLevClass: TurboLevClass;
  priceCoefficient: string;
  classificationSource: string;
  classificationConfidence: string;
  classificationReason: string;
  manualClassOverride: boolean;
  vehicleDataSource: string;
  vehicleDataConfidence: string;
  vehicleDataStatus: VehicleDataStatus;
  category: string;
  complaint: string;
  appointmentDate: string;
  appointmentTime: string;
  preliminaryAmount: string;
  comment: string;
  locationId: string;
  postId: string;
  mechanicId: string;
};

export type VehicleCandidate = Partial<RequestForm> & {
  id?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
};

export type ClientVehicle = NewRequestClientVehicleContract;
export type ClientLookup = NewRequestClientLookupContract;

export type MakeOption = { id: number | null; name: string };
export type ModelOption = { id: number | null; name: string; makeName: string };

export type OpenRequestDetail = {
  name?: string;
  phone?: string;
  source?: string;
  responsible?: string;
  plate?: string;
  vin?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  postId?: string;
  locationId?: string;
  inquiryId?: string;
};

export type UserOption = { id: string; name: string };
export type PlannerResource = { id: string; name: string };
export type PlannerLocation = {
  id: string;
  name: string;
  posts: PlannerResource[];
  mechanics: PlannerResource[];
};

export type VinApiResponse = {
  status: "FOUND" | "NOT_FOUND" | "INVALID_VIN" | "LOOKUP_UNAVAILABLE";
  source?: string;
  sourceDetail?: string;
  confidence?: number;
  warning?: string | null;
  message?: string;
  vehicle?: {
    make?: string | null;
    model?: string | null;
    year?: number | null;
    trim?: string | null;
    series?: string | null;
    bodyType?: string | null;
    vehicleType?: string | null;
    engine?: string | null;
    engineVolumeL?: number | null;
    fuelType?: string | null;
    secondaryFuelType?: string | null;
    driveType?: string | null;
    transmission?: string | null;
  } | null;
};

export type NewRequestWizardProps = {
  showButton?: boolean;
  onOpenChange?: (open: boolean) => void;
};
