import type {
  ClientDirectoryItem,
  ClientReference,
  CrmClientCore,
  CrmDecimal,
  CrmEmployeeCore,
  CrmVehicleCore,
  CrmWorkOrderCore,
  DiagnosticRequestReference,
  EmployeeAccessContract,
  EmployeeCabinetStatus,
  EmployeeDocumentContract,
  EmployeeRoleAssignmentContract,
  PersonnelItemContract,
  VehicleCardContract,
  VehicleDirectoryItem,
  VehicleReference,
  VehicleWorkflowIndicator,
  WorkOrderActionContract,
  WorkOrderDetailContract,
  WorkOrderGateContract,
  WorkOrderListItemContract,
  WorkOrderReference,
  WorkOrderTransitionContract,
} from "./crm-core";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function requiredString(value: unknown) {
  const result = stringValue(value).trim();
  return result || null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberValue(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function decimalValue(value: unknown, fallback: CrmDecimal = 0): CrmDecimal {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function dateString(value: unknown) {
  return requiredString(value);
}

function parseCount(value: unknown) {
  return Math.max(0, Math.trunc(numberValue(value)));
}

export function parseClientReference(value: unknown): ClientReference | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const phone = requiredString(value.phone);
  if (!id || !phone) return null;
  return { id, name: nullableString(value.name), phone };
}

export function parseVehicleReference(value: unknown): VehicleReference | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  if (!id) return null;
  return {
    id,
    brand: nullableString(value.brand),
    model: nullableString(value.model),
    year: nullableNumber(value.year),
    plateNumber: nullableString(value.plateNumber),
    vin: nullableString(value.vin),
  };
}

export function parseWorkOrderReference(value: unknown): WorkOrderReference | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const status = requiredString(value.status);
  const createdAt = dateString(value.createdAt);
  const updatedAt = dateString(value.updatedAt);
  if (!id || !status || !createdAt || !updatedAt) return null;
  return {
    id,
    status,
    createdAt,
    updatedAt,
    closedAt: dateString(value.closedAt),
  };
}

export function parseDiagnosticRequestReference(value: unknown): DiagnosticRequestReference | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const status = requiredString(value.status);
  const createdAt = dateString(value.createdAt);
  if (!id || !status || !createdAt) return null;
  const updatedAt = dateString(value.updatedAt);
  const result: DiagnosticRequestReference = {
    id,
    status,
    technicalConclusion: nullableString(value.technicalConclusion),
    confirmedAt: dateString(value.confirmedAt),
    createdAt,
  };
  if (updatedAt) result.updatedAt = updatedAt;
  if ("leadId" in value) result.leadId = nullableString(value.leadId);
  return result;
}

export function parseCrmClientCore(value: unknown): CrmClientCore | null {
  if (!isRecord(value)) return null;
  const reference = parseClientReference(value);
  const createdAt = dateString(value.createdAt);
  const updatedAt = dateString(value.updatedAt);
  if (!reference || !createdAt || !updatedAt) return null;
  return { ...reference, createdAt, updatedAt };
}

export function parseCrmVehicleCore(value: unknown): CrmVehicleCore | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const clientId = requiredString(value.clientId);
  const createdAt = dateString(value.createdAt);
  const updatedAt = dateString(value.updatedAt);
  if (!id || !clientId || !createdAt || !updatedAt) return null;
  return {
    id,
    clientId,
    plateNumber: nullableString(value.plateNumber),
    vin: nullableString(value.vin),
    brand: nullableString(value.brand),
    model: nullableString(value.model),
    year: nullableNumber(value.year),
    mileageKm: nullableNumber(value.mileageKm),
    engineName: nullableString(value.engineName),
    engineVolumeCm3: nullableNumber(value.engineVolumeCm3),
    fuelType: nullableString(value.fuelType),
    bodyType: nullableString(value.bodyType),
    driveType: nullableString(value.driveType),
    vehicleType: nullableString(value.vehicleType),
    turboLevClass: nullableString(value.turboLevClass),
    priceCoefficient: decimalValue(value.priceCoefficient, 1),
    vehicleDataSource: nullableString(value.vehicleDataSource),
    vehicleDataConfidence: nullableNumber(value.vehicleDataConfidence),
    exteriorColorName: nullableString(value.exteriorColorName),
    exteriorColorHex: nullableString(value.exteriorColorHex),
    exteriorPaintCode: nullableString(value.exteriorPaintCode),
    exteriorColorSource: nullableString(value.exteriorColorSource),
    exteriorColorConfirmed: booleanValue(value.exteriorColorConfirmed),
    createdAt,
    updatedAt,
  };
}

export function parseCrmEmployeeCore(value: unknown): CrmEmployeeCore | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const firstName = requiredString(value.firstName);
  const lastName = requiredString(value.lastName);
  if (!id || !firstName || !lastName) return null;
  return {
    id,
    firstName,
    lastName,
    middleName: nullableString(value.middleName),
    birthDate: dateString(value.birthDate),
    hireDate: dateString(value.hireDate),
    email: nullableString(value.email),
    phone: nullableString(value.phone),
    phoneCountry: nullableString(value.phoneCountry),
    address: nullableString(value.address),
    photoUrl: nullableString(value.photoUrl),
    personnelCategory: nullableString(value.personnelCategory),
    position: nullableString(value.position),
    crmLogin: nullableString(value.crmLogin),
    isActive: booleanValue(value.isActive, true),
  };
}

export function parseCrmWorkOrderCore(value: unknown): CrmWorkOrderCore | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const status = requiredString(value.status);
  const createdAt = dateString(value.createdAt);
  const updatedAt = dateString(value.updatedAt);
  if (!id || !status || !createdAt || !updatedAt) return null;
  return { id, status, createdAt, updatedAt, closedAt: dateString(value.closedAt) };
}

export function parseClientDirectoryItem(value: unknown): ClientDirectoryItem | null {
  if (!isRecord(value)) return null;
  const core = parseCrmClientCore(value);
  if (!core) return null;
  const count = isRecord(value._count) ? value._count : {};
  return {
    ...core,
    _count: {
      vehicles: parseCount(count.vehicles),
      workOrders: parseCount(count.workOrders),
      diagnosticRequests: parseCount(count.diagnosticRequests),
    },
    workOrders: Array.isArray(value.workOrders)
      ? value.workOrders.map(parseWorkOrderReference).filter((item): item is WorkOrderReference => item !== null)
      : [],
    vehicles: Array.isArray(value.vehicles)
      ? value.vehicles.map((item) => {
          const vehicle = parseVehicleReference(item);
          return vehicle ? {
            id: vehicle.id,
            plateNumber: vehicle.plateNumber,
            vin: vehicle.vin,
            brand: vehicle.brand,
            model: vehicle.model,
            year: vehicle.year,
          } : null;
        }).filter((item): item is ClientDirectoryItem["vehicles"][number] => item !== null)
      : [],
  };
}

export function parseVehicleDirectoryItem(value: unknown): VehicleDirectoryItem | null {
  if (!isRecord(value)) return null;
  const core = parseCrmVehicleCore(value);
  const client = parseClientReference(value.client);
  if (!core || !client) return null;
  const count = isRecord(value._count) ? value._count : {};
  const workflow = parseVehicleWorkflowIndicator(value.workflow);
  return {
    ...core,
    client,
    _count: {
      workOrders: parseCount(count.workOrders),
      diagnosticRequests: parseCount(count.diagnosticRequests),
    },
    workflow,
  };
}

function parseVehicleWorkflowIndicator(value: unknown): VehicleWorkflowIndicator {
  const row = isRecord(value) ? value : {};
  const diagnosticCard = row.diagnosticCard === "READY" || row.diagnosticCard === "IN_PROGRESS" ? row.diagnosticCard : "NONE";
  const commercialProposal = row.commercialProposal === "APPROVED" || row.commercialProposal === "PENDING" ? row.commercialProposal : "NOT_SENT";
  const repair = row.repair === "PAID" || row.repair === "IN_PROGRESS" ? row.repair : "NOT_STARTED";
  return { diagnosticCard, commercialProposal, repair };
}

export function parseVehicleCard(value: unknown): VehicleCardContract | null {
  if (!isRecord(value)) return null;
  const directory = parseVehicleDirectoryItem(value);
  if (!directory) return null;
  return {
    ...directory,
    classificationSource: nullableString(value.classificationSource),
    classificationConfidence: nullableNumber(value.classificationConfidence),
    lastVehicleLookupAt: dateString(value.lastVehicleLookupAt),
    diagnosticRequests: Array.isArray(value.diagnosticRequests)
      ? value.diagnosticRequests.map(parseDiagnosticRequestReference).filter((item): item is DiagnosticRequestReference => item !== null)
      : [],
    workOrders: Array.isArray(value.workOrders)
      ? value.workOrders.map(parseWorkOrderReference).filter((item): item is WorkOrderReference => item !== null)
      : [],
  };
}

function parseEmployeeDocument(value: unknown): EmployeeDocumentContract | null {
  if (!isRecord(value)) return null;
  const type = requiredString(value.type);
  const name = requiredString(value.name);
  const status = requiredString(value.status);
  if (!type || !name || !status) return null;
  const id = requiredString(value.id);
  return {
    ...(id ? { id } : {}),
    type,
    name,
    status,
    fileUrl: nullableString(value.fileUrl),
  };
}

function parseLocation(value: unknown) {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  return id && name ? { id, name } : null;
}

function parseRoleAssignment(value: unknown): EmployeeRoleAssignmentContract | null {
  if (!isRecord(value) || !isRecord(value.role)) return null;
  const id = requiredString(value.id);
  const code = requiredString(value.role.code);
  const name = requiredString(value.role.name);
  if (!id || !code || !name) return null;
  return {
    id,
    isPrimary: booleanValue(value.isPrimary),
    role: { code, name, category: nullableString(value.role.category) },
    location: parseLocation(value.location),
  };
}

const CABINET_STATUSES = new Set<EmployeeCabinetStatus>([
  "NOT_OPENED",
  "WAITING_ACTIVATION",
  "ACTIVE",
  "SUSPENDED",
]);

function cabinetStatus(value: unknown): EmployeeCabinetStatus {
  return typeof value === "string" && CABINET_STATUSES.has(value as EmployeeCabinetStatus)
    ? value as EmployeeCabinetStatus
    : "NOT_OPENED";
}

function parseEmployeeAccess(value: unknown): EmployeeAccessContract | undefined {
  if (!isRecord(value)) return undefined;
  let mechanicResource: EmployeeAccessContract["mechanicResource"] = null;
  if (isRecord(value.mechanicResource)) {
    const id = requiredString(value.mechanicResource.id);
    const name = requiredString(value.mechanicResource.name);
    const locationId = requiredString(value.mechanicResource.locationId);
    if (id && name && locationId) {
      mechanicResource = {
        id,
        name,
        locationId,
        isActive: booleanValue(value.mechanicResource.isActive),
        userId: nullableString(value.mechanicResource.userId),
      };
    }
  }
  return {
    roleCode: nullableString(value.roleCode),
    roleName: nullableString(value.roleName),
    location: parseLocation(value.location),
    cabinetStatus: cabinetStatus(value.cabinetStatus),
    cabinetEnabled: booleanValue(value.cabinetEnabled),
    userId: nullableString(value.userId),
    authLinked: booleanValue(value.authLinked),
    lastLoginAt: dateString(value.lastLoginAt),
    mechanicResource,
  };
}

export function parsePersonnelItem(value: unknown): PersonnelItemContract | null {
  if (!isRecord(value)) return null;
  const core = parseCrmEmployeeCore(value);
  if (!core) return null;
  const result: PersonnelItemContract = {
    ...core,
    baseSalary: value.baseSalary == null ? null : decimalValue(value.baseSalary),
    minimumSalary: value.minimumSalary == null ? null : decimalValue(value.minimumSalary),
    workPercent: value.workPercent == null ? null : decimalValue(value.workPercent),
    partsSalesPercent: value.partsSalesPercent == null ? null : decimalValue(value.partsSalesPercent),
    partsMarginPercent: value.partsMarginPercent == null ? null : decimalValue(value.partsMarginPercent),
    netProfitPercent: value.netProfitPercent == null ? null : decimalValue(value.netProfitPercent),
    payrollRuleNote: nullableString(value.payrollRuleNote),
    compensationRestricted: typeof value.compensationRestricted === "boolean" ? value.compensationRestricted : undefined,
    documents: Array.isArray(value.documents)
      ? value.documents.map(parseEmployeeDocument).filter((item): item is EmployeeDocumentContract => item !== null)
      : [],
    roleAssignments: Array.isArray(value.roleAssignments)
      ? value.roleAssignments.map(parseRoleAssignment).filter((item): item is EmployeeRoleAssignmentContract => item !== null)
      : [],
  };
  const access = parseEmployeeAccess(value.access);
  if (access) result.access = access;
  return result;
}

function parseGate(value: unknown): WorkOrderGateContract | null {
  if (!isRecord(value)) return null;
  const code = requiredString(value.code);
  const label = requiredString(value.label);
  return code && label ? { code, label } : null;
}

function parseAction(value: unknown): WorkOrderActionContract | null {
  if (!isRecord(value)) return null;
  const code = requiredString(value.code);
  const label = requiredString(value.label);
  return code && label ? { code, label } : null;
}

function parseTransition(value: unknown): WorkOrderTransitionContract | null {
  if (!isRecord(value)) return null;
  const to = requiredString(value.to);
  const label = requiredString(value.label);
  const code = requiredString(value.code);
  if (!to || !label || !code) return null;
  const gates = (input: unknown) => Array.isArray(input)
    ? input.map(parseGate).filter((item): item is WorkOrderGateContract => item !== null)
    : [];
  const actions = (input: unknown) => Array.isArray(input)
    ? input.map(parseAction).filter((item): item is WorkOrderActionContract => item !== null)
    : [];
  return {
    to,
    label,
    allowed: booleanValue(value.allowed),
    code,
    requiredGates: gates(value.requiredGates),
    missingGates: gates(value.missingGates),
    actions: actions(value.actions),
    unsupportedActions: actions(value.unsupportedActions),
  };
}

export function parseWorkOrderListItem(value: unknown, number: number | null = null): WorkOrderListItemContract | null {
  if (!isRecord(value)) return null;
  const core = parseCrmWorkOrderCore(value);
  const client = parseClientReference(value.client);
  const vehicle = parseVehicleReference(value.vehicle);
  const diagnostic = parseDiagnosticRequestReference(value.diagnosticRequest);
  const statusLabel = requiredString(value.statusLabel);
  const statusTone = requiredString(value.statusTone);
  if (!core || !client || !vehicle || !diagnostic || !statusLabel || !statusTone) return null;
  return {
    ...core,
    number,
    statusLabel,
    statusTone,
    stage: nullableString(value.stage),
    client,
    vehicle: {
      ...vehicle,
      mileageKm: isRecord(value.vehicle) ? nullableNumber(value.vehicle.mileageKm) : null,
      turboLevClass: isRecord(value.vehicle) ? nullableString(value.vehicle.turboLevClass) : null,
    },
    diagnosticRequest: {
      ...diagnostic,
      leadId: isRecord(value.diagnosticRequest) ? nullableString(value.diagnosticRequest.leadId) : null,
    },
    transitions: Array.isArray(value.transitions)
      ? value.transitions.map(parseTransition).filter((item): item is WorkOrderTransitionContract => item !== null)
      : [],
  };
}

export function parseWorkOrderDetail(value: unknown): WorkOrderDetailContract | null {
  if (!isRecord(value)) return null;
  const list = parseWorkOrderListItem(value);
  if (!list) return null;
  let appointment: WorkOrderDetailContract["appointment"] = null;
  if (isRecord(value.appointment)) {
    const id = requiredString(value.appointment.id);
    const status = requiredString(value.appointment.status);
    const plannedStartAt = dateString(value.appointment.plannedStartAt);
    if (id && status && plannedStartAt) {
      const post = isRecord(value.appointment.post) && requiredString(value.appointment.post.name)
        ? { name: requiredString(value.appointment.post.name)! }
        : null;
      const mechanic = isRecord(value.appointment.mechanic) && requiredString(value.appointment.mechanic.name)
        ? { name: requiredString(value.appointment.mechanic.name)! }
        : null;
      appointment = {
        id,
        status,
        plannedStartAt,
        actualArrivalAt: dateString(value.appointment.actualArrivalAt),
        post,
        mechanic,
      };
    }
  }
  const recentCalls = Array.isArray(value.recentCalls)
    ? value.recentCalls.map((item) => {
        if (!isRecord(item)) return null;
        const id = requiredString(item.id);
        const type = requiredString(item.type);
        if (!id || !type) return null;
        return {
          id,
          type,
          status: nullableString(item.status),
          duration: Math.max(0, Math.trunc(numberValue(item.duration))),
          startedAt: dateString(item.startedAt),
          recordingUrl: nullableString(item.recordingUrl),
        };
      }).filter((item): item is WorkOrderDetailContract["recentCalls"][number] => item !== null)
    : [];
  const { number: _number, ...withoutNumber } = list;
  return { ...withoutNumber, appointment, recentCalls };
}

export function readPayloadField(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined;
}

export function payloadMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const error = requiredString(payload.error);
  if (error) return error;
  return requiredString(payload.message) || fallback;
}
