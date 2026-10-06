"use client";

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { startAdaptivePoller } from "@/src/lib/client/adaptive-polling";
import styles from "./mechanic-standalone-cabinet.module.css";
import { MechanicDiagnosticWorkspace } from "./mechanic-diagnostic-workspace";
import { MechanicExecutionIssueForm } from "./mechanic-execution-issue-form";
import { MechanicTaskPlateVerification } from "./mechanic-task-plate-verification";
import { MechanicRepairCompletion } from "./mechanic-repair-completion";
import { neonAuthClient } from "@/src/security/neon-auth-client";

type MechanicTask = {
  id: string;
  workOrderId: string;
  description: string;
  status: string;
  lineStatus?: string;
  type: string;
  laborHours: string | null;
  plate: string;
  vehicle: string;
  workOrderStatus: string;
  startedAt?: string | null;
  completedAt?: string | null;
  pausedAt?: string | null;
  pauseReason?: string | null;
  pauseNote?: string | null;
  stopAt?: string | null;
  stopReason?: string | null;
  stopNote?: string | null;
  stopIssueId?: string | null;
  isAdditionalWork?: boolean;
  findingCount?: number;
  openFindingCount?: number;
};

type RepairCaseLine = {
  id: string;
  type: string;
  status: string;
  description: string;
  code: string | null;
  article: string | null;
  brand: string | null;
  unit: string;
  requiredForRepair: boolean;
  plannedQuantity: string | null;
  actualQuantity: string | null;
  laborHours: string | null;
  mechanicId: string | null;
  assignedToCurrentMechanic: boolean;
  startedAt: string | null;
  completedAt: string | null;
  mechanicWorkflow: {
    pausedAt: string | null;
    pauseReason: string | null;
    pauseNote: string | null;
    stopAt: string | null;
    stopReason: string | null;
    stopNote: string | null;
    stopIssueId: string | null;
    isAdditionalWork: boolean;
    totalPausedSeconds: number;
  };
  isAdditionalWork?: boolean;
};

type RepairCasePart = {
  id: string;
  description: string;
  article: string | null;
  brand: string | null;
  status: string;
  unit: string;
  requiredForRepair: boolean;
  plannedQuantity: string | null;
  actualQuantity: string | null;
};

type RepairCase = {
  id: string;
  workOrderId: string;
  status: string;
  vehicle: { id: string; label: string; plateNumber: string | null; vin: string | null; mileageKm: number | null };
  client: { id: string; name: string | null; phone: string };
  appointment: { id: string; status: string; plannedStartAt: string; plannedEndAt: string; post: string | null; problem: string | null } | null;
  diagnostic: { id: string; technicalConclusion: string | null; confirmedAt: string | null } | null;
  progress: { completed: number; total: number; percent: number };
  lines: RepairCaseLine[];
  parts: RepairCasePart[];
  activeLineId: string | null;
  hasAssignedWork: boolean;
  qualityControl: { id: string; attempt: number; status: string; resultNote: string | null; completedAt: string | null } | null;
  nextAction: string;
  updatedAt: string;
};

type RepairCaseFeed = {
  ok: boolean;
  linked: boolean;
  cases?: RepairCase[];
  kpis?: { total: number; active: number; inRepair: number; waitingParts: number; waitingQc: number; completedToday: number };
  message?: string;
  error?: string;
};

type Appointment = {
  id: string;
  workOrderId: string | null;
  purpose?: "DIAGNOSTICS" | "REPAIR" | null;
  requiresDiagnosticFirst?: boolean;
  status: string;
  workOrderStatus: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  plate: string;
  vehicle: string;
  problem: string | null;
  post: string | null;
};

type HomePayload = {
  ok: boolean;
  cabinet?: "MECHANIC";
  linked?: boolean;
  reason?: string;
  mechanic?: { id: string; name: string; station: { id: string; name: string } };
  kpis?: { assigned: number; scheduledToday: number; inProgress: number; completedToday: number; waitingParts: number };
  tasks?: MechanicTask[];
  appointments?: Appointment[];
  message?: string;
  error?: string;
};

type TaskFeed = {
  ok: boolean;
  linked: boolean;
  items?: MechanicTask[];
  kpis?: { assigned: number; inProgress: number; paused: number; completedToday: number };
  message?: string;
  error?: string;
};

type DiagnosticItem = {
  id: string;
  status: string;
  workflowState: string;
  reviewState: string;
  plannedStartAt: string;
  plannedEndAt: string;
  post: string | null;
  problem: string | null;
  requiresDiagnosticFirst?: boolean;
  vehicle: { label: string; plateNumber: string | null };
};

type Clarification = {
  id: string;
  findingText: string;
  recommendation: string | null;
  managerComment: string | null;
  workDescription: string;
  plate: string;
  vehicle: string;
  reviewedAt: string | null;
};

type MechanicNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  vehicle: string;
  plate: string;
  appointmentId: string | null;
  workOrderId: string | null;
  findingId: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationFeed = {
  ok: boolean;
  linked: boolean;
  unreadCount: number;
  items: MechanicNotification[];
  message?: string;
  error?: string;
};

type Payroll = {
  ok: boolean;
  rules?: {
    baseSalary: number;
    minimumSalary: number;
    workPercent: number;
    partsSalesPercent: number;
    partsMarginPercent: number;
    netProfitPercent: number;
  };
  balance?: { accrued: number; paid: number; due: number };
  today?: { accrued: number; paid: number; due: number };
  week?: { accrued: number; paid: number; due: number };
  month?: {
    accrued: number;
    paid: number;
    due: number;
    byCategory: Record<string, number>;
    details: Array<{
      id: string;
      category: string;
      amount: number;
      occurredAt: string;
      sourceType: string | null;
      sourceId: string | null;
      description: string | null;
    }>;
  };
  projection?: {
    postedAccrued: number;
    futureBase: number;
    estimatedProfitShare: number;
    estimatedMinimumTopUp: number;
    total: number;
  };
};
type Screen = "HOME" | "WORKS" | "WORK_DETAIL" | "REPAIR_COMPLETION" | "STOP" | "ADDITIONAL_WORK" | "FINDING" | "DIAGNOSTICS" | "DIAGNOSTIC_DETAIL" | "NOTIFICATIONS" | "PROFILE" | "SCHEDULE" | "PAYROLL" | "SUPPORT";
type WorkAction = "START" | "PAUSE" | "STOP" | "RESUME" | "COMPLETE" | "WAITING_PARTS";
type ThemeChoice = "system" | "light" | "dark";
type SupportKind = "QUESTION" | "PART_REQUEST";
type FindingUrgency = "INFO" | "SOON" | "CRITICAL";
type StopReason = "PARTS_UNAVAILABLE" | "TECHNICAL_PROBLEM" | "SAFETY_RISK" | "CUSTOMER_APPROVAL_REQUIRED" | "OTHER";
type WorksFilter = "ALL" | "OVERDUE" | "TODAY" | "FUTURE";
type ScheduleFilter = "ALL" | "TODAY";

type MechanicVehicleCardState = "OVERDUE" | "PENDING" | "DONE";

type MechanicProcessCard = {
  id: string;
  processType: "DIAGNOSTIC" | "REPAIR";
  processId: string;
  diagnosticId: string | null;
  workOrderId: string | null;
  appointmentId: string | null;
  vehicle: string;
  plate: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  completedAt: string | null;
  state: MechanicVehicleCardState;
  statusLabel: string;
  summary: string;
  workCount: number;
  taskId: string | null;
  routePending: boolean;
  updatedAt: string;
};

type MechanicProcessFeed = {
  ok: boolean;
  linked: boolean;
  items?: MechanicProcessCard[];
  message?: string;
  error?: string;
};

type MechanicVehicleRow = {
  key: string;
  vehicle: string;
  plate: string;
  task: MechanicTask | null;
  appointment: Appointment | null;
  diagnostic: DiagnosticItem | null;
  workCount: number;
  unfinishedWorkCount: number;
  completedWorkCount: number;
  hasDiagnostic: boolean;
  hasActiveRepairCase: boolean;
  plannedStarts: string[];
  state: MechanicVehicleCardState;
};

const statusLabel: Record<string, string> = {
  BOOKED: "Заплановано",
  ARRIVED: "Автомобіль прибув",
  DIAGNOSTICS: "Діагностика",
  DRAFT: "Очікує погодження",
  APPROVED: "Готово до роботи",
  PENDING: "Заплановано",
  READY: "Готово до роботи",
  IN_PROGRESS: "В роботі",
  IN_REPAIR: "В роботі",
  REWORK: "Доопрацювання",
  PAUSED: "Пауза",
  COMPLETED: "Завершено",
  DONE: "Завершено",
  WAITING_PARTS: "Очікує запчастини",
  WAITING_PARTS_SELECTION: "Очікує підбору деталей",
  WAITING_APPROVAL: "Очікує погодження",
  CANCELLED: "Скасовано",
  SUBMITTED: "Передано менеджеру",
  RETURNED: "Повернено на уточнення",
  CONFIRMED: "Підтверджено",
  NO_SHOW: "Не приїхав",
  STOPPED: "СТОП — потребує уваги",
};

const stopReasonLabel: Record<StopReason, string> = {
  PARTS_UNAVAILABLE: "Немає потрібної запчастини",
  TECHNICAL_PROBLEM: "Технічна проблема",
  SAFETY_RISK: "Ризик для безпеки",
  CUSTOMER_APPROVAL_REQUIRED: "Потрібне погодження клієнта",
  OTHER: "Інша причина",
};

function time(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function notificationTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  if (minutes < 60) return `${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} год ${rest} хв` : `${hours} год`;
}

function firstName(value?: string | null) {
  return value?.trim().split(/\s+/)[0] || "майстре";
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(number) : "—";
}

function isDone(status: string) {
  return status === "COMPLETED" || status === "DONE";
}

function statusTone(status: string) {
  if (isDone(status) || status === "CONFIRMED") return styles.good;
  if (status === "IN_PROGRESS" || status === "IN_REPAIR") return styles.info;
  if (["PAUSED", "STOPPED", "REWORK", "WAITING_PARTS", "WAITING_PARTS_SELECTION", "WAITING_APPROVAL", "RETURNED"].includes(status)) return styles.warn;
  if (status === "CANCELLED") return styles.mutedPill;
  return styles.accentPill;
}

function appointmentStatus(item: Appointment) {
  return item.workOrderStatus || item.status;
}

const terminalAppointmentStatuses = new Set(["COMPLETED", "DONE", "CANCELLED", "NO_SHOW", "READY_FOR_PICKUP", "CLOSED", "DELIVERED"]);

function isAppointmentOverdue(item: Appointment) {
  const status = appointmentStatus(item);
  if (terminalAppointmentStatuses.has(status)) return false;
  const plannedStart = new Date(item.plannedStartAt).getTime();
  return Number.isFinite(plannedStart) && plannedStart < Date.now();
}

function appointmentPriority(a: Appointment, b: Appointment) {
  const aOverdue = isAppointmentOverdue(a);
  const bOverdue = isAppointmentOverdue(b);
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  return new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime();
}

function matchesWorksFilter(item: Appointment | MechanicTask, filter: WorksFilter) {
  if (filter === "ALL") return true;
  if (!("plannedStartAt" in item)) return false;
  if (filter === "OVERDUE") return isAppointmentOverdue(item);
  const start = new Date(item.plannedStartAt).getTime();
  if (filter === "TODAY") return kyivDateKey(item.plannedStartAt) === kyivDateKey(new Date());
  return Number.isFinite(start) && start > Date.now();
}

function matchesRepairCaseFilter(item: RepairCase, filter: WorksFilter) {
  if (filter === "ALL") return true;
  if (filter === "OVERDUE") return Boolean(item.appointment && isAppointmentOverdue({
    id: item.appointment.id,
    workOrderId: item.workOrderId,
    status: item.appointment.status,
    workOrderStatus: item.status,
    plannedStartAt: item.appointment.plannedStartAt,
    plannedEndAt: item.appointment.plannedEndAt,
    plate: item.vehicle.plateNumber || "—",
    vehicle: item.vehicle.label,
    problem: item.appointment.problem,
    post: item.appointment.post,
  }));
  if (filter === "TODAY") return Boolean(item.appointment && kyivDateKey(item.appointment.plannedStartAt) === kyivDateKey(new Date()));
  return Boolean(item.appointment && new Date(item.appointment.plannedStartAt).getTime() > Date.now());
}

function kyivDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function appointmentForTask(task: MechanicTask, appointments: Appointment[]) {
  return appointments.find((item) => item.workOrderId && item.workOrderId === task.workOrderId)
    ?? appointments.find((item) => item.plate === task.plate || item.vehicle === task.vehicle)
    ?? null;
}

function mechanicVehicleKey(vehicle: string, plate?: string | null) {
  const lookalikes: Record<string, string> = {
    А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H",
    О: "O", Р: "P", С: "C", Т: "T", Х: "X",
  };
  const normalizedPlate = (plate || "")
    .toUpperCase()
    .replace(/[АВЕІКМНОРСТХ]/g, (letter) => lookalikes[letter] || letter)
    .replace(/[^A-Z0-9]/g, "");
  if (normalizedPlate && !/^(БЕЗДЕРЖНОМЕРА|БЕЗНОМЕРА)$/.test(normalizedPlate)) return `plate:${normalizedPlate}`;
  return `vehicle:${vehicle.toUpperCase().replace(/\s+/g, " ").trim()}`;
}

function mechanicTaskPriority(task: MechanicTask) {
  if (task.status === "IN_PROGRESS") return 0;
  if (task.status === "STOPPED") return 1;
  if (task.status === "PAUSED") return 2;
  if (task.status === "APPROVED" || task.status === "READY") return 3;
  if (task.status === "DRAFT" || task.status === "PENDING") return 4;
  if (isDone(task.status)) return 9;
  return 5;
}

function emptyMechanicVehicleRow(vehicle: string, plate?: string | null): MechanicVehicleRow {
  return {
    key: mechanicVehicleKey(vehicle, plate),
    vehicle,
    plate: plate && plate !== "—" ? plate : "Без держномера",
    task: null,
    appointment: null,
    diagnostic: null,
    workCount: 0,
    unfinishedWorkCount: 0,
    completedWorkCount: 0,
    hasDiagnostic: false,
    hasActiveRepairCase: false,
    plannedStarts: [],
    state: "PENDING",
  };
}

function finalizeMechanicVehicleRows(rows: Map<string, MechanicVehicleRow>) {
  const now = Date.now();
  return [...rows.values()]
    .map((row) => {
      const active = row.unfinishedWorkCount > 0 || row.hasActiveRepairCase || Boolean(row.appointment) || Boolean(row.diagnostic);
      const overdue = active && row.plannedStarts.some((value) => {
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) && timestamp < now;
      });
      const done = !active && row.workCount > 0 && row.completedWorkCount === row.workCount;
      return { ...row, state: overdue ? "OVERDUE" as const : done ? "DONE" as const : "PENDING" as const };
    })
    .sort((left, right) => {
      const stateOrder: Record<MechanicVehicleCardState, number> = { OVERDUE: 0, PENDING: 1, DONE: 2 };
      const byState = stateOrder[left.state] - stateOrder[right.state];
      if (byState) return byState;
      const leftStart = Math.min(...left.plannedStarts.map((value) => new Date(value).getTime()).filter(Number.isFinite));
      const rightStart = Math.min(...right.plannedStarts.map((value) => new Date(value).getTime()).filter(Number.isFinite));
      const safeLeft = Number.isFinite(leftStart) ? leftStart : Number.MAX_SAFE_INTEGER;
      const safeRight = Number.isFinite(rightStart) ? rightStart : Number.MAX_SAFE_INTEGER;
      return safeLeft - safeRight || left.vehicle.localeCompare(right.vehicle, "uk");
    });
}

function groupMechanicVehicles(
  tasks: MechanicTask[],
  appointments: Appointment[],
  diagnostics: DiagnosticItem[],
  repairCases: RepairCase[],
): MechanicVehicleRow[] {
  const rows = new Map<string, MechanicVehicleRow>();
  const ensure = (vehicle: string, plate?: string | null) => {
    const key = mechanicVehicleKey(vehicle, plate);
    const existing = rows.get(key);
    if (existing) return existing;
    const created = emptyMechanicVehicleRow(vehicle, plate);
    rows.set(key, created);
    return created;
  };

  for (const task of [...tasks].sort((left, right) => mechanicTaskPriority(left) - mechanicTaskPriority(right))) {
    const row = ensure(task.vehicle, task.plate);
    row.workCount += 1;
    if (isDone(task.status)) row.completedWorkCount += 1;
    else row.unfinishedWorkCount += 1;
    if (!row.task || mechanicTaskPriority(task) < mechanicTaskPriority(row.task)) row.task = task;
  }

  for (const appointment of appointments) {
    const row = ensure(appointment.vehicle, appointment.plate);
    if (!row.appointment || new Date(appointment.plannedStartAt).getTime() < new Date(row.appointment.plannedStartAt).getTime()) {
      row.appointment = appointment;
    }
    row.plannedStarts.push(appointment.plannedStartAt);
  }

  for (const diagnostic of diagnostics) {
    const row = ensure(diagnostic.vehicle.label, diagnostic.vehicle.plateNumber);
    row.hasDiagnostic = true;
    if (!row.diagnostic || new Date(diagnostic.plannedStartAt).getTime() < new Date(row.diagnostic.plannedStartAt).getTime()) {
      row.diagnostic = diagnostic;
    }
    row.plannedStarts.push(diagnostic.plannedStartAt);
  }

  for (const repairCase of repairCases) {
    const row = ensure(repairCase.vehicle.label, repairCase.vehicle.plateNumber);
    row.hasActiveRepairCase = true;
    if (repairCase.diagnostic) row.hasDiagnostic = true;
    if (repairCase.appointment) row.plannedStarts.push(repairCase.appointment.plannedStartAt);
  }

  return finalizeMechanicVehicleRows(rows);
}

function vehicleRowSummary(row: MechanicVehicleRow) {
  if (row.hasDiagnostic && row.workCount > 0) return `Діагностика + Робіт: ${row.workCount}`;
  if (row.hasDiagnostic) return "Діагностика";
  if (row.workCount > 0) return `Робіт: ${row.workCount}`;
  return "Запланована робота";
}

function vehicleRowStatusLabel(row: MechanicVehicleRow) {
  if (row.state === "OVERDUE") return "Протерміновано";
  if (row.state === "DONE") return "Виконано";
  const today = kyivDateKey(new Date());
  if (row.plannedStarts.some((value) => kyivDateKey(value) === today && new Date(value).getTime() >= Date.now())) return "Сьогодні";
  if (row.plannedStarts.some((value) => kyivDateKey(value) > today)) return "Заплановано";
  return "Очікує";
}

function matchesVehicleRowFilter(row: MechanicVehicleRow, filter: WorksFilter) {
  if (filter === "ALL") return true;
  if (filter === "OVERDUE") return row.state === "OVERDUE";
  const today = kyivDateKey(new Date());
  if (filter === "TODAY") return row.plannedStarts.some((value) => kyivDateKey(value) === today);
  return row.state !== "OVERDUE" && row.plannedStarts.some((value) => kyivDateKey(value) > today);
}

function BottomNav({ screen, onChange }: { screen: Screen; onChange: (screen: Screen) => void }) {
  const workActive = ["WORKS", "WORK_DETAIL", "STOP", "ADDITIONAL_WORK", "FINDING", "SUPPORT"].includes(screen);
  return <nav className={styles.bottomNav} aria-label="Навігація механіка">
    <button type="button" className={screen === "HOME" ? styles.navActive : ""} onClick={() => onChange("HOME")}><span>⌂</span><b>Головна</b></button>
    <button
      type="button"
      className={styles.scanButton}
      onClick={() => window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-scanner"))}
      aria-label="Сканувати номер автомобіля"
    >
      <span>▣</span><b>Сканувати</b>
    </button>
    <button type="button" className={workActive ? styles.navActive : ""} onClick={() => onChange("WORKS")}><span>▤</span><b>Роботи</b></button>
  </nav>;
}

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return <header className={styles.topBar}>
    <button type="button" onClick={onBack} aria-label="Назад">‹</button>
    <strong>{title}</strong>
    <span />
  </header>;
}

function MechanicNotificationPopup({
  notification,
  onOpen,
  onRead,
  onDelete,
}: {
  notification: MechanicNotification;
  onOpen: (notification: MechanicNotification) => void;
  onRead: (notificationId: string) => Promise<void>;
  onDelete: (notificationId: string) => Promise<void>;
}) {
  const [startX, setStartX] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState(false);

  function beginSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (deleting || (event.pointerType === "mouse" && event.button !== 0)) return;
    setStartX(event.clientX);
    setOffset(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (startX === null || deleting) return;
    setOffset(Math.max(-132, Math.min(0, event.clientX - startX)));
  }

  function finishSwipe() {
    if (startX === null || deleting) return;
    const shouldDelete = offset <= -76;
    setStartX(null);
    if (!shouldDelete) {
      setOffset(0);
      return;
    }
    setDeleting(true);
    setOffset(-520);
    void onDelete(notification.id).catch(() => {
      setDeleting(false);
      setOffset(0);
    });
  }

  return <div className={styles.notificationPopupWrap}>
    <div className={styles.notificationPopupDelete} aria-hidden="true">Видалити</div>
    <article
      className={styles.notificationPopup}
      style={{ transform: `translateX(${offset}px)` }}
      role="status"
      aria-label={`Нове сповіщення: ${notification.title}`}
      onPointerDown={beginSwipe}
      onPointerMove={moveSwipe}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
    >
      <div className={styles.notificationPopupTop}>
        <strong>Нове сповіщення</strong>
        <div className={styles.notificationPopupTopActions}>
          <time>{notificationTime(notification.createdAt)}</time>
          <button
            type="button"
            aria-label="Закрити сповіщення"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void onRead(notification.id)}
          >×</button>
        </div>
      </div>
      <strong className={styles.notificationPopupTitle}>{notification.title}</strong>
      <p>{notification.body || "Оновлено дані призначення."}</p>
      <div className={styles.notificationPopupBottom}>
        <span>{notification.vehicle} · {notification.plate}</span>
        <button
          type="button"
          disabled={deleting}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onOpen(notification)}
        >Відкрити</button>
      </div>
      <small>Змахніть вліво, щоб видалити</small>
    </article>
  </div>;
}

export function MechanicStandaloneCabinet({ userName }: { userName?: string | null }) {
  const [home, setHome] = useState<HomePayload | null>(null);
  const [tasks, setTasks] = useState<MechanicTask[]>([]);
  const [repairCases, setRepairCases] = useState<RepairCase[]>([]);
  const [repairCaseKpis, setRepairCaseKpis] = useState<RepairCaseFeed["kpis"] | null>(null);
  const [taskKpis, setTaskKpis] = useState<TaskFeed["kpis"] | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [processCards, setProcessCards] = useState<MechanicProcessCard[]>([]);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [notificationFeed, setNotificationFeed] = useState<NotificationFeed | null>(null);
  const [screen, setScreen] = useState<Screen>("HOME");
  const [worksFilter, setWorksFilter] = useState<WorksFilter>("ALL");
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("ALL");
  const [scheduleBackScreen, setScheduleBackScreen] = useState<Screen>("PROFILE");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [findingText, setFindingText] = useState("");
  const [findingRecommendation, setFindingRecommendation] = useState("");
  const [findingUrgency, setFindingUrgency] = useState<FindingUrgency>("INFO");
  const [findingFiles, setFindingFiles] = useState<File[]>([]);
  const [supportKind, setSupportKind] = useState<SupportKind>("QUESTION");
  const [supportText, setSupportText] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [showExecutionIssue, setShowExecutionIssue] = useState(false);
  const [showPlateVerification, setShowPlateVerification] = useState(false);
  const [stopReason, setStopReason] = useState<StopReason>("PARTS_UNAVAILABLE");
  const [stopNote, setStopNote] = useState("");
  const [additionalWorkDescription, setAdditionalWorkDescription] = useState("");
  const [additionalWorkHours, setAdditionalWorkHours] = useState("");
  const [additionalWorkNote, setAdditionalWorkNote] = useState("");

  const loadHome = useCallback(async () => {
    const response = await fetch("/api/cabinet/home", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as HomePayload | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося відкрити кабінет механіка");
    setHome(body);
    if (body.tasks) setTasks(body.tasks);
  }, []);

  const loadTasks = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/tasks", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as TaskFeed | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити роботи");
    if (body.linked) {
      setTasks(body.items ?? []);
      setTaskKpis(body.kpis ?? null);
    }
  }, []);

  const loadRepairCases = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/repair-cases", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as RepairCaseFeed | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити ремонтні справи");
    if (body.linked) {
      setRepairCases(body.cases ?? []);
      setRepairCaseKpis(body.kpis ?? null);
    }
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const response = await fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setDiagnostics(body.items ?? []);
  }, []);

  const loadProcessCards = useCallback(async () => {
    const response = await fetch("/api/cabinet/mechanic/process-cards", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as MechanicProcessFeed | null;
    if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити історію діагностик і ремонтів");
    if (body.linked) setProcessCards(body.items ?? []);
  }, []);

  const loadNotifications = useCallback(async () => {
    const [notificationsResponse, findingsResponse] = await Promise.all([
      fetch("/api/cabinet/mechanic/notifications", { cache: "no-store", credentials: "include" }),
      fetch("/api/cabinet/mechanic/findings", { cache: "no-store", credentials: "include" }),
    ]);
    const [notificationsBody, findingsBody] = await Promise.all([
      notificationsResponse.json().catch(() => null) as Promise<NotificationFeed | null>,
      findingsResponse.json().catch(() => null),
    ]);
    if (!notificationsResponse.ok || !notificationsBody?.ok) {
      throw new Error(notificationsBody?.message || notificationsBody?.error || "Не вдалося завантажити сповіщення");
    }
    setNotificationFeed(notificationsBody);
    if (findingsResponse.ok && findingsBody?.ok) setClarifications(findingsBody.items ?? []);
  }, [])  const loadPayroll = useCallback(async () => {
    const response = await fetch("/api/me/compensation", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null) as Payroll | null;
    if (!response.ok || !body?.ok) throw new Error((body as { message?: string; error?: string } | null)?.message || (body as { message?: string; error?: string } | null)?.error || "Не вдалося завантажити зарплату");
    setPayroll(body);
    return body;
  }, []);

;

  useEffect(() => {
    const stored = window.localStorage.getItem("turbolev:mechanic-theme");
    if (stored === "light" || stored === "dark" || stored === "system") setThemeChoice(stored);
    void Promise.all([loadHome(), loadTasks(), loadRepairCases(), loadDiagnostics(), loadProcessCards(), loadNotifications(), loadPayroll()]).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося завантажити кабінет"));
  }, [loadDiagnostics, loadHome, loadNotifications, loadPayroll, loadProcessCards, loadRepairCases, loadTasks]);

  useEffect(() => startAdaptivePoller({
    run: () => loadNotifications().catch(() => undefined),
    intervalMs: 30_000,
    immediate: false,
    pauseWhenHidden: true,
    runOnFocus: true,
  }), [loadNotifications]);

  useEffect(() => {
    const onOpenDiagnostic = (event: Event) => {
      const diagnosticId = (event as CustomEvent<{ diagnosticId?: string }>).detail?.diagnosticId;
      if (diagnosticId) openDiagnostic(diagnosticId);
    };
    const onOpenTask = (event: Event) => {
      const taskId = (event as CustomEvent<{ taskId?: string }>).detail?.taskId;
      const task = taskId ? tasks.find((item) => item.id === taskId) : null;
      if (task) openTask(task);
      else { setWorksFilter("ALL"); setScreen("WORKS"); }
    };
    const onResumeTask = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string; recognizedPlate?: string }>).detail;
      const task = detail?.taskId ? tasks.find((item) => item.id === detail.taskId) : null;
      if (!task) {
        setWorksFilter("ALL");
        setScreen("WORKS");
        setError("Роботу для продовження не знайдено. Оновіть список робіт.");
        return;
      }
      openTask(task);
      void resumeTaskAfterScan(task, detail?.recognizedPlate || task.plate);
    };
    const onRefresh = () => { void Promise.all([loadHome(), loadTasks(), loadRepairCases(), loadDiagnostics(), loadProcessCards()]).catch(() => undefined); };
    window.addEventListener("turbolev:mechanic-open-diagnostic", onOpenDiagnostic);
    window.addEventListener("turbolev:mechanic-open-task", onOpenTask);
    window.addEventListener("turbolev:mechanic-resume-task", onResumeTask);
    window.addEventListener("turbolev:mechanic-refresh", onRefresh);
    return () => {
      window.removeEventListener("turbolev:mechanic-open-diagnostic", onOpenDiagnostic);
      window.removeEventListener("turbolev:mechanic-open-task", onOpenTask);
      window.removeEventListener("turbolev:mechanic-resume-task", onResumeTask);
      window.removeEventListener("turbolev:mechanic-refresh", onRefresh);
    };
  }, [loadDiagnostics, loadHome, loadProcessCards, loadRepairCases, loadTasks, tasks]);

  const appointments = home?.appointments ?? [];
  const mechanicActionableAppointmentStatuses = new Set(["BOOKED", "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "PAUSED"]);
  const scheduledAppointments = appointments.filter((item) => item.purpose !== "DIAGNOSTICS" && mechanicActionableAppointmentStatuses.has(item.status));
  const prioritizedScheduledAppointments = [...scheduledAppointments].sort(appointmentPriority);
  const nextScheduledAppointment = prioritizedScheduledAppointments[0] ?? null;
  const selectedTask = tasks.find((item) => item.id === selectedTaskId) ?? null;
  const selectedRepairCase = selectedTask ? repairCases.find((item) => item.workOrderId === selectedTask.workOrderId) ?? null : null;
  const selectedOrderTasks = selectedRepairCase?.lines ?? (selectedTask ? tasks.filter((item) => item.workOrderId === selectedTask.workOrderId) : []);
  const selectedAppointment = selectedTask ? appointmentForTask(selectedTask, appointments) : null;
  const nextRepairTask = [...repairCases]
    .filter((item) => item.appointment)
    .sort((a, b) => {
      const aAppointment = a.appointment!;
      const bAppointment = b.appointment!;
      const aOverdue = isAppointmentOverdue({ id: aAppointment.id, workOrderId: a.workOrderId, status: aAppointment.status, workOrderStatus: a.status, plannedStartAt: aAppointment.plannedStartAt, plannedEndAt: aAppointment.plannedEndAt, plate: a.vehicle.plateNumber || "—", vehicle: a.vehicle.label, problem: aAppointment.problem, post: aAppointment.post });
      const bOverdue = isAppointmentOverdue({ id: bAppointment.id, workOrderId: b.workOrderId, status: bAppointment.status, workOrderStatus: b.status, plannedStartAt: bAppointment.plannedStartAt, plannedEndAt: bAppointment.plannedEndAt, plate: b.vehicle.plateNumber || "—", vehicle: b.vehicle.label, problem: bAppointment.problem, post: bAppointment.post });
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return new Date(aAppointment.plannedStartAt).getTime() - new Date(bAppointment.plannedStartAt).getTime();
    })
    .map((item) => {
      const line = item.lines.find((candidate) => candidate.assignedToCurrentMechanic && !isDone(candidate.status));
      return line ? tasks.find((candidate) => candidate.id === line.id) ?? null : null;
    })
    .find((item): item is MechanicTask => Boolean(item)) ?? null;
  const activeTask = tasks.find((item) => item.status === "IN_PROGRESS" || item.status === "PAUSED" || item.status === "STOPPED") ?? nextRepairTask;
  const activeTaskAppointment = activeTask ? appointmentForTask(activeTask, appointments) : null;
  const currentPost = activeTaskAppointment?.post || nextScheduledAppointment?.post || null;
  const assignedCases = home?.kpis?.assigned ?? appointments.length;
  const inProgress = repairCaseKpis?.inRepair ?? ((taskKpis?.inProgress ?? tasks.filter((item) => item.status === "IN_PROGRESS").length) + (taskKpis?.paused ?? tasks.filter((item) => item.status === "PAUSED").length));
  const completed = repairCaseKpis?.completedToday ?? taskKpis?.completedToday ?? tasks.filter((item) => isDone(item.status)).length;
  const notificationCount = notificationFeed?.unreadCount ?? 0;
  const mechanicName = userName || home?.mechanic?.name || "Автомеханік";
  const homeProcessCards = processCards;
  const visibleProcessCards = processCards.filter((card) => {
    if (worksFilter === "ALL") return true;
    if (worksFilter === "OVERDUE") return card.state === "OVERDUE";
    if (!card.plannedStartAt) return false;
    const today = kyivDateKey(new Date());
    const planned = kyivDateKey(card.plannedStartAt);
    if (worksFilter === "TODAY") return planned === today;
    return card.state !== "OVERDUE" && planned > today;
  });
  const todayKyivKey = kyivDateKey(new Date());
  const visibleScheduleAppointments = (scheduleFilter === "TODAY"
    ? appointments.filter((item) => kyivDateKey(item.plannedStartAt) === todayKyivKey)
    : [...appointments]).sort(appointmentPriority);
  const nextAppointmentOverdue = activeTaskAppointment
    ? isAppointmentOverdue(activeTaskAppointment)
    : nextScheduledAppointment ? isAppointmentOverdue(nextScheduledAppointment) : false;
  const selectedTaskOverdue = Boolean(selectedAppointment && isAppointmentOverdue(selectedAppointment));

  const overdueCardStyle = {
    background: "var(--m-danger-soft)",
    borderColor: "color-mix(in srgb,var(--m-danger) 48%,var(--m-border))",
    boxShadow: "inset 4px 0 0 var(--m-danger), 0 7px 22px rgba(18,31,44,.055)",
  };
  const overduePillStyle = {
    background: "var(--m-danger-soft)",
    color: "var(--m-danger)",
    border: "1px solid color-mix(in srgb,var(--m-danger) 45%,var(--m-border))",
  };

  const worksHeading = worksFilter === "OVERDUE"
    ? { title: "Протерміновані", description: "Автомобілі, у яких є хоча б одна незавершена прострочена дія.", empty: "Протермінованих автомобілів немає." }
    : worksFilter === "TODAY"
      ? { title: "Сьогодні", description: "Автомобілі із запланованими діями на сьогодні.", empty: "На сьогодні автомобілів немає." }
      : worksFilter === "FUTURE"
        ? { title: "Майбутні", description: "Автомобілі із запланованими діями після сьогодні.", empty: "Майбутніх автомобілів немає." }
        : { title: "Мої автомобілі", description: "Кожна діагностика та кожен ремонт — окрема картка зі своєю історією.", empty: "Записів по автомобілях немає." };
  const scheduleHeading = scheduleFilter === "TODAY"
    ? { title: "Заплановано на сьогодні", description: "Ваші закріплення на поточний день за київським часом.", empty: "На сьогодні закріплень немає." }
    : { title: "Активні закріплення", description: "Авто залишаються тут до завершення сервісного випадку.", empty: "Активних закріплень немає." };

  function changeTheme(next: ThemeChoice) {
    setThemeChoice(next);
    window.localStorage.setItem("turbolev:mechanic-theme", next);
  }

  function openWorks(filter: WorksFilter) {
    setWorksFilter(filter);
    setScreen("WORKS");
    setError("");
    setMessage("");
  }

  function openSchedule(filter: ScheduleFilter, backScreen: Screen) {
    setScheduleFilter(filter);
    setScheduleBackScreen(backScreen);
    setScreen("SCHEDULE");
    setError("");
    setMessage("");
  }

  function openTask(task: MechanicTask) {
    setSelectedTaskId(task.id);
    setScreen("WORK_DETAIL");
    setError("");
    setMessage("");
    setShowExecutionIssue(false);
    if (task.stopReason && task.stopReason in stopReasonLabel) setStopReason(task.stopReason as StopReason);
    setStopNote(task.stopNote || "");
  }

  function openAppointment(appointment: Appointment) {
    const task = appointment.workOrderId
      ? tasks.find((candidate) => candidate.workOrderId === appointment.workOrderId && !isDone(candidate.status))
      : null;
    if (task) openTask(task);
    else openScannedVehicle(appointment.plate);
  }

  function openProcessCard(card: MechanicProcessCard) {
    if (card.processType === "DIAGNOSTIC" && card.diagnosticId) {
      openDiagnostic(card.diagnosticId);
      return;
    }

    if (card.processType === "REPAIR") {
      const directTask = card.taskId ? tasks.find((item) => item.id === card.taskId) : null;
      const orderTask = card.workOrderId ? tasks.find((item) => item.workOrderId === card.workOrderId && !isDone(item.status))
        ?? tasks.find((item) => item.workOrderId === card.workOrderId) : null;
      if (directTask || orderTask) {
        openTask(directTask || orderTask!);
        return;
      }
      const repairCase = card.workOrderId ? repairCases.find((item) => item.workOrderId === card.workOrderId) : null;
      if (repairCase) {
        openRepairCase(repairCase);
        return;
      }
      setMessage(card.state === "DONE"
        ? "Цей ремонт уже завершено. Картка збережена в історії."
        : "Ремонт заплановано, але окрема операція механіку ще не призначена.");
    }
  }

  function openScannedVehicle(plate: string | null | undefined, resumeTaskId?: string) {
    const expectedPlate = plate?.trim();
    if (!expectedPlate || expectedPlate === "—") {
      setError("Для цього автомобіля немає державного номера для сканування.");
      return;
    }
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-scanner", {
      detail: { expectedPlate, resumeTaskId: resumeTaskId || undefined },
    }));
  }

  function openRepairCase(item: RepairCase) {
    const preferredLine = item.lines.find((line) => line.assignedToCurrentMechanic && line.status === "IN_PROGRESS")
      ?? item.lines.find((line) => line.assignedToCurrentMechanic && line.status === "APPROVED")
      ?? item.lines.find((line) => line.assignedToCurrentMechanic && line.status === "DRAFT")
      ?? item.lines.find((line) => line.assignedToCurrentMechanic);
    const task = preferredLine ? tasks.find((candidate) => candidate.id === preferredLine.id) : null;
    if (task) openTask(task);
    else {
      setError("Для цього автомобіля ще не призначено окрему операцію механіку.");
      setWorksFilter("ALL");
      setScreen("WORKS");
    }
  }

  function openDiagnostic(diagnosticId: string) {
    setSelectedDiagnosticId(diagnosticId);
    setScreen("DIAGNOSTIC_DETAIL");
    setError("");
    setMessage("");
  }

  function returnToHomeAfterDiagnostic() {
    setSelectedDiagnosticId(null);
    setScreen("HOME");
    setError("");
    setMessage("");
    void Promise.all([loadDiagnostics(), loadProcessCards(), loadHome(), loadTasks(), loadRepairCases()]).catch(() => undefined);
  }

  async function runAction(action: WorkAction, options: {
    reason?: string;
    reasonCode?: StopReason;
    note?: string;
    verifiedPlate?: string;
    verifiedByScan?: boolean;
    confirm?: boolean;
  } = {}) {
    if (!selectedTask) return;
    if (action === "COMPLETE" && options.confirm !== false && !window.confirm("Завершити цю роботу?")) return;
    const reason = options.reason || (action === "PAUSE"
      ? window.prompt("Чому ставите роботу на паузу?", selectedTask.pauseNote || "") ?? ""
      : action === "WAITING_PARTS"
        ? window.prompt("Яка запчастина потрібна?", "") ?? ""
        : "");
    if ((action === "PAUSE" || action === "WAITING_PARTS") && !reason.trim()) return;
    setBusy(action); setError("");
    try {
      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(selectedTask.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(options.reasonCode ? { reasonCode: options.reasonCode } : {}),
          ...(options.note ? { note: options.note.trim() } : {}),
          ...(options.verifiedPlate ? { verifiedPlate: options.verifiedPlate } : {}),
          ...(options.verifiedByScan ? { verifiedByScan: true } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити роботу");
      await Promise.all([loadTasks(), loadRepairCases(), loadProcessCards(), loadHome()]);
      setMessage(action === "START"
        ? "Роботу розпочато."
        : action === "PAUSE"
          ? "Роботу поставлено на паузу."
          : action === "STOP"
            ? "Роботу зупинено. Сервіс-менеджера повідомлено."
            : action === "RESUME"
              ? "Роботу продовжено."
              : action === "WAITING_PARTS" ? "Роботу призупинено: очікується запчастина." : "Роботу завершено.");
      if (action === "STOP" || action === "RESUME" || action === "COMPLETE") setScreen("WORK_DETAIL");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося оновити роботу"); }
    finally { setBusy(""); }
  }

  async function resumeTaskAfterScan(task: MechanicTask, recognizedPlate: string) {
    setSelectedTaskId(task.id);
    setScreen("WORK_DETAIL");
    setBusy("resume-scan");
    setError("");
    try {
      const verificationResponse = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(task.id)}/verify-plate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recognizedPlate, verificationMethod: "CAMERA" }),
      });
      const verification = await verificationResponse.json().catch(() => null);
      if (!verificationResponse.ok || !verification?.ok) throw new Error(verification?.message || verification?.error || "Номер автомобіля не підтверджено.");

      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESUME", verifiedPlate: recognizedPlate, verifiedByScan: true }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося продовжити роботу.");
      await Promise.all([loadTasks(), loadRepairCases(), loadProcessCards(), loadHome(), loadNotifications()]);
      setMessage("Автомобіль підтверджено. Роботу продовжено.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося продовжити роботу.");
    } finally {
      setBusy("");
    }
  }

  async function submitAdditionalWork() {
    if (!selectedTask) return;
    if (additionalWorkDescription.trim().length < 3) {
      setError("Опишіть, яку додаткову роботу потрібно виконати.");
      return;
    }
    setBusy("additional-work");
    setError("");
    try {
      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(selectedTask.id)}/additional-work`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: additionalWorkDescription.trim(),
          laborHours: additionalWorkHours.trim() || undefined,
          note: additionalWorkNote.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати додаткову роботу.");
      setAdditionalWorkDescription("");
      setAdditionalWorkHours("");
      setAdditionalWorkNote("");
      await Promise.all([loadTasks(), loadRepairCases(), loadProcessCards(), loadHome(), loadNotifications()]);
      setScreen("WORK_DETAIL");
      setMessage(body.message || "Додаткову роботу передано на погодження.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося передати додаткову роботу.");
    } finally {
      setBusy("");
    }
  }

  async function submitFinding() {
    if (!selectedTask) return;
    if (findingText.trim().length < 3 || !findingFiles.length) { setError("Опишіть несправність і додайте хоча б одне фото."); return; }
    setBusy("finding"); setError("");
    try {
      const form = new FormData();
      form.append("lineId", selectedTask.id);
      form.append("findingText", findingText.trim());
      form.append("recommendation", findingRecommendation.trim());
      form.append("urgency", findingUrgency);
      findingFiles.forEach((file) => form.append("photos", file));
      const response = await fetch("/api/cabinet/mechanic/findings", { method: "POST", credentials: "include", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати несправність");
      setFindingText(""); setFindingRecommendation(""); setFindingFiles([]); setFindingUrgency("INFO");
      await Promise.all([loadTasks(), loadNotifications()]);
      setScreen("WORK_DETAIL"); setMessage(body.message || "Несправність передано сервіс-менеджеру.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося передати несправність"); }
    finally { setBusy(""); }
  }

  async function submitSupport() {
    if (!selectedTask || supportText.trim().length < 3) { setError("Опишіть запит."); return; }
    setBusy("support"); setError("");
    try {
      const response = await fetch("/api/cabinet/mechanic/support", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: selectedTask.id, kind: supportKind, text: supportText.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати запит");
      if (supportKind === "PART_REQUEST" && selectedTask.status === "IN_PROGRESS") {
        const statusResponse = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(selectedTask.id)}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "WAITING_PARTS", reason: supportText.trim() }),
        });
        const statusBody = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok || !statusBody?.ok) throw new Error(statusBody?.message || statusBody?.error || "Запит передано, але статус не оновлено");
        await Promise.all([loadTasks(), loadRepairCases(), loadProcessCards(), loadHome()]);
      }
      setSupportText(""); setScreen("WORK_DETAIL"); setMessage(supportKind === "PART_REQUEST" ? "Запчастину запитано. Роботу переведено в очікування." : body.message || "Запит передано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося передати запит"); }
    finally { setBusy(""); }
  }

  async function markNotification(notificationId: string) {
    const wasUnread = notificationFeed?.items.some((item) => item.id === notificationId && !item.readAt) ?? false;
    if (wasUnread) {
      const now = new Date().toISOString();
      setNotificationFeed((current) => current ? {
        ...current,
        unreadCount: Math.max(0, current.unreadCount - 1),
        items: current.items.map((item) => item.id === notificationId ? { ...item, readAt: now } : item),
      } : current);
    }
    try {
      const response = await fetch("/api/cabinet/mechanic/notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося позначити сповіщення");
    } catch (cause) {
      await loadNotifications().catch(() => undefined);
      throw cause;
    }
  }

  async function markAllNotifications() {
    if (!notificationCount) return;
    setBusy("notifications:all"); setError("");
    const now = new Date().toISOString();
    setNotificationFeed((current) => current ? {
      ...current,
      unreadCount: 0,
      items: current.items.map((item) => item.readAt ? item : { ...item, readAt: now }),
    } : current);
    try {
      const response = await fetch("/api/cabinet/mechanic/notifications", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити сповіщення");
    } catch (cause) {
      await loadNotifications().catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "Не вдалося оновити сповіщення");
    } finally {
      setBusy("");
    }
  }

  async function deleteNotification(notificationId: string) {
    const deleted = notificationFeed?.items.find((item) => item.id === notificationId);
    if (!deleted) return;
    setNotificationFeed((current) => current ? {
      ...current,
      unreadCount: deleted.readAt ? current.unreadCount : Math.max(0, current.unreadCount - 1),
      items: current.items.filter((item) => item.id !== notificationId),
    } : current);
    try {
      const response = await fetch(`/api/cabinet/mechanic/notifications?notificationId=${encodeURIComponent(notificationId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; unreadCount?: number; message?: string; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося видалити сповіщення");
      if (typeof body.unreadCount === "number") {
        setNotificationFeed((current) => current ? { ...current, unreadCount: body.unreadCount! } : current);
      }
    } catch (cause) {
      await loadNotifications().catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "Не вдалося видалити сповіщення");
      throw cause;
    }
  }

  async function openNotification(item: MechanicNotification) {
    if (!item.readAt) await markNotification(item.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося оновити сповіщення"));
    const assignmentId = typeof item.payload?.assignmentId === "string" ? item.payload.assignmentId : null;
    const task = assignmentId ? tasks.find((candidate) => candidate.id === assignmentId) : null;
    if (task) {
      openTask(task);
      return;
    }
    if (item.type !== "UNASSIGNED") {
      if (item.appointmentId) openSchedule("ALL", "NOTIFICATIONS");
      else openWorks("ALL");
    }
  }

  async function replyClarification(item: Clarification) {
    const reply = (replyDrafts[item.id] || "").trim();
    if (reply.length < 3) return;
    setBusy(`reply:${item.id}`); setError("");
    try {
      const response = await fetch("/api/cabinet/mechanic/findings", {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: item.id, reply }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося передати відповідь");
      setReplyDrafts((current) => ({ ...current, [item.id]: "" }));
      await loadNotifications(); setMessage(body.message || "Відповідь передано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося передати відповідь"); }
    finally { setBusy(""); }
  }

  async function openPayroll() {
    setScreen("PAYROLL"); setError("");
    try { await loadPayroll(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося завантажити зарплату"); }
  }

  async function signOut() {
    if (busy === "logout") return;
    setBusy("logout"); setError("");
    await Promise.allSettled([
      fetch("/api/auth/local/sign-out", { method: "POST", credentials: "include" }),
      neonAuthClient.signOut(),
    ]);
    window.location.assign("/auth/sign-in?next=/");
  }

  if (!home) return <div className={styles.loading} data-theme-choice={themeChoice}><strong>ТУРБО <b>ЛЕВ</b></strong><span>Завантажую кабінет механіка…</span></div>;
  if (!home.linked || !home.mechanic) return <div className={styles.loading} data-theme-choice={themeChoice}><strong>Кабінет механіка не прив’язаний</strong><span>Призначте працівнику станцію та роль «Автомеханік».</span></div>;

  const popupNotifications = (notificationFeed?.items ?? []).filter((item) => !item.readAt).slice(0, 3);

  return <div className={styles.app} data-theme-choice={themeChoice} data-mechanic-cabinet="true">
    <div className={styles.shell}>
      {popupNotifications.length > 0 && <aside className={styles.notificationPopups} aria-label="Нові сповіщення">
        {popupNotifications.map((notification) => <MechanicNotificationPopup key={notification.id} notification={notification} onOpen={(item) => void openNotification(item)} onRead={markNotification} onDelete={deleteNotification} />)}
      </aside>}
      {screen === "HOME" && <>
        <header className={styles.hero}>
          <div><div style={{ display: "flex", alignItems: "center", gap: 10 }}><img data-crm-logo-slot="mechanic" data-crm-default-src="/brand/turbolev-logo.png" src="/brand/turbolev-logo.png" alt="Turbo LEV" style={{ width: 44, height: 34, objectFit: "contain" }} /><div className={styles.brand}><span>ТУРБО</span> <b>ЛЕВ</b></div></div><small>Кабінет механіка · {firstName(mechanicName)}</small></div>
          <button type="button" className={styles.iconButton} onClick={() => setScreen("NOTIFICATIONS")} aria-label="Сповіщення">◉{notificationCount > 0 && <em>{notificationCount}</em>}</button>
        </header>
        <main className={styles.content}>
          <section><div className={styles.sectionHead}><div><h2>{activeTask?.status === "IN_PROGRESS" ? "Поточна робота" : activeTask?.status === "PAUSED" ? "Робота на паузі" : nextAppointmentOverdue ? "Протермінована робота" : "Наступна робота"}</h2><p>За даними планувальника</p></div></div>{activeTask ? <article className={`${styles.taskHero} ${nextAppointmentOverdue ? styles.vehicleCardOverdue : styles.vehicleCardPending}`}><div className={styles.taskTop}><div><h3>{activeTask.vehicle}</h3><p>{activeTask.plate}</p></div><span className={`${styles.pill} ${nextAppointmentOverdue ? styles.vehicleStatusOverdue : styles.warn}`}>{nextAppointmentOverdue ? "Протерміновано" : statusLabel[activeTask.status] || activeTask.status}</span></div><strong>🔧 {activeTask.description}</strong><div className={styles.meta}><span>Пост <b>{activeTaskAppointment?.post || "—"}</b></span><span>Час <b>{time(activeTaskAppointment?.plannedStartAt)}</b></span></div><button type="button" className={styles.primary} onClick={() => openTask(activeTask)}>Відкрити роботу →</button></article> : nextScheduledAppointment ? <article className={`${styles.taskHero} ${nextAppointmentOverdue ? styles.vehicleCardOverdue : styles.vehicleCardPending}`}><div className={styles.taskTop}><div><h3>{nextScheduledAppointment.vehicle}</h3><p>{nextScheduledAppointment.plate}</p></div><span className={`${styles.pill} ${nextAppointmentOverdue ? styles.vehicleStatusOverdue : styles.warn}`}>{nextAppointmentOverdue ? "Протерміновано" : kyivDateKey(nextScheduledAppointment.plannedStartAt) === kyivDateKey(new Date()) ? "Сьогодні" : "Заплановано"}</span></div><strong>🔧 {nextScheduledAppointment.problem || "Запис на СТО"}</strong><div className={styles.meta}><span>Пост <b>{nextScheduledAppointment.post || "—"}</b></span><span>Час <b>{time(nextScheduledAppointment.plannedStartAt)}</b></span></div><button type="button" className={styles.primary} onClick={() => openAppointment(nextScheduledAppointment)}>{nextAppointmentOverdue ? "Відкрити роботу →" : "Почати роботу →"}</button></article> : <div className={styles.empty}>Активних робіт немає.</div>}</section>
          <section className={styles.card}><div className={styles.sectionHead}><div><h2>Мій заробіток</h2><p>Нарахування оновлюються після виконаних робіт</p></div><button type="button" className={styles.textButton} onClick={() => void openPayroll()}>Детально ›</button></div><div className={styles.earningsGrid}><div><span>Сьогодні</span><strong>{money(payroll?.today?.accrued)}</strong></div><div><span>Цей місяць</span><strong>{money(payroll?.month?.accrued)}</strong></div><div><span>До виплати</span><strong>{money(payroll?.balance?.due)}</strong></div></div></section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Мої автомобілі</h2><p>Діагностика і ремонт — окремі картки</p></div><button type="button" className={styles.textButton} onClick={() => openWorks("ALL")}>Всі авто ›</button></div><div className={styles.compactList}>{homeProcessCards.slice(0, 4).map((card) => <button type="button" data-vehicle-card="true" data-vehicle-state={card.state} className={`${styles.vehicleRow} ${card.state === "OVERDUE" ? styles.vehicleCardOverdue : card.state === "DONE" ? styles.vehicleCardDone : styles.vehicleCardPending}`} key={card.id} onClick={() => openProcessCard(card)}><div><strong data-vehicle-title="true">{card.vehicle}</strong><small data-vehicle-plate="true" className={styles.plateLine}>{card.plate}</small><small data-vehicle-summary="true">{card.summary}</small></div><span data-vehicle-status="true" className={`${styles.pill} ${styles.vehicleRowStatus} ${card.state === "OVERDUE" ? styles.vehicleStatusOverdue : card.state === "DONE" ? styles.good : styles.warn}`}>{card.statusLabel}</span></button>)}</div>{!homeProcessCards.length && <div className={styles.emptyInline}>Записів по автомобілях немає.</div>}</section>
        </main>
      </>}

      {screen === "WORKS" && <><TopBar title="Мої автомобілі" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>{worksHeading.title}</h1><p>{worksHeading.description}</p></div><div className={styles.filterBar} role="group" aria-label="Фільтр робіт"><button type="button" className={worksFilter === "ALL" ? styles.filterActive : ""} aria-pressed={worksFilter === "ALL"} onClick={() => setWorksFilter("ALL")}>Усі</button><button type="button" className={worksFilter === "OVERDUE" ? styles.filterActive : ""} aria-pressed={worksFilter === "OVERDUE"} onClick={() => setWorksFilter("OVERDUE")}>Протерміновані</button><button type="button" className={worksFilter === "TODAY" ? styles.filterActive : ""} aria-pressed={worksFilter === "TODAY"} onClick={() => setWorksFilter("TODAY")}>Сьогодні</button><button type="button" className={worksFilter === "FUTURE" ? styles.filterActive : ""} aria-pressed={worksFilter === "FUTURE"} onClick={() => setWorksFilter("FUTURE")}>Майбутні</button></div><div className={styles.stack}>{visibleProcessCards.map((card) => <button type="button" data-vehicle-card="true" data-vehicle-state={card.state} className={`${styles.listCard} ${styles.vehicleRow} ${card.state === "OVERDUE" ? styles.vehicleCardOverdue : card.state === "DONE" ? styles.vehicleCardDone : styles.vehicleCardPending}`} key={card.id} onClick={() => openProcessCard(card)}><div><h3 data-vehicle-title="true">{card.vehicle}</h3><b data-vehicle-plate="true">{card.plate}</b></div><p data-vehicle-summary="true">{card.summary}</p><span data-vehicle-status="true" className={`${styles.pill} ${styles.vehicleRowStatus} ${card.state === "OVERDUE" ? styles.vehicleStatusOverdue : card.state === "DONE" ? styles.good : styles.warn}`}>{card.statusLabel}</span></button>)}</div>{!visibleProcessCards.length && <div className={styles.empty}>{worksHeading.empty}</div>}</main></>}

      {screen === "REPAIR_COMPLETION" && selectedTask && <MechanicRepairCompletion task={selectedTask} onBack={() => setScreen("WORK_DETAIL")} onCompleted={async () => { await runAction("COMPLETE", { confirm: false }); }} />}

      {screen === "WORK_DETAIL" && selectedTask && <><TopBar title="Робота" onBack={() => setScreen("WORKS")} /><main className={styles.content}><section className={styles.card}><div className={styles.taskTop}><div><h2>{selectedTask.vehicle}</h2><p>{selectedTask.plate}</p></div><span className={`${styles.pill} ${selectedTaskOverdue ? "" : statusTone(selectedTask.status)}`} style={selectedTaskOverdue ? overduePillStyle : undefined}>{selectedTaskOverdue ? "Прострочено" : statusLabel[selectedTask.status] || selectedTask.status}</span></div><div className={styles.metaGrid}><span>Пост<b>{selectedAppointment?.post || "—"}</b></span><span>Початок<b>{time(selectedTask.startedAt || selectedAppointment?.plannedStartAt)}</b></span><span>Тривалість<b>{duration(selectedAppointment?.plannedStartAt, selectedAppointment?.plannedEndAt)}</b></span></div>{selectedTaskOverdue && <p className={styles.subtle} style={{ color: "var(--m-danger)", fontWeight: 800 }}>Плановий час уже минув. Робота потребує рішення.</p>}</section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Роботи за комерційною пропозицією</h2><p>{selectedOrderTasks.filter((item) => isDone(item.status)).length} з {selectedOrderTasks.length} виконано</p></div></div><div className={styles.orderLines}>{selectedOrderTasks.map((item) => <div key={item.id}><i className={statusTone(item.status)}>●</i><div><strong>{item.description}</strong><small>{item.laborHours ? `${item.laborHours} нормо-год` : item.type}</small></div><span>{statusLabel[item.status] || item.status}</span></div>)}</div></section>{selectedRepairCase?.parts?.length ? <section className={styles.card}><div className={styles.sectionHead}><div><h2>Запчастини</h2><p>Деталі цієї ремонтної справи</p></div></div><div className={styles.orderLines}>{selectedRepairCase.parts.map((part) => <div key={part.id}><i className={statusTone(part.status)}>●</i><div><strong>{part.description}</strong><small>{[part.brand, part.article].filter(Boolean).join(" · ") || "Запчастина"}</small></div><span>{part.plannedQuantity || "1"} {part.unit} · {statusLabel[part.status] || part.status}</span></div>)}</div></section> : null}<section className={styles.card}><div className={styles.sectionHead}><div><h2>Керування роботою</h2><p>Фіксується в історії замовлення</p></div></div>{selectedTask.status === "APPROVED" && <button className={styles.primary} disabled={Boolean(busy)} onClick={() => setShowPlateVerification(true)}>▶ Почати роботу</button>}{selectedTask.status === "IN_PROGRESS" && <div className={styles.twoButtons}><button className={styles.secondary} disabled={Boolean(busy)} onClick={() => void runAction("PAUSE")}>Ⅱ Пауза</button><button className={styles.successButton} disabled={Boolean(busy)} onClick={() => setScreen("REPAIR_COMPLETION")}>✓ Завершити ремонт</button></div>}{selectedTask.status === "PAUSED" && <div className={styles.twoButtons}><button className={styles.primary} disabled={Boolean(busy)} onClick={() => void runAction("RESUME")}>▶ Продовжити</button><button className={styles.successButton} disabled={Boolean(busy)} onClick={() => setScreen("REPAIR_COMPLETION")}>✓ Завершити ремонт</button></div>}{isDone(selectedTask.status) && <div className={styles.doneBox}>✓ Роботу завершено</div>}{selectedTaskOverdue && <button type="button" className={styles.secondary} style={{ width: "100%", marginTop: 12 }} onClick={() => setShowExecutionIssue(true)}>Не можу виконати роботу</button>}<div className={styles.actionList}><button type="button" onClick={() => setScreen("FINDING")}>📷 Додати фото / виявлений дефект <span>›</span></button><button type="button" onClick={() => { setSupportKind("PART_REQUEST"); setSupportText(""); setScreen("SUPPORT"); }}>⚙ Запросити запчастину <span>›</span></button><button type="button" onClick={() => { setSupportKind("QUESTION"); setSupportText(""); setScreen("SUPPORT"); }}>💬 Поставити питання менеджеру <span>›</span></button></div></section></main>{showExecutionIssue && <MechanicExecutionIssueForm task={selectedTask} onClose={() => setShowExecutionIssue(false)} onSubmitted={(notice) => { setShowExecutionIssue(false); setMessage(notice); void loadNotifications(); }} />}{showPlateVerification && <MechanicTaskPlateVerification task={selectedTask} onClose={() => setShowPlateVerification(false)} onVerified={async () => { setShowPlateVerification(false); await runAction("START"); }} />}</>}

      {screen === "FINDING" && selectedTask && <><TopBar title="Виявлений дефект" onBack={() => setScreen("WORK_DETAIL")} /><main className={styles.content}><section className={styles.card}><h2>{selectedTask.vehicle} · {selectedTask.plate}</h2><p className={styles.subtle}>🔧 {selectedTask.description}</p></section><section className={styles.formCard}><label><span>Що виявлено *</span><textarea value={findingText} onChange={(event) => setFindingText(event.target.value)} rows={4} placeholder="Опишіть дефект або несправність" /></label><label><span>Рекомендація</span><textarea value={findingRecommendation} onChange={(event) => setFindingRecommendation(event.target.value)} rows={3} placeholder="Що рекомендуєте зробити" /></label><div><span className={styles.label}>Терміновість</span><div className={styles.segmented}>{(["INFO", "SOON", "CRITICAL"] as FindingUrgency[]).map((value) => <button type="button" key={value} className={findingUrgency === value ? styles.segmentActive : ""} onClick={() => setFindingUrgency(value)}>{value === "INFO" ? "Рекомендація" : value === "SOON" ? "Скоро" : "Критично"}</button>)}</div></div><label className={styles.photoButton}>📷 Додати фото (1–3)<input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)); setFindingFiles((current) => [...current, ...files].slice(0, 3)); event.currentTarget.value = ""; }} /></label>{findingFiles.length > 0 && <div className={styles.fileList}>{findingFiles.map((file, index) => <div key={`${file.name}-${index}`}><span>{file.name || `Фото ${index + 1}`}</span><button type="button" onClick={() => setFindingFiles((current) => current.filter((_, i) => i !== index))}>×</button></div>)}</div>}<button type="button" className={styles.primary} disabled={busy === "finding"} onClick={() => void submitFinding()}>{busy === "finding" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button></section></main></>}

      {screen === "SUPPORT" && selectedTask && <><TopBar title={supportKind === "PART_REQUEST" ? "Запит на запчастину" : "Питання менеджеру"} onBack={() => setScreen("WORK_DETAIL")} /><main className={styles.content}><section className={styles.card}><h2>{selectedTask.vehicle} · {selectedTask.plate}</h2><p className={styles.subtle}>{selectedTask.description}</p></section><section className={styles.formCard}><label><span>{supportKind === "PART_REQUEST" ? "Яка запчастина потрібна?" : "Ваше питання"}</span><textarea rows={5} value={supportText} onChange={(event) => setSupportText(event.target.value)} placeholder={supportKind === "PART_REQUEST" ? "Назва, сторона, кількість, уточнення…" : "Опишіть, що потрібно уточнити…"} /></label><button type="button" className={styles.primary} disabled={busy === "support"} onClick={() => void submitSupport()}>{busy === "support" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button></section></main></>}

      {screen === "DIAGNOSTICS" && <><TopBar title="Діагностика" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>Мої діагностики</h1><p>Лише автомобілі, призначені вам.</p></div><div className={styles.stack}>{diagnostics.map((item) => <button type="button" className={styles.listCard} key={item.id} onClick={() => openDiagnostic(item.id)}><div><h3>{item.vehicle.label}</h3><b>{item.vehicle.plateNumber || "Без номера"}</b></div><p>{item.problem || "Планова діагностика"}</p><div className={styles.meta}><span>Час <b>{time(item.plannedStartAt)}</b></span><span>Пост <b>{item.post || "—"}</b></span></div><span className={`${styles.pill} ${statusTone(item.workflowState)}`}>{item.requiresDiagnosticFirst ? "Діагностика → ремонт" : statusLabel[item.workflowState] || item.workflowState}</span></button>)}</div>{!diagnostics.length && <div className={styles.empty}>{scheduledAppointments.length ? "Діагностика з’явиться після відмітки «Приїхав»." : "Призначених діагностик немає."}</div>}</main></>}

      {screen === "DIAGNOSTIC_DETAIL" && selectedDiagnosticId && <MechanicDiagnosticWorkspace diagnosticId={selectedDiagnosticId} onBack={() => { setSelectedDiagnosticId(null); setScreen("DIAGNOSTICS"); }} onChanged={() => { void Promise.all([loadDiagnostics(), loadProcessCards(), loadHome(), loadTasks()]).catch(() => undefined); }} onFinished={returnToHomeAfterDiagnostic} />}

      {screen === "NOTIFICATIONS" && <>
        <TopBar title="Сповіщення" onBack={() => setScreen("HOME")} />
        <main className={styles.content}>
          <div className={styles.notificationTitle}>
            <div><h1>Історія подій</h1><p>Призначення, зміни часу, поста, статусу та уточнення менеджера.</p></div>
            {notificationCount > 0 && <button type="button" disabled={busy === "notifications:all"} onClick={() => void markAllNotifications()}>Прочитати всі</button>}
          </div>
          <div className={styles.notificationList}>
            {(notificationFeed?.items ?? []).map((notification) => {
              const clarification = notification.findingId ? clarifications.find((item) => item.id === notification.findingId) : null;
              return <section className={`${styles.noticeCard} ${notification.readAt ? "" : styles.noticeUnread}`} key={notification.id}>
                <div className={styles.noticeHeader}>
                  <div><strong>{notification.title}</strong><span>{notificationTime(notification.createdAt)}</span></div>
                  {!notification.readAt && <em>Нове</em>}
                </div>
                <div className={styles.noticeVehicle}><strong>{notification.vehicle} · {notification.plate}</strong>{clarification && <span>{clarification.workDescription}</span>}</div>
                <p>{notification.body || "Оновлено дані призначення."}</p>
                {clarification ? <>
                  <blockquote>{clarification.findingText}</blockquote>
                  <textarea rows={3} value={replyDrafts[clarification.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [clarification.id]: event.target.value }))} placeholder="Відповідь сервіс-менеджеру…" />
                  <button type="button" className={styles.primary} disabled={busy === `reply:${clarification.id}`} onClick={() => void replyClarification(clarification)}>Відповісти →</button>
                </> : <div className={styles.noticeActions}>
                  {!notification.readAt && <button type="button" onClick={() => void markNotification(notification.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося оновити сповіщення"))}>Позначити прочитаним</button>}
                  {notification.type !== "UNASSIGNED" && <button type="button" onClick={() => void openNotification(notification)}>Відкрити роботи →</button>}
                </div>}
              </section>;
            })}
          </div>
          {!notificationFeed?.items.length && <div className={styles.empty}>Сповіщень ще немає.</div>}
        </main>
      </>}

      {screen === "PROFILE" && <><TopBar title="Профіль" onBack={() => setScreen("HOME")} /><main className={styles.content}><section className={styles.profileLarge}><div className={styles.avatar}>{firstName(mechanicName).slice(0, 1).toUpperCase()}</div><div><h1>{mechanicName}</h1><p>Автомеханік</p><span>{home.mechanic.station.name} · {currentPost || "пост не призначено"}</span></div></section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Оформлення</h2><p>Тема цього мобільного кабінету</p></div></div><div className={styles.themePicker}><button type="button" className={themeChoice === "system" ? styles.themeActive : ""} onClick={() => changeTheme("system")}>Як у системі</button><button type="button" className={themeChoice === "light" ? styles.themeActive : ""} onClick={() => changeTheme("light")}>Світла</button><button type="button" className={themeChoice === "dark" ? styles.themeActive : ""} onClick={() => changeTheme("dark")}>Темна</button></div></section><section className={styles.card}><div className={styles.actionList}><button type="button" onClick={() => openSchedule("ALL", "PROFILE")}>▣ Мій графік <span>›</span></button><button type="button" onClick={() => void openPayroll()}>₴ Моя зарплата <span>›</span></button></div></section><section className={styles.card}><button type="button" className={styles.logoutButton} onClick={() => void signOut()} disabled={busy === "logout"}>{busy === "logout" ? "Виходжу…" : "↪ Вийти з профілю"}</button></section></main></>}

      {screen === "SCHEDULE" && <><TopBar title="Мій графік" onBack={() => setScreen(scheduleBackScreen)} /><main className={styles.content}><div className={styles.pageTitle}><h1>{scheduleHeading.title}</h1><p>{scheduleHeading.description}</p></div><div className={`${styles.filterBar} ${styles.filterBarTwo}`} role="group" aria-label="Фільтр графіка"><button type="button" className={scheduleFilter === "ALL" ? styles.filterActive : ""} aria-pressed={scheduleFilter === "ALL"} onClick={() => setScheduleFilter("ALL")}>Усі закріплення</button><button type="button" className={scheduleFilter === "TODAY" ? styles.filterActive : ""} aria-pressed={scheduleFilter === "TODAY"} onClick={() => setScheduleFilter("TODAY")}>На сьогодні</button></div><div className={styles.stack}>{visibleScheduleAppointments.map((item) => { const itemStatus = appointmentStatus(item); const overdue = isAppointmentOverdue(item); return <article className={styles.scheduleCard} style={overdue ? overdueCardStyle : undefined} key={item.id}><time style={overdue ? { color: "var(--m-danger)", fontWeight: 850 } : undefined}>{notificationTime(item.plannedStartAt)}–{time(item.plannedEndAt)}</time><div><strong>{item.vehicle}</strong><p>{item.plate} · {item.problem || "Запис на СТО"}</p><small style={overdue ? { color: "var(--m-danger)", fontWeight: 800 } : undefined}>{item.post || "Пост не призначено"} · {overdue ? "Протерміновано" : statusLabel[itemStatus] || itemStatus}</small></div></article>; })}</div>{!visibleScheduleAppointments.length && <div className={styles.empty}>{scheduleHeading.empty}</div>}</main></>}

      {screen === "PAYROLL" && <><TopBar title="Моя зарплата" onBack={() => setScreen("PROFILE")} /><main className={styles.content}>
        <section className={styles.payHero}><span>Прогноз за місяць</span><strong>{money(payroll?.projection?.total)}</strong><small>Оцінка за поточними правилами мотивації</small></section>
        <section className={styles.card}><div className={styles.sectionHead}><div><h2>Зароблено</h2><p>Тільки Ваші власні нарахування</p></div></div><div className={styles.earningsGrid}><div><span>Сьогодні</span><strong>{money(payroll?.today?.accrued)}</strong></div><div><span>Тиждень</span><strong>{money(payroll?.week?.accrued)}</strong></div><div><span>Місяць</span><strong>{money(payroll?.month?.accrued)}</strong></div></div></section>
        <section className={styles.card}><div className={styles.sectionHead}><div><h2>Розрахунки</h2><p>Зароблено, виплачено і залишок</p></div></div><div className={styles.payBalance}><div><span>Нараховано всього</span><strong>{money(payroll?.balance?.accrued)}</strong></div><div><span>Виплачено</span><strong>{money(payroll?.balance?.paid)}</strong></div><div><span>До виплати</span><strong>{money(payroll?.balance?.due)}</strong></div></div></section>
        <section className={styles.card}><div className={styles.sectionHead}><div><h2>З чого складається місяць</h2><p>Кожна сума має джерело</p></div></div><div className={styles.payBreakdown}><div><span>Базова ставка</span><strong>{money(payroll?.month?.byCategory?.BASE)}</strong></div><div><span>% від робіт</span><strong>{money(payroll?.month?.byCategory?.LABOR)}</strong></div><div><span>% від деталей / маржі</span><strong>{money(payroll?.month?.byCategory?.SALES)}</strong></div><div><span>Бонуси</span><strong>{money((payroll?.month?.byCategory?.BONUS || 0) + (payroll?.month?.byCategory?.KPI || 0))}</strong></div><div><span>Доплата до мінімуму</span><strong>{money(payroll?.month?.byCategory?.ADJUSTMENT)}</strong></div></div></section>
        <section className={styles.card}><div className={styles.sectionHead}><div><h2>Мої правила оплати</h2><p>Зміни правил не перераховують уже зафіксовані нарахування</p></div></div><div className={styles.ruleGrid}><div><span>Ставка</span><strong>{money(payroll?.rules?.baseSalary)}</strong></div><div><span>Мінімум</span><strong>{money(payroll?.rules?.minimumSalary)}</strong></div><div><span>Від робіт</span><strong>{payroll?.rules?.workPercent ?? 0}%</strong></div><div><span>Від продажу деталей</span><strong>{payroll?.rules?.partsSalesPercent ?? 0}%</strong></div><div><span>Від маржі деталей</span><strong>{payroll?.rules?.partsMarginPercent ?? 0}%</strong></div><div><span>Від прибутку</span><strong>{payroll?.rules?.netProfitPercent ?? 0}%</strong></div></div></section>
        <section className={styles.card}><div className={styles.sectionHead}><div><h2>Останні нарахування</h2><p>Розшифровка за поточний місяць</p></div></div><div className={styles.payDetails}>{(payroll?.month?.details ?? []).slice(0, 30).map((item) => <div key={item.id}><div><strong>{item.description || "Нарахування"}</strong><small>{new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" }).format(new Date(item.occurredAt))}</small></div><b>{money(item.amount)}</b></div>)}</div>{!(payroll?.month?.details?.length) && <div className={styles.emptyInline}>Нарахувань за цей місяць ще немає.</div>}</section>
        <section className={styles.card}><div className={styles.sectionHead}><div><h2>Прогноз</h2><p>Не є виплатою до закриття відповідних умов</p></div></div><div className={styles.payBreakdown}><div><span>Вже нараховано</span><strong>{money(payroll?.projection?.postedAccrued)}</strong></div><div><span>Ще ставка до кінця місяця</span><strong>{money(payroll?.projection?.futureBase)}</strong></div><div><span>Орієнтовний profit-бонус</span><strong>{money(payroll?.projection?.estimatedProfitShare)}</strong></div><div><span>Орієнтовна доплата до мінімуму</span><strong>{money(payroll?.projection?.estimatedMinimumTopUp)}</strong></div></div></section>
      </main></>}

      {message && <div className={styles.toastGood}><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}
      {error && <div className={styles.toastBad}><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}

      {screen === "WORK_DETAIL" && selectedTask && (selectedTask.status === "IN_PROGRESS" || selectedTask.status === "STOPPED" || selectedTask.status === "PAUSED") && <section className={`${styles.card} ${selectedTask.status === "STOPPED" ? styles.stopCard : ""}`}>
        {selectedTask.status === "STOPPED" ? <>
          <div className={styles.sectionHead}><div><h2>СТОП — потребує уваги</h2><p>{selectedTask.stopReason && selectedTask.stopReason in stopReasonLabel ? stopReasonLabel[selectedTask.stopReason as StopReason] : "Роботу зупинено"}</p></div><span className={`${styles.pill} ${styles.warn}`}>ЗУПИНЕНО</span></div>
          {selectedTask.stopNote && <p className={styles.subtle}>{selectedTask.stopNote}</p>}
          <p className={styles.formHint}>Для безпечного продовження повторно відскануйте автомобіль і підтвердіть номер.</p>
          <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => openScannedVehicle(selectedTask.plate, selectedTask.id)}>▣ Відновити через сканування →</button>
        </> : <>
          <div className={styles.sectionHead}><div><h2>Дії під час роботи</h2><p>Важливі зміни фіксуються в замовленні та історії авто.</p></div></div>
          <div className={styles.quickActions}>
            {selectedTask.status === "IN_PROGRESS" && <button type="button" className={styles.stopButton} disabled={Boolean(busy)} onClick={() => { setStopReason("PARTS_UNAVAILABLE"); setStopNote(""); setScreen("STOP"); }}>СТОП — призупинити роботу</button>}
            <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => { setAdditionalWorkDescription(""); setAdditionalWorkHours(""); setAdditionalWorkNote(""); setScreen("ADDITIONAL_WORK"); }}>＋ Додаткові роботи</button>
          </div>
        </>}
      </section>}

      {screen === "STOP" && selectedTask && <>
        <TopBar title="Зупинити роботу" onBack={() => setScreen("WORK_DETAIL")} />
        <main className={styles.content}>
          <section className={styles.card}>
            <div className={styles.taskTop}><div><h2>{selectedTask.vehicle}</h2><p>{selectedTask.plate}</p></div><span className={`${styles.pill} ${styles.warn}`}>СТОП</span></div>
            <p className={styles.subtle}>Робота буде припинена, автомобіль залишиться у списку робіт, а сервіс-менеджер отримає сповіщення.</p>
          </section>
          <section className={styles.formCard}>
            <label><span>Причина зупинки *</span><select value={stopReason} onChange={(event) => setStopReason(event.target.value as StopReason)}>
              {(Object.keys(stopReasonLabel) as StopReason[]).map((value) => <option key={value} value={value}>{stopReasonLabel[value]}</option>)}
            </select></label>
            <label><span>Коментар {stopReason === "PARTS_UNAVAILABLE" ? "(необов’язково)" : "*"}</span><textarea rows={4} value={stopNote} onChange={(event) => setStopNote(event.target.value)} placeholder="Що саме зупинило роботу?" /></label>
            <p className={styles.formHint}>Після СТОП продовження можливе тільки після повторного сканування цього автомобіля.</p>
            <button type="button" className={styles.stopButton} disabled={busy === "STOP" || (stopReason !== "PARTS_UNAVAILABLE" && stopNote.trim().length < 3)} onClick={() => void runAction("STOP", { reasonCode: stopReason, note: stopNote })}>{busy === "STOP" ? "Зупиняю…" : "СТОП — передати на контроль"}</button>
          </section>
        </main>
      </>}

      {screen === "ADDITIONAL_WORK" && selectedTask && <>
        <TopBar title="Додаткова робота" onBack={() => setScreen("WORK_DETAIL")} />
        <main className={styles.content}>
          <section className={styles.card}>
            <div className={styles.taskTop}><div><h2>{selectedTask.vehicle}</h2><p>{selectedTask.plate}</p></div><span className={`${styles.pill} ${styles.warn}`}>ПОГОДЖЕННЯ</span></div>
            <p className={styles.subtle}>Зафіксуйте технічну потребу. Менеджер погодить її з клієнтом, після чого робота з’явиться в цьому ж замовленні та фінальній накладній.</p>
          </section>
          <section className={styles.formCard}>
            <label><span>Що потрібно додатково виконати? *</span><textarea rows={4} value={additionalWorkDescription} onChange={(event) => setAdditionalWorkDescription(event.target.value)} placeholder="Наприклад: заміна передньої опори амортизатора" /></label>
            <label><span>Орієнтовний час</span><input type="number" min="0.1" max="1000" step="0.1" value={additionalWorkHours} onChange={(event) => setAdditionalWorkHours(event.target.value)} placeholder="Нормо-години" /></label>
            <label><span>Коментар для менеджера</span><textarea rows={3} value={additionalWorkNote} onChange={(event) => setAdditionalWorkNote(event.target.value)} placeholder="Причина, ризики, рекомендації…" /></label>
            <p className={styles.formHint}>Механік не змінює ціну та не запускає роботу без погодження клієнта.</p>
            <button type="button" className={styles.primary} disabled={busy === "additional-work" || additionalWorkDescription.trim().length < 3} onClick={() => void submitAdditionalWork()}>{busy === "additional-work" ? "Передаю…" : "Передати на погодження →"}</button>
          </section>
        </main>
      </>}

      <BottomNav screen={screen} onChange={(next) => { if (next === "WORKS") setWorksFilter("ALL"); setScreen(next); setError(""); setMessage(""); }} />
    </div>
  </div>;
}
