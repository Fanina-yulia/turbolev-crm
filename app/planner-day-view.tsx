"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
type Appointment = {
  id: string;
  locationId: string;
  postId: string | null;
  mechanicId: string | null;
  status: string;
  customerName: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
  post?: Post | null;
  mechanic?: Mechanic | null;
};
type AvailabilitySlot = { time: string; posts: Array<{ id: string; available: boolean }> };
type AvailabilityResponse = { status: string; slots?: AvailabilitySlot[]; message?: string };
type Row = { id: string; name: string; type: string; reception?: boolean };

const SLOT = 30;
const NON_BLOCKING = new Set(["COMPLETED", "NO_SHOW", "CANCELLED"]);

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

export function PlannerDayView({ day, location, appointments, onOpen, onCreate }: {
  day: string;
  location: Location;
  appointments: Appointment[];
  onOpen: (appointmentId: string) => void;
  onCreate: (day: string, time: string, postId: string) => void;
}) {
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timeZone = location.timezone || "Europe/Kyiv";
  const openMinute = Number.isFinite(location.openMinute) ? location.openMinute : 540;
  const closeMinute = Number.isFinite(location.closeMinute) ? location.closeMinute : 1260;
  const slots = useMemo(() => {
    const result: number[] = [];
    for (let minute = openMinute; minute < closeMinute; minute += SLOT) result.push(minute);
    return result;
  }, [openMinute, closeMinute]);
  const rows = useMemo<Row[]>(() => [
    ...location.posts.map((post) => ({ id: post.id, name: post.name, type: postType(post) })),
    { id: "__RECEPTION__", name: "Без поста", type: "Зона приймання", reception: true },
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

  const dayAppointments = useMemo(() => appointments
    .filter((item) => item.locationId === location.id && localParts(item.plannedStartAt, timeZone).day === day)
    .sort((a, b) => +new Date(a.plannedStartAt) - +new Date(b.plannedStartAt)), [appointments, location.id, timeZone, day]);

  const availabilityMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const slot of availability?.slots || []) {
      for (const post of slot.posts) map.set(`${slot.time}:${post.id}`, post.available);
    }
    return map;
  }, [availability]);

  const gridStyle = { gridTemplateColumns: `150px repeat(${slots.length}, minmax(68px, 1fr))` } as CSSProperties;
  const now = new Date();
  const nowParts = localParts(now.toISOString(), timeZone);
  const nowMinute = nowParts.minute;
  const showNow = nowParts.day === day && nowMinute >= openMinute && nowMinute < closeMinute;
  const nowLeft = showNow ? 150 + ((nowMinute - openMinute) / SLOT) * 68 : 0;

  return <div className={styles.wrap}>
    <div className={styles.meta}>
      <div><strong>{location.name}</strong> · {minuteLabel(openMinute)}–{minuteLabel(closeMinute)} · крок 30 хв</div>
      <div>Натисніть «+» у вільній клітинці, щоб створити запис на цей час.</div>
    </div>
    {loading && !availability && <div className={styles.loading}>Оновлюю доступність постів…</div>}
    {error && <div className={styles.loading}>{error}</div>}
    <div className={styles.scroll}>
      <div className={styles.grid} style={gridStyle}>
        <div className={styles.corner} style={{ gridColumn: 1, gridRow: 1 }}>Пост / час</div>
        {slots.map((minute, index) => <div className={styles.time} key={minute} style={{ gridColumn: index + 2, gridRow: 1 }}>{minuteLabel(minute)}</div>)}

        {rows.map((row, rowIndex) => {
          const gridRow = rowIndex + 2;
          return <div key={row.id} style={{ display: "contents" }}>
            <div className={styles.resource} style={{ gridColumn: 1, gridRow }}><b>{row.name}</b><span>{row.type}</span></div>
            {slots.map((minute, slotIndex) => {
              const time = minuteLabel(minute);
              const available = row.reception ? false : availabilityMap.get(`${time}:${row.id}`);
              const cellClass = row.reception ? styles.unknown : available === true ? styles.free : styles.busy;
              return <button
                type="button"
                aria-label={row.reception ? `${row.name} ${time}` : `${row.name} ${time}: ${available ? "вільно" : "зайнято"}`}
                title={row.reception ? "Записи без призначеного поста" : available ? `${row.name} · ${time} · вільно` : `${row.name} · ${time} · зайнято`}
                className={`${styles.cell} ${cellClass}`}
                key={`${row.id}-${minute}`}
                style={{ gridColumn: slotIndex + 2, gridRow }}
                disabled={row.reception || available !== true}
                onClick={() => onCreate(day, time, row.id)}
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
          const done = NON_BLOCKING.has(item.status);
          return <button
            type="button"
            key={item.id}
            className={`${styles.event} ${done ? styles.eventDone : ""}`}
            style={{ gridColumn: `${startIndex + 2} / span ${span}`, gridRow: rowIndex + 2 }}
            onClick={() => onOpen(item.id)}
            title={`${item.plateNumber || "Без номера"} · ${minuteLabel(start)}–${minuteLabel(end)}`}
          >
            <b>{item.plateNumber || "БЕЗ НОМЕРА"}</b>
            <span>{item.vehicleLabel || item.customerName || "Автомобіль"}</span>
            <small>{minuteLabel(start)}–{minuteLabel(end)}{item.mechanic?.name ? ` · ${item.mechanic.name}` : ""}</small>
          </button>;
        })}
        {showNow && <div className={styles.now} style={{ left: nowLeft }} aria-hidden="true" />}
      </div>
      {!location.posts.length && <div className={styles.empty}>У локації ще не створено жодного сервісного поста.</div>}
    </div>
  </div>;
}
