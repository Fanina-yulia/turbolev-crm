"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import styles from "./planner-v2.module.css";

type Status =
  | "BOOKED" | "ARRIVED" | "DIAGNOSTICS" | "WAITING_PARTS_SELECTION" | "WAITING_CALCULATION"
  | "WAITING_APPROVAL" | "WAITING_PARTS" | "READY_FOR_REPAIR" | "IN_REPAIR" | "WAITING_QC"
  | "READY_FOR_PICKUP" | "COMPLETED" | "WARRANTY" | "PAUSED" | "NO_SHOW" | "CANCELLED" | "RESERVE";

type Post = { id: string; name: string; sortOrder: number; capabilities: string[] };
type Mechanic = { id: string; name: string; sortOrder: number };
type Location = { id: string; name: string; timezone: string; openMinute: number; closeMinute: number; posts: Post[]; mechanics: Mechanic[] };
type Appointment = {
  id: string; locationId: string; postId: string | null; mechanicId: string | null; status: Status;
  leadId?: string | null; clientId?: string | null; vehicleId?: string | null; workOrderId?: string | null;
  customerName: string | null; phone: string | null; vehicleLabel: string | null; plateNumber: string | null;
  problem: string | null; comment: string | null; source: string | null; estimatedAmount: string | number | null;
  priority: number; plannedStartAt: string; plannedEndAt: string; actualArrivalAt: string | null;
  actualStartAt: string | null; actualEndAt: string | null; partsEtaAt: string | null; noShowAt: string | null;
  post?: Post | null; mechanic?: Mechanic | null;
};
type BoardResponse = { status: string; locations: Location[]; activeLocationId: string | null; appointments: Appointment[]; message?: string };
type FormState = {
  id?: string; workOrderId?: string | null; postId: string; mechanicId: string; status: Status; customerName: string; phone: string;
  vehicleLabel: string; plateNumber: string; problem: string; comment: string; estimatedAmount: string;
  start: string; duration: string; partsEtaAt: string;
};

type Zone = "WAITING_ZONE" | "WAITING_PARTS";

const SLOT_MINUTES = 30;
const ROW_HEIGHT = 52;
const STATUS_META: Record<Status, { label: string; tone: string }> = {
  BOOKED: { label: "Записаний", tone: "booked" }, ARRIVED: { label: "Приїхав", tone: "arrived" },
  DIAGNOSTICS: { label: "Діагностика", tone: "diagnostics" }, WAITING_PARTS_SELECTION: { label: "Підбір деталей", tone: "waiting" },
  WAITING_CALCULATION: { label: "Калькуляція", tone: "waiting" }, WAITING_APPROVAL: { label: "Погодження", tone: "approval" },
  WAITING_PARTS: { label: "Очікує запчастини", tone: "parts" }, READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "ready" },
  IN_REPAIR: { label: "У ремонті", tone: "repair" }, WAITING_QC: { label: "Очікує QC", tone: "qc" },
  READY_FOR_PICKUP: { label: "Готовий до видачі", tone: "ready" }, COMPLETED: { label: "Виданий", tone: "done" },
  WARRANTY: { label: "Гарантія", tone: "warranty" }, PAUSED: { label: "Призупинений", tone: "paused" },
  NO_SHOW: { label: "No-show", tone: "noshow" }, CANCELLED: { label: "Скасований", tone: "cancelled" }, RESERVE: { label: "Резерв", tone: "reserve" },
};
const STATUS_OPTIONS = Object.keys(STATUS_META) as Status[];
const TERMINAL: Status[] = ["COMPLETED", "CANCELLED", "NO_SHOW"];
const WORKING: Status[] = ["ARRIVED", "DIAGNOSTICS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "READY_FOR_PICKUP", "WARRANTY", "PAUSED"];

const pad = (n: number) => String(n).padStart(2, "0");
function dayKey(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function addDays(day: string, count: number) { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + count); return dayKey(d); }
function minuteOfDay(iso: string) { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
function timeLabel(minute: number) { return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`; }
function localDateTimeValue(iso: string | null) { if (!iso) return ""; const d = new Date(iso); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function durationMinutes(item: Appointment) { return Math.max(SLOT_MINUTES, Math.round((new Date(item.plannedEndAt).getTime() - new Date(item.plannedStartAt).getTime()) / 60000)); }
function money(value: Appointment["estimatedAmount"]) { const n = Number(value); return value != null && value !== "" && Number.isFinite(n) ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(n) : null; }
function emptyForm(start = "09:00", postId = ""): FormState { return { postId, mechanicId: "", status: "BOOKED", customerName: "", phone: "", vehicleLabel: "", plateNumber: "", problem: "", comment: "", estimatedAmount: "", start, duration: "60", partsEtaAt: "" }; }
function humanTime(iso: string | null) { if (!iso) return "—"; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function lateness(item: Appointment) {
  if (!item.actualArrivalAt) return null;
  const minutes = Math.round((new Date(item.actualArrivalAt).getTime() - new Date(item.plannedStartAt).getTime()) / 60000);
  if (Math.abs(minutes) < 3) return "вчасно";
  return minutes > 0 ? `+${minutes} хв` : `${minutes} хв`;
}

export function PlannerV2() {
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [mechanicFilter, setMechanicFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Планувальник готовий до роботи.");
  const [modal, setModal] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const location = useMemo(() => locations.find((x) => x.id === locationId) ?? locations[0] ?? null, [locations, locationId]);
  const filtered = useMemo(() => mechanicFilter ? appointments.filter((x) => x.mechanicId === mechanicFilter) : appointments, [appointments, mechanicFilter]);
  const active = useMemo(() => filtered.filter((x) => !TERMINAL.includes(x.status) && x.status !== "CANCELLED"), [filtered]);
  const waitingParts = useMemo(() => active.filter((x) => x.status === "WAITING_PARTS" || x.status === "WAITING_PARTS_SELECTION"), [active]);
  const waitingZone = useMemo(() => active.filter((x) => !x.postId && !waitingParts.some((w) => w.id === x.id)), [active, waitingParts]);
  const boardItems = useMemo(() => active.filter((x) => Boolean(x.postId) && !waitingParts.some((w) => w.id === x.id)), [active, waitingParts]);

  const load = useCallback(async (nextLocationId?: string) => {
    setBusy(true);
    try {
      const from = new Date(`${day}T00:00:00`).toISOString();
      const to = new Date(`${addDays(day, 1)}T00:00:00`).toISOString();
      const params = new URLSearchParams({ from, to });
      const requestedLocation = nextLocationId ?? locationId;
      if (requestedLocation) params.set("locationId", requestedLocation);
      const response = await fetch(`/api/planner?${params}`, { cache: "no-store" });
      const data = await response.json() as BoardResponse;
      if (!response.ok) throw new Error(data.message || "Не вдалося завантажити планувальник.");
      setLocations(data.locations ?? []);
      setLocationId(data.activeLocationId ?? "");
      setAppointments(data.appointments ?? []);
      setMessage("План і факт синхронізовано з Neon.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Планувальник тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }, [day, locationId]);

  useEffect(() => { void load(); }, [day]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [load]);

  const slots = useMemo(() => {
    if (!location) return [];
    const out: number[] = [];
    for (let m = location.openMinute; m < location.closeMinute; m += SLOT_MINUTES) out.push(m);
    return out;
  }, [location]);

  const stats = useMemo(() => {
    const now = Date.now();
    return {
      planned: active.filter((x) => x.status === "BOOKED").length,
      arrived: active.filter((x) => Boolean(x.actualArrivalAt) || WORKING.includes(x.status)).length,
      inRepair: active.filter((x) => x.status === "IN_REPAIR").length,
      waitingParts: waitingParts.length,
      noShowRisk: active.filter((x) => x.status === "BOOKED" && !x.actualArrivalAt && new Date(x.plannedStartAt).getTime() + 15 * 60_000 < now).length,
    };
  }, [active, waitingParts]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(day, i - 3)), [day]);
  const isToday = day === dayKey(new Date());
  const nowMinute = new Date().getHours() * 60 + new Date().getMinutes();

  function currentOnPost(postId: string) {
    if (!isToday) return null;
    return boardItems.find((item) => item.postId === postId && (
      item.status === "IN_REPAIR" ||
      (minuteOfDay(item.plannedStartAt) <= nowMinute && minuteOfDay(item.plannedEndAt) > nowMinute && WORKING.includes(item.status))
    )) ?? null;
  }

  function openCreate(postId = "", minute?: number) { setModal(emptyForm(timeLabel(minute ?? location?.openMinute ?? 540), postId)); }
  function openEdit(item: Appointment) {
    const start = new Date(item.plannedStartAt);
    setModal({
      id: item.id, workOrderId: item.workOrderId ?? null, postId: item.postId ?? "", mechanicId: item.mechanicId ?? "", status: item.status,
      customerName: item.customerName ?? "", phone: item.phone ?? "", vehicleLabel: item.vehicleLabel ?? "", plateNumber: item.plateNumber ?? "",
      problem: item.problem ?? "", comment: item.comment ?? "", estimatedAmount: item.estimatedAmount == null ? "" : String(item.estimatedAmount),
      start: `${pad(start.getHours())}:${pad(start.getMinutes())}`, duration: String(durationMinutes(item)), partsEtaAt: localDateTimeValue(item.partsEtaAt),
    });
  }

  async function patchAppointment(id: string, patch: Record<string, unknown>, success: string) {
    try {
      const response = await fetch(`/api/planner/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не вдалося змінити запис.");
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося змінити запис.");
    }
  }

  async function saveModal() {
    if (!modal || !location) return;
    const start = new Date(`${day}T${modal.start}:00`);
    const end = new Date(start.getTime() + Number(modal.duration || 60) * 60_000);
    const payload = {
      locationId: location.id, postId: modal.postId || null, mechanicId: modal.mechanicId || null, status: modal.status,
      customerName: modal.customerName, phone: modal.phone, vehicleLabel: modal.vehicleLabel, plateNumber: modal.plateNumber,
      problem: modal.problem, comment: modal.comment, estimatedAmount: modal.estimatedAmount || null,
      plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), partsEtaAt: modal.partsEtaAt ? new Date(modal.partsEtaAt).toISOString() : null, source: "CRM",
    };
    setSaving(true);
    try {
      const response = await fetch(modal.id ? `/api/planner/${modal.id}` : "/api/planner", {
        method: modal.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не вдалося зберегти запис.");
      setModal(null);
      setMessage(modal.id ? "Запис оновлено." : "Новий запис створено.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося зберегти запис.");
    } finally {
      setSaving(false);
    }
  }

  function dragId(event: DragEvent) { return event.dataTransfer.getData("text/planner-appointment"); }

  async function dropAppointment(event: DragEvent, postId: string, minute: number) {
    event.preventDefault();
    const id = dragId(event);
    const item = appointments.find((x) => x.id === id);
    if (!item) return;
    const start = new Date(`${day}T${timeLabel(minute)}:00`);
    const end = new Date(start.getTime() + durationMinutes(item) * 60_000);
    await patchAppointment(id, {
      postId,
      status: item.status === "WAITING_PARTS" || item.status === "WAITING_PARTS_SELECTION" ? "READY_FOR_REPAIR" : item.status,
      plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(),
    }, `Авто поставлено на пост на ${timeLabel(minute)}.`);
  }

  async function dropToZone(event: DragEvent, zone: Zone) {
    event.preventDefault();
    const id = dragId(event);
    const item = appointments.find((x) => x.id === id);
    if (!item) return;
    if (zone === "WAITING_PARTS") {
      await patchAppointment(id, { postId: null, mechanicId: null, status: "WAITING_PARTS" }, "Авто переміщено в зону очікування запчастин.");
    } else {
      await patchAppointment(id, { postId: null, mechanicId: null, status: item.actualArrivalAt ? "ARRIVED" : "BOOKED" }, "Авто переміщено в зону очікування поста.");
    }
  }

  function openWorkOrder(workOrderId: string) {
    setModal(null);
    window.dispatchEvent(new CustomEvent("turbolev:navigate", {
      detail: { section: "Замовлення-наряди", filter: `workorder:${workOrderId}`, filterLabel: `Замовлення-наряд ${workOrderId}` },
    }));
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p>TURBO LEV · ДИСПЕТЧЕРСЬКИЙ ЦЕНТР</p><h1>Планувальник</h1><span>План → факт → пост → механік → блокер. Один екран для керування станцією.</span></div>
      <div className={styles.headerActions}><button className={styles.secondary} onClick={() => setDay(dayKey(new Date()))}>Сьогодні</button><button className={styles.primary} onClick={() => openCreate()}>+ Запис у план</button></div>
    </header>

    <section className={styles.toolbar}>
      <div className={styles.dateNav}><button onClick={() => setDay(addDays(day, -1))}>‹</button><strong>{new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00`))}</strong><button onClick={() => setDay(addDays(day, 1))}>›</button></div>
      <label><span>Локація</span><select value={locationId} onChange={(e) => { setLocationId(e.target.value); void load(e.target.value); }}>{locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label><span>Механік</span><select value={mechanicFilter} onChange={(e) => setMechanicFilter(e.target.value)}><option value="">Усі механіки</option>{location?.mechanics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <button className={styles.refresh} disabled={busy} onClick={() => void load()}>{busy ? "Синхронізація…" : "Оновити"}</button>
    </section>

    <div className={styles.weekStrip}>{weekDays.map((x) => <button key={x} className={x === day ? styles.dayActive : ""} onClick={() => setDay(x)}><span>{new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(new Date(`${x}T12:00:00`))}</span><strong>{new Date(`${x}T12:00:00`).getDate()}</strong></button>)}</div>

    <section className={styles.kpis}>
      <article><span>План</span><strong>{stats.planned}</strong><small>ще очікуємо</small></article>
      <article><span>Факт приїзду</span><strong>{stats.arrived}</strong><small>авто вже на станції</small></article>
      <article><span>У ремонті</span><strong>{stats.inRepair}</strong><small>робота зараз</small></article>
      <article className={stats.waitingParts ? styles.kpiWarn : ""}><span>Очікують деталі</span><strong>{stats.waitingParts}</strong><small>звільняємо пост</small></article>
      <article className={stats.noShowRisk ? styles.kpiAlert : ""}><span>No-show ризик</span><strong>{stats.noShowRisk}</strong><small>&gt;15 хв від плану</small></article>
    </section>

    <div className={styles.systemMessage}>{message}</div>

    <section className={styles.zones}>
      <ZoneLane title="Вхід / очікує пост" subtitle="Авто вже приїхало або ще не розподілене" count={waitingZone.length} items={waitingZone} zone="WAITING_ZONE" onDrop={dropToZone} onOpen={openEdit} />
      <ZoneLane title="Очікує запчастини" subtitle="Пост має бути звільнений до приходу деталей" count={waitingParts.length} items={waitingParts} zone="WAITING_PARTS" onDrop={dropToZone} onOpen={openEdit} />
    </section>

    {!location ? <div className={styles.empty}>Немає активної локації.</div> : <section className={styles.boardWrap}>
      <div className={styles.board} style={{ gridTemplateColumns: `82px repeat(${Math.max(location.posts.length, 1)}, minmax(245px, 1fr))` }}>
        <div className={styles.corner}><span>ЧАС</span></div>
        {location.posts.map((post) => {
          const current = currentOnPost(post.id);
          return <div className={styles.postHead} key={post.id}><div><strong>{post.name}</strong><span>{boardItems.filter((x) => x.postId === post.id).length} записів</span></div><div className={`${styles.postState} ${current ? styles.postBusy : styles.postFree}`}><b>{current ? "ЗАЙНЯТИЙ" : "ВІЛЬНИЙ"}</b>{current && <small>{current.plateNumber || current.vehicleLabel || "авто"}</small>}</div></div>;
        })}
        <div className={styles.timeRail} style={{ height: slots.length * ROW_HEIGHT }}>{slots.map((m, i) => <div className={styles.timeCell} style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }} key={m}><span>{timeLabel(m)}</span></div>)}</div>
        {location.posts.map((post) => <div className={styles.postColumn} key={post.id} style={{ height: slots.length * ROW_HEIGHT }}>
          {slots.map((m, i) => <button type="button" aria-label={`${post.name} ${timeLabel(m)}`} className={styles.dropSlot} style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }} key={m}
            onDoubleClick={() => openCreate(post.id, m)} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => void dropAppointment(e, post.id, m)} />)}
          {boardItems.filter((x) => x.postId === post.id).map((item) => {
            const top = Math.max(0, ((minuteOfDay(item.plannedStartAt) - location.openMinute) / SLOT_MINUTES) * ROW_HEIGHT);
            const height = Math.max(44, (durationMinutes(item) / SLOT_MINUTES) * ROW_HEIGHT - 5);
            return <div className={styles.cardPosition} style={{ top, height }} key={item.id}><AppointmentCard item={item} onOpen={() => openEdit(item)} /></div>;
          })}
        </div>)}
      </div>
    </section>}

    <div className={styles.legend}>{(["BOOKED", "ARRIVED", "DIAGNOSTICS", "WAITING_PARTS", "IN_REPAIR", "WAITING_QC", "NO_SHOW", "RESERVE"] as Status[]).map((s) => <span key={s}><i className={`${styles.legendDot} ${styles[`tone_${STATUS_META[s].tone}`]}`} />{STATUS_META[s].label}</span>)}</div>

    {modal && location && <div className={styles.modalBackdrop} onMouseDown={() => setModal(null)}><section className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.modalHead}><div><p>{modal.id ? "КАРТКА ПЛАНУ / ФАКТУ" : "НОВИЙ ЗАПИС"}</p><h2>{modal.id ? (modal.vehicleLabel || modal.plateNumber || modal.customerName || "Запис") : "Записати клієнта"}</h2></div><button onClick={() => setModal(null)}>×</button></div>
      {modal.id && (() => { const item = appointments.find((x) => x.id === modal.id); return item ? <div className={styles.factStrip}><div><span>ПЛАН</span><b>{humanTime(item.plannedStartAt)}–{humanTime(item.plannedEndAt)}</b></div><div><span>ПРИЇХАВ</span><b>{humanTime(item.actualArrivalAt)}</b><small>{lateness(item) || "—"}</small></div><div><span>СТАРТ РОБІТ</span><b>{humanTime(item.actualStartAt)}</b></div><div><span>ЗАВЕРШЕНО</span><b>{humanTime(item.actualEndAt)}</b></div></div> : null; })()}
      <div className={styles.formGrid}>
        <label><span>Пост</span><select value={modal.postId} onChange={(e) => setModal({ ...modal, postId: e.target.value })}><option value="">Зона очікування</option>{location.posts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span>Механік</span><select value={modal.mechanicId} onChange={(e) => setModal({ ...modal, mechanicId: e.target.value })}><option value="">Не призначено</option>{location.mechanics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label><span>Початок план</span><input type="time" step="1800" value={modal.start} onChange={(e) => setModal({ ...modal, start: e.target.value })} /></label>
        <label><span>Тривалість</span><select value={modal.duration} onChange={(e) => setModal({ ...modal, duration: e.target.value })}>{[30,60,90,120,180,240,360,480].map((v) => <option value={v} key={v}>{v < 60 ? `${v} хв` : `${v / 60} год`}</option>)}</select></label>
        <label><span>Статус</span><select value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value as Status })}>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></label>
        <label><span>Попередня сума</span><input inputMode="decimal" value={modal.estimatedAmount} onChange={(e) => setModal({ ...modal, estimatedAmount: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="0 грн" /></label>
        <label><span>Клієнт</span><input value={modal.customerName} onChange={(e) => setModal({ ...modal, customerName: e.target.value })} placeholder="ПІБ / ім'я" /></label>
        <label><span>Телефон</span><input value={modal.phone} onChange={(e) => setModal({ ...modal, phone: e.target.value })} placeholder="+380…" /></label>
        <label><span>Автомобіль</span><input value={modal.vehicleLabel} onChange={(e) => setModal({ ...modal, vehicleLabel: e.target.value })} placeholder="Mazda 6 2016" /></label>
        <label><span>Держномер</span><input value={modal.plateNumber} onChange={(e) => setModal({ ...modal, plateNumber: e.target.value.toUpperCase() })} placeholder="AA 0000 AA" /></label>
        <label className={styles.wide}><span>Проблема / причина звернення</span><textarea value={modal.problem} onChange={(e) => setModal({ ...modal, problem: e.target.value })} /></label>
        <label className={styles.wide}><span>Коментар диспетчера</span><textarea value={modal.comment} onChange={(e) => setModal({ ...modal, comment: e.target.value })} /></label>
        <label className={styles.wide}><span>ETA запчастин</span><input type="datetime-local" value={modal.partsEtaAt} onChange={(e) => setModal({ ...modal, partsEtaAt: e.target.value })} /></label>
      </div>
      {modal.id && <div className={styles.quickActions}>
        <button onClick={() => void patchAppointment(modal.id!, { status: "ARRIVED", postId: null }, "Фактичний приїзд зафіксовано.").then(() => setModal(null))}>✓ Приїхав</button>
        <button onClick={() => void patchAppointment(modal.id!, { status: "IN_REPAIR" }, "Ремонт розпочато.").then(() => setModal(null))}>▶ Почати ремонт</button>
        <button onClick={() => void patchAppointment(modal.id!, { status: "WAITING_PARTS", postId: null, mechanicId: null }, "Авто очікує запчастини; пост звільнено.").then(() => setModal(null))}>⌛ Очікує деталі</button>
        <button onClick={() => void patchAppointment(modal.id!, { status: "WAITING_QC" }, "Передано на контроль якості.").then(() => setModal(null))}>QC</button>
        <button onClick={() => void patchAppointment(modal.id!, { status: "NO_SHOW" }, "Позначено no-show.").then(() => setModal(null))}>No-show</button>
        {modal.workOrderId && <button className={styles.workOrderButton} onClick={() => openWorkOrder(modal.workOrderId!)}>Відкрити замовлення-наряд →</button>}
      </div>}
      <div className={styles.modalFoot}><button className={styles.secondary} onClick={() => setModal(null)}>Закрити</button><button className={styles.primary} disabled={saving} onClick={() => void saveModal()}>{saving ? "Зберігаю…" : modal.id ? "Зберегти зміни" : "Створити запис"}</button></div>
    </section></div>}
  </div>;
}

function ZoneLane({ title, subtitle, count, items, zone, onDrop, onOpen }: { title: string; subtitle: string; count: number; items: Appointment[]; zone: Zone; onDrop: (event: DragEvent, zone: Zone) => Promise<void>; onOpen: (item: Appointment) => void }) {
  return <div className={styles.zone} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => void onDrop(e, zone)}>
    <div className={styles.zoneHead}><div><strong>{title}</strong><span>{subtitle}</span></div><b>{count}</b></div>
    <div className={styles.zoneCards}>{items.length ? items.map((item) => <AppointmentCard key={item.id} item={item} compact onOpen={() => onOpen(item)} />) : <div className={styles.zoneEmpty}>Перетягни авто сюди</div>}</div>
  </div>;
}

function AppointmentCard({ item, compact = false, onOpen }: { item: Appointment; compact?: boolean; onOpen: () => void }) {
  const meta = STATUS_META[item.status];
  const start = new Date(item.plannedStartAt); const end = new Date(item.plannedEndAt);
  const plan = `${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`;
  const fact = item.actualArrivalAt ? new Date(item.actualArrivalAt) : null;
  const delay = lateness(item);
  return <button type="button" draggable={!TERMINAL.includes(item.status)}
    onDragStart={(e) => { e.dataTransfer.setData("text/planner-appointment", item.id); e.dataTransfer.effectAllowed = "move"; }} onClick={onOpen}
    className={`${styles.appointment} ${styles[`tone_${meta.tone}`]} ${compact ? styles.appointmentCompact : ""}`}>
    <div className={styles.appointmentTop}><strong>{item.status === "RESERVE" ? "РЕЗЕРВ" : item.plateNumber || item.vehicleLabel || item.customerName || "Запис"}</strong><span>{plan}</span></div>
    {item.status !== "RESERVE" && <div className={styles.appointmentVehicle}>{item.vehicleLabel || item.customerName || "Авто не вказано"}</div>}
    <div className={styles.appointmentMeta}><span>{meta.label}</span>{item.mechanic?.name && <span>{item.mechanic.name}</span>}{fact && <span>факт {pad(fact.getHours())}:{pad(fact.getMinutes())}{delay ? ` · ${delay}` : ""}</span>}</div>
    {item.problem && <small>{item.problem}</small>}
    <div className={styles.appointmentFoot}>{money(item.estimatedAmount) && <b>{money(item.estimatedAmount)}</b>}{item.partsEtaAt && <span>ETA {new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.partsEtaAt))}</span>}</div>
  </button>;
}
