"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { zonedDateTimeToDate } from "@/src/lib/zoned-time";
import { VehiclePlate } from "./vehicle-plate";
import styles from "./planner-day-view.module.css";
import compactStyles from "./planner-day-view-compact.module.css";

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
type AppointmentBase = {
  id: string;
  locationId: string;
  postId: string | null;
  mechanicId: string | null;
  status: string;
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
type ResizeEdge = "start" | "end";
type ResizeState = {
  id: string;
  edge: ResizeEdge;
  startMinute: number;
  endMinute: number;
  originalStartMinute: number;
  originalEndMinute: number;
  valid: boolean;
};
type StatusMeta = { label: string; tone: "blue" | "green" | "orange" | "amber" | "red" | "gray" | "violet" | "cyan" };

export type PlannerTimeSelection = {
  day: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  locationId: string;
  postId: string;
};

export type PlannerDayMetrics = {
  total: number;
  completed: number;
  inProgress: number;
  waiting: number;
  freeSlots: number;
  revenue: number;
};

const SLOT = 30;
const DURATION_COOKIE = "turbolev_booking_duration_minutes";
const CONTEXT_COOKIE = "turbolev_booking_context";
const NON_BLOCKING = new Set(["NO_SHOW", "CANCELLED"]);
const NON_DRAGGABLE = new Set(["COMPLETED", "NO_SHOW", "CANCELLED", "RESERVE"]);
const IN_PROGRESS = new Set(["ARRIVED", "DIAGNOSTICS", "IN_REPAIR", "WAITING_QC"]);
const WAITING = new Set(["WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "READY_FOR_PICKUP", "PAUSED"]);
const POST_COLORS = ["#ff6600", "#2f80ed", "#7c3aed", "#16a34a", "#d97706", "#0891b2"];
const STATUS_META: Record<string, StatusMeta> = {
  BOOKED: { label: "Записаний", tone: "blue" },
  ARRIVED: { label: "Приїхав", tone: "green" },
  DIAGNOSTICS: { label: "Діагностика", tone: "violet" },
  WAITING_PARTS_SELECTION: { label: "Очікує підбору", tone: "amber" },
  WAITING_CALCULATION: { label: "Очікує калькуляції", tone: "amber" },
  WAITING_APPROVAL: { label: "Очікує погодження", tone: "orange" },
  WAITING_PARTS: { label: "Очікує запчастини", tone: "orange" },
  READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "green" },
  IN_REPAIR: { label: "В роботі", tone: "blue" },
  WAITING_QC: { label: "Контроль якості", tone: "cyan" },
  READY_FOR_PICKUP: { label: "Очікує клієнта", tone: "amber" },
  COMPLETED: { label: "Виконано", tone: "green" },
  WARRANTY: { label: "Гарантія", tone: "orange" },
  PAUSED: { label: "Пауза", tone: "gray" },
  NO_SHOW: { label: "Не приїхав", tone: "red" },
  CANCELLED: { label: "Скасовано", tone: "gray" },
  RESERVE: { label: "Резерв", tone: "gray" },
};

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

export function PlannerDayView<TAppointment extends AppointmentBase>({ day, location, appointments, onOpen, onCreate, onSelection, onResize, onMove, onMetrics, showMetrics = true, compact = false }: {
  day: string;
  location: Location;
  appointments: TAppointment[];
  onOpen: (appointment: TAppointment) => void;
  onCreate: (day: string, time: string, postId: string) => void;
  onSelection?: (selection: PlannerTimeSelection) => void;
  onResize?: (appointment: TAppointment, day: string, startTime: string, endTime: string) => Promise<boolean>;
  onMetrics?: (metrics: PlannerDayMetrics) => void;
  onMove?: (appointment: TAppointment, day: string, time: string, postId: string, durationMinutes: number) => void;
  showMetrics?: boolean;
  compact?: boolean;
}) {
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const skipNextClickRef = useRef(false);
  const [draggingAppointmentId, setDraggingAppointmentId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ rowId: string; slotIndex: number } | null>(null);
  const suppressDragClickRef = useRef(false);
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
      }
    })();
    return () => controller.abort();
  }, [day, location.id]);

  useEffect(() => {
    const cancelSelection = () => setSelection(null);
    window.addEventListener("blur", cancelSelection);
    return () => window.removeEventListener("blur", cancelSelection);
  }, []);

  useEffect(() => {
    setSelection(null);
    skipNextClickRef.current = false;
    setResize(null);
    resizeRef.current = null;
  }, [day, location.id]);

  const dayAppointments = useMemo(() => appointments
    .filter((item) => item.locationId === location.id && localParts(item.plannedStartAt, timeZone).day === day && item.status !== "CANCELLED")
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
    const completed = dayAppointments.filter((item) => item.status === "COMPLETED").length;
    const inProgress = dayAppointments.filter((item) => IN_PROGRESS.has(item.status)).length;
    const waiting = dayAppointments.filter((item) => WAITING.has(item.status)).length;
    const freeSlots = Array.from(availabilityMap.values()).filter(Boolean).length;
    const revenue = dayAppointments.reduce((sum, item) => {
      const value = Number(item.estimatedAmount);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    return { total: dayAppointments.length, completed, inProgress, waiting, freeSlots, revenue };
  }, [dayAppointments, availabilityMap]);

  useEffect(() => {
    onMetrics?.(metrics);
  }, [metrics, onMetrics]);

  const resizeHandler = onResize ?? (async (item: TAppointment, resizeDay: string, startTime: string, endTime: string) => {
    const start = zonedDateTimeToDate(resizeDay, startTime, timeZone);
    const end = zonedDateTimeToDate(resizeDay, endTime, timeZone);
    try {
      const response = await fetch(`/api/planner/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() }),
      });
      const payload = await response.json().catch(() => null) as { status?: string } | null;
      if (!response.ok || payload?.status !== "OK") return false;
      window.dispatchEvent(new Event("turbolev:planner-refresh"));
      return true;
    } catch {
      return false;
    }
  });

  function rowHasAppointment(row: Row, minute: number, ignoreId?: string) {
    const slotEnd = minute + SLOT;
    return dayAppointments.some((item) => {
      if (item.id === ignoreId) return false;
      if (row.reception ? Boolean(item.postId) : item.postId !== row.id) return false;
      const start = localParts(item.plannedStartAt, timeZone).minute;
      const end = localParts(item.plannedEndAt, timeZone).minute;
      return start < slotEnd && end > minute;
    });
  }

  function slotAvailable(row: Row, slotIndex: number, ignoreId?: string) {
    const minute = slots[slotIndex];
    if (minute === undefined || rowHasAppointment(row, minute, ignoreId)) return false;
    if (row.reception) return true;
    const ignored = ignoreId ? dayAppointments.find((item) => item.id === ignoreId) : null;
    if (ignored && ignored.postId === row.id) {
      const ignoredStart = localParts(ignored.plannedStartAt, timeZone).minute;
      const ignoredEnd = localParts(ignored.plannedEndAt, timeZone).minute;
      if (ignoredStart < minute + SLOT && ignoredEnd > minute) return true;
    }
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

  function appointmentDuration(item: TAppointment) {
    return Math.max(SLOT, Math.round((new Date(item.plannedEndAt).getTime() - new Date(item.plannedStartAt).getTime()) / 60000));
  }

  function canDropRange(row: Row, startIndex: number, durationMinutes: number, ignoreId: string) {
    const span = Math.max(1, Math.ceil(durationMinutes / SLOT));
    const endIndex = startIndex + span - 1;
    if (startIndex < 0 || endIndex >= slots.length || row.reception) return false;
    for (let index = startIndex; index <= endIndex; index += 1) {
      if (!slotAvailable(row, index, ignoreId)) return false;
    }
    return true;
  }

  function dragAppointment(event: ReactDragEvent<HTMLButtonElement>, item: TAppointment) {
    if (NON_DRAGGABLE.has(item.status)) {
      event.preventDefault();
      return;
    }
    suppressDragClickRef.current = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/planner-appointment", item.id);
    setDraggingAppointmentId(item.id);
    setDropTarget(null);
  }

  function endAppointmentDrag() {
    setDraggingAppointmentId(null);
    setDropTarget(null);
    window.setTimeout(() => { suppressDragClickRef.current = false; }, 0);
  }

  function dragOverCell(event: ReactDragEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    const id = draggingAppointmentId || event.dataTransfer.getData("text/planner-appointment");
    const item = id ? dayAppointments.find((appointment) => appointment.id === id) : null;
    if (!item || NON_DRAGGABLE.has(item.status)) return;
    if (!canDropRange(row, slotIndex, appointmentDuration(item), item.id)) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ rowId: row.id, slotIndex });
  }

  function dropOnCell(event: ReactDragEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    event.preventDefault();
    const id = draggingAppointmentId || event.dataTransfer.getData("text/planner-appointment");
    const item = id ? dayAppointments.find((appointment) => appointment.id === id) : null;
    setDraggingAppointmentId(null);
    setDropTarget(null);
    if (!item || NON_DRAGGABLE.has(item.status)) return;
    const durationMinutes = appointmentDuration(item);
    if (!canDropRange(row, slotIndex, durationMinutes, item.id)) {
      setError("Обраний період зайнятий або недоступний для цього запису.");
      return;
    }
    setError("");
    onMove?.(item, day, minuteLabel(slots[slotIndex]), row.id, durationMinutes);
  }

  function canResizeAppointment(item: TAppointment, startMinute: number, endMinute: number) {
    if (startMinute < openMinute || endMinute > closeMinute || endMinute - startMinute < SLOT) return false;
    return !dayAppointments.some((other) => {
      if (other.id === item.id || NON_BLOCKING.has(other.status)) return false;
      if (other.postId !== item.postId) return false;
      const otherStart = localParts(other.plannedStartAt, timeZone).minute;
      const otherEnd = localParts(other.plannedEndAt, timeZone).minute;
      return otherStart < endMinute && otherEnd > startMinute;
    });
  }

  function minuteBoundaryFromPointer(clientX: number) {
    const grid = gridRef.current;
    if (!grid || !slots.length) return null;
    const rect = grid.getBoundingClientRect();
    const timeWidth = rect.width - resourceWidth;
    if (timeWidth <= 0) return null;
    const rawIndex = Math.round(((clientX - rect.left - resourceWidth) / timeWidth) * slots.length);
    const index = Math.max(0, Math.min(slots.length, rawIndex));
    return openMinute + index * SLOT;
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>, item: TAppointment, edge: ResizeEdge) {
    if (NON_BLOCKING.has(item.status)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is not available in a few older embedded browsers;
      // the window-level listeners below still handle the drag in that case.
    }
    const originalStartMinute = localParts(item.plannedStartAt, timeZone).minute;
    const originalEndMinute = Math.max(originalStartMinute + SLOT, localParts(item.plannedEndAt, timeZone).minute);
    const next: ResizeState = {
      id: item.id,
      edge,
      startMinute: originalStartMinute,
      endMinute: originalEndMinute,
      originalStartMinute,
      originalEndMinute,
      valid: true,
    };
    resizeRef.current = next;
    setResize(next);
  }

  useEffect(() => {
    if (!resize) return;
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeRef.current;
      if (!active) return;
      event.preventDefault();
      const boundary = minuteBoundaryFromPointer(event.clientX);
      if (boundary == null) return;
      const nextStart = active.edge === "start" ? boundary : active.originalStartMinute;
      const nextEnd = active.edge === "end" ? boundary : active.originalEndMinute;
      const item = dayAppointments.find((appointment) => appointment.id === active.id);
      const next = {
        ...active,
        startMinute: nextStart,
        endMinute: nextEnd,
        valid: Boolean(item && canResizeAppointment(item, nextStart, nextEnd)),
      };
      resizeRef.current = next;
      setResize(next);
    };
    const onPointerUp = () => {
      const active = resizeRef.current;
      resizeRef.current = null;
      if (!active || !active.valid || (active.startMinute === active.originalStartMinute && active.endMinute === active.originalEndMinute)) {
        setResize(null);
        return;
      }
      const item = dayAppointments.find((appointment) => appointment.id === active.id);
      if (!item) {
        setResize(null);
        return;
      }
      const startTime = minuteLabel(active.startMinute);
      const endTime = minuteLabel(active.endMinute);
      void resizeHandler(item, day, startTime, endTime).then((ok) => {
        setResize(null);
        if (!ok) {
          setError("Не вдалося змінити час: пост або механік зайнятий у цьому діапазоні.");
        }
      });
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    // Capture release before the handle stops propagation to prevent the card opening.
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, [resize, resizeHandler, dayAppointments, day, openMinute, timeZone, slots]);

  function beginSelection(event: ReactPointerEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    if (event.button !== 0 || !slotAvailable(row, slotIndex)) return;
    event.preventDefault();
    skipNextClickRef.current = false;
    setSelection({ rowId: row.id, startIndex: slotIndex, endIndex: slotIndex });
  }

  function extendSelection(event: ReactPointerEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    if (!selection || selection.rowId !== row.id || event.buttons !== 1) return;
    if (!canSelectRange(row, selection.startIndex, slotIndex)) return;
    setSelection((current) => current ? { ...current, endIndex: slotIndex } : current);
  }

  function finishSelection(row: Row, slotIndex: number, activeSelection: SlotSelection) {
    const endIndex = canSelectRange(row, activeSelection.startIndex, slotIndex) ? slotIndex : activeSelection.endIndex;
    const from = Math.min(activeSelection.startIndex, endIndex);
    const to = Math.max(activeSelection.startIndex, endIndex);
    const startTime = minuteLabel(slots[from]);
    const endTime = minuteLabel(slots[to] + SLOT);
    const durationMinutes = (to - from + 1) * SLOT;
    const selected: PlannerTimeSelection = {
      day,
      startTime,
      endTime,
      durationMinutes,
      locationId: location.id,
      postId: row.reception ? "" : row.id,
    };
    const context = {
      date: day,
      time: startTime,
      endTime,
      durationMinutes,
      locationId: location.id,
      postId: row.reception ? "" : row.id,
    };
    document.cookie = `${DURATION_COOKIE}=${durationMinutes}; Path=/; Max-Age=1800; SameSite=Lax`;
    document.cookie = `${CONTEXT_COOKIE}=${encodeURIComponent(JSON.stringify(context))}; Path=/; Max-Age=1800; SameSite=Lax`;
    // Keep the range highlighted so the chosen appointment time remains visible in the grid.
    setSelection({ rowId: row.id, startIndex: from, endIndex: to });
    onSelection?.(selected);
    onCreate(day, startTime, row.reception ? "" : row.id);
  }

  function commitSelection(event: ReactPointerEvent<HTMLButtonElement>, row: Row, slotIndex: number) {
    if (!selection || selection.rowId !== row.id) return;
    event.preventDefault();
    skipNextClickRef.current = true;
    finishSelection(row, slotIndex, selection);
  }

  function clickSelection(row: Row, slotIndex: number) {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return;
    }
    if (!slotAvailable(row, slotIndex)) return;
    finishSelection(row, slotIndex, { rowId: row.id, startIndex: slotIndex, endIndex: slotIndex });
  }

  const resourceWidth = 164;
  const gridStyle = { gridTemplateColumns: `${resourceWidth}px repeat(${slots.length}, minmax(0, 1fr))` } as CSSProperties;
  const now = new Date();
  const nowParts = localParts(now.toISOString(), timeZone);
  const nowMinute = nowParts.minute;
  const showNow = nowParts.day === day && nowMinute >= openMinute && nowMinute < closeMinute;
  const nowRatio = showNow ? (nowMinute - openMinute) / totalDayMinutes : 0;
  const nowStyle = { left: `calc(${resourceWidth}px + (100% - ${resourceWidth}px) * ${nowRatio})` } as CSSProperties;

  return <div className={`${styles.wrap} ${compact ? compactStyles.root : ""}`}>
    {showMetrics && <section className={styles.kpis} aria-label="Показники дня">
      <article><span className={styles.kpiIcon}>▣</span><div><strong>{metrics.total}</strong><small>Записів<br/>на сьогодні</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiGreen}`}>✓</span><div><strong>{metrics.completed}</strong><small>Завершено</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiBlue}`}>◌</span><div><strong>{metrics.inProgress}</strong><small>В роботі</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiOrange}`}>◷</span><div><strong>{metrics.waiting}</strong><small>Очікують</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiGreen}`}>◴</span><div><strong>{metrics.freeSlots}</strong><small>Вільних слотів<br/>по 30 хв</small></div></article>
      <article><span className={`${styles.kpiIcon} ${styles.kpiGreen}`}>₴</span><div><strong>{currency(metrics.revenue)}</strong><small>Очікуваний виторг<br/>за день</small></div></article>
    </section>}

    {error && <div className={styles.inlineError} role="status">{error}</div>}

    <div className={`${styles.board} ${compact ? compactStyles.board : ""}`}>
      <div ref={gridRef} className={`${styles.grid} ${compact ? compactStyles.grid : ""}`} style={gridStyle} onMouseLeave={() => selection && setSelection(selection)}>
        <div className={`${styles.corner} ${compact ? compactStyles.corner : ""}`} style={{ gridColumn: 1, gridRow: 1 }}>Пости / ресурси</div>
        {slots.map((minute, index) => <div className={`${styles.time} ${compact ? compactStyles.time : ""}`} key={minute} style={{ gridColumn: index + 2, gridRow: 1 }}>{minuteLabel(minute)}</div>)}

        {rows.map((row, rowIndex) => {
          const gridRow = rowIndex + 2;
          const loadPercent = resourceLoad.get(row.id) || 0;
          return <div key={row.id} style={{ display: "contents" }}>
            <div className={`${styles.resource} ${compact ? compactStyles.resource : ""}`} style={{ gridColumn: 1, gridRow, "--resource-color": row.color } as CSSProperties}>
              <div className={styles.resourceTitle}><i/><b>{row.name}</b><button type="button" tabIndex={-1} aria-hidden="true">⋮</button></div>
              <span>{row.type}</span>
              <div className={styles.resourceProgress}><i style={{ width: `${loadPercent}%` }}/></div>
              <small>{loadPercent}% зайнято</small>
            </div>
            {slots.map((minute, slotIndex) => {
              const available = slotAvailable(row, slotIndex);
              const draggedItem = draggingAppointmentId ? dayAppointments.find((item) => item.id === draggingAppointmentId) : null;
              const dragAvailable = draggedItem ? canDropRange(row, slotIndex, appointmentDuration(draggedItem), draggedItem.id) : false;
              const selected = selection?.rowId === row.id && slotIndex >= Math.min(selection.startIndex, selection.endIndex) && slotIndex <= Math.max(selection.startIndex, selection.endIndex);
              const cellClass = available ? styles.free : styles.busy;
              const time = minuteLabel(minute);
              const selectedStart = selection && selection.rowId === row.id ? Math.min(selection.startIndex, selection.endIndex) : -1;
              const selectedEnd = selection && selection.rowId === row.id ? Math.max(selection.startIndex, selection.endIndex) : -1;
              const selectionLabel = selected && slotIndex === selectedStart ? `${minuteLabel(slots[selectedStart])}–${minuteLabel(slots[selectedEnd] + SLOT)}` : "";
              return <button
                type="button"
                aria-label={`${row.name} ${time}: ${available || dragAvailable ? (selected ? `обрано ${selectionLabel}` : "вільно") : "зайнято"}`}
                title={available || dragAvailable ? `${row.name} · ${time} · вільно` : `${row.name} · ${time} · зайнято`}
                className={`${styles.cell} ${cellClass} ${selected ? styles.selected : ""} ${dropTarget?.rowId === row.id && dropTarget.slotIndex === slotIndex ? styles.dropTarget : ""} ${compact ? compactStyles.cell : ""}`}
                key={`${row.id}-${minute}`}
                style={{ gridColumn: slotIndex + 2, gridRow }}
                disabled={!available && !dragAvailable}
                onPointerDown={(event) => beginSelection(event, row, slotIndex)}
                onPointerEnter={(event) => extendSelection(event, row, slotIndex)}
                onPointerUp={(event) => commitSelection(event, row, slotIndex)}
                onClick={() => clickSelection(row, slotIndex)}
                onDragOver={(event) => dragOverCell(event, row, slotIndex)}
                onDrop={(event) => dropOnCell(event, row, slotIndex)}
                aria-dropeffect={dropTarget?.rowId === row.id && dropTarget.slotIndex === slotIndex ? "move" : undefined}
              >{selectionLabel && <span className={compactStyles.selectionLabel}>{selectionLabel}</span>}</button>;
            })}
          </div>;
        })}

        {dayAppointments.map((item) => {
          const rowIndex = item.postId ? rows.findIndex((row) => row.id === item.postId) : rows.findIndex((row) => row.reception);
          if (rowIndex < 0) return null;
          const originalStart = localParts(item.plannedStartAt, timeZone).minute;
          const originalEnd = localParts(item.plannedEndAt, timeZone).minute;
          const preview = resize?.id === item.id ? resize : null;
          const start = preview?.startMinute ?? originalStart;
          const end = preview?.endMinute ?? originalEnd;
          const clippedStart = Math.max(openMinute, start);
          const clippedEnd = Math.min(closeMinute, Math.max(clippedStart + SLOT, end));
          if (clippedStart >= closeMinute || clippedEnd <= openMinute) return null;
          const startIndex = Math.max(0, Math.floor((clippedStart - openMinute) / SLOT));
          const span = Math.max(1, Math.ceil((clippedEnd - clippedStart) / SLOT));
          const done = item.status === "COMPLETED";
          const row = rows[rowIndex];
          const status = STATUS_META[item.status] || { label: item.status, tone: "gray" as const };
          return <button
            type="button"
            key={item.id}
            className={`${styles.event} ${styles[`event_${status.tone}`]} ${done ? styles.eventDone : ""} ${compact ? compactStyles.event : ""} ${preview ? styles.eventResizing : ""} ${preview && !preview.valid ? styles.eventResizeInvalid : ""} ${draggingAppointmentId === item.id ? styles.eventDragging : ""}`}
            style={{ gridColumn: `${startIndex + 2} / span ${span}`, gridRow: rowIndex + 2, "--event-color": row.color } as CSSProperties}
            draggable={Boolean(onMove) && !NON_DRAGGABLE.has(item.status)}
            onDragStart={(event) => dragAppointment(event, item)}
            onDragEnd={endAppointmentDrag}
            onClick={() => { if (!suppressDragClickRef.current) onOpen(item); }}
            title={`${item.plateNumber || "Без номера"} · ${minuteLabel(start)}–${minuteLabel(end)}`}
          >
            {!NON_BLOCKING.has(item.status) && <>
              <span
                className={`${styles.resizeHandle} ${styles.resizeHandleStart}`}
                role="slider"
                tabIndex={0}
                aria-label="Змінити час початку запису"
                aria-valuemin={openMinute}
                aria-valuemax={closeMinute - SLOT}
                aria-valuenow={start}
                onPointerDown={(event) => startResize(event, item, "start")}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              />
              <span
                className={`${styles.resizeHandle} ${styles.resizeHandleEnd}`}
                role="slider"
                tabIndex={0}
                aria-label="Змінити час завершення запису"
                aria-valuemin={openMinute + SLOT}
                aria-valuemax={closeMinute}
                aria-valuenow={end}
                onPointerDown={(event) => startResize(event, item, "end")}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              />
            </>}
            <small className={styles.eventTime}>{minuteLabel(start)}–{minuteLabel(end)}</small>
            <VehiclePlate value={item.plateNumber} size="xs" />
            <b>{item.vehicleLabel || "Автомобіль"}</b>
            <span>{item.problem || item.customerName || item.mechanic?.name || "Запис на СТО"}</span>
            <em><i/>{status.label}</em>
          </button>;
        })}
        {showNow && <div className={styles.now} style={nowStyle} aria-hidden="true" />}
      </div>
      {!location.posts.length && <div className={styles.empty}>У локації ще не створено жодного сервісного поста.</div>}
    </div>

    <div className={`${styles.legend} ${compact ? compactStyles.legend : ""}`}>
      <span><i className={styles.legendGreen}/>Підтверджено</span>
      <span><i className={styles.legendBlue}/>В роботі</span>
      <span><i className={styles.legendOrange}/>Очікує запчастини</span>
      <span><i className={styles.legendAmber}/>Очікує клієнта</span>
      <span><i className={styles.legendDone}/>Виконано</span>
      <span><i className={styles.legendFree}/>Вільний слот</span>
      <span><i className={styles.legendSelected}/>Обраний час</span>
      {onMove && <span>Перетягніть запис: змінити пост і час</span>}
    </div>
  </div>;
}
