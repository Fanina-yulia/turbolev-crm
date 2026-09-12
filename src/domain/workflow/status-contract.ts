import { getWorkflowDefinition, getWorkflowStatus, normalizeWorkflowStatus } from "./engine";
import {
  APPOINTMENT_CANONICAL_STATUS_CODES,
  APPOINTMENT_STATUS_CODES,
  PLANNER_BLOCKING_STATUS_VALUES,
  PLANNER_STATUS_VALUES,
  WORK_ORDER_STATUS_CODES,
} from "./status-codes";
import type { WorkflowEntity } from "./types";

export {
  APPOINTMENT_CANONICAL_STATUS_CODES,
  APPOINTMENT_STATUS_CODES,
  PLANNER_BLOCKING_STATUS_VALUES,
  PLANNER_STATUS_VALUES,
  WORK_ORDER_STATUS_CODES,
} from "./status-codes";

export const WORKFLOW_STATUS_CONTRACT_VERSION = "2.0.0" as const;

export type WorkflowStatusSource = "APPOINTMENT" | "DIAGNOSTIC" | "WORK_ORDER" | "NONE";

export const WORKFLOW_STATUS_SOURCE_OF_TRUTH: Readonly<Record<WorkflowEntity, string>> = {
  INQUIRY: "Inquiry",
  LEAD: "Lead",
  CLIENT: "Client",
  VEHICLE: "Vehicle",
  APPOINTMENT: "ServiceAppointment",
  DIAGNOSTIC: "DiagnosticRequest",
  WORK_ORDER: "WorkOrder",
  PARTS_REQUEST: "PartsRequest",
  SUPPLIER_ORDER: "SupplierOrder",
  STOCK_RESERVATION: "StockReservation",
  PAYMENT: "FinancialObligation / Payment",
  QUALITY_CONTROL: "QualityControl",
  WARRANTY: "WarrantyCase",
};

export const CANONICAL_APPOINTMENT_STATUS_CODES = APPOINTMENT_CANONICAL_STATUS_CODES;
export const COMPATIBILITY_APPOINTMENT_STATUS_CODES = APPOINTMENT_STATUS_CODES.filter(
  (status) => !(APPOINTMENT_CANONICAL_STATUS_CODES as readonly string[]).includes(status),
);

export function getCanonicalWorkflowStatusCodes(entity: WorkflowEntity): readonly string[] {
  return getWorkflowDefinition(entity).statuses
    .filter((status) => !status.compatibilityOnly && !status.legacy)
    .map((status) => status.code);
}

export function isCanonicalWorkflowStatus(entity: WorkflowEntity, status: string): boolean {
  const raw = status.trim().toUpperCase();
  const normalized = normalizeWorkflowStatus(entity, raw);
  if (raw !== normalized) return false;
  const definition = getWorkflowStatus(entity, normalized);
  return Boolean(definition && !definition.compatibilityOnly && !definition.legacy);
}

export function isCompatibilityWorkflowStatus(entity: WorkflowEntity, status: string): boolean {
  const raw = status.trim().toUpperCase();
  const normalized = normalizeWorkflowStatus(entity, raw);
  const definition = getWorkflowStatus(entity, normalized);
  return raw !== normalized || Boolean(definition?.compatibilityOnly || definition?.legacy);
}

export function assertCanonicalWorkflowStatus(entity: WorkflowEntity, status: string): true {
  if (!isCanonicalWorkflowStatus(entity, status)) {
    throw new Error(`NON_CANONICAL_WORKFLOW_STATUS:${entity}:${status}`);
  }
  return true;
}

export type OperationalServiceState =
  | "UNKNOWN"
  | "RESERVE"
  | "BOOKED"
  | "ARRIVED"
  | "DIAGNOSTICS"
  | "PREPARATION"
  | "WAITING_APPROVAL"
  | "WAITING_PARTS"
  | "READY_FOR_REPAIR"
  | "IN_REPAIR"
  | "REWORK"
  | "PAUSED"
  | "WAITING_QC"
  | "WAITING_PAYMENT"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED"
  | "WARRANTY";

export const OPERATIONAL_SERVICE_STATE_LABELS: Readonly<Record<OperationalServiceState, string>> = {
  UNKNOWN: "Стан не визначено",
  RESERVE: "Резерв",
  BOOKED: "Записаний",
  ARRIVED: "Автомобіль прийнято",
  DIAGNOSTICS: "Діагностика",
  PREPARATION: "Підготовка ремонту",
  WAITING_APPROVAL: "Очікує погодження",
  WAITING_PARTS: "Очікує запчастини",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У ремонті",
  REWORK: "Доопрацювання після контролю якості",
  PAUSED: "Призупинено",
  WAITING_QC: "Контроль якості",
  WAITING_PAYMENT: "Очікує повну оплату",
  READY_FOR_PICKUP: "Готовий до видачі",
  COMPLETED: "Завершено",
  NO_SHOW: "Не приїхав",
  CANCELLED: "Скасовано",
  WARRANTY: "Гарантійне звернення",
};

export type OperationalServiceProjection = {
  code: OperationalServiceState;
  label: string;
  source: WorkflowStatusSource;
  sourceStatus: string | null;
  compatibilityOnly: boolean;
};

const APPOINTMENT_TO_OPERATIONAL_STATE: Readonly<Record<string, OperationalServiceState>> = {
  RESERVE: "RESERVE",
  BOOKED: "BOOKED",
  ARRIVED: "ARRIVED",
  NO_SHOW: "NO_SHOW",
  CANCELLED: "CANCELLED",
  DIAGNOSTICS: "DIAGNOSTICS",
  WAITING_PARTS_SELECTION: "PREPARATION",
  WAITING_CALCULATION: "PREPARATION",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  WAITING_PARTS: "WAITING_PARTS",
  READY_FOR_REPAIR: "READY_FOR_REPAIR",
  IN_REPAIR: "IN_REPAIR",
  WAITING_QC: "WAITING_QC",
  WAITING_PAYMENT: "WAITING_PAYMENT",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  COMPLETED: "COMPLETED",
  WARRANTY: "WARRANTY",
  PAUSED: "PAUSED",
};

const DIAGNOSTIC_TO_OPERATIONAL_STATE: Readonly<Record<string, OperationalServiceState>> = {
  PENDING: "DIAGNOSTICS",
  IN_PROGRESS: "DIAGNOSTICS",
  CONFIRMED: "DIAGNOSTICS",
  CANCELLED: "CANCELLED",
};

const WORK_ORDER_TO_OPERATIONAL_STATE: Readonly<Record<string, OperationalServiceState>> = {
  PARTS_REVIEW: "PREPARATION",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  WAITING_PARTS: "WAITING_PARTS",
  READY_FOR_REPAIR: "READY_FOR_REPAIR",
  IN_REPAIR: "IN_REPAIR",
  REWORK: "REWORK",
  PAUSED: "PAUSED",
  WAITING_QC: "WAITING_QC",
  WAITING_PAYMENT: "WAITING_PAYMENT",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  CLOSED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

function fromSource(
  entity: "APPOINTMENT" | "DIAGNOSTIC" | "WORK_ORDER",
  rawStatus: string | null | undefined,
  map: Readonly<Record<string, OperationalServiceState>>,
): OperationalServiceProjection | null {
  if (!rawStatus?.trim()) return null;
  const raw = rawStatus.trim().toUpperCase();
  const normalized = normalizeWorkflowStatus(entity, raw);
  const definition = getWorkflowStatus(entity, normalized);
  const code = map[normalized];
  if (!definition || !code) return null;
  return {
    code,
    label: OPERATIONAL_SERVICE_STATE_LABELS[code],
    source: entity,
    sourceStatus: normalized,
    compatibilityOnly: entity === "APPOINTMENT"
      ? !(APPOINTMENT_CANONICAL_STATUS_CODES as readonly string[]).includes(normalized)
      : false,
  };
}

export function deriveOperationalServiceState(input: {
  appointmentStatus?: string | null;
  diagnosticStatus?: string | null;
  workOrderStatus?: string | null;
  purpose?: "DIAGNOSTICS" | "REPAIR" | null;
}): OperationalServiceProjection {
  const workOrder = fromSource("WORK_ORDER", input.workOrderStatus, WORK_ORDER_TO_OPERATIONAL_STATE);
  if (workOrder) return workOrder;

  const diagnostic = fromSource("DIAGNOSTIC", input.diagnosticStatus, DIAGNOSTIC_TO_OPERATIONAL_STATE);
  if (diagnostic) return diagnostic;

  const appointment = fromSource("APPOINTMENT", input.appointmentStatus, APPOINTMENT_TO_OPERATIONAL_STATE);
  if (appointment) {
    if (
      input.purpose === "DIAGNOSTICS"
      && (appointment.sourceStatus === "BOOKED" || appointment.sourceStatus === "ARRIVED")
    ) {
      return {
        ...appointment,
        code: "DIAGNOSTICS",
        label: OPERATIONAL_SERVICE_STATE_LABELS.DIAGNOSTICS,
      };
    }
    return appointment;
  }

  return {
    code: "UNKNOWN",
    label: OPERATIONAL_SERVICE_STATE_LABELS.UNKNOWN,
    source: "NONE",
    sourceStatus: null,
    compatibilityOnly: false,
  };
}

/**
 * WorkOrder owns the production state after ARRIVED. The Planner Appointment
 * lifecycle changes only for final appointment outcomes; intermediate repair
 * states are read through deriveOperationalServiceState().
 */
export function appointmentLifecycleStatusAfterWorkOrder(status: string): "COMPLETED" | "CANCELLED" | null {
  const normalized = normalizeWorkflowStatus("WORK_ORDER", status.trim().toUpperCase());
  if (normalized === "CLOSED") return "COMPLETED";
  if (normalized === "CANCELLED") return "CANCELLED";
  return null;
}

export const STATUS_CODE_CONTRACT = {
  version: WORKFLOW_STATUS_CONTRACT_VERSION,
  planner: {
    canonical: CANONICAL_APPOINTMENT_STATUS_CODES,
    compatibility: COMPATIBILITY_APPOINTMENT_STATUS_CODES,
    all: PLANNER_STATUS_VALUES,
    blocking: PLANNER_BLOCKING_STATUS_VALUES,
  },
  workOrder: {
    canonical: WORK_ORDER_STATUS_CODES,
  },
  sourceOfTruth: WORKFLOW_STATUS_SOURCE_OF_TRUTH,
} as const;
