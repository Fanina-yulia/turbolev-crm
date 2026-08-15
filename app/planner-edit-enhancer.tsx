"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VehicleBrandLogo } from "./vehicle-brand-logo";

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

type Post = { id: string; name: string; sortOrder?: number };
type Mechanic = { id: string; name: string; sortOrder?: number };
type ScheduleDay = { day: number; label: string; enabled: boolean; open: string; close: string; openMinute: number; closeMinute: number };
type DayAppointment = {
  id: string;
  postId: string | null;
  mechanicId: string | null;
  status: Status;
  vehicleLabel: string | null;
  plateNumber: string | null;
  plannedStartAt: string;
  plannedEndAt: string;
};
type Appointment = DayAppointment & {
  locationId: string;
  vehicleId: string | null;
  clientId: string | null;
  leadId: string | null;
  customerName: string | null;
  phone: string | null;
  problem: string | null;
  comment: string | null;
  source: string | null;
  post?: Post | null;
  mechanic?: Mechanic | null;
};
type Vehicle = {
  id: string;
  clientId: string;
  plateNumber: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  client?: { id: string; name: string | null; phone: string } | null;
};
type EditContext = {
  ok: boolean;
  appointment: Appointment;
  vehicle: Vehicle | null;
  location: {
    id: string;
    name: string;
    timezone: string;
    openMinute: number;
    closeMinute: number;
    posts: Post[];
    mechanics: Mechanic[];
  };
  workSchedule: ScheduleDay[];
  dayAppointments: DayAppointment[];
};
type FormState = {
  date: string;
  start: string;
  duration: string;
  status: Status;
  postId: string;
  mechanicId: string;
  problem: string;
  preliminaryWorks: string;
  comment: string;
};
type LegacySnapshot = {
  plate: string;
  date: string;
  start: string;
  duration: string;
  status: Status;
  postId: string;
  mechanicId: string;
};
type Conflict = { kind: "SCHEDULE" | "POST" | "MECHANIC"; title: string; detail: string };

const EDIT_STATUSES: Status[] = ["BOOKED", "ARRIVED", "NO_SHOW", "CANCELLED"];
const NON_BLOCKING = new Set<Status>(["COMPLETED", "NO_SHOW", "CANCELLED"]);
const STATUS_LABELS: Record<Status, string> = {
  BOOKED: "Записаний",
  ARRIVED: "Приїхав",
  DIAGNOSTICS: "Діагностика",
  WAITING_PARTS_SELECTION: "Підбір деталей",
  WAITING_CALCULATION: "Калькуляція",
  WAITING_APPROVAL: "Погодження",
  WAITING_PARTS: "Очікує деталі",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У ремонті",
  WAITING_QC: "Контроль якості",
  READY_FOR_PICKUP: "Готовий до видачі",
  COMPLETED: "Виданий",
  WARRANTY: "Гарантія",
  PAUSED: "Пауза",
  NO_SHOW: "Не приїхав",
  CANCELLED: "Скасовано",
  RESERVE: "Резерв",
};
const SOURCE_LABELS: Record<string, string> = {
  CRM_INTAKE: "Нова заявка",
  PLANNER: "Планувальник",
  BINOTEL: "Binotel",
  PHONE: "Телефон",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  OLX: "OLX",
  WEBSITE: "Сайт",
};

const pad = (value: number) => String(value).padStart(2, "0");
const clockToMinute = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
};
const minuteToClock = (value: number) => `${pad(Math.floor(Math.max(0, value) / 60))}:${pad(Math.max(0, value) % 60)}`;

function dayNumber(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function localDateTime(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
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
    clock: `${values.hour}:${values.minute}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

function durationMinutes(item: DayAppointment) {
  return Math.max(15, Math.round((+new Date(item.plannedEndAt) - +new Date(item.plannedStartAt)) / 60000));
}

function normalizePlate(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/gi, "");
}

function splitComment(value: string | null | undefined) {
  const text = (value || "").trim();
  const marker = "Попередні роботи:";
  const index = text.indexOf(marker);
  if (index < 0) return { comment: text, preliminaryWorks: "" };
  const comment = text.slice(0, index).trim();
  const preliminaryWorks = text
    .slice(index + marker.length)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
  return { comment, preliminaryWorks };
}

function composeComment(comment: string, preliminaryWorks: string) {
  const lines = preliminaryWorks
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter(Boolean);
  const works = lines.length ? `Попередні роботи:\n${lines.map((line) => `• ${line}`).join("\n")}` : "";
  return [comment.trim(), works].filter(Boolean).join("\n\n") || null;
}

function controlByLabel(section: HTMLElement, startsWith: string) {
  const labels = Array.from(section.querySelectorAll("label"));
  const label = labels.find((item) => (item.querySelector("span")?.textContent || "").trim().toLowerCase().startsWith(startsWith.toLowerCase()));
  return label?.querySelector("input,select") as HTMLInputElement | HTMLSelectElement | null;
}

function setNativeValue(element: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (!element) return;
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function formatVehicle(vehicle: Vehicle | null, fallback: string | null) {
  const value = [vehicle?.brand, vehicle?.model, vehicle?.year].filter(Boolean).join(" ");
  return value || fallback || "Автомобіль";
}

function formatDateChange(day: string, clock: string) {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year} ${clock}`;
}

export function PlannerEditEnhancer() {
  const legacyBackdropRef = useRef<HTMLElement | null>(null);
  const legacySectionRef = useRef<HTMLElement | null>(null);
  const legacySnapshotRef = useRef<LegacySnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState<EditContext | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const closeLegacy = useCallback(() => {
    const backdrop = legacyBackdropRef.current;
    const section = legacySectionRef.current;
    if (backdrop) {
      backdrop.style.visibility = "";
      backdrop.style.pointerEvents = "";
      delete backdrop.dataset.plannerEditEnhanced;
    }
    const close = section
      ? Array.from(section.querySelectorAll("button")).find((button) => button.textContent?.trim() === "×")
      : null;
    close?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    legacyBackdropRef.current = null;
    legacySectionRef.current = null;
    legacySnapshotRef.current = null;
    setOpen(false);
    setContext(null);
    setForm(null);
    setError("");
    setSuccess("");
  }, []);

  const loadContext = useCallback(async (snapshot: LegacySnapshot) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        date: snapshot.date,
        start: snapshot.start,
        plate: snapshot.plate,
        postId: snapshot.postId,
        mechanicId: snapshot.mechanicId,
      });
      const response = await fetch(`/api/planner/edit-context?${params}`, { cache: "no-store" });
      const data = await response.json() as EditContext & { error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити запис.");
      setContext(data);
      const parsed = splitComment(data.appointment.comment);
      setForm((current) => current ? {
        ...current,
        problem: data.appointment.problem || "",
        comment: parsed.comment,
        preliminaryWorks: parsed.preliminaryWorks,
      } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити запис.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const scan = () => {
      if (legacyBackdropRef.current?.isConnected) return;
      const sections = Array.from(document.querySelectorAll<HTMLElement>("section"));
      const section = sections.find((candidate) => {
        if (candidate.closest("[data-planner-edit-enhancer]")) return false;
        const text = candidate.textContent || "";
        return (text.includes("РЕДАГУВАННЯ ВИРОБНИЧОГО СЛОТУ") || text.includes("РЕДАГУВАННЯ НАРЯДУ"))
          && Boolean(candidate.querySelector('input[type="date"]'))
          && Boolean(candidate.querySelector('input[type="time"]'));
      });
      if (!section) return;
      const backdrop = section.parentElement as HTMLElement | null;
      if (!backdrop || backdrop.dataset.plannerEditEnhanced === "1") return;

      const date = controlByLabel(section, "Дата")?.value || "";
      const start = controlByLabel(section, "Початок")?.value || "";
      const duration = controlByLabel(section, "Тривалість")?.value || "60";
      const status = (controlByLabel(section, "Статус")?.value || "BOOKED") as Status;
      const postId = controlByLabel(section, "Пост")?.value || "";
      const mechanicId = controlByLabel(section, "Механік")?.value || "";
      const plate = section.querySelector("h2")?.textContent?.trim() || "";
      if (!date || !start) return;

      const snapshot: LegacySnapshot = { plate, date, start, duration, status, postId, mechanicId };
      legacyBackdropRef.current = backdrop;
      legacySectionRef.current = section;
      legacySnapshotRef.current = snapshot;
      backdrop.dataset.plannerEditEnhanced = "1";
      backdrop.style.visibility = "hidden";
      backdrop.style.pointerEvents = "none";

      setForm({
        date,
        start,
        duration,
        status,
        postId,
        mechanicId,
        problem: "",
        preliminaryWorks: "",
        comment: "",
      });
      setContext(null);
      setOpen(true);
      setError("");
      setSuccess("");
      void loadContext(snapshot);
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      const backdrop = legacyBackdropRef.current;
      if (backdrop) {
        backdrop.style.visibility = "";
        backdrop.style.pointerEvents = "";
      }
    };
  }, [loadContext]);

  const timeZone = context?.location.timezone || "Europe/Kyiv";
  const original = context?.appointment || null;
  const vehicle = context?.vehicle || null;
  const displayPlate = vehicle?.plateNumber || original?.plateNumber || legacySnapshotRef.current?.plate || "БЕЗ НОМЕРА";
  const clientName = vehicle?.client?.name || original?.customerName || "Клієнт";
  const clientPhone = vehicle?.client?.phone || original?.phone || "";
  const vehicleName = formatVehicle(vehicle, original?.vehicleLabel || null);

  const conflicts = useMemo<Conflict[]>(() => {
    if (!context || !form || NON_BLOCKING.has(form.status)) return [];
    const startMinute = clockToMinute(form.start);
    const length = Math.max(15, Number(form.duration || 60));
    const endMinute = startMinute + length;
    const schedule = context.workSchedule.find((item) => item.day === dayNumber(form.date));
    const result: Conflict[] = [];

    if (schedule && (!schedule.enabled || startMinute < schedule.openMinute || endMinute > schedule.closeMinute)) {
      result.push({
        kind: "SCHEDULE",
        title: schedule.enabled ? "Час поза графіком СТО" : "Це неробочий день",
        detail: schedule.enabled ? `Доступний час: ${schedule.open}–${schedule.close}.` : `${schedule.label}: СТО не працює.`,
      });
      return result;
    }

    const overlapping = context.dayAppointments.filter((item) => {
      if (item.id === context.appointment.id || NON_BLOCKING.has(item.status)) return false;
      const localStart = localDateTime(item.plannedStartAt, timeZone);
      if (localStart.day !== form.date) return false;
      const itemStart = localStart.minute;
      const itemEndLocal = localDateTime(item.plannedEndAt, timeZone);
      const itemEnd = itemEndLocal.day === form.date ? itemEndLocal.minute : 24 * 60;
      return itemStart < endMinute && itemEnd > startMinute;
    });

    if (form.postId) {
      const item = overlapping.find((entry) => entry.postId === form.postId);
      if (item) {
        const resource = context.location.posts.find((post) => post.id === form.postId)?.name || "Обраний пост";
        result.push({
          kind: "POST",
          title: `${resource} уже зайнятий`,
          detail: `${localDateTime(item.plannedStartAt, timeZone).clock}–${localDateTime(item.plannedEndAt, timeZone).clock} · ${item.plateNumber || item.vehicleLabel || "інше авто"}`,
        });
      }
    }
    if (form.mechanicId) {
      const item = overlapping.find((entry) => entry.mechanicId === form.mechanicId);
      if (item) {
        const resource = context.location.mechanics.find((mechanic) => mechanic.id === form.mechanicId)?.name || "Обраний майстер";
        result.push({
          kind: "MECHANIC",
          title: `${resource} уже зайнятий`,
          detail: `${localDateTime(item.plannedStartAt, timeZone).clock}–${localDateTime(item.plannedEndAt, timeZone).clock} · ${item.plateNumber || item.vehicleLabel || "інше авто"}`,
        });
      }
    }
    return result;
  }, [context, form, timeZone]);

  const alternatives = useMemo(() => {
    if (!context || !form) return { posts: [] as Post[], mechanics: [] as Mechanic[] };
    const startMinute = clockToMinute(form.start);
    const endMinute = startMinute + Math.max(15, Number(form.duration || 60));
    const overlapping = context.dayAppointments.filter((item) => {
      if (item.id === context.appointment.id || NON_BLOCKING.has(item.status)) return false;
      const itemStart = localDateTime(item.plannedStartAt, timeZone);
      if (itemStart.day !== form.date) return false;
      const itemEndLocal = localDateTime(item.plannedEndAt, timeZone);
      const itemEnd = itemEndLocal.day === form.date ? itemEndLocal.minute : 24 * 60;
      return itemStart.minute < endMinute && itemEnd > startMinute;
    });
    return {
      posts: context.location.posts.filter((post) => !overlapping.some((item) => item.postId === post.id)),
      mechanics: context.location.mechanics.filter((mechanic) => !overlapping.some((item) => item.mechanicId === mechanic.id)),
    };
  }, [context, form, timeZone]);

  const changeSummary = useMemo(() => {
    if (!context || !form) return [] as string[];
    const item = context.appointment;
    const originalLocal = localDateTime(item.plannedStartAt, timeZone);
    const originalDuration = durationMinutes(item);
    const result: string[] = [];
    if (originalLocal.day !== form.date || originalLocal.clock !== form.start) {
      result.push(`Час: ${formatDateChange(originalLocal.day, originalLocal.clock)} → ${formatDateChange(form.date, form.start)}`);
    }
    if (String(originalDuration) !== String(form.duration)) result.push(`Тривалість: ${originalDuration} хв → ${form.duration} хв`);
    if ((item.postId || "") !== form.postId) {
      const from = item.post?.name || "без поста";
      const to = context.location.posts.find((post) => post.id === form.postId)?.name || "без поста";
      result.push(`Пост: ${from} → ${to}`);
    }
    if ((item.mechanicId || "") !== form.mechanicId) {
      const from = item.mechanic?.name || "не призначено";
      const to = context.location.mechanics.find((mechanic) => mechanic.id === form.mechanicId)?.name || "не призначено";
      result.push(`Майстер: ${from} → ${to}`);
    }
    if (item.status !== form.status) result.push(`Статус: ${STATUS_LABELS[item.status]} → ${STATUS_LABELS[form.status]}`);
    if ((item.problem || "") !== form.problem.trim()) result.push("Оновлено причину заїзду");
    const parsed = splitComment(item.comment);
    if (parsed.preliminaryWorks !== form.preliminaryWorks.trim()) result.push("Оновлено попередні роботи");
    if (parsed.comment !== form.comment.trim()) result.push("Оновлено внутрішній коментар");
    return result;
  }, [context, form, timeZone]);

  const syncLegacyAndSubmit = useCallback((nextForm: FormState, forcedStatus?: Status) => {
    const section = legacySectionRef.current;
    const backdrop = legacyBackdropRef.current;
    if (!section || !backdrop) return;
    setNativeValue(controlByLabel(section, "Дата"), nextForm.date);
    setNativeValue(controlByLabel(section, "Початок"), nextForm.start);
    setNativeValue(controlByLabel(section, "Тривалість"), nextForm.duration);
    setNativeValue(controlByLabel(section, "Механік"), nextForm.mechanicId);
    setNativeValue(controlByLabel(section, "Пост"), nextForm.postId);
    setNativeValue(controlByLabel(section, "Статус"), forcedStatus || nextForm.status);

    window.setTimeout(() => {
      const save = Array.from(section.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Зберегти");
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.setTimeout(() => {
        if (backdrop.isConnected) {
          backdrop.style.visibility = "";
          backdrop.style.pointerEvents = "";
          delete backdrop.dataset.plannerEditEnhanced;
        }
      }, 1400);
    }, 80);
  }, []);

  const saveChanges = useCallback(async (goToDiagnostics = false) => {
    if (!context || !form) return;
    const targetStatus: Status = goToDiagnostics ? "ARRIVED" : form.status;
    if (!NON_BLOCKING.has(targetStatus) && conflicts.length) {
      setError("Спочатку усуньте конфлікт часу, поста або майстра.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const startMinute = clockToMinute(form.start);
      const duration = Math.max(15, Number(form.duration || 60));
      const [year, month, date] = form.date.split("-").map(Number);
      const hour = Math.floor(startMinute / 60);
      const minute = startMinute % 60;
      const wall = new Date(Date.UTC(year, month - 1, date, hour, minute));
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      const parts = Object.fromEntries(formatter.formatToParts(wall).map((part) => [part.type, part.value]));
      const wallAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const offset = wallAsUtc - wall.getTime();
      const plannedStartAt = new Date(wall.getTime() - offset);
      const refinedParts = Object.fromEntries(formatter.formatToParts(plannedStartAt).map((part) => [part.type, part.value]));
      const refinedWall = Date.UTC(Number(refinedParts.year), Number(refinedParts.month) - 1, Number(refinedParts.day), Number(refinedParts.hour), Number(refinedParts.minute), Number(refinedParts.second));
      const refinedOffset = refinedWall - plannedStartAt.getTime();
      const finalStart = new Date(wall.getTime() - refinedOffset);
      const finalEnd = new Date(finalStart.getTime() + duration * 60_000);

      const response = await fetch(`/api/planner/${context.appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: targetStatus,
          postId: form.postId || null,
          mechanicId: form.mechanicId || null,
          plannedStartAt: finalStart.toISOString(),
          plannedEndAt: finalEnd.toISOString(),
          problem: form.problem.trim() || null,
          comment: composeComment(form.comment, form.preliminaryWorks),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не вдалося зберегти зміни.");

      setSuccess(goToDiagnostics ? "Заїзд підтверджено. Передаю в діагностику…" : "Зміни збережено.");
      syncLegacyAndSubmit({ ...form, status: targetStatus }, targetStatus);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "appointment", id: context.appointment.id } }));
      setOpen(false);
      setContext(null);
      setForm(null);
      legacyBackdropRef.current = null;
      legacySectionRef.current = null;
      legacySnapshotRef.current = null;

      if (goToDiagnostics) {
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: "Діагностика" })), 260);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти зміни.");
    } finally {
      setSaving(false);
    }
  }, [conflicts, context, form, syncLegacyAndSubmit, timeZone]);

  function navigateClient(filter: string, label: string) {
    closeLegacy();
    window.dispatchEvent(new CustomEvent("turbolev:navigate", {
      detail: { section: "Клієнти та авто", filter, filterLabel: label },
    }));
  }

  if (!open || !form) return null;
  const statusOptions = EDIT_STATUSES.includes(form.status) ? EDIT_STATUSES : [form.status, ...EDIT_STATUSES];
  const sourceLabel = original?.source ? (SOURCE_LABELS[original.source] || original.source) : "CRM";

  return <div className="plannerEditEnhancerBackdrop" data-planner-edit-enhancer="true" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeLegacy(); }}>
    <section className="plannerEditEnhancerModal" onMouseDown={(event) => event.stopPropagation()}>
      <header className="plannerEditEnhancerHead">
        <div><p>РЕДАГУВАННЯ НАРЯДУ</p><span>Планувальник · {context?.location.name || "Turbo LEV"}</span></div>
        <button type="button" onClick={closeLegacy} disabled={saving}>×</button>
      </header>

      <div className="plannerEditEnhancerScroll">
        <section className="plannerEditVehicleCard">
          <div className="uaPlate plannerEditPlate" aria-label={`Держномер ${displayPlate}`}>
            <span className="uaPlateCountry"><span className="uaFlag"><i className="uaFlagBlue"/><i className="uaFlagYellow"/></span><small>UA</small></span>
            <span className="uaPlateText">{displayPlate}</span>
          </div>
          <VehicleBrandLogo brand={vehicle?.brand || vehicleName.split(" ")[0]} size={54} />
          <div className="plannerEditVehicleMain">
            <h2>{vehicleName}</h2>
            <p>{clientName}{clientPhone ? ` · ${clientPhone}` : ""}</p>
            <div>{vehicle?.vin && <span>VIN {vehicle.vin}</span>}<button type="button" onClick={() => navigateClient(clientPhone || displayPlate, `Клієнт ${clientName}`)}>Картка клієнта ↗</button><button type="button" onClick={() => navigateClient(displayPlate, vehicleName)}>Авто ↗</button></div>
          </div>
          <div className="plannerEditVehicleState"><span>{sourceLabel}</span><strong>{STATUS_LABELS[form.status]}</strong></div>
        </section>

        {loading && <div className="plannerEditNotice">Завантажую повну картку запису…</div>}
        {error && <div className="plannerEditError"><strong>Потрібна увага</strong><span>{error}</span></div>}
        {success && <div className="plannerEditSuccess">{success}</div>}

        <section className="plannerEditSection">
          <div className="plannerEditSectionTitle"><div><small>КОЛИ</small><h3>Дата і час заїзду</h3></div><span>{context?.workSchedule.find((item) => item.day === dayNumber(form.date))?.enabled === false ? "Вихідний" : "Перевіряємо завантаження автоматично"}</span></div>
          <div className="plannerEditGrid plannerEditGrid3">
            <label><span>Дата</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></label>
            <label><span>Час</span><input type="time" step={900} value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })}/></label>
            <label><span>Тривалість</span><select value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })}>{!["30","60","90","120","180","240"].includes(form.duration) && <option value={form.duration}>{form.duration} хв</option>}<option value="30">30 хв</option><option value="60">1 год</option><option value="90">1 год 30 хв</option><option value="120">2 год</option><option value="180">3 год</option><option value="240">4 год</option></select></label>
          </div>
        </section>

        <section className="plannerEditSection">
          <div className="plannerEditSectionTitle"><div><small>ХТО ПРИЙМАЄ</small><h3>Ресурси та статус</h3></div></div>
          <div className="plannerEditGrid plannerEditGrid3">
            <label><span>Пост</span><select value={form.postId} onChange={(event) => setForm({ ...form, postId: event.target.value })}><option value="">Зона приймання / без поста</option>{context?.location.posts.map((post) => <option key={post.id} value={post.id}>{post.name}</option>)}</select></label>
            <label><span>Майстер</span><select value={form.mechanicId} onChange={(event) => setForm({ ...form, mechanicId: event.target.value })}><option value="">Не призначено</option>{context?.location.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
            <label><span>Статус запису</span><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Status })}>{statusOptions.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          </div>

          {conflicts.length > 0 && <div className="plannerEditConflict">
            <div><b>⛔ Є конфлікт планувальника</b><span>Збереження заблоковано, доки ресурс не буде вільним.</span></div>
            {conflicts.map((conflict, index) => <p key={`${conflict.kind}-${index}`}><strong>{conflict.title}</strong><span>{conflict.detail}</span></p>)}
            {(alternatives.posts.length > 0 || alternatives.mechanics.length > 0) && <small>Вільні зараз: {alternatives.posts.slice(0, 3).map((item) => item.name).join(", ")}{alternatives.posts.length && alternatives.mechanics.length ? " · " : ""}{alternatives.mechanics.slice(0, 3).map((item) => item.name).join(", ")}</small>}
          </div>}
        </section>

        <section className="plannerEditSection plannerEditTextSection">
          <div className="plannerEditSectionTitle"><div><small>ЗАВДАННЯ</small><h3>Що робимо з авто</h3></div><span>Коротко і по суті для приймальника та майстра</span></div>
          <label><span>Причина заїзду</span><textarea rows={2} value={form.problem} onChange={(event) => setForm({ ...form, problem: event.target.value })} placeholder="Напр.: стук спереду, перевірити ходову"/></label>
          <label><span>Попередні роботи</span><textarea rows={3} value={form.preliminaryWorks} onChange={(event) => setForm({ ...form, preliminaryWorks: event.target.value })} placeholder="Кожна робота з нового рядка"/><small>Роботи, які менеджер додав у «Новій заявці». Тут їх можна швидко уточнити.</small></label>
          <label><span>Внутрішній коментар для СТО</span><textarea rows={2} value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} placeholder="Напр.: подзвонити клієнту перед початком робіт"/></label>
        </section>

        {changeSummary.length > 0 && <section className="plannerEditChanges"><b>Що зміниться після збереження</b>{changeSummary.map((change) => <span key={change}>• {change}</span>)}</section>}
      </div>

      <footer className="plannerEditEnhancerFoot">
        <button className="plannerEditSecondary" type="button" onClick={closeLegacy} disabled={saving}>Скасувати</button>
        {form.status === "ARRIVED" && <button className="plannerEditDiagnostics" type="button" onClick={() => void saveChanges(true)} disabled={saving || conflicts.length > 0}>{saving ? "Зберігаю…" : "Передати на діагностику →"}</button>}
        <button className="plannerEditPrimary" type="button" onClick={() => void saveChanges(false)} disabled={saving || (!NON_BLOCKING.has(form.status) && conflicts.length > 0)}>{saving ? "Зберігаю…" : "Зберегти зміни"}</button>
      </footer>
    </section>

    <style jsx global>{`
      .plannerEditEnhancerBackdrop{position:fixed;inset:0;z-index:1900;display:grid;place-items:center;padding:18px;background:rgba(8,10,13,.58);backdrop-filter:blur(7px)}
      .plannerEditEnhancerModal{width:min(900px,calc(100vw - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:20px;background:var(--panel);color:var(--text);box-shadow:0 34px 100px rgba(0,0,0,.36)}
      .plannerEditEnhancerHead{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
      .plannerEditEnhancerHead p{margin:0 0 3px;color:var(--orange);font-size:9px;font-weight:900;letter-spacing:.12em}.plannerEditEnhancerHead span{color:var(--muted);font-size:10px}.plannerEditEnhancerHead>button{width:35px;height:35px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);color:var(--text);font-size:20px;cursor:pointer}
      .plannerEditEnhancerScroll{min-height:0;overflow:auto;padding:16px 20px 20px;display:grid;gap:12px}
      .plannerEditVehicleCard{display:grid;grid-template-columns:155px 58px minmax(0,1fr) auto;align-items:center;gap:13px;padding:15px;border:1px solid var(--line);border-radius:15px;background:var(--panel-2)}
      .plannerEditPlate{width:155px;height:49px}.plannerEditPlate .uaPlateText{font-size:18px;letter-spacing:.08em}.plannerEditVehicleMain{min-width:0}.plannerEditVehicleMain h2{margin:0;font-size:20px;line-height:1.15;letter-spacing:-.025em}.plannerEditVehicleMain p{margin:5px 0;color:var(--muted);font-size:11px}.plannerEditVehicleMain>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.plannerEditVehicleMain>div span{color:var(--muted);font-size:9px}.plannerEditVehicleMain>div button{border:0;background:transparent;color:var(--orange);padding:0;font-size:9px;font-weight:800;cursor:pointer}.plannerEditVehicleState{display:flex;flex-direction:column;align-items:flex-end;gap:7px}.plannerEditVehicleState span{padding:5px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:8px}.plannerEditVehicleState strong{padding:7px 10px;border-radius:999px;background:color-mix(in srgb,var(--orange) 12%,var(--panel));color:var(--orange);font-size:9px;white-space:nowrap}
      .plannerEditNotice,.plannerEditSuccess{padding:10px 12px;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:10px}.plannerEditSuccess{border-color:color-mix(in srgb,#16a34a 40%,var(--line));background:color-mix(in srgb,#16a34a 7%,var(--panel));color:#16a34a}.plannerEditError{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid color-mix(in srgb,#dc2626 42%,var(--line));border-radius:10px;background:color-mix(in srgb,#dc2626 6%,var(--panel));font-size:10px}.plannerEditError strong{color:#dc2626}.plannerEditError span{color:var(--muted)}
      .plannerEditSection{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.plannerEditSectionTitle{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:11px}.plannerEditSectionTitle small{display:block;margin-bottom:3px;color:var(--orange);font-size:7px;font-weight:900;letter-spacing:.11em}.plannerEditSectionTitle h3{margin:0;font-size:14px}.plannerEditSectionTitle>span{color:var(--muted);font-size:8px;text-align:right}
      .plannerEditGrid{display:grid;gap:9px}.plannerEditGrid3{grid-template-columns:repeat(3,minmax(0,1fr))}.plannerEditGrid label,.plannerEditTextSection label{display:grid;gap:5px}.plannerEditGrid label>span,.plannerEditTextSection label>span{color:var(--muted);font-size:8px;font-weight:750;text-transform:uppercase}.plannerEditGrid input,.plannerEditGrid select,.plannerEditTextSection textarea{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--panel-2);color:var(--text);font:inherit}.plannerEditGrid input,.plannerEditGrid select{height:40px;padding:0 10px;font-size:10px}.plannerEditTextSection{display:grid;gap:11px}.plannerEditTextSection textarea{resize:vertical;min-height:62px;padding:10px 11px;font-size:10px;line-height:1.45}.plannerEditTextSection label>small{color:var(--muted);font-size:7.5px}
      .plannerEditConflict{margin-top:10px;padding:11px 12px;border:1px solid color-mix(in srgb,#dc2626 45%,var(--line));border-radius:11px;background:color-mix(in srgb,#dc2626 5%,var(--panel));display:grid;gap:7px}.plannerEditConflict>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.plannerEditConflict>div b{color:#dc2626;font-size:10px}.plannerEditConflict>div span,.plannerEditConflict small{color:var(--muted);font-size:8px}.plannerEditConflict p{margin:0;display:grid;grid-template-columns:180px 1fr;gap:9px;padding-top:6px;border-top:1px solid color-mix(in srgb,#dc2626 20%,var(--line));font-size:9px}.plannerEditConflict p strong{color:var(--text)}.plannerEditConflict p span{color:var(--muted)}
      .plannerEditChanges{padding:11px 13px;border:1px dashed color-mix(in srgb,var(--orange) 45%,var(--line));border-radius:11px;background:color-mix(in srgb,var(--orange) 4%,var(--panel));display:grid;gap:4px}.plannerEditChanges b{font-size:9px}.plannerEditChanges span{color:var(--muted);font-size:8px}
      .plannerEditEnhancerFoot{display:flex;justify-content:flex-end;gap:8px;padding:13px 20px;border-top:1px solid var(--line);background:var(--panel)}.plannerEditEnhancerFoot button{min-height:41px;border-radius:10px;padding:0 14px;font-size:10px;font-weight:850;cursor:pointer}.plannerEditEnhancerFoot button:disabled{opacity:.45;cursor:default}.plannerEditSecondary{border:1px solid var(--line);background:var(--panel-2);color:var(--text)}.plannerEditPrimary{border:1px solid var(--orange);background:var(--orange);color:#fff}.plannerEditDiagnostics{border:1px solid #16a34a;background:#16a34a;color:#fff}
      @media(max-width:760px){.plannerEditEnhancerBackdrop{padding:8px}.plannerEditEnhancerModal{width:100%;max-height:calc(100vh - 16px);border-radius:14px}.plannerEditEnhancerScroll{padding:12px}.plannerEditVehicleCard{grid-template-columns:135px 48px 1fr}.plannerEditVehicleState{grid-column:1/-1;flex-direction:row;align-items:center}.plannerEditPlate{width:135px}.plannerEditPlate .uaPlateText{font-size:15px}.plannerEditGrid3{grid-template-columns:1fr}.plannerEditSectionTitle{align-items:flex-start;flex-direction:column}.plannerEditEnhancerFoot{padding:10px 12px;flex-wrap:wrap}.plannerEditEnhancerFoot button{flex:1;min-width:130px}.plannerEditConflict p{grid-template-columns:1fr}}
    `}</style>
  </div>;
}
