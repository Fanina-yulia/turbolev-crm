export const VEHICLE_LIFECYCLE_CODES = [
  "PLANNED",
  "IN_WORK",
  "DIAGNOSTIC_COMPLETED",
  "MANAGER_REVIEW",
  "CLIENT_DECISION",
  "PARTS_SELECTION",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "QUALITY_CONTROL",
  "WAITING_PAYMENT",
  "READY_FOR_PICKUP",
  "DELIVERED",
  "CANCELLED",
  "CLIENT_DECLINED",
] as const;

export type VehicleLifecycleCode = (typeof VEHICLE_LIFECYCLE_CODES)[number];

export const VEHICLE_LIFECYCLE_META: Record<VehicleLifecycleCode, {
  label: string;
  order: number;
  tone: "neutral" | "info" | "accent" | "warning" | "success" | "danger";
  active: boolean;
}> = {
  PLANNED: { label: "Заплановано", order: 10, tone: "neutral", active: true },
  IN_WORK: { label: "В роботі", order: 20, tone: "accent", active: true },
  DIAGNOSTIC_COMPLETED: { label: "Завершена діагностика", order: 30, tone: "info", active: true },
  MANAGER_REVIEW: { label: "На перевірці менеджера", order: 40, tone: "info", active: true },
  CLIENT_DECISION: { label: "Очікує рішення клієнта", order: 50, tone: "warning", active: true },
  PARTS_SELECTION: { label: "Підбір деталей", order: 60, tone: "accent", active: true },
  WAITING_APPROVAL: { label: "Очікує погодження", order: 70, tone: "warning", active: true },
  WAITING_PARTS: { label: "Очікує деталі", order: 80, tone: "warning", active: true },
  READY_FOR_REPAIR: { label: "Готовий до ремонту", order: 90, tone: "success", active: true },
  IN_REPAIR: { label: "У ремонті", order: 100, tone: "accent", active: true },
  QUALITY_CONTROL: { label: "Контроль якості", order: 110, tone: "info", active: true },
  WAITING_PAYMENT: { label: "Очікує оплату", order: 120, tone: "warning", active: true },
  READY_FOR_PICKUP: { label: "Готовий до видачі", order: 130, tone: "success", active: true },
  DELIVERED: { label: "Видано", order: 140, tone: "success", active: false },
  CANCELLED: { label: "Скасовано", order: 150, tone: "neutral", active: false },
  CLIENT_DECLINED: { label: "Клієнт відмовився", order: 160, tone: "danger", active: false },
};

export const VEHICLE_LIFECYCLE_FLAGS = [
  "OVERDUE",
  "NEEDS_ATTENTION",
  "WAITING_MANAGER",
  "WAITING_CLIENT",
  "RETURNED_TO_MECHANIC",
  "PAUSED",
  "REWORK",
  "WARRANTY",
  "NO_SHOW",
  "RESERVE",
] as const;

export type VehicleLifecycleFlag = (typeof VEHICLE_LIFECYCLE_FLAGS)[number];

export const VEHICLE_LIFECYCLE_FLAG_LABELS: Record<VehicleLifecycleFlag, string> = {
  OVERDUE: "Протерміновано",
  NEEDS_ATTENTION: "Потребує уваги",
  WAITING_MANAGER: "Очікує менеджера",
  WAITING_CLIENT: "Очікує клієнта",
  RETURNED_TO_MECHANIC: "Повернено механіку",
  PAUSED: "Призупинено",
  REWORK: "Доопрацювання",
  WARRANTY: "Гарантійне звернення",
  NO_SHOW: "Не приїхав",
  RESERVE: "Резерв",
};

export type VehicleLifecycleSource = {
  appointmentStatus?: string | null;
  appointmentPlannedStartAt?: Date | string | null;
  appointmentPlannedEndAt?: Date | string | null;
  appointmentActualArrivalAt?: Date | string | null;
  diagnosticStatus?: string | null;
  diagnosticReviewState?: string | null;
  diagnosticReviewerUserId?: string | null;
  diagnosticCardSent?: boolean;
  workOrderStatus?: string | null;
  estimateStatus?: string | null;
  hasFutureBookedWork?: boolean;
};

export type VehicleLifecycleSnapshot = {
  code: VehicleLifecycleCode;
  label: string;
  tone: (typeof VEHICLE_LIFECYCLE_META)[VehicleLifecycleCode]["tone"];
  order: number;
  active: boolean;
  flags: VehicleLifecycleFlag[];
  source: "WORK_ORDER" | "DIAGNOSTIC" | "APPOINTMENT";
};

function validDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function base(code: VehicleLifecycleCode, source: VehicleLifecycleSnapshot["source"]): VehicleLifecycleSnapshot {
  const meta = VEHICLE_LIFECYCLE_META[code];
  return { code, label: meta.label, tone: meta.tone, order: meta.order, active: meta.active, flags: [], source };
}

function uniqueFlags(flags: VehicleLifecycleFlag[]) {
  return [...new Set(flags)];
}

function workOrderCode(status?: string | null): VehicleLifecycleCode | null {
  switch (status) {
    case "PARTS_REVIEW": return "PARTS_SELECTION";
    case "WAITING_APPROVAL": return "WAITING_APPROVAL";
    case "WAITING_PARTS": return "WAITING_PARTS";
    case "READY_FOR_REPAIR": return "READY_FOR_REPAIR";
    case "IN_REPAIR":
    case "PAUSED":
    case "REWORK":
    case "WARRANTY": return "IN_REPAIR";
    case "WAITING_QC": return "QUALITY_CONTROL";
    case "WAITING_PAYMENT": return "WAITING_PAYMENT";
    case "READY_FOR_PICKUP": return "READY_FOR_PICKUP";
    case "CLOSED": return "DELIVERED";
    case "CANCELLED": return "CANCELLED";
    default: return null;
  }
}

function appointmentCode(status?: string | null): VehicleLifecycleCode | null {
  switch (status) {
    case "BOOKED":
    case "RESERVE": return "PLANNED";
    case "ARRIVED":
    case "DIAGNOSTICS": return "IN_WORK";
    case "WAITING_PARTS_SELECTION": return "PARTS_SELECTION";
    case "WAITING_CALCULATION":
    case "WAITING_APPROVAL": return "WAITING_APPROVAL";
    case "WAITING_PARTS": return "WAITING_PARTS";
    case "READY_FOR_REPAIR": return "READY_FOR_REPAIR";
    case "IN_REPAIR":
    case "PAUSED":
    case "WARRANTY": return "IN_REPAIR";
    case "WAITING_QC": return "QUALITY_CONTROL";
    case "WAITING_PAYMENT": return "WAITING_PAYMENT";
    case "READY_FOR_PICKUP": return "READY_FOR_PICKUP";
    case "COMPLETED": return "DELIVERED";
    case "NO_SHOW":
    case "CANCELLED": return "CANCELLED";
    default: return null;
  }
}

/**
 * One canonical, user-facing lifecycle status for a vehicle.
 * Technical statuses remain in their own aggregates; this resolver is the single
 * translation layer used by CRM screens and public client views.
 */
export function deriveVehicleLifecycle(source: VehicleLifecycleSource, now = new Date()): VehicleLifecycleSnapshot | null {
  let result: VehicleLifecycleSnapshot | null = null;

  // A follow-up appointment intentionally wins over a newly-created PARTS_REVIEW
  // work order. This is the "Запис на наступні роботи" branch after a diagnostic card.
  if (source.hasFutureBookedWork && (!source.workOrderStatus || source.workOrderStatus === "PARTS_REVIEW")) {
    result = base("PLANNED", "APPOINTMENT");
  }

  if (!result) {
    const woCode = workOrderCode(source.workOrderStatus);
    if (woCode) {
      if (woCode === "CANCELLED" && source.estimateStatus === "REJECTED") result = base("CLIENT_DECLINED", "WORK_ORDER");
      else result = base(woCode, "WORK_ORDER");
    }
  }

  if (!result) {
    if (source.diagnosticStatus === "CONFIRMED" && source.diagnosticCardSent) {
      result = base("CLIENT_DECISION", "DIAGNOSTIC");
    } else if (source.diagnosticStatus === "CONFIRMED") {
      result = base("MANAGER_REVIEW", "DIAGNOSTIC");
    } else if (source.diagnosticReviewState === "SUBMITTED" && source.diagnosticReviewerUserId) {
      result = base("MANAGER_REVIEW", "DIAGNOSTIC");
    } else if (source.diagnosticReviewState === "SUBMITTED") {
      result = base("DIAGNOSTIC_COMPLETED", "DIAGNOSTIC");
    } else if (source.diagnosticReviewState === "RETURNED" || source.diagnosticStatus === "IN_PROGRESS") {
      result = base("IN_WORK", "DIAGNOSTIC");
    }
  }

  if (!result) {
    const apptCode = appointmentCode(source.appointmentStatus);
    if (apptCode) result = base(apptCode, "APPOINTMENT");
  }

  if (!result && source.diagnosticStatus === "PENDING" && source.appointmentActualArrivalAt) {
    result = base("IN_WORK", "DIAGNOSTIC");
  }

  if (!result) return null;

  const flags: VehicleLifecycleFlag[] = [];
  const plannedEnd = validDate(source.appointmentPlannedEndAt);
  if (result.active && plannedEnd && plannedEnd.getTime() < now.getTime()) flags.push("OVERDUE");
  if (result.code === "DIAGNOSTIC_COMPLETED" || result.code === "MANAGER_REVIEW") flags.push("WAITING_MANAGER");
  if (result.code === "CLIENT_DECISION" || result.code === "WAITING_APPROVAL") flags.push("WAITING_CLIENT");
  if (source.diagnosticReviewState === "RETURNED") flags.push("RETURNED_TO_MECHANIC");
  if (source.workOrderStatus === "PAUSED" || source.appointmentStatus === "PAUSED") flags.push("PAUSED");
  if (source.workOrderStatus === "REWORK") flags.push("REWORK");
  if (source.workOrderStatus === "WARRANTY" || source.appointmentStatus === "WARRANTY") flags.push("WARRANTY");
  if (source.appointmentStatus === "NO_SHOW") flags.push("NO_SHOW");
  if (source.appointmentStatus === "RESERVE") flags.push("RESERVE");
  if (flags.some((flag) => ["OVERDUE", "RETURNED_TO_MECHANIC", "PAUSED", "REWORK"].includes(flag))) flags.push("NEEDS_ATTENTION");

  result.flags = uniqueFlags(flags);
  return result;
}

export function lifecycleLabel(code: VehicleLifecycleCode) {
  return VEHICLE_LIFECYCLE_META[code].label;
}

export function isVehicleLifecycleCode(value: unknown): value is VehicleLifecycleCode {
  return typeof value === "string" && (VEHICLE_LIFECYCLE_CODES as readonly string[]).includes(value);
}
