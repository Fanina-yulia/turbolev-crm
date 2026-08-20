"use client";

import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import styles from "./planner-day-view.module.css";

type Post = { id: string; name: string; sortOrder?: number; capabilities?: string[] };
type Mechanic = { id: string; name: string; sortOrder?: number };
type Location = {
  id: string;
  name: string;
  timezone: string;
  openMinute: number;
  closeMinute: number;
  posts: Post[];
  mechanics: Mechanic[];
};
type Lifecycle = {
  code: string;
  label: string;
  tone: "neutral" | "info" | "accent" | "warning" | "success" | "danger";
  flags: string[];
};
type AppointmentBase = {
  id: string;
  locationId: string;
  postId: string | null;
  mechanicId: string | null;
  status: string;
  lifecycle?: Lifecycle | null;
  customerName: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  estimatedAmount?: string | number | null;
  plannedStartAt: string;
  plannedEndAt: string;
  post?: Post | null;
  mechanic?: Mechanic | null;
};
type AvailabilitySlot = { time: string; posts: Array<{ id: string; available: boolean }> };
type AvailabilityResponse = { status: string; slots?: AvailabilitySlot[]; message?: string };
type Row = { id: string; name: string; type: string; reception?: boolean; color: string };
type SlotSelection = { rowId: string; startIndex: number; endIndex: number };
type StatusMeta = { label: string; tone: "blue" | "green" | "orange" | "amber" | "red" | "gray" | "violet" | "cyan" };

const SLOT = 30;
const DURATION_COOKIE = "turbolev_booking_duration_minutes";
const CONTEXT_COOKIE = "turbolev_booking_context";
const NON_BLOCKING = new Set(["NO_SHOW", "CANCELLED"]);
const CANONICAL_IN_PROGRESS = new Set(["IN_WORK", "IN_REPAIR", "QUALITY_CONTROL"]);
const CANONICAL_WAITING = new Set(["DIAGNOSTIC_COMPLETED", "MANAGER_REVIEW", "CLIENT_DECISION", "PARTS_SELECTION", "WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "WAITING_PAYMENT", "READY_FOR_PICKUP"]);
const POST_COLORS = ["#ff6600", "#2f80ed", "#7c3aed", "#16a34a", "#d97706", "#0891b2"];
const STATUS_META: Record<string, StatusMeta> = {
  BOOKED: { label: "Заплановано", tone: "blue" },
  ARRIVED: { label: "В роботі", tone: "blue" },
  DIAGNOSTICS: { label: "В роботі", tone: "blue" },
  WAITING_PARTS_SELECTION: { label: "Підбір деталей", tone: "amber" },
  WAITING_CALCULATION: { label: "Очікує погодження", tone: "amber" },
  WAITING_APPROVAL: { label: "Очікує погодження", tone: "orange" },
  WAITING_PARTS: { label: "Очікує деталі", tone: "orange" },
  READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "green" },
  IN_REPAIR: { label: "У ремонті", tone: "blue" },
  WAITING_QC: { label: "Контроль якості", tone: "cyan" },
  WAITING_PAYMENT: { label: "Очікує оплату", tone: "amber" },
  READY_FOR_PICKUP: { label: "Готовий до видачі", tone: "green" },
  COMPLETED: { label: "Видано", tone: "green" },
  WARRANTY: { label: "У ремонті", tone: "orange" },
  PAUSED: { label: "У ремонті", tone: "gray" },
  NO_SHOW: { label: "Скасовано", tone: "red" },
  CANCELLED: { label: "Скасовано", tone: "gray" },
  RESERVE: { label: "Заплановано", tone: "gray" },
};
const RAW_TO_CANONICAL: Record<string, string> = {
  BOOKED: "PLANNED",
  RESERVE: "PLANNED",
  ARRIVED: "IN_WORK",
  DIAGNOSTICS: "IN_WORK",
  WAITING_PARTS_SELECTION: "PARTS_SELECTION",
  WAITING_CALCULATION: "WAITING_APPROVAL",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  WAITING_PARTS: "WAITING_PARTS",
  READY_FOR_REPAIR: "READY_FOR_REPAIR",
  IN_REPAIR: "IN_REPAIR",
  PAUSED: "IN_REPAIR",
  WARRANTY: "IN_REPAIR",
  WAITING_QC: "QUALITY_CONTROL",
  WAITING_PAYMENT: "WAITING_PAYMENT",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  COMPLETED: "DELIVERED",
  NO_SHOW: "CANCELLED",
  CANCELLED: "CANCELLED",
};
const LIFECYCLE_TONE: Record<Lifecycle["tone"], StatusMeta["tone"]> = {
  neutral: "gray",
  info: "cyan",
  accent: "blue",
  warning: "amber",
  success: "green",
  danger: "red",
};

function canonicalCode(item: AppointmentBase) {
  return item.lifecycle?.code || RAW_TO_CANONICAL[item.status] || item.status;
}

function statusView(item: AppointmentBase): StatusMeta & { overdue: boolean } {
  if (item.lifecycle) {
    const overdue = item.lifecycle.flags.includes("OVERDUE");
    return { label: item.lifecycle.label, tone: overdue ? "red" : LIFECYCLE_TONE[item.lifecycle.tone], overdue };
  }
  const fallback = STATUS_META[item.status] || { label: item.status, tone: "gray" as const };
  return { ...fallback, overdue: false };
}

function minuteLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

function postType(post: Post) {
  const type = post.capabilities?.find((item) => item.startsWith("TYPE:"))?.slice(5);
  return type === "PIT" ? "Яма" : type === "ALIGNMENT" ? "Розвал-сходження" : type === "NO_LIFT" ? "Без підйомника" : "Підйомник";
}

function postColor(post: Post, index: number) {
  return post.capabilities?.find((item) => item.startsWith("COLOR:"))?.slice(6) || POST_COLORS[index % POST_COLORS.length];
}

function overlapMinutes(start: number, end: number, openMinute: number, closeMinute: number) {
  return Math.max(0, Math.min(end, closeMinute) - Math.max(start, openMinute));
}

function currency(value: number) {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}

export function PlannerDayView<TAppointment extends AppointmentBase>({ day, location, appointments, onOpen, onCreate }: {
  day: string;
  location: Location;
  appointments: TAppointment[];
  onOpen: (appointment: TAppointment) => void;
  onCreate: (day: string, time: string, postId: string) => void;
}) {
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const timeZone = location.timezone || "Europe/Kyiv";
  const openMinute = Number.isFinite(location.openMinute) ? location.openMinute : 540;
  const closeMinute = Number.isFinite(location.closeMinute) ? location.closeMinute : 1260;
  const totalDayMinutes = Math.max(SLOT, closeMinute - openMinute);

  const slots = useMemo(() => {
    const result: number[] = [];
    for (let minute = openMinute; minute < closeMinute; minute += SLOT) result.push(minute);
    return result;
  }, [openMinute, closeMinute]);

  const rows = useMemo<Row[]>(() => [
    ...location.posts.map((post, index) => ({ id: post.id, name: post.name, type: postType(post), color: postColor(post, index) })),
    { id: "__RECEPTION__", name: "Без поста", type: "Зона приймання", reception: true, color: "#64748b" },
  ], [location.posts]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const params = new URLSearchParams({ date: day, locationId: location.id, durationMinutes: "30" });
        const response = await fetch(`/api/planner/availability?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as AvailabilityResponse;
        if (!response.ok || payload.status !== "OK") throw new Error(payload.message || "Не вдалося перевірити доступність.");
        setAvailability(payload);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Не вдалося перевірити доступність.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [day, location.id]);

  useEffect(() => {
    const cancelSelection = () => setSelection(null);
    window.addEventListener("blur", cancelSelection);
    return () => window.removeEventListener("blur", cancelSelection);
  }, []);

  const dayAppointments = useMemo(() => appointments
    .filter((item) => item.locationId === location.id && localParts(item.plannedStartAt, timeZone).day === day && canonicalCode(item) !== "CANCELLED")
    .sort((a, b) => +new Date(a.plannedStartAt) - +new Date(b.plannedStartAt)), [appointments, location.id, timeZone, day]);

  const availabilityMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const slot of availability?.slots || []) {
      for (const post of slot.posts) map.set(`${slot.time}:${post.id}`, post.available);
    }
    return map;
  }, [availability]);

  const resourceLoad = useMemo(() => {
    const result = new Map<string, number>();
    for (const row of rows) {
      const occupied = dayAppointments
        .filter((item) => row.reception ? !item.postId : item.postId === row.id)
        .filter((item) => !NON_BLOCKING.has(item.status))
        .reduce((sum, item) => {
          const start = localParts(item.plannedStartAt, timeZone).minute;
          const end = localParts(item.plannedEndAt, timeZone).minute;
          return sum + overlapMinutes(start, end, openMinute, closeMinute);
        }, 0);
      result.set(row.id, Math.min(100, Math.round((occupied / totalDayMinutes) * 100)));
    }
    return result;
  }, [rows, dayAppointments, timeZone, openMinute, closeMinute, totalDayMinutes]);

  const metrics = useMemo(() => {
    const completed = dayAppointments.filter((item) => canonicalCode(item) === "DELIVERED").length;
    const inProgress = dayAppointments.filter((item) => CANONICAL_IN_PROGRESS.has(canonicalCode(item))).length;
    const waiting = dayAppointments.filter((item) => CANONICAL_WAITING.has(canonicalCode(item))).length;
    const freeSlots = Array.from(availabilityMap.values()).filter(Boolean).length;
    const revenue = dayAppointments.reduce((sum, item) => {
      const value = Number(item.estimatedAmount);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    return { total: dayAppointments.length, completed, inProgress, waiting, freeSlots, revenue };
  }, [dayAppointments, availabilityMap]);

  function rowHasAppointment(row: Row, minute: number) {
    const slotEnd = minute + SLOT;
    return dayAppointments.some((item) => {
      if (row.reception ? Boolean(item.postId) : item.postId !== row.id) return false;
      const start = localParts(item.plannedStartAt, timeZone).minute;
      const end = localParts(item.plannedEndAt, timeZone).minute;
      return start < slotEnd && end > minute;
    });
  }

  function slotAvailable(row: Row, slotIndex: number) {
    const minute = slots[slotIndex];
    if (minute === undefined || rowHasAppointment(row, minute)) return false;
    if (row.reception) return true;
    return availabilityMap.get(`${minuteLabel(minute)}:${row.id}`) === true;
  }

  function canSelectRange(row: Row, startIndex: number, endIndex: number) {
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    for (let index = from; index <= to; index += 1) {
      if (!slotAvailable(row, index)) return false;
    }
    return true;
  }

  function beginSelection(event: ReactMouseEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    if (event.button !== 0 || !slotAvailable(row, slotIndex)) return;
    event.preventDefault();
    setSelection({ rowId: row.id, startIndex: slotIndex, endIndex: slotIndex });
  }

  function extendSelection(event: ReactMouseEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    if (!selection || selection.rowId !== row.id || event.buttons !== 1) return;
    if (!canSelectRange(row, selection.startIndex, slotIndex)) return;
    setSelection((current) => current ? { ...current, endIndex: slotIndex } : current);
  }

  function commitSelection(event: ReactMouseEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    if (!selection || selection.rowId !== row.id) return;
    event.preventDefault();
    const endIndex = canSelectRange(row, selection.startIndex, slotIndex) ? slotIndex : selection.endIndex;
    const from = Math.min(selection.startIndex, endIndex);
    const to = Math.max(selection.startIndex, endIndex);
    const startTime = minuteLabel(slots[from]);
    const durationMinutes = (to - from + 1) * SLOT;
    const context = {
      date: day,
      time: startTime,
      durationMinutes,
      locationId: location.id,
      postId: row.reception ? "" : row.id,
    };
    document.cookie = `${DURATION_COOKIE}=${durationMinutes}; Path=/; Max-Age=1800; SameSite=Lax`;
    document.cookie = `${CONTEXT_COOKIE}=${encodeURIComponent(JSON.stringify(context))}; Path=/; Max-Age=1800; SameSite=Lax`;
    setSelection(null);
    onCreate(day, startTime, row.reception ? "" : row.id);
  }

  const resourceWidth = 164;
  const gridStyle = { gridTemplateColumns: `${resourceWidth}px repeat(${slots.length}, minmax(0, 1fr))` } as CSSProperties;
  const now = new Date();
  const nowParts = localParts(now.toISOString(), timeZone);
  const nowMinute = nowParts.minute;
  const showNow = nowParts.day === day && nowMinute >= openMinute && nowMinute < closeMinute;
  const nowRatio = showNow ? (nowMinute - openMinute) / totalDayMinutes : 0;
  const nowStyle = { left: `calc(${resourceWidth}px + (100% - ${resourceWidth}px) * ${nowRatio})` } as CSSProperties;

  return <div className={styles.wrap}>
    <section className={styles.kpis} aria-label="Показники дня">
      <article><span className={styles.kpiIcon}>▣</span><div><strong>{metrics.total}</strong><small>Записів<br/>на сьогодні</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiGreen}`}>✓</span><div><strong>{metrics.completed}</strong><small>Видано</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiBlue}`}>◌</span><div><strong>{metrics.inProgress}</strong><small>В роботі</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiOrange}`}>◷</span><div><strong>{metrics.waiting}</strong><small>Очікують дії</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiGreen}`}>◴</span><div><strong>{metrics.freeSlots}</strong><small>Вільних слотів<br/>по 30 хв</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiGreen}`}>₴</span><div><strong>{currency(metrics.revenue)}</strong><small>Очікуваний виторг<br/>за день</small></div></article>
    </section>

    <div className={styles.meta}>
      <div><strong>{location.name}</strong> · {minuteLabel(openMinute)}–{minuteLabel(closeMinute)} · крок 30 хв</div>
      <div>{loading ? "Оновлюю доступність…" : error || "Затисніть мишу на вільній клітинці та протягніть до часу завершення"}</div>
    </div>

    <div className={styles.board}>
      <div className={styles.grid} style={gridStyle} onMouseLeave={() => selection && setSelection(selection)}>
        <div className={styles.corner} style={{ gridColumn: 1, gridRow: 1 }}>Пости / ресурси</div>
        {slots.map((minute, index) => <div className={styles.time} key={minute} style={{ gridColumn: index + 2, gridRow: 1 }}>{minuteLabel(minute)}</div>)}

        {rows.map((row, rowIndex) => {
          const gridRow = rowIndex + 2;
          const loadPercent = resourceLoad.get(row.id) || 0;
          return <div key={row.id} style={{ display: "contents" }}>
            <div className={styles.resource} style={{ gridColumn: 1, gridRow, "--resource-color": row.color } as CSSProperties}>
              <div className={styles.resourceTitle}><i/><b>{row.name}</b><button type="button" tabIndex={-1} aria-hidden="true">⋮</button></div>
              <span>{row.type}</span>
              <div className={styles.resourceProgress}><i style={{ width: `${loadPercent}%` }}/></div>
              <small>{loadPercent}% зайнято</small>
            </div>
            {slots.map((minute, slotIndex) => {
              const available = slotAvailable(row, slotIndex);
              const selected = selection?.rowId === row.id && slotIndex >= Math.min(selection.startIndex, selection.endIndex) && slotIndex <= Math.max(selection.startIndex, selection.endIndex);
              const cellClass = available ? styles.free : styles.busy;
              const time = minuteLabel(minute);
              return <button
                type="button"
                aria-label={`${row.name} ${time}: ${available ? "вільно" : "зайнято"}`}
                title={available ? `${row.name} · ${time} · вільно` : `${row.name} · ${time} · зайнято`}
                className={`${styles.cell} ${cellClass} ${selected ? styles.selected : ""}`}
                key={`${row.id}-${minute}`}
                style={{ gridColumn: slotIndex + 2, gridRow }}
                disabled={!available}
                onMouseDown={(event) => beginSelection(event, row, slotIndex)}
                onMouseEnter={(event) => extendSelection(event, row, slotIndex)}
                onMouseUp={(event) => commitSelection(event, row, slotIndex)}
              />;
            })}
          </div>;
        })}

        {dayAppointments.map((item) => {
          const rowIndex = item.postId ? rows.findIndex((row) => row.id === item.postId) : rows.findIndex((row) => row.reception);
          if (rowIndex < 0) return null;
          const start = localParts(item.plannedStartAt, timeZone).minute;
          const end = localParts(item.plannedEndAt, timeZone).minute;
          const clippedStart = Math.max(openMinute, start);
          const clippedEnd = Math.min(closeMinute, Math.max(clippedStart + SLOT, end));
          if (clippedStart >= closeMinute || clippedEnd <= openMinute) return null;
          const startIndex = Math.max(0, Math.floor((clippedStart - openMinute) / SLOT));
          const span = Math.max(1, Math.ceil((clippedEnd - clippedStart) / SLOT));
          const done = canonicalCode(item) === "DELIVERED";
          const row = rows[rowIndex];
          const status = statusView(item);
          return <button
            type="button"
            key={item.id}
            className={`${styles.event} ${styles[`event_${status.tone}`]} ${done ? styles.eventDone : ""}`}
            style={{ gridColumn: `${startIndex + 2} / span ${span}`, gridRow: rowIndex + 2, "--event-color": row.color } as CSSProperties}
            onClick={() => onOpen(item)}
            title={`${item.plateNumber || "Без номера"} · ${minuteLabel(start)}–${minuteLabel(end)}`}
          >
            <small className={styles.eventTime}>{minuteLabel(start)}–{minuteLabel(end)}</small>
            <strong>{item.plateNumber || "БЕЗ НОМЕРА"}</strong>
            <b>{item.vehicleLabel || "Автомобіль"}</b>
            <span>{item.problem || item.customerName || item.mechanic?.name || "Запис на СТО"}</span>
            <em><i/>{status.overdue ? `Протерміновано · ${status.label}` : status.label}</em>
          </button>;
        })}
        {showNow && <div className={styles.now} style={nowStyle} aria-hidden="true" />}
      </div>
      {!location.posts.length && <div className={styles.empty}>У локації ще не створено жодного сервісного поста.</div>}
    </div>

    <div className={styles.legend}>
      <span><i className={styles.legendBlue}/>В роботі</span>
      <span><i className={styles.legendOrange}/>Очікує дії</span>
      <span><i className={styles.legendAmber}/>Очікує клієнта / деталі</span>
      <span><i className={styles.legendGreen}/>Готово / видано</span>
      <span><i className={styles.legendFree}/>Вільний слот</span>
      <span><i className={styles.legendSelected}/>Обраний час</span>
    </div>
  </div>;
}
