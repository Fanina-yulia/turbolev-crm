import { isRecord, payloadMessage } from "./crm-core.parsers";
import {
  PLANNER_STATUS_VALUES,
  type PlannerAppointmentContract,
  type PlannerBoardPayload,
  type PlannerLocationContract,
  type PlannerMechanicContract,
  type PlannerPostContract,
  type PlannerPurposeContract,
  type PlannerPaymentStatusContract,
  type PlannerStatusContract,
} from "./planner";

const PLANNER_STATUSES = new Set<string>(PLANNER_STATUS_VALUES);
const PLANNER_PURPOSES = new Set<string>(["DIAGNOSTICS", "REPAIR"]);

function requiredString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function nullableString(value: unknown) {
  return value == null ? null : typeof value === "string" ? value : undefined;
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
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

function decimal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return value;
  return undefined;
}

function nullableDecimal(value: unknown) {
  return value == null ? null : decimal(value);
}

function parsePayment(value: unknown) {
  if (!isRecord(value)) return null;
  const statuses = new Set<PlannerPaymentStatusContract>(["NOT_FORMED", "UNPAID", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"]);
  const status = typeof value.status === "string" && statuses.has(value.status as PlannerPaymentStatusContract) ? value.status as PlannerPaymentStatusContract : null;
  const amount = nullableDecimal(value.amount);
  const paid = nullableDecimal(value.paid);
  const outstanding = nullableDecimal(value.outstanding);
  return status && amount !== undefined && paid !== undefined && outstanding !== undefined ? { status, amount, paid, outstanding } : null;
}

function parseStringArrayStrict(value: unknown) {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    const text = requiredString(item);
    if (!text) return null;
    result.push(text);
  }
  return result;
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

function parseStatus(value: unknown): PlannerStatusContract | null {
  return typeof value === "string" && PLANNER_STATUSES.has(value)
    ? value as PlannerStatusContract
    : null;
}

function parsePost(value: unknown): PlannerPostContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const sortOrder = integer(value.sortOrder);
  const capabilities = parseStringArrayStrict(value.capabilities);
  if (!id || !name || sortOrder == null || !capabilities) return null;
  return { id, name, sortOrder, capabilities };
}

function parseMechanic(value: unknown): PlannerMechanicContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const sortOrder = integer(value.sortOrder);
  if (!id || !name || sortOrder == null) return null;
  return { id, name, sortOrder };
}

function parseLocation(value: unknown): PlannerLocationContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  const timezone = requiredString(value.timezone);
  const openMinute = integer(value.openMinute);
  const closeMinute = integer(value.closeMinute);
  const posts = parseArrayStrict(value.posts, parsePost);
  const mechanics = parseArrayStrict(value.mechanics, parseMechanic);
  if (!id || !name || !timezone || openMinute == null || closeMinute == null || !posts || !mechanics) return null;
  return { id, name, timezone, openMinute, closeMinute, posts, mechanics };
}

function parseAppointment(value: unknown): PlannerAppointmentContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const locationId = requiredString(value.locationId);
  const status = parseStatus(value.status);
  const priority = integer(value.priority);
  const plannedStartAt = dateString(value.plannedStartAt);
  const plannedEndAt = dateString(value.plannedEndAt);
  if (!id || !locationId || !status || priority == null || !plannedStartAt || !plannedEndAt) return null;

  const postId = nullableString(value.postId);
  const mechanicId = nullableString(value.mechanicId);
  const workOrderId = nullableString(value.workOrderId);
  const purpose = value.purpose == null ? null : typeof value.purpose === "string" && PLANNER_PURPOSES.has(value.purpose) ? value.purpose as PlannerPurposeContract : undefined;
  const processStatus = nullableString(value.processStatus);
  const processLabel = nullableString(value.processLabel);
  const payment = parsePayment(value.payment);
  const vehicleId = nullableString(value.vehicleId);
  const customerName = nullableString(value.customerName);
  const phone = nullableString(value.phone);
  const vehicleLabel = nullableString(value.vehicleLabel);
  const plateNumber = nullableString(value.plateNumber);
  const problem = nullableString(value.problem);
  const comment = nullableString(value.comment);
  const source = nullableString(value.source);
  const estimatedAmount = nullableDecimal(value.estimatedAmount);
  const actualArrivalAt = nullableDateString(value.actualArrivalAt);
  const actualStartAt = nullableDateString(value.actualStartAt);
  const actualEndAt = nullableDateString(value.actualEndAt);
  const partsEtaAt = nullableDateString(value.partsEtaAt);

  if (
    postId === undefined || mechanicId === undefined || workOrderId === undefined || purpose === undefined || vehicleId === undefined ||
    customerName === undefined || phone === undefined || vehicleLabel === undefined ||
    plateNumber === undefined || problem === undefined || comment === undefined || source === undefined ||
    estimatedAmount === undefined || actualArrivalAt === undefined || actualStartAt === undefined ||
    actualEndAt === undefined || partsEtaAt === undefined || processStatus === undefined || processLabel === undefined || !payment
  ) return null;

  const post = value.post == null ? null : parsePost(value.post);
  const mechanic = value.mechanic == null ? null : parseMechanic(value.mechanic);
  if (value.post != null && !post) return null;
  if (value.mechanic != null && !mechanic) return null;

  return {
    id,
    locationId,
    postId,
    mechanicId,
    status,
    workOrderId,
    purpose,
    processStatus,
    processLabel,
    payment,
    vehicleId,
    customerName,
    phone,
    vehicleLabel,
    plateNumber,
    problem,
    comment,
    source,
    estimatedAmount,
    priority,
    plannedStartAt,
    plannedEndAt,
    actualArrivalAt,
    actualStartAt,
    actualEndAt,
    partsEtaAt,
    post,
    mechanic,
  };
}

export function parsePlannerBoardPayload(value: unknown): PlannerBoardPayload | null {
  if (!isRecord(value) || value.status !== "OK") return null;
  const locations = parseArrayStrict(value.locations, parseLocation);
  const appointments = parseArrayStrict(value.appointments, parseAppointment);
  const activeLocationId = nullableString(value.activeLocationId);
  if (!locations || !appointments || activeLocationId === undefined) return null;
  if (activeLocationId && !locations.some((location) => location.id === activeLocationId)) return null;
  return { status: "OK", locations, activeLocationId, appointments };
}

export function plannerPayloadMessage(value: unknown, fallback = "Не вдалося завантажити План робіт.") {
  return payloadMessage(value, fallback);
}
