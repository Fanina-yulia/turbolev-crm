import type {
  InquiriesPayloadContract,
  InquiryAssignedUserContract,
  InquiryExistingClientContract,
  InquiryExistingLeadContract,
  InquiryItemContract,
  InquiryMutationPayloadContract,
  InquiryPriorityContract,
  InquiryStatsContract,
  InquiryVehicleContract,
} from "./inquiries";

const INQUIRY_PRIORITIES = new Set<InquiryPriorityContract>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null || (typeof value === "number" && Number.isFinite(value)) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function parseVehicle(value: unknown): InquiryVehicleContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const brand = nullableString(value.brand);
  const model = nullableString(value.model);
  const year = nullableNumber(value.year);
  const plateNumber = nullableString(value.plateNumber);
  const vin = nullableString(value.vin);
  if (!id || brand === undefined || model === undefined || year === undefined || plateNumber === undefined || vin === undefined) return null;
  return { id, brand, model, year, plateNumber, vin };
}

function parseAssignedUser(value: unknown): InquiryAssignedUserContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  return id && name ? { id, name } : null;
}

function parseExistingClient(value: unknown): InquiryExistingClientContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = nullableString(value.name);
  return id && name !== undefined ? { id, name } : null;
}

function parseExistingLead(value: unknown): InquiryExistingLeadContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = nullableString(value.name);
  const status = requiredString(value.status);
  const assignedUserId = nullableString(value.assignedUserId);
  if (!id || name === undefined || !status || assignedUserId === undefined) return null;
  return { id, name, status, assignedUserId };
}

function parseItem(value: unknown): InquiryItemContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const channel = requiredString(value.channel);
  const state = requiredString(value.state);
  const name = requiredString(value.name);
  const phone = nullableString(value.phone);
  const handle = nullableString(value.handle);
  const subject = requiredString(value.subject);
  const preview = typeof value.preview === "string" ? value.preview : null;
  const vehicle = nullableString(value.vehicle);
  const plate = nullableString(value.plate);
  const receivedAt = requiredString(value.receivedAt);
  const sourceDetail = nullableString(value.sourceDetail);
  const campaign = nullableString(value.campaign);
  const priority = typeof value.priority === "string" && INQUIRY_PRIORITIES.has(value.priority as InquiryPriorityContract)
    ? value.priority as InquiryPriorityContract
    : null;
  if (
    !id || !channel || !state || !name || phone === undefined || handle === undefined || subject === null || preview === null ||
    vehicle === undefined || plate === undefined || !receivedAt || sourceDetail === undefined || campaign === undefined || !priority
  ) return null;
  if (Number.isNaN(new Date(receivedAt).getTime())) return null;

  let assignedUser: InquiryAssignedUserContract | null = null;
  if (value.assignedUser !== null) {
    assignedUser = parseAssignedUser(value.assignedUser);
    if (!assignedUser) return null;
  }

  let existingClient: InquiryExistingClientContract | null = null;
  if (value.existingClient !== null) {
    existingClient = parseExistingClient(value.existingClient);
    if (!existingClient) return null;
  }

  let existingLead: InquiryExistingLeadContract | null = null;
  if (value.existingLead !== null) {
    existingLead = parseExistingLead(value.existingLead);
    if (!existingLead) return null;
  }

  if (!Array.isArray(value.vehicles)) return null;
  const vehicles = value.vehicles.map(parseVehicle);
  if (vehicles.some((item) => item === null)) return null;

  return {
    id,
    channel,
    state,
    name,
    phone,
    handle,
    subject,
    preview,
    vehicle,
    plate,
    receivedAt,
    sourceDetail,
    campaign,
    assignedUser,
    priority,
    existingClient,
    vehicles: vehicles as InquiryVehicleContract[],
    existingLead,
  };
}

function parseStats(value: unknown): InquiryStatsContract | null {
  if (!isRecord(value)) return null;
  const total = nonNegativeInteger(value.total);
  const critical = nonNegativeInteger(value.critical);
  const high = nonNegativeInteger(value.high);
  const existingClients = nonNegativeInteger(value.existingClients);
  const withActiveLead = nonNegativeInteger(value.withActiveLead);
  if (total === null || critical === null || high === null || existingClients === null || withActiveLead === null) return null;
  return { total, critical, high, existingClients, withActiveLead };
}

export function parseInquiriesPayload(value: unknown): InquiriesPayloadContract | null {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  const stats = parseStats(value.stats);
  if (!stats) return null;
  return { ok: true, items: items as InquiryItemContract[], stats };
}

export function parseInquiryMutationPayload(value: unknown): InquiryMutationPayloadContract | null {
  return isRecord(value) && value.ok === true ? { ok: true } : null;
}

export function inquiryPayloadMessage(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback;
  const error = typeof value.error === "string" ? value.error.trim() : "";
  if (error) return error;
  const message = typeof value.message === "string" ? value.message.trim() : "";
  return message || fallback;
}
