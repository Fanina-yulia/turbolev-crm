import {
  VEHICLE_LIFECYCLE_CODES,
  VEHICLE_LIFECYCLE_FLAGS,
  type VehicleLifecycleCode,
  type VehicleLifecycleFlag,
} from "@/src/domain/vehicle-lifecycle";
import { isRecord, payloadMessage } from "./crm-core.parsers";
import {
  type CabinetHomePayload,
  type CabinetStationReference,
  type MechanicCabinetLinkedPayload,
  type MechanicHomeAppointmentContract,
  type MechanicHomeKpisContract,
  type MechanicHomeTaskContract,
  type StationManagerAttentionContract,
  type StationManagerCabinetLinkedPayload,
  type StationManagerFlowContract,
  type StationManagerKpisContract,
} from "./cabinet-home";
import { PLANNER_STATUS_VALUES, type PlannerLifecycleContract, type PlannerStatusContract } from "./planner";

const PLANNER_STATUSES = new Set<string>(PLANNER_STATUS_VALUES);
const LIFECYCLE_CODES = new Set<string>(VEHICLE_LIFECYCLE_CODES);
const LIFECYCLE_FLAGS = new Set<string>(VEHICLE_LIFECYCLE_FLAGS);

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

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseStatus(value: unknown): PlannerStatusContract | null {
  return typeof value === "string" && PLANNER_STATUSES.has(value)
    ? value as PlannerStatusContract
    : null;
}

function parseLifecycle(value: unknown): PlannerLifecycleContract | null {
  if (!isRecord(value)) return null;
  const code = typeof value.code === "string" && LIFECYCLE_CODES.has(value.code) ? value.code as VehicleLifecycleCode : null;
  const label = requiredString(value.label);
  const tone = typeof value.tone === "string" && ["neutral", "info", "accent", "warning", "success", "danger"].includes(value.tone)
    ? value.tone as PlannerLifecycleContract["tone"]
    : null;
  const order = typeof value.order === "number" && Number.isInteger(value.order) ? value.order : null;
  const active = typeof value.active === "boolean" ? value.active : null;
  if (!Array.isArray(value.flags)) return null;
  const flags: VehicleLifecycleFlag[] = [];
  for (const raw of value.flags) {
    if (typeof raw !== "string" || !LIFECYCLE_FLAGS.has(raw)) return null;
    flags.push(raw as VehicleLifecycleFlag);
  }
  if (!code || !label || !tone || order == null || active == null) return null;
  return { code, label, tone, order, active, flags };
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

function parseStation(value: unknown): CabinetStationReference | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  return id && name ? { id, name } : null;
}

function parseReason(value: Record<string, unknown>) {
  if (!("reason" in value)) return {};
  const reason = requiredString(value.reason);
  return reason ? { reason } : null;
}

function parseMechanicTask(value: unknown): MechanicHomeTaskContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const workOrderId = requiredString(value.workOrderId);
  const description = requiredString(value.description);
  const status = requiredString(value.status);
  const type = requiredString(value.type);
  const laborHours = nullableString(value.laborHours);
  const plate = requiredString(value.plate);
  const vehicle = requiredString(value.vehicle);
  const workOrderStatus = requiredString(value.workOrderStatus);
  const updatedAt = dateString(value.updatedAt);
  if (!id || !workOrderId || !description || !status || !type || laborHours === undefined || !plate || !vehicle || !workOrderStatus || !updatedAt) return null;
  return { id, workOrderId, description, status, type, laborHours, plate, vehicle, workOrderStatus, updatedAt };
}

function parseMechanicAppointment(value: unknown): MechanicHomeAppointmentContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const workOrderId = nullableString(value.workOrderId);
  const status = parseStatus(value.status);
  const workOrderStatus = nullableString(value.workOrderStatus);
  const lifecycle = value.lifecycle == null ? null : parseLifecycle(value.lifecycle);
  const plannedStartAt = dateString(value.plannedStartAt);
  const plannedEndAt = dateString(value.plannedEndAt);
  const plate = requiredString(value.plate);
  const vehicle = requiredString(value.vehicle);
  const problem = nullableString(value.problem);
  const post = nullableString(value.post);
  if (!id || workOrderId === undefined || !status || workOrderStatus === undefined || (value.lifecycle != null && !lifecycle) || !plannedStartAt || !plannedEndAt || !plate || !vehicle || problem === undefined || post === undefined) return null;
  return { id, workOrderId, status, workOrderStatus, lifecycle, plannedStartAt, plannedEndAt, plate, vehicle, problem, post };
}

function parseMechanicKpis(value: unknown): MechanicHomeKpisContract | null {
  if (!isRecord(value)) return null;
  const assigned = nonNegativeInteger(value.assigned);
  const scheduledToday = nonNegativeInteger(value.scheduledToday);
  const inProgress = nonNegativeInteger(value.inProgress);
  const completedToday = nonNegativeInteger(value.completedToday);
  const waitingParts = nonNegativeInteger(value.waitingParts);
  if (assigned == null || scheduledToday == null || inProgress == null || completedToday == null || waitingParts == null) return null;
  return { assigned, scheduledToday, inProgress, completedToday, waitingParts };
}

function parseMechanicLinked(value: Record<string, unknown>): MechanicCabinetLinkedPayload | null {
  if (!isRecord(value.mechanic)) return null;
  const id = requiredString(value.mechanic.id);
  const name = requiredString(value.mechanic.name);
  const station = parseStation(value.mechanic.station);
  const kpis = parseMechanicKpis(value.kpis);
  const tasks = parseArrayStrict(value.tasks, parseMechanicTask);
  const appointments = parseArrayStrict(value.appointments, parseMechanicAppointment);
  if (!id || !name || !station || !kpis || !tasks || !appointments) return null;
  return {
    ok: true,
    cabinet: "MECHANIC",
    linked: true,
    mechanic: { id, name, station },
    kpis,
    tasks,
    appointments,
  };
}

function parseManagerKpis(value: unknown): StationManagerKpisContract | null {
  if (!isRecord(value)) return null;
  const carsToday = nonNegativeInteger(value.carsToday);
  const carsOnStation = nonNegativeInteger(value.carsOnStation);
  const inRepair = nonNegativeInteger(value.inRepair);
  const postsOccupied = nonNegativeInteger(value.postsOccupied);
  const postsTotal = nonNegativeInteger(value.postsTotal);
  const mechanicsTotal = nonNegativeInteger(value.mechanicsTotal);
  const noShow = nonNegativeInteger(value.noShow);
  if (carsToday == null || carsOnStation == null || inRepair == null || postsOccupied == null || postsTotal == null || mechanicsTotal == null || noShow == null) return null;
  return { carsToday, carsOnStation, inRepair, postsOccupied, postsTotal, mechanicsTotal, noShow };
}

function parseManagerFlow(value: unknown): StationManagerFlowContract | null {
  if (!isRecord(value)) return null;
  const booked = nonNegativeInteger(value.booked);
  const diagnostics = nonNegativeInteger(value.diagnostics);
  const approval = nonNegativeInteger(value.approval);
  const waitingParts = nonNegativeInteger(value.waitingParts);
  const readyForRepair = nonNegativeInteger(value.readyForRepair);
  const inRepair = nonNegativeInteger(value.inRepair);
  const qc = nonNegativeInteger(value.qc);
  const ready = nonNegativeInteger(value.ready);
  if (booked == null || diagnostics == null || approval == null || waitingParts == null || readyForRepair == null || inRepair == null || qc == null || ready == null) return null;
  return { booked, diagnostics, approval, waitingParts, readyForRepair, inRepair, qc, ready };
}

function parseAttention(value: unknown): StationManagerAttentionContract | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const status = parseStatus(value.status);
  const lifecycle = value.lifecycle == null ? null : parseLifecycle(value.lifecycle);
  const plate = requiredString(value.plate);
  const vehicle = requiredString(value.vehicle);
  const problem = nullableString(value.problem);
  const plannedStartAt = dateString(value.plannedStartAt);
  const post = nullableString(value.post);
  const mechanic = nullableString(value.mechanic);
  if (!id || !status || (value.lifecycle != null && !lifecycle) || !plate || !vehicle || problem === undefined || !plannedStartAt || post === undefined || mechanic === undefined) return null;
  return { id, status, lifecycle, plate, vehicle, problem, plannedStartAt, post, mechanic };
}

function parseManagerLinked(value: Record<string, unknown>): StationManagerCabinetLinkedPayload | null {
  const station = parseStation(value.station);
  const kpis = parseManagerKpis(value.kpis);
  const flow = parseManagerFlow(value.flow);
  const attention = parseArrayStrict(value.attention, parseAttention);
  if (!station || !kpis || !flow || !attention) return null;
  return { ok: true, cabinet: "STATION_MANAGER", linked: true, station, kpis, flow, attention };
}

export function parseCabinetHomePayload(value: unknown): CabinetHomePayload | null {
  if (!isRecord(value) || value.ok !== true || typeof value.linked !== "boolean") return null;
  if (value.cabinet === "MECHANIC") {
    if (value.linked) return parseMechanicLinked(value);
    const reason = parseReason(value);
    return reason ? { ok: true, cabinet: "MECHANIC", linked: false, ...reason } : null;
  }
  if (value.cabinet === "STATION_MANAGER") {
    if (value.linked) return parseManagerLinked(value);
    const reason = parseReason(value);
    return reason ? { ok: true, cabinet: "STATION_MANAGER", linked: false, ...reason } : null;
  }
  return null;
}

export function cabinetHomePayloadMessage(value: unknown, fallback = "Не вдалося завантажити кабінет") {
  return payloadMessage(value, fallback);
}
