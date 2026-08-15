"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from "react";
import styles from "./planner-v2.module.css";

type Status =
  | "BOOKED"
  | "ARRIVED"
  | "DIAGNOSTICS"
  | "WAITING_PARTS_SELECTION"
  | "WAITING_CALCULATION"
  | "WAITING_APPROVAL"
  | "WAITING_PARTS"
  | "READY_FOR_REPAIR"
  | "IN_REPAIR"
  | "WAITING_QC"
  | "READY_FOR_PICKUP"
  | "COMPLETED"
  | "WARRANTY"
  | "PAUSED"
  | "NO_SHOW"
  | "CANCELLED"
  | "RESERVE";

type Post = {
  id: string;
  name: string;
  sortOrder: number;
  capabilities: string[];
};

type Mechanic = {
  id: string;
  name: string;
  sortOrder: number;
};

type Location = {
  id: string;
  name: string;
  timezone: string;
  openMinute: number;
  closeMinute: number;
  posts: Post[];
  mechanics: Mechanic[];
};

type ScheduleDay = {
  day: number;
  label: string;
  enabled: boolean;
  open: string;
  close: string;
  openMinute: number;
  closeMinute: number;
};

type Appointment = {
  id: string;
  locationId: string;
  postId: string | null;
  mechanicId: string | null;
  status: Status;
  workOrderId?: string | null;
  customerName: string | null;
  phone: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  comment: string | null;
  source: string | null;
  estimatedAmount: string | number | null;
  priority: number;
  plannedStartAt: string;
  plannedEndAt: string;
  actualArrivalAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  partsEtaAt: string | null;
  post?: Post | null;
  mechanic?: Mechanic | null;
};

type BoardResponse = {
  status: string;
  locations: Location[];
  activeLocationId: string | null;
  appointments: Appointment[];
  workSchedule: ScheduleDay[];
  message?: string;
};

type EditState = {
  id: string;
  date: string;
  status: Status;
  postId: string;
  mechanicId: string;
  start: string;
  duration: string;
};

type ViewMode = "DAY" | "WEEK";

const KYIV_TZ = "Europe/Kyiv";
const SNAP_MINUTES = 15;
const FALLBACK_COLORS = ["#FF5A1F", "#2F80ED", "#7C3AED", "#16A34A", "#D97706", "#0891B2", "#DB2777"];

const STATUS_META: Record<Status, { label: string; tone: string }> = {
  BOOKED: { label: "Записаний", tone: "blue" },
  ARRIVED: { label: "Приїхав", tone: "green" },
  DIAGNOSTICS: { label: "Діагностика", tone: "violet" },
  WAITING_PARTS_SELECTION: { label: "Підбір деталей", tone: "amber" },
  WAITING_CALCULATION: { label: "Калькуляція", tone: "amber" },
  WAITING_APPROVAL: { label: "Погодження", tone: "orange" },
  WAITING_PARTS: { label: "Очікує деталі", tone: "amber" },
  READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "green" },
  IN_REPAIR: { label: "У ремонті", tone: "orange" },
  WAITING_QC: { label: "Контроль якості", tone: "cyan" },
  READY_FOR_PICKUP: { label: "Готовий до видачі", tone: "green" },
  COMPLETED: { label: "Виданий", tone: "gray" },
  WARRANTY: { label: "Гарантія", tone: "pink" },
  PAUSED: { label: "Пауза", tone: "gray" },
  NO_SHOW: { label: "No-show", tone: "red" },
  CANCELLED: { label: "Скасований", tone: "gray" },
  RESERVE: { label: "Резерв", tone: "gray" },
};

const STATUS_OPTIONS = Object.keys(STATUS_META) as Status[];
const NON_CAPACITY_STATUSES = new Set<Status>(["CANCELLED", "NO_SHOW"]);
const IMMUTABLE_DRAG_STATUSES = new Set<Status>(["COMPLETED", "NO_SHOW", "CANCELLED"]);

const pad = (value: number) => String(value).padStart(2, "0");
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function dateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(day: string, count: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dayNumber(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function formatDayTitle(day: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T12:00:00Z`));
}

function dayName(day: string) {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${day}T12:00:00Z`)).replace(".", "");
}

function minuteToClock(value: number) {
  const safe = clamp(Math.round(value), 0, 1439);
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

function clockToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function localDateTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

function clock(iso: string, timeZone: string) {
  return minuteToClock(localDateTime(new Date(iso), timeZone).minute);
}

function duration(item: Appointment) {
  return Math.max(SNAP_MINUTES, Math.round((+new Date(item.plannedEndAt) - +new Date(item.plannedStartAt)) / 60000));
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const wallClock = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return wallClock - date.getTime();
}

function toIso(day: string, minute: number, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const hour = Math.floor(minute / 60);
  const mins = minute % 60;
  const wallClock = new Date(Date.UTC(year, month - 1, date, hour, mins, 0));
  const firstOffset = timeZoneOffsetMs(wallClock, timeZone);
  const firstPass = new Date(wallClock.getTime() - firstOffset);
  const refinedOffset = timeZoneOffsetMs(firstPass, timeZone);
  return new Date(wallClock.getTime() - refinedOffset).toISOString();
}

function amount(value: Appointment["estimatedAmount"]) {
  const parsed = Number(value);
  return value != null && value !== "" && Number.isFinite(parsed)
    ? new Intl.NumberFormat("uk-UA", {
        style: "currency",
        currency: "UAH",
        maximumFractionDigits: 0,
      }).format(parsed)
    : "";
}

function postColor(post: Post, index: number) {
  return post.capabilities.find((entry) => entry.startsWith("COLOR:"))?.slice(6)
    || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function scheduleForDay(day: string, schedule: ScheduleDay[], location: Location | null) {
  const configured = schedule.find((entry) => entry.day === dayNumber(day));
  if (configured) return configured;
  const openMinute = location?.openMinute ?? 540;
  const closeMinute = location?.closeMinute ?? 1260;
  return {
    day: dayNumber(day),
    label: dayName(day),
    enabled: true,
    open: minuteToClock(openMinute),
    close: minuteToClock(closeMinute),
    openMinute,
    closeMinute,
  } satisfies ScheduleDay;
}

function isSameDay(item: Appointment, day: string, timeZone: string) {
  return localDateTime(new Date(item.plannedStartAt), timeZone).day === day;
}

function isOutsideSchedule(item: Appointment, day: string, schedule: ScheduleDay, timeZone: string) {
  const start = localDateTime(new Date(item.plannedStartAt), timeZone);
  const end = localDateTime(new Date(item.plannedEndAt), timeZone);
  return !schedule.enabled
    || start.day !== day
    || end.day !== day
    || start.minute < schedule.openMinute
    || end.minute > schedule.closeMinute;
}

function itemMinutesInsideSchedule(item: Appointment, day: string, schedule: ScheduleDay, timeZone: string) {
  if (!schedule.enabled || !isSameDay(item, day, timeZone)) return 0;
  const start = localDateTime(new Date(item.plannedStartAt), timeZone).minute;
  const end = localDateTime(new Date(item.plannedEndAt), timeZone).minute;
  return Math.max(0, Math.min(end, schedule.closeMinute) - Math.max(start, schedule.openMinute));
}

function overlapPercent(item: Appointment, schedule: ScheduleDay, timeZone: string) {
  const span = Math.max(1, schedule.closeMinute - schedule.openMinute);
  const start = localDateTime(new Date(item.plannedStartAt), timeZone).minute;
  const end = localDateTime(new Date(item.plannedEndAt), timeZone).minute;
  const left = clamp(((start - schedule.openMinute) / span) * 100, 0, 100);
  const right = clamp(((end - schedule.openMinute) / span) * 100, 0, 100);
  return { left, width: Math.max(1.3, right - left) };
}

function operationalLabel(item: Appointment, now: Date) {
  const nowMs = now.getTime();
  const startMs = new Date(item.plannedStartAt).getTime();
  const endMs = new Date(item.plannedEndAt).getTime();

  if (item.status === "IN_REPAIR" && item.actualStartAt) {
    const minutes = Math.max(0, Math.round((nowMs - new Date(item.actualStartAt).getTime()) / 60000));
    return { label: `У роботі · ${minutes} хв`, tone: "live" };
  }
  if (item.status === "ARRIVED" && item.actualArrivalAt && nowMs < endMs) {
    const minutes = Math.max(0, Math.round((nowMs - new Date(item.actualArrivalAt).getTime()) / 60000));
    return { label: `Очікує · ${minutes} хв`, tone: "waiting" };
  }
  if (!item.actualStartAt && nowMs > startMs && nowMs < endMs && !IMMUTABLE_DRAG_STATUSES.has(item.status)) {
    return { label: `Не розпочато · +${Math.round((nowMs - startMs) / 60000)} хв`, tone: "danger" };
  }
  if (!item.actualEndAt && nowMs > endMs && !IMMUTABLE_DRAG_STATUSES.has(item.status)) {
    return { label: `Перевищення · +${Math.round((nowMs - endMs) / 60000)} хв`, tone: "danger" };
  }
  return { label: STATUS_META[item.status].label, tone: STATUS_META[item.status].tone };
}

function matchesSearch(item: Appointment, query: string) {
  const value = query.trim().toLocaleLowerCase("uk-UA");
  if (!value) return true;
  return [
    item.id,
    item.workOrderId,
    item.customerName,
    item.phone,
    item.vehicleLabel,
    item.plateNumber,
    item.problem,
    item.mechanic?.name,
    item.post?.name,
  ].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(value);
}

function hoursLabel(minutes: number) {
  return `${(minutes / 60).toLocaleString("uk-UA", {
    minimumFractionDigits: minutes % 60 ? 1 : 0,
    maximumFractionDigits: 1,
  })} год`;
}

export function PlannerV2() {
  const [anchorDay, setAnchorDay] = useState(() => dateKey(new Date(), KYIV_TZ));
  const [viewMode, setViewMode] = useState<ViewMode>("DAY");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [workSchedule, setWorkSchedule] = useState<ScheduleDay[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("План робіт готовий.");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const location = useMemo(
    () => locations.find((item) => item.id === locationId) ?? locations[0] ?? null,
    [locations, locationId],
  );
  const timeZone = location?.timezone || KYIV_TZ;
  const today = dateKey(now, timeZone);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(anchorDay, index)), [anchorDay]);
  const selectedSchedule = useMemo(
    () => scheduleForDay(anchorDay, workSchedule, location),
    [anchorDay, workSchedule, location],
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        from: toIso(anchorDay, 0, timeZone),
        to: toIso(addDays(anchorDay, 7), 0, timeZone),
      });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/planner?${params}`, { cache: "no-store" });
      const data = await response.json() as BoardResponse;
      if (!response.ok) throw new Error(data.message || "Не вдалося завантажити План робіт.");
      setLocations(data.locations || []);
      setLocationId(data.activeLocationId || "");
      setAppointments(data.appointments || []);
      setWorkSchedule(data.workSchedule || []);
      setMessage("Синхронізовано з CRM.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "План робіт недоступний.");
    } finally {
      setBusy(false);
    }
  }, [anchorDay, locationId, timeZone]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 45000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const dayItems = useMemo(
    () => appointments
      .filter((item) => item.status !== "CANCELLED")
      .filter((item) => isSameDay(item, anchorDay, timeZone)),
    [appointments, anchorDay, timeZone],
  );
  const visibleDayItems = useMemo(
    () => dayItems.filter((item) => matchesSearch(item, search)),
    [dayItems, search],
  );
  const outsideScheduleItems = useMemo(
    () => visibleDayItems.filter((item) => isOutsideSchedule(item, anchorDay, selectedSchedule, timeZone)),
    [visibleDayItems, anchorDay, selectedSchedule, timeZone],
  );
  const inScheduleItems = useMemo(
    () => visibleDayItems.filter((item) => !isOutsideSchedule(item, anchorDay, selectedSchedule, timeZone)),
    [visibleDayItems, anchorDay, selectedSchedule, timeZone],
  );
  const unassignedItems = useMemo(
    () => inScheduleItems.filter((item) => !item.mechanicId),
    [inScheduleItems],
  );
  const capacityItems = useMemo(
    () => dayItems.filter((item) => !NON_CAPACITY_STATUSES.has(item.status)),
    [dayItems],
  );

  const capacityMinutes = selectedSchedule.enabled
    ? Math.max(0, selectedSchedule.closeMinute - selectedSchedule.openMinute) * (location?.mechanics.length ?? 0)
    : 0;
  const plannedMinutes = capacityItems
    .filter((item) => item.mechanicId)
    .reduce((sum, item) => sum + itemMinutesInsideSchedule(item, anchorDay, selectedSchedule, timeZone), 0);
  const loadPercent = capacityMinutes > 0 ? Math.round((plannedMinutes / capacityMinutes) * 100) : 0;
  const liveDeviations = capacityItems.filter((item) => {
    if (isOutsideSchedule(item, anchorDay, selectedSchedule, timeZone)) return true;
    if (anchorDay !== today) return false;
    const startMs = new Date(item.plannedStartAt).getTime();
    const endMs = new Date(item.plannedEndAt).getTime();
    if (!item.actualStartAt && now.getTime() > startMs && now.getTime() < endMs) return true;
    return !item.actualEndAt && now.getTime() > endMs;
  }).length;

  const timeMarkers = useMemo(() => {
    const markers: number[] = [];
    const first = Math.ceil(selectedSchedule.openMinute / 60) * 60;
    for (let minute = first; minute <= selectedSchedule.closeMinute; minute += 60) markers.push(minute);
    if (markers[0] !== selectedSchedule.openMinute) markers.unshift(selectedSchedule.openMinute);
    if (markers[markers.length - 1] !== selectedSchedule.closeMinute) markers.push(selectedSchedule.closeMinute);
    return [...new Set(markers)];
  }, [selectedSchedule]);

  const currentMinute = localDateTime(now, timeZone).minute;
  const showNowLine = anchorDay === today
    && selectedSchedule.enabled
    && currentMinute >= selectedSchedule.openMinute
    && currentMinute <= selectedSchedule.closeMinute;
  const nowLeft = showNowLine
    ? ((currentMinute - selectedSchedule.openMinute) / Math.max(1, selectedSchedule.closeMinute - selectedSchedule.openMinute)) * 100
    : 0;

  function colorForPost(postId: string | null) {
    if (!postId || !location) return "#64748B";
    const index = location.posts.findIndex((post) => post.id === postId);
    return index >= 0 ? postColor(location.posts[index], index) : "#64748B";
  }

  function openNewRequest(day = anchorDay, minute?: number, mechanicId?: string) {
    window.dispatchEvent(new CustomEvent("turbolev:open-new-request", {
      detail: {
        appointmentDate: day,
        appointmentTime: minute == null ? undefined : minuteToClock(minute),
        source: "PLANNER",
        locationId: location?.id,
        mechanicId,
      },
    }));
  }

  async function patch(id: string, payload: Record<string, unknown>, success: string) {
    try {
      const response = await fetch(`/api/planner/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не вдалося змінити наряд.");
      setMessage(success);
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося змінити наряд.");
      return false;
    }
  }

  function openEdit(item: Appointment) {
    setEdit({
      id: item.id,
      date: localDateTime(new Date(item.plannedStartAt), timeZone).day,
      status: item.status,
      postId: item.postId || "",
      mechanicId: item.mechanicId || "",
      start: clock(item.plannedStartAt, timeZone),
      duration: String(duration(item)),
    });
  }

  async function saveEdit() {
    if (!edit || !location) return;
    const daySchedule = scheduleForDay(edit.date, workSchedule, location);
    if (!daySchedule.enabled) {
      setMessage(`${daySchedule.label} — неробочий день.`);
      return;
    }
    const startMinute = clockToMinute(edit.start);
    const durationMinutes = Math.max(SNAP_MINUTES, Number(edit.duration || 60));
    setSaving(true);
    const ok = await patch(edit.id, {
      status: edit.status,
      postId: edit.postId || null,
      mechanicId: edit.mechanicId || null,
      plannedStartAt: toIso(edit.date, startMinute, timeZone),
      plannedEndAt: toIso(edit.date, startMinute + durationMinutes, timeZone),
    }, "Наряд оновлено.");
    setSaving(false);
    if (ok) setEdit(null);
  }

  async function dropOnMechanic(event: DragEvent<HTMLDivElement>, mechanicId: string) {
    event.preventDefault();
    if (!location || !selectedSchedule.enabled) return;
    const id = event.dataTransfer.getData("text/planner-appointment");
    const item = appointments.find((entry) => entry.id === id);
    if (!item || IMMUTABLE_DRAG_STATUSES.has(item.status)) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const span = selectedSchedule.closeMinute - selectedSchedule.openMinute;
    const itemDuration = duration(item);
    const requested = selectedSchedule.openMinute + ratio * span;
    const snapped = Math.round(requested / SNAP_MINUTES) * SNAP_MINUTES;
    const startMinute = clamp(
      snapped,
      selectedSchedule.openMinute,
      Math.max(selectedSchedule.openMinute, selectedSchedule.closeMinute - itemDuration),
    );

    await patch(id, {
      mechanicId,
      plannedStartAt: toIso(anchorDay, startMinute, timeZone),
      plannedEndAt: toIso(anchorDay, startMinute + itemDuration, timeZone),
    }, "Роботу переплановано.");
  }

  async function dropUnassigned(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/planner-appointment");
    const item = appointments.find((entry) => entry.id === id);
    if (!item || IMMUTABLE_DRAG_STATUSES.has(item.status)) return;
    await patch(id, { mechanicId: null }, "Роботу повернуто в нерозподілені без зміни часу.");
  }

  function timelineClick(event: MouseEvent<HTMLDivElement>, mechanicId: string) {
    if (!location || !selectedSchedule.enabled) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const span = selectedSchedule.closeMinute - selectedSchedule.openMinute;
    const requested = selectedSchedule.openMinute + ratio * span;
    const snapped = Math.round(requested / SNAP_MINUTES) * SNAP_MINUTES;
    openNewRequest(
      anchorDay,
      clamp(snapped, selectedSchedule.openMinute, selectedSchedule.closeMinute - SNAP_MINUTES),
      mechanicId,
    );
  }

  function mechanicLoad(mechanicId: string, day: string) {
    const daySchedule = scheduleForDay(day, workSchedule, location);
    if (!daySchedule.enabled) return { minutes: 0, percent: 0, jobs: 0 };
    const items = appointments.filter(
      (item) => item.mechanicId === mechanicId
        && !NON_CAPACITY_STATUSES.has(item.status)
        && isSameDay(item, day, timeZone),
    );
    const minutes = items.reduce(
      (sum, item) => sum + itemMinutesInsideSchedule(item, day, daySchedule, timeZone),
      0,
    );
    return {
      minutes,
      percent: Math.round((minutes / Math.max(1, daySchedule.closeMinute - daySchedule.openMinute)) * 100),
      jobs: items.length,
    };
  }

  function renderAppointmentCard(item: Appointment, compact = false) {
    const position = overlapPercent(item, selectedSchedule, timeZone);
    const operational = operationalLabel(item, now);
    const cardStyle = compact
      ? { "--post-color": colorForPost(item.postId) } as CSSProperties
      : {
          "--card-left": `${position.left}%`,
          "--card-width": `${position.width}%`,
          "--post-color": colorForPost(item.postId),
        } as CSSProperties;
    const isViolation = isOutsideSchedule(item, anchorDay, selectedSchedule, timeZone);

    return (
      <button
        key={item.id}
        className={`${styles.timelineCard} ${isViolation ? styles.violationCard : ""}`}
        style={cardStyle}
        draggable={!IMMUTABLE_DRAG_STATUSES.has(item.status)}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/planner-appointment", item.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={(event) => {
          event.stopPropagation();
          openEdit(item);
        }}
        title={`${clock(item.plannedStartAt, timeZone)}–${clock(item.plannedEndAt, timeZone)} · ${item.problem || ""}`}
      >
        <div className={styles.cardLine}>
          <strong>{item.plateNumber || "БЕЗ НОМЕРА"}</strong>
          <span>{clock(item.plannedStartAt, timeZone)}–{clock(item.plannedEndAt, timeZone)}</span>
        </div>
        <div className={styles.vehicleLine}>{item.vehicleLabel || "Автомобіль"}</div>
        <div className={styles.cardMeta}>
          <em className={`${styles.stateBadge} ${styles[`state_${operational.tone}`]}`}>
            {operational.label}
          </em>
          {item.post?.name && <span>{item.post.name}</span>}
          {amount(item.estimatedAmount) && <b>{amount(item.estimatedAmount)}</b>}
        </div>
      </button>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>TURBO LEV / СТО {(location?.name || "ГЛЕВАХА").toUpperCase()}</p>
          <h1>План робіт</h1>
          <span>Виробнича дошка по реальних механіках і робочому часу СТО</span>
        </div>
        <button className={styles.primary} onClick={() => openNewRequest(anchorDay)}>+ Нова заявка</button>
      </header>

      <section className={styles.controlBar}>
        <div className={styles.dateControl}>
          <button onClick={() => setAnchorDay(addDays(anchorDay, -1))}>‹</button>
          <div>
            <strong>{formatDayTitle(anchorDay)}</strong>
            <span>{selectedSchedule.enabled ? `${selectedSchedule.open}–${selectedSchedule.close}` : "Вихідний"}</span>
          </div>
          <button onClick={() => setAnchorDay(addDays(anchorDay, 1))}>›</button>
          <button className={styles.todayButton} onClick={() => setAnchorDay(today)} disabled={anchorDay === today}>
            Сьогодні
          </button>
        </div>

        <div className={styles.viewSwitch}>
          <button className={viewMode === "DAY" ? styles.activeView : ""} onClick={() => setViewMode("DAY")}>День</button>
          <button className={viewMode === "WEEK" ? styles.activeView : ""} onClick={() => setViewMode("WEEK")}>Тиждень</button>
        </div>

        {locations.length > 1 && (
          <select className={styles.locationSelect} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}

        <div className={styles.compactSearch}>
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Авто, номер, клієнт, наряд..." />
        </div>
      </section>

      <section className={styles.metricsStrip}>
        <div><strong>{location?.mechanics.length ?? 0}</strong><span>механіки сьогодні</span></div>
        <div><strong>{hoursLabel(capacityMinutes)}</strong><span>доступна потужність</span></div>
        <div><strong>{hoursLabel(plannedMinutes)}</strong><span>заплановано</span></div>
        <div><strong>{loadPercent}%</strong><span>завантаження</span></div>
        <div><strong>{dayItems.filter((item) => !item.mechanicId).length}</strong><span>без виконавця</span></div>
        <div className={liveDeviations ? styles.metricAlert : ""}><strong>{liveDeviations}</strong><span>відхилення</span></div>
      </section>

      <div className={styles.systemMessage}>{busy ? "Оновлюю картину…" : message}</div>

      {viewMode === "DAY" ? (
        <>
          {outsideScheduleItems.length > 0 && (
            <section className={styles.alertQueue}>
              <div className={styles.queueTitle}>
                <div><strong>Поза робочим графіком</strong><span>Ці записи потрібно перепланувати в доступний час.</span></div>
                <b>{outsideScheduleItems.length}</b>
              </div>
              <div className={styles.queueCards}>{outsideScheduleItems.map((item) => renderAppointmentCard(item, true))}</div>
            </section>
          )}

          <section
            className={styles.unassignedQueue}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void dropUnassigned(event)}
          >
            <div className={styles.queueTitle}>
              <div><strong>Нерозподілені роботи</strong><span>Перетягніть картку на рядок потрібного механіка.</span></div>
              <b>{unassignedItems.length}</b>
            </div>
            {unassignedItems.length > 0
              ? <div className={styles.queueCards}>{unassignedItems.map((item) => renderAppointmentCard(item, true))}</div>
              : <span className={styles.queueEmpty}>Усі роботи мають виконавця.</span>}
          </section>

          {!selectedSchedule.enabled ? (
            <section className={styles.closedDay}>
              <strong>{selectedSchedule.label} — СТО не працює</strong>
              <span>Нові виробничі слоти на цей день заблоковані графіком.</span>
            </section>
          ) : (
            <section className={styles.timelineShell}>
              <div className={styles.timelineScroll}>
                <div className={styles.timelineBoard}>
                  <div className={styles.timelineHeader}>
                    <div className={styles.mechanicHeading}>Механік / завантаження</div>
                    <div className={styles.timeAxis}>
                      {timeMarkers.map((minute) => {
                        const left = ((minute - selectedSchedule.openMinute) / Math.max(1, selectedSchedule.closeMinute - selectedSchedule.openMinute)) * 100;
                        return <span key={minute} style={{ left: `${left}%` }} className={styles.timeLabel}>{minuteToClock(minute)}</span>;
                      })}
                      {showNowLine && <span className={styles.nowAxis} style={{ left: `${nowLeft}%` }}><b>ЗАРАЗ</b></span>}
                    </div>
                  </div>

                  {(location?.mechanics || []).map((mechanic) => {
                    const mechanicItems = inScheduleItems
                      .filter((item) => item.mechanicId === mechanic.id)
                      .sort((left, right) => +new Date(left.plannedStartAt) - +new Date(right.plannedStartAt));
                    const load = mechanicLoad(mechanic.id, anchorDay);
                    return (
                      <div className={styles.mechanicRow} key={mechanic.id}>
                        <div className={styles.mechanicCell}>
                          <div className={styles.mechanicAvatar}>
                            {mechanic.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                          </div>
                          <div><strong>{mechanic.name}</strong><span>{hoursLabel(load.minutes)} · {load.percent}%</span></div>
                          <i className={`${styles.loadDot} ${load.percent > 100 ? styles.overloaded : ""}`} title={`${load.percent}% завантаження`} />
                        </div>
                        <div
                          className={styles.timelineLane}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => void dropOnMechanic(event, mechanic.id)}
                          onClick={(event) => timelineClick(event, mechanic.id)}
                          title="Клік по вільному часу — нова заявка. Перетягування — перепланування."
                        >
                          {timeMarkers.map((minute) => {
                            const left = ((minute - selectedSchedule.openMinute) / Math.max(1, selectedSchedule.closeMinute - selectedSchedule.openMinute)) * 100;
                            return <i key={minute} className={styles.gridLine} style={{ left: `${left}%` }} />;
                          })}
                          {showNowLine && <i className={styles.nowLine} style={{ left: `${nowLeft}%` }} />}
                          {mechanicItems.map((item) => renderAppointmentCard(item))}
                          {mechanicItems.length === 0 && <span className={styles.freeHint}>Вільний час</span>}
                        </div>
                      </div>
                    );
                  })}

                  {(location?.mechanics.length ?? 0) === 0 && (
                    <div className={styles.noMechanics}>У «Налаштування → Персонал» немає активних механіків для цієї локації.</div>
                  )}
                </div>
              </div>
              <p className={styles.helpText}>
                Перетягніть роботу по горизонталі — зміниться час; на інший рядок — зміниться механік. Клік по вільній ділянці відкриває «Нову заявку» з обраними датою та часом.
              </p>
            </section>
          )}
        </>
      ) : (
        <section className={styles.weekShell}>
          <div className={styles.weekGrid}>
            <div className={`${styles.weekCell} ${styles.weekHeadCell}`}>Механік</div>
            {days.map((day) => {
              const schedule = scheduleForDay(day, workSchedule, location);
              return (
                <button
                  key={day}
                  className={`${styles.weekCell} ${styles.weekDayHead} ${day === today ? styles.weekToday : ""}`}
                  onClick={() => { setAnchorDay(day); setViewMode("DAY"); }}
                >
                  <strong>{dayName(day)}</strong>
                  <span>{new Date(`${day}T12:00:00Z`).getUTCDate()}</span>
                  <small>{schedule.enabled ? `${schedule.open}–${schedule.close}` : "Вихідний"}</small>
                </button>
              );
            })}

            {(location?.mechanics || []).map((mechanic) => (
              <div className={styles.weekRow} key={mechanic.id}>
                <div className={`${styles.weekCell} ${styles.weekMechanic}`}><strong>{mechanic.name}</strong></div>
                {days.map((day) => {
                  const schedule = scheduleForDay(day, workSchedule, location);
                  const load = mechanicLoad(mechanic.id, day);
                  const cellClass = !schedule.enabled
                    ? styles.weekClosed
                    : load.percent >= 100
                      ? styles.weekFull
                      : load.percent >= 75
                        ? styles.weekBusy
                        : load.percent >= 40
                          ? styles.weekMedium
                          : styles.weekLight;
                  return (
                    <button
                      key={day}
                      className={`${styles.weekCell} ${styles.weekLoad} ${cellClass}`}
                      onClick={() => { setAnchorDay(day); setViewMode("DAY"); }}
                    >
                      {schedule.enabled
                        ? <><strong>{load.percent}%</strong><span>{hoursLabel(load.minutes)}</span><small>{load.jobs} роб.</small></>
                        : <strong>Вихідний</strong>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      )}

      {edit && location && (
        <div className={styles.modalBackdrop} onMouseDown={() => setEdit(null)}>
          <section className={styles.modal} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHead}>
              <div><p>РЕДАГУВАННЯ ВИРОБНИЧОГО СЛОТУ</p><h2>{appointments.find((item) => item.id === edit.id)?.plateNumber || "Наряд"}</h2></div>
              <button onClick={() => setEdit(null)}>×</button>
            </div>
            <div className={styles.formGrid}>
              <label><span>Дата</span><input type="date" value={edit.date} onChange={(event) => setEdit({ ...edit, date: event.target.value })} /></label>
              <label><span>Початок</span><input type="time" step={SNAP_MINUTES * 60} value={edit.start} onChange={(event) => setEdit({ ...edit, start: event.target.value })} /></label>
              <label><span>Тривалість, хв</span><input type="number" min={SNAP_MINUTES} step={SNAP_MINUTES} value={edit.duration} onChange={(event) => setEdit({ ...edit, duration: event.target.value })} /></label>
              <label>
                <span>Механік</span>
                <select value={edit.mechanicId} onChange={(event) => setEdit({ ...edit, mechanicId: event.target.value })}>
                  <option value="">Нерозподілено</option>
                  {location.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}
                </select>
              </label>
              <label>
                <span>Пост</span>
                <select value={edit.postId} onChange={(event) => setEdit({ ...edit, postId: event.target.value })}>
                  <option value="">Без поста / зона приймання</option>
                  {location.posts.map((post) => <option key={post.id} value={post.id}>{post.name}</option>)}
                </select>
              </label>
              <label>
                <span>Статус</span>
                <select value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as Status })}>
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
                </select>
              </label>
            </div>
            <div className={styles.modalSchedule}>
              {(() => {
                const schedule = scheduleForDay(edit.date, workSchedule, location);
                return schedule.enabled ? `Графік на ${schedule.label}: ${schedule.open}–${schedule.close}` : `${schedule.label}: вихідний`;
              })()}
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.secondary} onClick={() => setEdit(null)}>Скасувати</button>
              <button className={styles.primary} onClick={() => void saveEdit()} disabled={saving}>{saving ? "Зберігаю…" : "Зберегти"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
