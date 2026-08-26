export type CrmDecimal = string | number;
export type CrmDateTime = string;

export type EntityCounts = {
  workOrders: number;
  diagnosticRequests: number;
};

export type VehicleWorkflowIndicator = {
  diagnosticCard: "NONE" | "IN_PROGRESS" | "READY";
  commercialProposal: "NOT_SENT" | "PENDING" | "APPROVED";
  repair: "NOT_STARTED" | "IN_PROGRESS" | "PAID";
};

export type ClientReference = {
  id: string;
  name: string | null;
  phone: string;
};

export type VehicleReference = {
  id: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  plateNumber: string | null;
  vin: string | null;
};

export type WorkOrderReference = {
  id: string;
  status: string;
  createdAt: CrmDateTime;
  updatedAt: CrmDateTime;
  closedAt: CrmDateTime | null;
};

export type DiagnosticRequestReference = {
  id: string;
  status: string;
  technicalConclusion: string | null;
  confirmedAt: CrmDateTime | null;
  createdAt: CrmDateTime;
  updatedAt?: CrmDateTime;
  leadId?: string | null;
};

/**
 * Canonical client identity shared by CRM APIs and UI read models.
 * Domain views may extend this contract, but they should not redefine these fields.
 */
export type CrmClientCore = {
  id: string;
  name: string | null;
  phone: string;
  createdAt: CrmDateTime;
  updatedAt: CrmDateTime;
};

/**
 * Canonical vehicle data. Optional view-specific relations belong in read models,
 * not in this base entity contract.
 */
export type CrmVehicleCore = {
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
  priceCoefficient: CrmDecimal;
  vehicleDataSource: string | null;
  vehicleDataConfidence: number | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  exteriorPaintCode: string | null;
  exteriorColorSource: string | null;
  exteriorColorConfirmed: boolean;
  createdAt: CrmDateTime;
  updatedAt: CrmDateTime;
};

export type EmployeeCabinetStatus = "NOT_OPENED" | "WAITING_ACTIVATION" | "ACTIVE" | "SUSPENDED";

export type EmployeeDocumentContract = {
  id?: string;
  type: string;
  name: string;
  status: string;
  fileUrl?: string | null;
};

export type EmployeeRoleAssignmentContract = {
  id: string;
  isPrimary: boolean;
  role: { code: string; name: string; category: string | null };
  location: { id: string; name: string } | null;
};

export type EmployeeAccessContract = {
  roleCode: string | null;
  roleName: string | null;
  location: { id: string; name: string } | null;
  cabinetStatus: EmployeeCabinetStatus;
  cabinetEnabled: boolean;
  userId: string | null;
  authLinked: boolean;
  lastLoginAt: CrmDateTime | null;
  mechanicResource: {
    id: string;
    name: string;
    locationId: string;
    isActive: boolean;
    userId: string | null;
  } | null;
};

/**
 * Canonical personnel identity. Compensation, documents and access are read-model
 * concerns and are layered on top of this contract.
 */
export type CrmEmployeeCore = {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  birthDate: CrmDateTime | null;
  hireDate?: CrmDateTime | null;
  email: string | null;
  phone: string | null;
  phoneCountry: string | null;
  address: string | null;
  photoUrl: string | null;
  personnelCategory: string | null;
  position: string | null;
  crmLogin: string | null;
  isActive: boolean;
};

/**
 * Canonical work-order identity. Workflow decoration belongs in a read model.
 */
export type CrmWorkOrderCore = {
  id: string;
  status: string;
  createdAt: CrmDateTime;
  updatedAt: CrmDateTime;
  closedAt: CrmDateTime | null;
};

export type ClientDirectoryItem = CrmClientCore & {
  _count: { vehicles: number; workOrders: number; diagnosticRequests: number };
  workOrders: WorkOrderReference[];
  vehicles: Array<
    Pick<CrmVehicleCore, "id" | "plateNumber" | "vin" | "brand" | "model" | "year">
  >;
};

export type VehicleDirectoryItem = CrmVehicleCore & {
  client: ClientReference;
  _count: EntityCounts;
  workflow: VehicleWorkflowIndicator;
};

export type VehicleCardContract = CrmVehicleCore & {
  classificationSource: string | null;
  classificationConfidence: number | null;
  lastVehicleLookupAt: CrmDateTime | null;
  client: ClientReference;
  diagnosticRequests: DiagnosticRequestReference[];
  workOrders: WorkOrderReference[];
  _count: EntityCounts;
  workflow: VehicleWorkflowIndicator;
};

export type PersonnelItemContract = CrmEmployeeCore & {
  baseSalary: CrmDecimal | null;
  minimumSalary: CrmDecimal | null;
  workPercent: CrmDecimal | null;
  partsSalesPercent: CrmDecimal | null;
  partsMarginPercent: CrmDecimal | null;
  netProfitPercent: CrmDecimal | null;
  payrollRuleNote: string | null;
  compensationRestricted?: boolean;
  documents: EmployeeDocumentContract[];
  roleAssignments: EmployeeRoleAssignmentContract[];
  access?: EmployeeAccessContract;
};

export type WorkOrderGateContract = { code: string; label: string };
export type WorkOrderActionContract = { code: string; label: string };

export type WorkOrderTransitionContract = {
  to: string;
  label: string;
  allowed: boolean;
  code: string;
  requiredGates: WorkOrderGateContract[];
  missingGates: WorkOrderGateContract[];
  actions: WorkOrderActionContract[];
  unsupportedActions: WorkOrderActionContract[];
};

export type WorkOrderListItemContract = CrmWorkOrderCore & {
  number: number | null;
  statusLabel: string;
  statusTone: string;
  stage: string | null;
  client: ClientReference;
  vehicle: VehicleReference & {
    mileageKm: number | null;
    turboLevClass: string | null;
  };
  diagnosticRequest: DiagnosticRequestReference & { leadId: string | null };
  transitions: WorkOrderTransitionContract[];
};

export type WorkOrderDetailContract = Omit<WorkOrderListItemContract, "number"> & {
  appointment: null | {
    id: string;
    status: string;
    plannedStartAt: CrmDateTime;
    actualArrivalAt: CrmDateTime | null;
    post: { name: string } | null;
    mechanic: { name: string } | null;
  };
  recentCalls: Array<{
    id: string;
    type: string;
    status: string | null;
    duration: number;
    startedAt: CrmDateTime | null;
    recordingUrl: string | null;
  }>;
};

export type PagedListContract<T> = {
  ok: true;
  total: number;
  page: number;
  limit: number;
  pages: number;
  items: T[];
};
