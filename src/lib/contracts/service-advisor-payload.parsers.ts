import { isRecord, payloadMessage } from "./crm-core.parsers";
import { PLANNER_STATUS_VALUES, type PlannerStatusContract } from "./planner";
import type {
  ServiceAdvisorAppointmentContract,
  ServiceAdvisorCabinetLinkedPayload,
  ServiceAdvisorCabinetPayload,
  ServiceAdvisorDiagnosticContract,
  ServiceAdvisorFindingContract,
  ServiceAdvisorFindingMediaContract,
  ServiceAdvisorFindingUrgency,
  ServiceAdvisorKpisContract,
  ServiceAdvisorStationReference,
} from "./service-advisor";

const PLANNER_STATUSES = new Set<string>(PLANNER_STATUS_VALUES);
const DIAGNOSTIC_STATUSES = new Set(["PENDING", "IN_PROGRESS"]);
const DIAGNOSTIC_WORKFLOW_STATES = new Set(["PENDING", "IN_PROGRESS", "SUBMITTED", "RETURNED", "CONFIRMED", "CANCELLED"]);
const DIAGNOSTIC_REVIEW_STATES = new Set(["DRAFT", "SUBMITTED", "RETURNED", "CONFIRMED"]);
const FINDING_URGENCIES = new Set(["INFO", "SOON", "CRITICAL"]);

function requiredString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function nullableString(value: unknown) {
  return value == null ? null : typeof value === "string" ? value : undefined;
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

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
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

function parsePlannerStatus(value: unknown): PlannerStatusContract | null {
  return typeof value === "string" && PLANNER_STATUSES.has(value)
    ? value as PlannerStatusContract
    : null;
}

function parseStation(value: unknown): ServiceAdvisorStationReference | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  return id && name ? { id, name } : null;
}

function parseKpis(value: unknown): ServiceAdvisorKpisContract | null {
  if (!isRecord(value)) return null;
  const today = nonNegativeInteger(value.today);
  const arrived = nonNegativeInteger(value.arrived);
  const approval = nonNegativeInteger(value.approval);
  const waitingParts = nonNegativeInteger(value.waitingParts);
  const inRepair = nonNegativeInteger(value.inRepair);
  const mechanicFindings = nonNegativeInteger(value.mechanicFindings);
  const diagnosticReviews = nonNegativeInteger(value.diagnosticReviews);
  if (today == null || arrived == null || approval == null || waitingParts == null || inRepair == null || mechanicFindings == null || diagnosticReviews == null) return null;
  return { today, arrived, approval, waitingParts, inRepair, mechanicFindings, diagnosticReviews };
}

function parseAppointment(value: unknown): ServiceAdvisorAppointmentContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const status = parsePlannerStatus(value.status);
  const start = dateString(value.start);
  const plate = requiredString(value.plate);
  const vehicle = requiredString(value.vehicle);
  const problem = nullableString(value.problem);
  const post = nullableString(value.post);
  const mechanic = nullableString(value.mechanic);
  if (!id || !status || !start || !plate || !vehicle || problem === undefined || post === undefined || mechanic === undefined) return null;
  return { id, status, start, plate, vehicle, problem, post, mechanic };
}

function parseDiagnostic(value: unknown): ServiceAdvisorDiagnosticContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const status = typeof value.status === "string" && DIAGNOSTIC_STATUSES.has(value.status)
    ? value.status as ServiceAdvisorDiagnosticContract["status"]
    : null;
  const workflowState = typeof value.workflowState === "string" && DIAGNOSTIC_WORKFLOW_STATES.has(value.workflowState)
    ? value.workflowState as ServiceAdvisorDiagnosticContract["workflowState"]
    : null;
  const reviewState = typeof value.reviewState === "string" && DIAGNOSTIC_REVIEW_STATES.has(value.reviewState)
    ? value.reviewState as ServiceAdvisorDiagnosticContract["reviewState"]
    : null;
  const submittedAt = nullableDateString(value.submittedAt);
  const plate = requiredString(value.plate);
  const vehicle = requiredString(value.vehicle);
  const client = requiredString(value.client);
  const mechanic = nullableString(value.mechanic);
  if (!id || !status || !workflowState || !reviewState || submittedAt === undefined || !plate || !vehicle || !client || mechanic === undefined) return null;
  return { id, status, workflowState, reviewState, submittedAt, plate, vehicle, client, mechanic };
}

function parseFindingMedia(value: unknown): ServiceAdvisorFindingMediaContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const fileName = requiredString(value.fileName);
  const mimeType = requiredString(value.mimeType);
  const fileSize = nonNegativeInteger(value.fileSize);
  const url = requiredString(value.url);
  if (!id || !fileName || !mimeType || fileSize == null || !url) return null;
  return { id, fileName, mimeType, fileSize, url };
}

function parseFinding(value: unknown): ServiceAdvisorFindingContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const workOrderId = requiredString(value.workOrderId);
  const workOrderLineId = requiredString(value.workOrderLineId);
  const status = requiredString(value.status);
  const resolutionCode = nullableString(value.resolutionCode);
  const estimateLineId = nullableString(value.estimateLineId);
  const urgency = typeof value.urgency === "string" && FINDING_URGENCIES.has(value.urgency)
    ? value.urgency as ServiceAdvisorFindingUrgency
    : null;
  const findingText = requiredString(value.findingText);
  const recommendation = nullableString(value.recommendation);
  const managerComment = nullableString(value.managerComment);
  const mechanicReply = nullableString(value.mechanicReply);
  const mechanicRepliedAt = nullableDateString(value.mechanicRepliedAt);
  const submittedAt = dateString(value.submittedAt);
  const reviewedAt = nullableDateString(value.reviewedAt);
  const mechanic = requiredString(value.mechanic);
  const workDescription = requiredString(value.workDescription);
  const plate = requiredString(value.plate);
  const vehicle = requiredString(value.vehicle);
  const media = parseArrayStrict(value.media, parseFindingMedia);
  if (
    !id || !workOrderId || !workOrderLineId || !status || resolutionCode === undefined || estimateLineId === undefined ||
    !urgency || !findingText || recommendation === undefined || managerComment === undefined || mechanicReply === undefined ||
    mechanicRepliedAt === undefined || !submittedAt || reviewedAt === undefined || !mechanic || !workDescription ||
    !plate || !vehicle || !media
  ) return null;
  return {
    id,
    workOrderId,
    workOrderLineId,
    status,
    resolutionCode,
    estimateLineId,
    urgency,
    findingText,
    recommendation,
    managerComment,
    mechanicReply,
    mechanicRepliedAt,
    submittedAt,
    reviewedAt,
    mechanic,
    workDescription,
    plate,
    vehicle,
    media,
  };
}

function parseLinked(value: Record<string, unknown>): ServiceAdvisorCabinetLinkedPayload | null {
  const station = parseStation(value.station);
  const kpis = parseKpis(value.kpis);
  const appointments = parseArrayStrict(value.appointments, parseAppointment);
  const diagnostics = parseArrayStrict(value.diagnostics, parseDiagnostic);
  const mechanicFindings = parseArrayStrict(value.mechanicFindings, parseFinding);
  if (!station || !kpis || !appointments || !diagnostics || !mechanicFindings) return null;
  return { ok: true, linked: true, station, kpis, appointments, diagnostics, mechanicFindings };
}

export function parseServiceAdvisorCabinetPayload(value: unknown): ServiceAdvisorCabinetPayload | null {
  if (!isRecord(value) || value.ok !== true || typeof value.linked !== "boolean") return null;
  if (value.linked) return parseLinked(value);
  if (!("reason" in value)) return { ok: true, linked: false };
  const reason = requiredString(value.reason);
  return reason ? { ok: true, linked: false, reason } : null;
}

export function serviceAdvisorPayloadMessage(value: unknown, fallback = "Не вдалося завантажити кабінет сервіс-менеджера") {
  return payloadMessage(value, fallback);
}
