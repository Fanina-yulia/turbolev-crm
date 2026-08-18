"use client";

import {
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./diagnostic-booking-enhancer.module.css";

type Resource = { id: string; name: string };
type Location = {
  id: string;
  name: string;
  timezone?: string;
  openMinute?: number;
  closeMinute?: number;
  posts: Resource[];
  mechanics: Resource[];
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
  post?: Resource | null;
  mechanic?: Resource | null;
};
type BoardResponse = {
  status: string;
  locations?: Location[];
  activeLocationId?: string | null;
  appointments?: Appointment[];
  message?: string;
};
type Selection = {
  day: string;
  postId: string;
  startMinute: number;
  endMinute: number;
};
type WizardControls = {
  date: HTMLInputElement;
  time: HTMLInputElement;
  post: HTMLSelectElement;
  mechanic: HTMLSelectElement;
  location: HTMLSelectElement | null;
};

const SLOT = 30;
const FALLBACK_OPEN = 9 * 60;
const FALLBACK_CLOSE = 21 * 60;
const DURATION_COOKIE = "turbolev_booking_duration_minutes";
const NON_BLOCKING = new Set(["COMPLETED", "NO_SHOW", "CANCELLED"]);

function pad(value: number) {
  return String(value).padStart(2, "0");
}
function minuteToClock(value: number) {
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}
function clockToMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}
function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + amount, 12));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}
function dayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(new Date(Date.UTC(year, month - 1, date, 12)));
}
function shortDate(day: string) {
  const [, month, date] = day.split("-");
  return `${date}.${month}`;
}
function longDate(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, date, 12)));
}
function offsetMinutes(date: Date, timeZone: string) {
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
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}
function zonedToIso(day: string, clock: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, date, hour, minute, 0);
  let candidate = new Date(wallAsUtc);
  let offset = offsetMinutes(candidate, timeZone);
  candidate = new Date(wallAsUtc - offset * 60_000);
  const correctedOffset = offsetMinutes(candidate, timeZone);
  if (correctedOffset !== offset) candidate = new Date(wallAsUtc - correctedOffset * 60_000);
  return candidate.toISOString();
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
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}
function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
function readControls(step: HTMLElement): WizardControls | null {
  const grid = step.querySelector<HTMLElement>(".bookingGrid");
  if (!grid) return null;
  const inputs = grid.querySelectorAll<HTMLInputElement>("input");
  const selects = grid.querySelectorAll<HTMLSelectElement>("select");
  if (inputs.length < 2 || selects.length < 2) return null;
  return {
    date: inputs[0],
    time: inputs[1],
    post: selects[0],
    mechanic: selects[1],
    location: step.querySelector<HTMLSelectElement>(".fastLocationSelect select"),
  };
}
function summary(step: HTMLElement) {
  const articles = [...step.querySelectorAll<HTMLElement>(".fastBookingSummary article")];
  const item = (index: number) => ({
    title: articles[index]?.querySelector("strong")?.textContent?.trim() || "—",
    sub: articles[index]?.querySelector("span")?.textContent?.trim() || "",
  });
  return { vehicle: item(0), client: item(1), diagnostic: item(2), works: item(3) };
}

export function DiagnosticBookingEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [step, setStep] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const resolve = () => {
      const candidate = [...document.querySelectorAll<HTMLElement>(".requestFastStep")]
        .find(item => item.textContent?.includes("КРОК 4")) || null;
      if (!candidate) {
        setHost(null);
        setStep(null);
        return;
      }
      candidate.classList.add("diagnosticSchedulerActive");
      let nextHost = candidate.querySelector<HTMLElement>("[data-diagnostic-scheduler-host]");
      if (!nextHost) {
        nextHost = document.createElement("div");
        nextHost.dataset.diagnosticSchedulerHost = "true";
        const marker = candidate.querySelector(".requestHiddenPricingField");
        candidate.insertBefore(nextHost, marker || null);
      }
      setStep(candidate);
      setHost(nextHost);
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll(".diagnosticSchedulerActive").forEach(node => node.classList.remove("diagnosticSchedulerActive"));
    };
  }, []);

  return host && step ? createPortal(<Scheduler step={step} />, host) : null;
}

function Scheduler({ step }: { step: HTMLElement }) {
  const [rangeStart, setRangeStart] = useState(() => readControls(step)?.date.value || todayKey());
  const [activeDay, setActiveDay] = useState(() => readControls(step)?.date.value || todayKey());
  const [locations, setLocations] = useState<Location[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedMechanicId, setSelectedMechanicId] = useState(() => readControls(step)?.mechanic.value || "");
  const selecting = useRef(false);
  const selectionAnchor = useRef<{ postId: string; minute: number } | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index)), [rangeStart]);
  const controls = readControls(step);
  const requestedLocationId = controls?.location?.value || "";
  const activeLocation = useMemo(
    () => locations.find(location => location.id === requestedLocationId) || locations[0] || null,
    [locations, requestedLocationId],
  );
  const timezone = activeLocation?.timezone || "Europe/Kyiv";
  const openMinute = Math.max(0, activeLocation?.openMinute ?? FALLBACK_OPEN);
  const closeMinute = Math.min(24 * 60, activeLocation?.closeMinute ?? FALLBACK_CLOSE);
  const slots = useMemo(() => {
    const values: number[] = [];
    for (let value = openMinute; value < closeMinute; value += SLOT) values.push(value);
    return values;
  }, [openMinute, closeMinute]);
  const activeAppointments = useMemo(
    () => appointments.filter(item =>
      item.locationId === activeLocation?.id &&
      !NON_BLOCKING.has(item.status) &&
      localParts(item.plannedStartAt, timezone).day === activeDay,
    ),
    [appointments, activeLocation?.id, activeDay, timezone],
  );

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const from = zonedToIso(rangeStart, "00:00", "Europe/Kyiv");
      const to = zonedToIso(addDays(rangeStart, 7), "00:00", "Europe/Kyiv");
      const params = new URLSearchParams({ from, to });
      if (requestedLocationId) params.set("locationId", requestedLocationId);
      const response = await fetch(`/api/planner?${params}`, { cache: "no-store" });
      const payload = await response.json() as BoardResponse;
      if (!response.ok || payload.status !== "OK") throw new Error(payload.message || "Не вдалося завантажити календар.");
      setLocations(Array.isArray(payload.locations) ? payload.locations : []);
      setAppointments(Array.isArray(payload.appointments) ? payload.appointments : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити календар.");
    } finally {
      setLoading(false);
    }
  }, [rangeStart, requestedLocationId]);

  useEffect(() => { void loadBoard(); }, [loadBoard]);
  useEffect(() => {
    const refresh = () => void loadBoard();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => window.removeEventListener("turbolev:data-changed", refresh);
  }, [loadBoard]);
  useEffect(() => {
    const onPointerUp = () => { selecting.current = false; selectionAnchor.current = null; };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (!activeLocation) return;
    const mechanic = activeLocation.mechanics.some(item => item.id === selectedMechanicId)
      ? selectedMechanicId
      : activeLocation.mechanics.length === 1 ? activeLocation.mechanics[0].id : "";
    setSelectedMechanicId(mechanic);
    if (mechanic && controls?.mechanic.value !== mechanic) setNativeValue(controls!.mechanic, mechanic);
  }, [activeLocation?.id]);

  function appointmentAt(postId: string, minute: number) {
    return activeAppointments.find(item => {
      if (item.postId !== postId) return false;
      const start = localParts(item.plannedStartAt, timezone).minute;
      const end = localParts(item.plannedEndAt, timezone).minute;
      return start < minute + SLOT && end > minute;
    }) || null;
  }
  function rangeIsFree(postId: string, start: number, end: number, ignoreId?: string) {
    for (let minute = start; minute < end; minute += SLOT) {
      const occupied = appointmentAt(postId, minute);
      if (occupied && occupied.id !== ignoreId) return false;
    }
    return start >= openMinute && end <= closeMinute;
  }
  function syncSelection(next: Selection) {
    const currentControls = readControls(step);
    if (!currentControls) return;
    setNativeValue(currentControls.date, next.day);
    setNativeValue(currentControls.time, minuteToClock(next.startMinute));
    setNativeValue(currentControls.post, next.postId);
    if (selectedMechanicId) setNativeValue(currentControls.mechanic, selectedMechanicId);
    const duration = next.endMinute - next.startMinute;
    document.cookie = `${DURATION_COOKIE}=${duration}; Path=/; Max-Age=1800; SameSite=Lax`;
  }
  function beginSelection(postId: string, minute: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || appointmentAt(postId, minute)) return;
    event.preventDefault();
    selecting.current = true;
    selectionAnchor.current = { postId, minute };
    const next = { day: activeDay, postId, startMinute: minute, endMinute: minute + SLOT };
    setSelection(next);
    syncSelection(next);
  }
  function extendSelection(postId: string, minute: number) {
    const anchor = selectionAnchor.current;
    if (!selecting.current || !anchor || anchor.postId !== postId) return;
    const start = Math.min(anchor.minute, minute);
    const end = Math.max(anchor.minute + SLOT, minute + SLOT);
    if (!rangeIsFree(postId, start, end)) return;
    const next = { day: activeDay, postId, startMinute: start, endMinute: end };
    setSelection(next);
    syncSelection(next);
  }
  function chooseDay(day: string) {
    setActiveDay(day);
    setSelection(null);
    const currentControls = readControls(step);
    if (currentControls) setNativeValue(currentControls.date, day);
  }
  function chooseMechanic(id: string) {
    setSelectedMechanicId(id);
    const currentControls = readControls(step);
    if (currentControls) setNativeValue(currentControls.mechanic, id);
  }
  async function moveAppointment(item: Appointment, postId: string, minute: number) {
    const durationMs = Math.max(SLOT * 60_000, new Date(item.plannedEndAt).getTime() - new Date(item.plannedStartAt).getTime());
    const durationMinutes = Math.ceil(durationMs / 60_000 / SLOT) * SLOT;
    if (!rangeIsFree(postId, minute, minute + durationMinutes, item.id)) {
      setMessage("Цей проміжок уже зайнятий. Оберіть інший час або пост.");
      return;
    }
    const plannedStartAt = zonedToIso(activeDay, minuteToClock(minute), timezone);
    const plannedEndAt = new Date(new Date(plannedStartAt).getTime() + durationMinutes * 60_000).toISOString();
    setMessage("");
    try {
      const response = await fetch(`/api/planner/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, plannedStartAt, plannedEndAt }),
      });
      const payload = await response.json() as { status?: string; appointment?: Appointment; message?: string };
      if (!response.ok || !payload.appointment) throw new Error(payload.message || "Не вдалося перенести запис.");
      setAppointments(current => current.map(existing => existing.id === item.id ? payload.appointment! : existing));
      setMessage("Запис перенесено.");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "planner", appointment: payload.appointment } }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося перенести запис.");
    }
  }
  function onDrop(event: DragEvent<HTMLButtonElement>, postId: string, minute: number) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/planner-appointment") || draggingId;
    const item = appointments.find(candidate => candidate.id === id);
    setDraggingId(null);
    if (item) void moveAppointment(item, postId, minute);
  }

  const availability = useMemo(() => {
    const result = new Map<string, number>();
    for (const day of days) {
      let count = 0;
      for (const post of activeLocation?.posts || []) {
        for (let minute = openMinute; minute < closeMinute; minute += SLOT) {
          const busy = appointments.some(item => {
            if (item.locationId !== activeLocation?.id || item.postId !== post.id || NON_BLOCKING.has(item.status)) return false;
            const start = localParts(item.plannedStartAt, timezone);
            const end = localParts(item.plannedEndAt, timezone);
            return start.day === day && start.minute < minute + SLOT && end.minute > minute;
          });
          if (!busy) count += 1;
        }
      }
      result.set(day, count);
    }
    return result;
  }, [days, activeLocation, appointments, openMinute, closeMinute, timezone]);

  const selectedPost = activeLocation?.posts.find(item => item.id === selection?.postId) || null;
  const selectedMechanic = activeLocation?.mechanics.find(item => item.id === selectedMechanicId) || null;
  const oldSummary = summary(step);
  const selectedDuration = selection ? selection.endMinute - selection.startMinute : 0;
  const selectedEnd = selection ? minuteToClock(selection.endMinute) : "";
  const selectedStart = selection ? minuteToClock(selection.startMinute) : "";

  return <div className={styles.scheduler}>
    <div className={styles.headingRow}>
      <div>
        <small>КРОК 4</small>
        <h3>Оберіть дату та час</h3>
        <p>Затисніть ліву кнопку миші та протягніть по вільних слотах, щоб вибрати потрібну тривалість.</p>
      </div>
      <div className={styles.rules}><b>Крок: 30 хв</b><span>{minuteToClock(openMinute)}–{minuteToClock(closeMinute)}</span></div>
    </div>

    {locations.length > 1 && <div className={styles.locationRow}>
      <span>Локація</span>
      <select value={activeLocation?.id || ""} onChange={event => {
        const currentControls = readControls(step);
        if (currentControls?.location) setNativeValue(currentControls.location, event.target.value);
        setSelection(null);
        void loadBoard();
      }}>
        {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>
    </div>}

    <div className={styles.dateStrip}>
      <button type="button" className={styles.arrow} onClick={() => { const next = addDays(rangeStart, -7); setRangeStart(next); setActiveDay(next); }}>‹</button>
      {days.map(day => {
        const count = availability.get(day) || 0;
        return <button
          type="button"
          key={day}
          className={`${styles.dayChip} ${day === activeDay ? styles.dayChipActive : ""}`}
          onClick={() => chooseDay(day)}
          onDragOver={event => { if (draggingId) { event.preventDefault(); setActiveDay(day); } }}
        >
          <span>{day === todayKey() ? "Сьогодні" : dayLabel(day)}</span>
          <b>{shortDate(day)}</b>
          <small className={count ? styles.freeCount : styles.noFree}>{count ? `${count} вільних` : "немає місць"}</small>
        </button>;
      })}
      <button type="button" className={styles.arrow} onClick={() => { const next = addDays(rangeStart, 7); setRangeStart(next); setActiveDay(next); }}>›</button>
    </div>

    <div className={styles.content}>
      <div className={styles.boardWrap}>
        {loading && <div className={styles.loading}>Оновлюю календар…</div>}
        {!loading && activeLocation && activeLocation.posts.length > 0 && <div
          className={styles.board}
          style={{
            gridTemplateColumns: `72px repeat(${activeLocation.posts.length}, minmax(150px, 1fr))`,
            gridTemplateRows: `42px repeat(${slots.length}, 34px)`,
          }}
        >
          <div className={`${styles.headerCell} ${styles.timeHeader}`} style={{ gridColumn: 1, gridRow: 1 }}>Час</div>
          {activeLocation.posts.map((post, postIndex) => <div key={post.id} className={styles.headerCell} style={{ gridColumn: postIndex + 2, gridRow: 1 }}>{post.name}</div>)}
          {slots.map((minute, rowIndex) => <div key={`time-${minute}`} className={styles.timeCell} style={{ gridColumn: 1, gridRow: rowIndex + 2 }}>{minuteToClock(minute)}</div>)}
          {activeLocation.posts.flatMap((post, postIndex) => slots.map((minute, rowIndex) => {
            const occupied = appointmentAt(post.id, minute);
            const selected = selection?.day === activeDay && selection.postId === post.id && minute >= selection.startMinute && minute < selection.endMinute;
            const nearBusy = !occupied && (Boolean(appointmentAt(post.id, minute - SLOT)) || Boolean(appointmentAt(post.id, minute + SLOT)));
            return <button
              type="button"
              aria-label={`${post.name}, ${minuteToClock(minute)}`}
              key={`${post.id}-${minute}`}
              className={`${styles.slot} ${occupied ? styles.slotBusy : nearBusy ? styles.slotNear : styles.slotFree} ${selected ? styles.slotSelected : ""}`}
              style={{ gridColumn: postIndex + 2, gridRow: rowIndex + 2 }}
              onPointerDown={event => beginSelection(post.id, minute, event)}
              onPointerEnter={() => extendSelection(post.id, minute)}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
              onDrop={event => onDrop(event, post.id, minute)}
            >{!occupied && <span>{selected ? "✓" : nearBusy ? "Скоро зайнято" : "Вільно"}</span>}</button>;
          }))}
          {activeAppointments.map(item => {
            if (!item.postId) return null;
            const postIndex = activeLocation.posts.findIndex(post => post.id === item.postId);
            if (postIndex < 0) return null;
            const start = localParts(item.plannedStartAt, timezone).minute;
            const end = localParts(item.plannedEndAt, timezone).minute;
            const startIndex = Math.max(0, Math.floor((start - openMinute) / SLOT));
            const span = Math.max(1, Math.ceil((Math.min(end, closeMinute) - Math.max(start, openMinute)) / SLOT));
            if (start >= closeMinute || end <= openMinute) return null;
            return <div
              key={item.id}
              draggable
              className={`${styles.appointment} ${draggingId === item.id ? styles.appointmentDragging : ""}`}
              style={{ gridColumn: postIndex + 2, gridRow: `${startIndex + 2} / span ${span}` }}
              onDragStart={event => {
                setDraggingId(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/planner-appointment", item.id);
              }}
              onDragEnd={() => setDraggingId(null)}
              title="Перетягніть запис на інший час, пост або день"
            >
              <b>{item.vehicleLabel || item.plateNumber || item.customerName || "Запис"}</b>
              <span>{item.problem || item.customerName || "Запланована робота"}</span>
              <small>{minuteToClock(start)}–{minuteToClock(end)}</small>
            </div>;
          })}
        </div>}
        {!loading && (!activeLocation || activeLocation.posts.length === 0) && <div className={styles.empty}>Для цієї локації не налаштовано активні пости.</div>}
      </div>

      <aside className={styles.summary}>
        <h4>Ваш вибір</h4>
        <div className={`${styles.choice} ${selection ? styles.choiceReady : ""}`}>
          <b>{selection ? `${longDate(selection.day)} · ${selectedStart}–${selectedEnd}` : "Оберіть вільний час"}</b>
          <span>{selectedPost?.name || "Пост не обрано"}{selectedDuration ? ` · ${selectedDuration} хв` : ""}</span>
        </div>
        <div className={styles.summaryItem}><small>Авто</small><b>{oldSummary.vehicle.title}</b><span>{oldSummary.vehicle.sub}</span></div>
        <div className={styles.summaryItem}><small>Клієнт</small><b>{oldSummary.client.title}</b><span>{oldSummary.client.sub}</span></div>
        <div className={styles.summaryItem}><small>Діагностика</small><b>{oldSummary.diagnostic.title}</b><span>{oldSummary.diagnostic.sub}</span></div>
        <label className={styles.mechanicSelect}>
          <small>Майстер *</small>
          <select value={selectedMechanicId} onChange={event => chooseMechanic(event.target.value)} disabled={!activeLocation}>
            <option value="">Оберіть майстра</option>
            {activeLocation?.mechanics.map(mechanic => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}
          </select>
        </label>
        {selectedMechanic && <div className={styles.assigned}>✓ {selectedMechanic.name} закріплений</div>}
        <div className={styles.dragHint}><b>Перенесення записів</b><span>Схопіть заплановану роботу мишкою та перетягніть у будь-яку вільну клітинку. Для іншого дня наведіть її на потрібну дату зверху.</span></div>
      </aside>
    </div>

    {message && <div className={styles.message}>{message}</div>}
  </div>;
}
