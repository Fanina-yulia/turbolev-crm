"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./mechanic-standalone-cabinet.module.css";
import { MechanicDiagnosticWorkspace } from "./mechanic-diagnostic-workspace";
import { MechanicExecutionIssueForm } from "./mechanic-execution-issue-form";
import { MechanicTaskPlateVerification } from "./mechanic-task-plate-verification";
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
  findingCount?: number;
  openFindingCount?: number;
};

type Appointment = {
  id: string;
  workOrderId: string | null;
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

type Payroll = { ok: boolean; projection?: { total?: number | string; month?: string } };
type Screen = "HOME" | "WORKS" | "WORK_DETAIL" | "FINDING" | "DIAGNOSTICS" | "DIAGNOSTIC_DETAIL" | "NOTIFICATIONS" | "PROFILE" | "SCHEDULE" | "PAYROLL" | "SUPPORT";
type WorkAction = "START" | "PAUSE" | "RESUME" | "COMPLETE";
type ThemeChoice = "system" | "light" | "dark";
type SupportKind = "QUESTION" | "PART_REQUEST";
type FindingUrgency = "INFO" | "SOON" | "CRITICAL";
type WorksFilter = "ALL" | "IN_PROGRESS" | "WAITING_PARTS";
type ScheduleFilter = "ALL" | "TODAY";

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

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 12) return "Доброго ранку";
  if (hour < 18) return "Добрий день";
  return "Добрий вечір";
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
  if (["PAUSED", "REWORK", "WAITING_PARTS", "WAITING_PARTS_SELECTION", "WAITING_APPROVAL", "RETURNED"].includes(status)) return styles.warn;
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
  const effectiveStatus = "plannedStartAt" in item ? appointmentStatus(item) : item.workOrderStatus || item.status;
  if (filter === "WAITING_PARTS") {
    return effectiveStatus === "WAITING_PARTS" || effectiveStatus === "WAITING_PARTS_SELECTION";
  }
  return effectiveStatus === "IN_REPAIR"
    || effectiveStatus === "REWORK"
    || effectiveStatus === "PAUSED"
    || (!("plannedStartAt" in item) && (item.status === "IN_PROGRESS" || item.status === "PAUSED"));
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

function normalizedPlate(value?: string | null) {
  const chars: Record<string, string> = { А: "A", В: "B", Е: "E", І: "I", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
  const source = (value || "").normalize("NFKC").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
  return [...source].map((char) => chars[char] || char).join("");
}

function BottomNav({ screen, notificationCount, onChange }: { screen: Screen; notificationCount: number; onChange: (screen: Screen) => void }) {
  const workActive = ["WORKS", "WORK_DETAIL", "FINDING", "SUPPORT"].includes(screen);
  const diagnosticActive = ["DIAGNOSTICS", "DIAGNOSTIC_DETAIL"].includes(screen);
  const profileActive = ["PROFILE", "SCHEDULE", "PAYROLL"].includes(screen);
  return <nav className={styles.bottomNav} aria-label="Навігація механіка">
    <button type="button" className={screen === "HOME" ? styles.navActive : ""} onClick={() => onChange("HOME")}><span>⌂</span><b>Головна</b></button>
    <button type="button" className={workActive ? styles.navActive : ""} onClick={() => onChange("WORKS")}><span>▤</span><b>Роботи</b></button>
    <button type="button" className={diagnosticActive ? styles.navActive : ""} onClick={() => onChange("DIAGNOSTICS")}><span>◇</span><b>Діагностика</b></button>
    <button type="button" className={screen === "NOTIFICATIONS" ? styles.navActive : ""} onClick={() => onChange("NOTIFICATIONS")}><span>◉{notificationCount > 0 && <em className={styles.navBadge}>{notificationCount}</em>}</span><b>Сповіщення</b></button>
    <button type="button" className={profileActive ? styles.navActive : ""} onClick={() => onChange("PROFILE")}><span>●</span><b>Профіль</b></button>
  </nav>;
}

function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return <header className={styles.topBar}>
    <button type="button" onClick={onBack} aria-label="Назад">‹</button>
    <strong>{title}</strong>
    <span />
  </header>;
}

export function MechanicStandaloneCabinet({ userName }: { userName?: string | null }) {
  const [home, setHome] = useState<HomePayload | null>(null);
  const [tasks, setTasks] = useState<MechanicTask[]>([]);
  const [taskKpis, setTaskKpis] = useState<TaskFeed["kpis"] | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
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

  const loadDiagnostics = useCallback(async () => {
    const response = await fetch("/api/diagnostics/me", { cache: "no-store", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setDiagnostics(body.items ?? []);
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
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("turbolev:mechanic-theme");
    if (stored === "light" || stored === "dark" || stored === "system") setThemeChoice(stored);
    void Promise.all([loadHome(), loadTasks(), loadDiagnostics(), loadNotifications()]).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося завантажити кабінет"));
  }, [loadDiagnostics, loadHome, loadNotifications, loadTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadNotifications().catch(() => undefined), 15000);
    const refresh = () => void loadNotifications().catch(() => undefined);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [loadNotifications]);

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
    const onRefresh = () => { void Promise.all([loadHome(), loadTasks(), loadDiagnostics()]).catch(() => undefined); };
    window.addEventListener("turbolev:mechanic-open-diagnostic", onOpenDiagnostic);
    window.addEventListener("turbolev:mechanic-open-task", onOpenTask);
    window.addEventListener("turbolev:mechanic-refresh", onRefresh);
    return () => {
      window.removeEventListener("turbolev:mechanic-open-diagnostic", onOpenDiagnostic);
      window.removeEventListener("turbolev:mechanic-open-task", onOpenTask);
      window.removeEventListener("turbolev:mechanic-refresh", onRefresh);
    };
  }, [loadDiagnostics, loadHome, loadTasks, tasks]);

  const appointments = home?.appointments ?? [];
  const activeAppointments = appointments;
  const representedWorkOrderIds = new Set(tasks.map((item) => item.workOrderId));
  const mechanicActionableAppointmentStatuses = new Set(["BOOKED", "ARRIVED", "DIAGNOSTICS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "PAUSED"]);
  const scheduledAppointments = activeAppointments.filter((item) => mechanicActionableAppointmentStatuses.has(item.status) && (!item.workOrderId || !representedWorkOrderIds.has(item.workOrderId)));
  const prioritizedScheduledAppointments = [...scheduledAppointments].sort(appointmentPriority);
  const nextScheduledAppointment = prioritizedScheduledAppointments[0] ?? null;
  const nextScheduledDiagnostic = nextScheduledAppointment
    ? diagnostics.find((item) => normalizedPlate(item.vehicle.plateNumber) === normalizedPlate(nextScheduledAppointment.plate)) ?? null
    : null;
  const selectedTask = tasks.find((item) => item.id === selectedTaskId) ?? null;
  const selectedOrderTasks = selectedTask ? tasks.filter((item) => item.workOrderId === selectedTask.workOrderId) : [];
  const selectedAppointment = selectedTask ? appointments.find((item) => item.plate === selectedTask.plate || item.vehicle === selectedTask.vehicle) ?? null : null;
  const activeTask = tasks.find((item) => item.status === "IN_PROGRESS" || item.status === "PAUSED") ?? tasks.find((item) => !isDone(item.status) && item.status !== "CANCELLED") ?? null;
  const currentPost = activeTask ? appointments.find((item) => item.plate === activeTask.plate)?.post : appointments.find((item) => item.post)?.post;
  const assignedCases = home?.kpis?.assigned ?? activeAppointments.length;
  const scheduledToday = home?.kpis?.scheduledToday ?? scheduledAppointments.length;
  const inProgress = (taskKpis?.inProgress ?? tasks.filter((item) => item.status === "IN_PROGRESS").length) + (taskKpis?.paused ?? tasks.filter((item) => item.status === "PAUSED").length);
  const completed = taskKpis?.completedToday ?? tasks.filter((item) => isDone(item.status)).length;
  const notificationCount = notificationFeed?.unreadCount ?? 0;
  const mechanicName = userName || home?.mechanic?.name || "Автомеханік";
  const visibleWorkAppointments = scheduledAppointments.filter((item) => matchesWorksFilter(item, worksFilter)).sort(appointmentPriority);
  const visibleWorkTasks = tasks.filter((item) => matchesWorksFilter(item, worksFilter));
  const todayKyivKey = kyivDateKey(new Date());
  const visibleScheduleAppointments = (scheduleFilter === "TODAY"
    ? appointments.filter((item) => kyivDateKey(item.plannedStartAt) === todayKyivKey)
    : [...appointments]).sort(appointmentPriority);
  const nextAppointmentOverdue = nextScheduledAppointment ? isAppointmentOverdue(nextScheduledAppointment) : false;
  const selectedTaskOverdue = Boolean(selectedAppointment && isAppointmentOverdue(selectedAppointment));

  const overdueCardStyle = {
    background: "var(--m-danger-soft)",
    borderColor: "color-mix(in srgb,var(--m-danger) 48%,var(--m-border))",
    boxShadow: "inset 4px 0 0 var(--m-danger), 0 7px 22px rgba(18,31,44,.055)",
  };
  const overdueRowStyle = {
    background: "color-mix(in srgb,var(--m-danger-soft) 72%,transparent)",
    boxShadow: "inset 4px 0 0 var(--m-danger)",
    paddingLeft: 12,
  };
  const overduePillStyle = {
    background: "var(--m-danger-soft)",
    color: "var(--m-danger)",
    border: "1px solid color-mix(in srgb,var(--m-danger) 45%,var(--m-border))",
  };

  const worksHeading = worksFilter === "IN_PROGRESS"
    ? { title: "В роботі", description: "Активні та призупинені операції й автомобілі в ремонті.", empty: "Робіт у процесі немає." }
    : worksFilter === "WAITING_PARTS"
      ? { title: "Очікують деталей", description: "Роботи й автомобілі, для яких очікуються деталі.", empty: "Робіт, що очікують деталей, немає." }
      : { title: "Призначені роботи", description: "Усі активні записи, комерційні пропозиції та операції.", empty: "Призначених робіт немає." };
  const scheduleHeading = scheduleFilter === "TODAY"
    ? { title: "Заплановано на сьогодні", description: "Ваші закріплення на поточний день за київським часом.", empty: "На сьогодні закріплень немає." }
    : { title: "Активні закріплення", description: "Авто залишаються тут до завершення сервісного випадку.", empty: "Активних закріплень немає." };

  const todayLabel = useMemo(() => new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long" }).format(new Date()), []);

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
  }

  function openScannedVehicle(plate: string | null | undefined) {
    const expectedPlate = plate?.trim();
    if (!expectedPlate || expectedPlate === "—") {
      setError("Для цього автомобіля немає державного номера для сканування.");
      return;
    }
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-open-scanner", {
      detail: { expectedPlate },
    }));
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
    void Promise.all([loadDiagnostics(), loadHome(), loadTasks()]).catch(() => undefined);
  }

  async function runAction(action: WorkAction) {
    if (!selectedTask) return;
    if (action === "COMPLETE" && !window.confirm("Завершити цю роботу?")) return;
    setBusy(action); setError("");
    try {
      const response = await fetch(`/api/cabinet/mechanic/tasks/${encodeURIComponent(selectedTask.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося оновити роботу");
      await Promise.all([loadTasks(), loadHome()]);
      setMessage(action === "START" ? "Роботу розпочато." : action === "PAUSE" ? "Роботу поставлено на паузу." : action === "RESUME" ? "Роботу продовжено." : "Роботу завершено.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося оновити роботу"); }
    finally { setBusy(""); }
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
      setSupportText(""); setScreen("WORK_DETAIL"); setMessage(body.message || "Запит передано.");
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

  async function openNotification(item: MechanicNotification) {
    if (!item.readAt) await markNotification(item.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося оновити сповіщення"));
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
    try {
      const response = await fetch("/api/me/compensation", { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося завантажити зарплату");
      setPayroll(body as Payroll);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося завантажити зарплату"); }
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

  return <div className={styles.app} data-theme-choice={themeChoice} data-mechanic-cabinet="true">
    <div className={styles.shell}>
      {screen === "HOME" && <>
        <header className={styles.hero}>
          <div><div className={styles.brand}><span>ТУРБО</span> <b>ЛЕВ</b></div><small>Кабінет механіка</small></div>
          <button type="button" className={styles.iconButton} onClick={() => setScreen("NOTIFICATIONS")} aria-label="Сповіщення">◉{notificationCount > 0 && <em>{notificationCount}</em>}</button>
        </header>
        <main className={styles.content}>
          <section className={styles.profileCard}><div className={styles.avatar}>{firstName(mechanicName).slice(0, 1).toUpperCase()}</div><div><h1>{greeting()}, {firstName(mechanicName)}!</h1><p>{currentPost || "Пост не призначено"}</p><span>{home.mechanic.station.name}</span></div></section>
          <section className={styles.card}>
            <div className={styles.sectionHead}><div><h2>Сьогодні, {todayLabel}</h2><p>Закріплено — до фактичної видачі; на сьогодні — план поточного дня.</p></div></div>
            <div className={styles.metrics}>
              <button type="button" className={styles.metricButton} onClick={() => openSchedule("ALL", "HOME")} aria-label={`Закріплено ${assignedCases}. Відкрити всі активні закріплення`}><b>{assignedCases}</b><span>Закріплено</span></button>
              <button type="button" className={styles.metricButton} onClick={() => openSchedule("TODAY", "HOME")} aria-label={`На сьогодні ${scheduledToday}. Відкрити закріплення на сьогодні`}><b>{scheduledToday}</b><span>На сьогодні</span></button>
              <button type="button" className={styles.metricButton} onClick={() => openWorks("IN_PROGRESS")} aria-label={`В роботі ${inProgress}. Відкрити роботи в процесі`}><b>{inProgress}</b><span>В роботі</span></button>
              <button type="button" className={styles.metricButton} onClick={() => openWorks("WAITING_PARTS")} aria-label={`Очікує деталей ${home.kpis?.waitingParts ?? 0}. Відкрити роботи, що очікують деталей`}><b>{home.kpis?.waitingParts ?? 0}</b><span>Очікує деталей</span></button>
            </div>
          </section>
          <section><div className={styles.sectionHead}><div><h2>{activeTask?.status === "IN_PROGRESS" ? "Поточна робота" : activeTask?.status === "PAUSED" ? "Робота на паузі" : "Наступна робота"}</h2><p>Найближче завдання</p></div></div>{activeTask ? <article className={styles.taskHero}><div className={styles.taskTop}><div className={styles.carIcon}>🚗</div><div><h3>{activeTask.vehicle}</h3><p>{activeTask.plate}</p></div><span className={`${styles.pill} ${statusTone(activeTask.status)}`}>{statusLabel[activeTask.status] || activeTask.status}</span></div><strong>🔧 {activeTask.description}</strong><div className={styles.meta}><span>Пост <b>{appointments.find((item) => item.plate === activeTask.plate)?.post || "—"}</b></span><span>Час <b>{time(appointments.find((item) => item.plate === activeTask.plate)?.plannedStartAt)}</b></span></div><button type="button" className={styles.primary} onClick={() => openScannedVehicle(activeTask.plate)}>Сканувати та відкрити →</button></article> : nextScheduledAppointment ? <article className={styles.taskHero} style={nextAppointmentOverdue ? overdueCardStyle : undefined}><div className={styles.taskTop}><div className={styles.carIcon}>🚗</div><div><h3>{nextScheduledAppointment.vehicle}</h3><p>{nextScheduledAppointment.plate}</p></div><span className={`${styles.pill} ${nextAppointmentOverdue ? "" : styles.accentPill}`} style={nextAppointmentOverdue ? overduePillStyle : undefined}>{nextAppointmentOverdue ? "Протерміновано" : "Заплановано"}</span></div><strong>🔧 {nextScheduledAppointment.problem || "Запис на СТО"}</strong><div className={styles.meta}><span>Пост <b>{nextScheduledAppointment.post || "—"}</b></span><span>Час <b style={nextAppointmentOverdue ? { color: "var(--m-danger)" } : undefined}>{time(nextScheduledAppointment.plannedStartAt)}</b></span></div><p className={styles.subtle}>{nextAppointmentOverdue ? "Плановий час уже минув. Авто потребує уваги — відкрийте діагностику або наступний доступний етап." : nextScheduledDiagnostic ? (["SUBMITTED", "CONFIRMED"].includes(nextScheduledDiagnostic.workflowState) ? "Діагностика завершена або передана. CRM очікує наступний етап." : "Діагностика доступна — можна переходити безпосередньо до автомобіля.") : "Діагностика ще не оформлена. Перевірте розділ діагностики."}</p><button type="button" className={styles.primary} onClick={() => openScannedVehicle(nextScheduledAppointment.plate)}>{nextScheduledDiagnostic ? (nextScheduledDiagnostic.workflowState === "PENDING" ? "Почати діагностику →" : nextScheduledDiagnostic.workflowState === "IN_PROGRESS" || nextScheduledDiagnostic.workflowState === "RETURNED" ? "Продовжити діагностику →" : "Переглянути діагностику →") : "До діагностики →"}</button></article> : <div className={styles.empty}>Активних робіт немає.</div>}</section>
          <section className={styles.card}><div className={styles.sectionHead}><div><h2>Мої роботи</h2><p>Сьогодні та активні</p></div><button type="button" className={styles.textButton} onClick={() => openWorks("ALL")}>Всі ›</button></div><div className={styles.compactList}>{prioritizedScheduledAppointments.slice(0, Math.max(0, 4 - tasks.length)).map((item) => { const overdue = isAppointmentOverdue(item); return <button type="button" key={`appointment:${item.id}`} style={overdue ? overdueRowStyle : undefined} onClick={() => openScannedVehicle(item.plate)}><div><strong>{item.vehicle}</strong><small style={overdue ? { color: "var(--m-danger)" } : undefined}>{notificationTime(item.plannedStartAt)} · {item.problem || "Запис на СТО"}</small></div><span className={`${styles.pill} ${overdue ? "" : styles.accentPill}`} style={overdue ? overduePillStyle : undefined}>{overdue ? "Протерміновано" : "Заплановано"}</span></button>; })}{tasks.slice(0, 4).map((task) => <button type="button" key={task.id} onClick={() => openScannedVehicle(task.plate)}><div><strong>{task.vehicle}</strong><small>{task.description}</small></div><span className={`${styles.pill} ${statusTone(task.status)}`}>{statusLabel[task.status] || task.status}</span></button>)}</div>{!tasks.length && !scheduledAppointments.length && <div className={styles.emptyInline}>Робіт немає.</div>}</section>
        </main>
      </>}

      {screen === "WORKS" && <><TopBar title="Мої роботи" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>{worksHeading.title}</h1><p>{worksHeading.description}</p></div><div className={styles.filterBar} role="group" aria-label="Фільтр робіт"><button type="button" className={worksFilter === "ALL" ? styles.filterActive : ""} aria-pressed={worksFilter === "ALL"} onClick={() => setWorksFilter("ALL")}>Усі</button><button type="button" className={worksFilter === "IN_PROGRESS" ? styles.filterActive : ""} aria-pressed={worksFilter === "IN_PROGRESS"} onClick={() => setWorksFilter("IN_PROGRESS")}>В роботі</button><button type="button" className={worksFilter === "WAITING_PARTS" ? styles.filterActive : ""} aria-pressed={worksFilter === "WAITING_PARTS"} onClick={() => setWorksFilter("WAITING_PARTS")}>Очікує деталей</button></div><div className={styles.stack}>{visibleWorkAppointments.map((item) => { const itemStatus = appointmentStatus(item); const overdue = isAppointmentOverdue(item); return <button type="button" className={styles.listCard} style={overdue ? overdueCardStyle : undefined} key={`appointment:${item.id}`} onClick={() => openScannedVehicle(item.plate)}><div><h3>{item.vehicle}</h3><b style={overdue ? { color: "var(--m-danger)" } : undefined}>{item.plate}</b></div><p>{item.problem || "Запис на СТО"}</p><div className={styles.meta}><span>Час <b style={overdue ? { color: "var(--m-danger)" } : undefined}>{notificationTime(item.plannedStartAt)}</b></span><span>Пост <b>{item.post || "—"}</b></span></div><small className={styles.subtle}>Натисніть, щоб підтвердити номер і відкрити діагностику</small><span className={`${styles.pill} ${overdue ? "" : statusTone(itemStatus)}`} style={overdue ? overduePillStyle : undefined}>{overdue ? "Протерміновано" : statusLabel[itemStatus] || itemStatus}</span></button>; })}{visibleWorkTasks.map((task) => { const itemStatus = worksFilter === "ALL" ? task.status : task.workOrderStatus || task.status; return <button type="button" className={styles.listCard} key={task.id} onClick={() => openScannedVehicle(task.plate)}><div><h3>{task.vehicle}</h3><b>{task.plate}</b></div><p>{task.description}</p><small className={styles.subtle}>Натисніть, щоб підтвердити номер і відкрити роботу</small><span className={`${styles.pill} ${statusTone(itemStatus)}`}>{statusLabel[itemStatus] || itemStatus}</span></button>; })}</div>{!visibleWorkTasks.length && !visibleWorkAppointments.length && <div className={styles.empty}>{worksHeading.empty}</div>}</main></>}

      {screen === "WORK_DETAIL" && selectedTask && <><TopBar title="Робота" onBack={() => setScreen("WORKS")} /><main className={styles.content}><section className={styles.card}><div className={styles.taskTop}><div className={styles.carIcon}>🚗</div><div><h2>{selectedTask.vehicle}</h2><p>{selectedTask.plate}</p></div><span className={`${styles.pill} ${selectedTaskOverdue ? "" : statusTone(selectedTask.status)}`} style={selectedTaskOverdue ? overduePillStyle : undefined}>{selectedTaskOverdue ? "Прострочено" : statusLabel[selectedTask.status] || selectedTask.status}</span></div><div className={styles.metaGrid}><span>Пост<b>{selectedAppointment?.post || "—"}</b></span><span>Початок<b>{time(selectedTask.startedAt || selectedAppointment?.plannedStartAt)}</b></span><span>Тривалість<b>{duration(selectedAppointment?.plannedStartAt, selectedAppointment?.plannedEndAt)}</b></span></div>{selectedTaskOverdue && <p className={styles.subtle} style={{ color: "var(--m-danger)", fontWeight: 800 }}>Плановий час уже минув. Робота потребує рішення.</p>}</section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Роботи за комерційною пропозицією</h2><p>{selectedOrderTasks.filter((item) => isDone(item.status)).length} з {selectedOrderTasks.length} виконано</p></div></div><div className={styles.orderLines}>{selectedOrderTasks.map((item) => <div key={item.id}><i className={statusTone(item.status)}>●</i><div><strong>{item.description}</strong><small>{item.laborHours ? `${item.laborHours} нормо-год` : item.type}</small></div><span>{statusLabel[item.status] || item.status}</span></div>)}</div></section><section className={styles.card}><div className={styles.sectionHead}><div><h2>Керування роботою</h2><p>Фіксується в історії замовлення</p></div></div>{selectedTask.status === "APPROVED" && <button className={styles.primary} disabled={Boolean(busy)} onClick={() => setShowPlateVerification(true)}>▶ Почати роботу</button>}{selectedTask.status === "IN_PROGRESS" && <div className={styles.twoButtons}><button className={styles.secondary} disabled={Boolean(busy)} onClick={() => void runAction("PAUSE")}>Ⅱ Пауза</button><button className={styles.successButton} disabled={Boolean(busy)} onClick={() => void runAction("COMPLETE")}>✓ Завершити</button></div>}{selectedTask.status === "PAUSED" && <div className={styles.twoButtons}><button className={styles.primary} disabled={Boolean(busy)} onClick={() => void runAction("RESUME")}>▶ Продовжити</button><button className={styles.successButton} disabled={Boolean(busy)} onClick={() => void runAction("COMPLETE")}>✓ Завершити</button></div>}{isDone(selectedTask.status) && <div className={styles.doneBox}>✓ Роботу завершено</div>}{selectedTaskOverdue && <button type="button" className={styles.secondary} style={{ width: "100%", marginTop: 12 }} onClick={() => setShowExecutionIssue(true)}>Не можу виконати роботу</button>}<div className={styles.actionList}><button type="button" onClick={() => setScreen("FINDING")}>📷 Додати фото / виявлений дефект <span>›</span></button><button type="button" onClick={() => { setSupportKind("PART_REQUEST"); setSupportText(""); setScreen("SUPPORT"); }}>⚙ Запросити запчастину <span>›</span></button><button type="button" onClick={() => { setSupportKind("QUESTION"); setSupportText(""); setScreen("SUPPORT"); }}>💬 Поставити питання менеджеру <span>›</span></button></div></section></main>{showExecutionIssue && <MechanicExecutionIssueForm task={selectedTask} onClose={() => setShowExecutionIssue(false)} onSubmitted={(notice) => { setShowExecutionIssue(false); setMessage(notice); void loadNotifications(); }} />}{showPlateVerification && <MechanicTaskPlateVerification task={selectedTask} onClose={() => setShowPlateVerification(false)} onVerified={async () => { setShowPlateVerification(false); await runAction("START"); }} />}</>}

      {screen === "FINDING" && selectedTask && <><TopBar title="Виявлений дефект" onBack={() => setScreen("WORK_DETAIL")} /><main className={styles.content}><section className={styles.card}><h2>{selectedTask.vehicle} · {selectedTask.plate}</h2><p className={styles.subtle}>🔧 {selectedTask.description}</p></section><section className={styles.formCard}><label><span>Що виявлено *</span><textarea value={findingText} onChange={(event) => setFindingText(event.target.value)} rows={4} placeholder="Опишіть дефект або несправність" /></label><label><span>Рекомендація</span><textarea value={findingRecommendation} onChange={(event) => setFindingRecommendation(event.target.value)} rows={3} placeholder="Що рекомендуєте зробити" /></label><div><span className={styles.label}>Терміновість</span><div className={styles.segmented}>{(["INFO", "SOON", "CRITICAL"] as FindingUrgency[]).map((value) => <button type="button" key={value} className={findingUrgency === value ? styles.segmentActive : ""} onClick={() => setFindingUrgency(value)}>{value === "INFO" ? "Рекомендація" : value === "SOON" ? "Скоро" : "Критично"}</button>)}</div></div><label className={styles.photoButton}>📷 Додати фото (1–3)<input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)); setFindingFiles((current) => [...current, ...files].slice(0, 3)); event.currentTarget.value = ""; }} /></label>{findingFiles.length > 0 && <div className={styles.fileList}>{findingFiles.map((file, index) => <div key={`${file.name}-${index}`}><span>{file.name || `Фото ${index + 1}`}</span><button type="button" onClick={() => setFindingFiles((current) => current.filter((_, i) => i !== index))}>×</button></div>)}</div>}<button type="button" className={styles.primary} disabled={busy === "finding"} onClick={() => void submitFinding()}>{busy === "finding" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button></section></main></>}

      {screen === "SUPPORT" && selectedTask && <><TopBar title={supportKind === "PART_REQUEST" ? "Запит на запчастину" : "Питання менеджеру"} onBack={() => setScreen("WORK_DETAIL")} /><main className={styles.content}><section className={styles.card}><h2>{selectedTask.vehicle} · {selectedTask.plate}</h2><p className={styles.subtle}>{selectedTask.description}</p></section><section className={styles.formCard}><label><span>{supportKind === "PART_REQUEST" ? "Яка запчастина потрібна?" : "Ваше питання"}</span><textarea rows={5} value={supportText} onChange={(event) => setSupportText(event.target.value)} placeholder={supportKind === "PART_REQUEST" ? "Назва, сторона, кількість, уточнення…" : "Опишіть, що потрібно уточнити…"} /></label><button type="button" className={styles.primary} disabled={busy === "support"} onClick={() => void submitSupport()}>{busy === "support" ? "Передаю…" : "Передати сервіс-менеджеру →"}</button></section></main></>}

      {screen === "DIAGNOSTICS" && <><TopBar title="Діагностика" onBack={() => setScreen("HOME")} /><main className={styles.content}><div className={styles.pageTitle}><h1>Мої діагностики</h1><p>Лише автомобілі, призначені вам.</p></div><div className={styles.stack}>{diagnostics.map((item) => <button type="button" className={styles.listCard} key={item.id} onClick={() => openDiagnostic(item.id)}><div><h3>{item.vehicle.label}</h3><b>{item.vehicle.plateNumber || "Без номера"}</b></div><p>{item.problem || "Планова діагностика"}</p><div className={styles.meta}><span>Час <b>{time(item.plannedStartAt)}</b></span><span>Пост <b>{item.post || "—"}</b></span></div><span className={`${styles.pill} ${statusTone(item.workflowState)}`}>{statusLabel[item.workflowState] || item.workflowState}</span></button>)}</div>{!diagnostics.length && <div className={styles.empty}>{scheduledAppointments.length ? "Діагностика з’явиться після відмітки «Приїхав»." : "Призначених діагностик немає."}</div>}</main></>}

      {screen === "DIAGNOSTIC_DETAIL" && selectedDiagnosticId && <MechanicDiagnosticWorkspace diagnosticId={selectedDiagnosticId} onBack={() => { setSelectedDiagnosticId(null); setScreen("DIAGNOSTICS"); }} onChanged={() => { void Promise.all([loadDiagnostics(), loadHome(), loadTasks()]).catch(() => undefined); }} onFinished={returnToHomeAfterDiagnostic} />}

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

      {screen === "PAYROLL" && <><TopBar title="Моя зарплата" onBack={() => setScreen("PROFILE")} /><main className={styles.content}><section className={styles.payHero}><span>Прогноз за місяць</span><strong>{money(payroll?.projection?.total)}</strong><small>{payroll?.projection?.month || "Поточний місяць"}</small></section><section className={styles.card}><div className={styles.metrics}><div><b>{assignedCases}</b><span>Закріплено</span></div><div><b>{inProgress}</b><span>В роботі</span></div><div><b>{completed}</b><span>Завершено</span></div><div><b>{home.kpis?.waitingParts ?? 0}</b><span>Очікує деталей</span></div></div></section></main></>}

      {message && <div className={styles.toastGood}><span>{message}</span><button type="button" onClick={() => setMessage("")}>×</button></div>}
      {error && <div className={styles.toastBad}><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
      <BottomNav screen={screen} notificationCount={notificationCount} onChange={(next) => { if (next === "WORKS") setWorksFilter("ALL"); setScreen(next); setError(""); setMessage(""); }} />
    </div>
  </div>;
}
