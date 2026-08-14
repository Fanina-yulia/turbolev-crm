"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import styles from "./planner-v2.module.css";

type Status =
  | "BOOKED" | "ARRIVED" | "DIAGNOSTICS" | "WAITING_PARTS_SELECTION" | "WAITING_CALCULATION"
  | "WAITING_APPROVAL" | "WAITING_PARTS" | "READY_FOR_REPAIR" | "IN_REPAIR" | "WAITING_QC"
  | "READY_FOR_PICKUP" | "COMPLETED" | "WARRANTY" | "PAUSED" | "NO_SHOW" | "CANCELLED" | "RESERVE";
type ViewMode = "DAY" | "WEEK" | "LIST";
type PlanType = "DIAGNOSTICS_BOOKING" | "APPROVED_REPAIR";
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
type PlannerWarning = { type?: string; message?: string; parallelCount?: number } | null;
type WriteResponse = { status?: string; message?: string; warning?: PlannerWarning; appointment?: Appointment };
type FormState = {
  id?: string; workOrderId?: string | null; date: string; postId: string; mechanicId: string; status: Status; planType: PlanType;
  customerName: string; phone: string; vehicleLabel: string; plateNumber: string; problem: string; comment: string;
  estimatedAmount: string; start: string; duration: string; partsEtaAt: string;
};

const STATUS_META: Record<Status, { label: string; tone: string }> = {
  BOOKED: { label: "Записаний", tone: "blue" }, ARRIVED: { label: "Приїхав", tone: "green" },
  DIAGNOSTICS: { label: "Діагностика", tone: "violet" }, WAITING_PARTS_SELECTION: { label: "Підбір деталей", tone: "amber" },
  WAITING_CALCULATION: { label: "Калькуляція", tone: "amber" }, WAITING_APPROVAL: { label: "Погодження", tone: "orange" },
  WAITING_PARTS: { label: "Очікує деталі", tone: "amber" }, READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "green" },
  IN_REPAIR: { label: "У ремонті", tone: "orange" }, WAITING_QC: { label: "Контроль якості", tone: "cyan" },
  READY_FOR_PICKUP: { label: "Готовий до видачі", tone: "green" }, COMPLETED: { label: "Виданий", tone: "gray" },
  WARRANTY: { label: "Гарантія", tone: "pink" }, PAUSED: { label: "Пауза", tone: "gray" },
  NO_SHOW: { label: "No-show", tone: "red" }, CANCELLED: { label: "Скасований", tone: "gray" }, RESERVE: { label: "Резерв", tone: "gray" },
};
const STATUS_OPTIONS = Object.keys(STATUS_META) as Status[];
const POST_COLORS = ["#ff5a1f", "#2f80ed", "#7c3aed", "#16a34a", "#d97706", "#0891b2", "#db2777", "#475569"];
const pad = (n: number) => String(n).padStart(2, "0");

function dayKey(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function startOfWeek(value: string) {
  const d = new Date(`${value}T12:00:00`);
  const weekday = d.getDay() || 7;
  d.setDate(d.getDate() - weekday + 1);
  return dayKey(d);
}
function addDays(day: string, count: number) { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + count); return dayKey(d); }
function formatDate(day: string) { return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${day}T12:00:00`)); }
function formatDayShort(day: string) { return new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(new Date(`${day}T12:00:00`)).replace(".", ""); }
function formatClock(iso: string | null) { if (!iso) return "—"; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function localDateTimeValue(iso: string | null) { if (!iso) return ""; const d = new Date(iso); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function durationMinutes(item: Appointment) { return Math.max(30, Math.round((new Date(item.plannedEndAt).getTime() - new Date(item.plannedStartAt).getTime()) / 60000)); }
function money(value: Appointment["estimatedAmount"]) { const n = Number(value); return value != null && value !== "" && Number.isFinite(n) ? new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(n) : null; }
function planTypeFromSource(source: string | null): PlanType { return source === "APPROVED_REPAIR" ? "APPROVED_REPAIR" : "DIAGNOSTICS_BOOKING"; }
function emptyForm(date: string, start = "09:00"): FormState {
  return { date, postId: "", mechanicId: "", status: "BOOKED", planType: "DIAGNOSTICS_BOOKING", customerName: "", phone: "", vehicleLabel: "", plateNumber: "", problem: "", comment: "", estimatedAmount: "", start, duration: "60", partsEtaAt: "" };
}

export function PlannerV2() {
  const [anchorDay, setAnchorDay] = useState(() => dayKey(new Date()));
  const [view, setView] = useState<ViewMode>("WEEK");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [mechanicFilter, setMechanicFilter] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [message, setMessage] = useState("План робіт готовий.");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<FormState | null>(null);

  const weekStart = useMemo(() => startOfWeek(anchorDay), [anchorDay]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const location = useMemo(() => locations.find((item) => item.id === locationId) ?? locations[0] ?? null, [locations, locationId]);

  const load = useCallback(async (nextLocationId?: string) => {
    setBusy(true);
    try {
      const from = new Date(`${weekStart}T00:00:00`).toISOString();
      const to = new Date(`${addDays(weekStart, 7)}T00:00:00`).toISOString();
      const params = new URLSearchParams({ from, to });
      const requestedLocation = nextLocationId ?? locationId;
      if (requestedLocation) params.set("locationId", requestedLocation);
      const response = await fetch(`/api/planner?${params}`, { cache: "no-store" });
      const data = await response.json() as BoardResponse;
      if (!response.ok) throw new Error(data.message || "Не вдалося завантажити План робіт.");
      setLocations(data.locations ?? []);
      setLocationId(data.activeLocationId ?? "");
      setAppointments(data.appointments ?? []);
      setMessage("План робіт синхронізовано з сервером.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "План робіт тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }, [weekStart, locationId]);

  useEffect(() => { void load(); }, [weekStart]);
  useEffect(() => { const timer = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(timer); }, [load]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLocaleLowerCase("uk-UA");
    return appointments
      .filter((item) => item.status !== "CANCELLED")
      .filter((item) => !statusFilter || item.status === statusFilter)
      .filter((item) => !mechanicFilter || item.mechanicId === mechanicFilter)
      .filter((item) => {
        if (!q) return true;
        const haystack = [item.id, item.workOrderId, item.customerName, item.phone, item.vehicleLabel, item.plateNumber, item.problem, item.comment].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA");
        return haystack.includes(q);
      });
  }, [appointments, statusFilter, mechanicFilter, searchTerm]);

  const activeDayItems = useMemo(() => filtered.filter((item) => dayKey(new Date(item.plannedStartAt)) === anchorDay), [filtered, anchorDay]);
  const weekRange = `${formatDate(weekStart)} — ${formatDate(addDays(weekStart, 6))}`;
  const thisWeek = startOfWeek(dayKey(new Date()));

  function colorForPost(postId: string | null) {
    if (!postId || !location) return "#64748b";
    const index = Math.max(0, location.posts.findIndex((post) => post.id === postId));
    return POST_COLORS[index % POST_COLORS.length];
  }

  function postKind(post: Post) {
    const caps = post.capabilities.map((item) => item.toUpperCase());
    if (caps.some((item) => item.includes("LIFT") || item.includes("ПІДЙОМ"))) return "Підйомник";
    if (caps.some((item) => item.includes("PIT") || item.includes("ЯМА"))) return "Яма";
    if (caps.some((item) => item.includes("ALIGN") || item.includes("РОЗВАЛ"))) return "Розвал-сходження";
    if (post.id === "post_glevakha_1" || post.id === "post_glevakha_2") return "Підйомник";
    return "Робочий пост";
  }

  function dayItems(day: string) {
    return filtered
      .filter((item) => dayKey(new Date(item.plannedStartAt)) === day)
      .sort((a, b) => +new Date(a.plannedStartAt) - +new Date(b.plannedStartAt));
  }

  function openCreate(date = anchorDay) {
    setAnchorDay(date);
    setModal(emptyForm(date, location ? `${pad(Math.floor(location.openMinute / 60))}:${pad(location.openMinute % 60)}` : "09:00"));
  }

  function openEdit(item: Appointment) {
    const start = new Date(item.plannedStartAt);
    setAnchorDay(dayKey(start));
    setModal({
      id: item.id, workOrderId: item.workOrderId ?? null, date: dayKey(start), postId: item.postId ?? "", mechanicId: item.mechanicId ?? "",
      status: item.status, planType: planTypeFromSource(item.source), customerName: item.customerName ?? "", phone: item.phone ?? "",
      vehicleLabel: item.vehicleLabel ?? "", plateNumber: item.plateNumber ?? "", problem: item.problem ?? "", comment: item.comment ?? "",
      estimatedAmount: item.estimatedAmount == null ? "" : String(item.estimatedAmount), start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      duration: String(durationMinutes(item)), partsEtaAt: localDateTimeValue(item.partsEtaAt),
    });
  }

  async function patchAppointment(id: string, patch: Record<string, unknown>, success: string) {
    try {
      const response = await fetch(`/api/planner/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json() as WriteResponse;
      if (!response.ok) throw new Error(data.message || "Не вдалося змінити запис.");
      setMessage(data.warning?.message ? `${success} ⚠ ${data.warning.message}` : success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося змінити запис.");
    }
  }

  async function saveModal() {
    if (!modal || !location) return;
    const start = new Date(`${modal.date}T${modal.start}:00`);
    const end = new Date(start.getTime() + Number(modal.duration || 60) * 60_000);
    const payload = {
      locationId: location.id, postId: modal.postId || null, mechanicId: modal.mechanicId || null, status: modal.status,
      customerName: modal.customerName, phone: modal.phone, vehicleLabel: modal.vehicleLabel, plateNumber: modal.plateNumber,
      problem: modal.problem, comment: modal.comment, estimatedAmount: modal.estimatedAmount || null, source: modal.planType,
      plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), partsEtaAt: modal.partsEtaAt ? new Date(modal.partsEtaAt).toISOString() : null,
    };
    setSaving(true);
    try {
      const response = await fetch(modal.id ? `/api/planner/${modal.id}` : "/api/planner", {
        method: modal.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json() as WriteResponse;
      if (!response.ok) throw new Error(data.message || "Не вдалося зберегти наряд.");
      const base = modal.id ? "Запис у Плані робіт оновлено." : "Запис додано у План робіт.";
      setMessage(data.warning?.message ? `${base} ⚠ ${data.warning.message}` : base);
      setModal(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося зберегти наряд.");
    } finally {
      setSaving(false);
    }
  }

  async function dropToDay(event: DragEvent, targetDay: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/planner-appointment");
    const item = appointments.find((entry) => entry.id === id);
    if (!item) return;
    const sourceStart = new Date(item.plannedStartAt);
    const start = new Date(`${targetDay}T${pad(sourceStart.getHours())}:${pad(sourceStart.getMinutes())}:00`);
    const end = new Date(start.getTime() + durationMinutes(item) * 60_000);
    await patchAppointment(id, { plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() }, `Наряд перенесено на ${formatDate(targetDay)}.`);
  }

  function openWorkOrder(workOrderId: string) {
    setModal(null);
    window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: { section: "Замовлення-наряди", filter: `workorder:${workOrderId}`, filterLabel: `Замовлення-наряд ${workOrderId}` } }));
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p>TURBO LEV / СТО {(location?.name || "ГЛЕВАХА").toUpperCase()}</p><h1>План робіт</h1></div>
      <div className={styles.headerRight}>
        <div className={styles.viewSwitch} aria-label="Режим Плану робіт">
          <button className={view === "DAY" ? styles.viewActive : ""} onClick={() => setView("DAY")}>День</button>
          <button className={view === "WEEK" ? styles.viewActive : ""} onClick={() => setView("WEEK")}>Тиждень</button>
          <button className={view === "LIST" ? styles.viewActive : ""} onClick={() => setView("LIST")}>Список</button>
        </div>
        <button className={styles.primary} onClick={() => openCreate(anchorDay)}>+ Новий наряд</button>
      </div>
    </header>

    <div className={styles.periodSummary}><i /><span><strong>{filtered.length}</strong> нарядів у вибраному періоді</span></div>

    <section className={styles.filters}>
      <div className={styles.filterTop}>
        <label><span>Статус</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">Усі статуси</option>{STATUS_OPTIONS.filter((status) => status !== "CANCELLED").map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}</select></label>
        <label><span>Виконавець</span><select value={mechanicFilter} onChange={(e) => setMechanicFilter(e.target.value)}><option value="">Усі виконавці</option>{location?.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
        <label className={styles.searchLabel}><span>Пошук</span><div className={styles.searchBox}><span>⌕</span><input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setSearchTerm(searchDraft); }} placeholder="Наряд, клієнт, авто, держномер або VIN..." /></div></label>
        <button className={styles.searchButton} onClick={() => setSearchTerm(searchDraft)}>Пошук</button>
      </div>
      <div className={styles.weekNav}>
        <button onClick={() => setAnchorDay(addDays(weekStart, -7))}>‹ Попередній тиждень</button>
        <button className={styles.rangeButton} onClick={() => setView("WEEK")}>{weekRange} <span>⌄</span></button>
        <button className={styles.thisWeek} disabled={weekStart === thisWeek} onClick={() => setAnchorDay(dayKey(new Date()))}>▣ Цей тиждень</button>
        <button onClick={() => setAnchorDay(addDays(weekStart, 7))}>Наступний тиждень ›</button>
      </div>
    </section>

    <section className={styles.resourceLegend}>
      {location?.posts.map((post) => <div key={post.id}><i style={{ background: colorForPost(post.id) }} /><strong>{post.name}</strong><span>{postKind(post)}</span></div>)}
      <div><i style={{ background: colorForPost(null) }} /><strong>Зона приймання</strong><span>Зона приймання</span></div>
    </section>

    {message ? <div className={styles.systemMessage}>{busy ? "Оновлюю…" : message}</div> : null}

    {view === "WEEK" && <section className={styles.weekBoard}>
      {weekDays.map((day) => <DayColumn key={day} day={day} today={day === dayKey(new Date())} items={dayItems(day)} colorForPost={colorForPost} onOpen={openEdit} onAdd={openCreate} onDrop={dropToDay} />)}
    </section>}

    {view === "DAY" && <section className={styles.dayMode}>
      <div className={styles.dayModeHead}><button onClick={() => setAnchorDay(addDays(anchorDay, -1))}>‹</button><div><strong>{new Intl.DateTimeFormat("uk-UA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${anchorDay}T12:00:00`))}</strong><span>{activeDayItems.length} нарядів</span></div><button onClick={() => setAnchorDay(addDays(anchorDay, 1))}>›</button></div>
      <div className={styles.dayCards} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void dropToDay(e, anchorDay)}>{activeDayItems.length ? activeDayItems.map((item) => <WorkCard key={item.id} item={item} color={colorForPost(item.postId)} onOpen={() => openEdit(item)} />) : <div className={styles.dayEmpty}>На цей день робіт немає</div>}</div>
      <button className={styles.dayAdd} onClick={() => openCreate(anchorDay)}>+ Додати наряд</button>
    </section>}

    {view === "LIST" && <section className={styles.listMode}>
      <div className={styles.listHead}><span>Дата / час</span><span>Автомобіль</span><span>Клієнт</span><span>Пост</span><span>Майстер</span><span>Статус</span></div>
      {filtered.length ? filtered.sort((a, b) => +new Date(a.plannedStartAt) - +new Date(b.plannedStartAt)).map((item) => <button key={item.id} className={styles.listRow} onClick={() => openEdit(item)}><span><b>{formatDate(dayKey(new Date(item.plannedStartAt)))}</b><small>{formatClock(item.plannedStartAt)}–{formatClock(item.plannedEndAt)}</small></span><span><b>{item.plateNumber || "Без номера"}</b><small>{item.vehicleLabel || "Авто не вказано"}</small></span><span>{item.customerName || "—"}</span><span><i style={{ background: colorForPost(item.postId) }} />{item.post?.name || "Зона приймання"}</span><span>{item.mechanic?.name || "—"}</span><span><em className={`${styles.statusBadge} ${styles[`status_${STATUS_META[item.status].tone}`]}`}>{STATUS_META[item.status].label}</em></span></button>) : <div className={styles.listEmpty}>Нарядів у цьому періоді немає.</div>}
    </section>}

    <p className={styles.ruleText}>Колір картки відповідає робочому посту. Перетин постів блокується; один майстер може вести до двох автомобілів одночасно, про паралельне завантаження CRM попереджає.</p>

    {modal && location && <div className={styles.modalBackdrop} onMouseDown={() => setModal(null)}><section className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.modalHead}><div><p>{modal.id ? "КАРТКА ПЛАНУ РОБІТ" : "НОВИЙ НАРЯД У ПЛАН"}</p><h2>{modal.id ? (modal.plateNumber || modal.vehicleLabel || modal.customerName || "Наряд") : "Додати у План робіт"}</h2></div><button onClick={() => setModal(null)}>×</button></div>

      <div className={styles.planType}><button className={modal.planType === "DIAGNOSTICS_BOOKING" ? styles.planTypeActive : ""} onClick={() => setModal({ ...modal, planType: "DIAGNOSTICS_BOOKING" })}><b>Діагностика</b><span>Запис / заїзд → заявка на діагностику</span></button><button className={modal.planType === "APPROVED_REPAIR" ? styles.planTypeActive : ""} onClick={() => setModal({ ...modal, planType: "APPROVED_REPAIR" })}><b>Погоджений ремонт</b><span>Роботи вже погоджені з клієнтом</span></button></div>

      {modal.id && (() => { const item = appointments.find((entry) => entry.id === modal.id); return item ? <div className={styles.factStrip}><div><span>ПЛАН</span><b>{formatClock(item.plannedStartAt)}–{formatClock(item.plannedEndAt)}</b></div><div><span>ПРИЇХАВ</span><b>{formatClock(item.actualArrivalAt)}</b></div><div><span>СТАРТ РОБІТ</span><b>{formatClock(item.actualStartAt)}</b></div><div><span>ЗАВЕРШЕНО</span><b>{formatClock(item.actualEndAt)}</b></div></div> : null; })()}

      <div className={styles.formGrid}>
        <label><span>Дата</span><input type="date" value={modal.date} onChange={(e) => setModal({ ...modal, date: e.target.value })} /></label>
        <label><span>Початок</span><input type="time" step="1800" value={modal.start} onChange={(e) => setModal({ ...modal, start: e.target.value })} /></label>
        <label><span>Пост</span><select value={modal.postId} onChange={(e) => setModal({ ...modal, postId: e.target.value })}><option value="">Зона приймання</option>{location.posts.map((post) => <option key={post.id} value={post.id}>{post.name} · {postKind(post)}</option>)}</select></label>
        <label><span>Виконавець</span><select value={modal.mechanicId} onChange={(e) => setModal({ ...modal, mechanicId: e.target.value })}><option value="">Не призначено</option>{location.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
        <label><span>Тривалість</span><select value={modal.duration} onChange={(e) => setModal({ ...modal, duration: e.target.value })}>{[30,60,90,120,180,240,360,480].map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} хв` : `${minutes / 60} год`}</option>)}</select></label>
        <label><span>Статус</span><select value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value as Status })}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}</select></label>
        <label><span>Клієнт</span><input value={modal.customerName} onChange={(e) => setModal({ ...modal, customerName: e.target.value })} /></label>
        <label><span>Телефон</span><input value={modal.phone} onChange={(e) => setModal({ ...modal, phone: e.target.value })} placeholder="+380…" /></label>
        <label><span>Автомобіль</span><input value={modal.vehicleLabel} onChange={(e) => setModal({ ...modal, vehicleLabel: e.target.value })} placeholder="Volvo XC90 2020" /></label>
        <label><span>Держномер</span><input value={modal.plateNumber} onChange={(e) => setModal({ ...modal, plateNumber: e.target.value.toUpperCase() })} placeholder="AA 0000 AA" /></label>
        <label><span>Попередня сума</span><input value={modal.estimatedAmount} onChange={(e) => setModal({ ...modal, estimatedAmount: e.target.value.replace(/[^0-9.,]/g, "") })} placeholder="0 грн" /></label>
        <label><span>ETA запчастин</span><input type="datetime-local" value={modal.partsEtaAt} onChange={(e) => setModal({ ...modal, partsEtaAt: e.target.value })} /></label>
        <label className={styles.wide}><span>Що робимо / причина звернення</span><textarea value={modal.problem} onChange={(e) => setModal({ ...modal, problem: e.target.value })} /></label>
        <label className={styles.wide}><span>Коментар</span><textarea value={modal.comment} onChange={(e) => setModal({ ...modal, comment: e.target.value })} /></label>
      </div>

      {modal.id && <div className={styles.quickActions}><button onClick={() => void patchAppointment(modal.id!, { status: "ARRIVED" }, "Заїзд зафіксовано.").then(() => setModal(null))}>✓ Приїхав</button><button onClick={() => void patchAppointment(modal.id!, { status: "IN_REPAIR" }, "Ремонт розпочато.").then(() => setModal(null))}>▶ Почати ремонт</button><button onClick={() => void patchAppointment(modal.id!, { status: "WAITING_PARTS", postId: null }, "Авто переміщено в очікування деталей, пост звільнено.").then(() => setModal(null))}>⌛ Очікує деталі</button><button onClick={() => void patchAppointment(modal.id!, { status: "WAITING_QC" }, "Передано на контроль якості.").then(() => setModal(null))}>QC</button>{modal.workOrderId && <button className={styles.workOrderButton} onClick={() => openWorkOrder(modal.workOrderId!)}>Відкрити замовлення-наряд →</button>}</div>}

      <div className={styles.modalFoot}><button className={styles.secondary} onClick={() => setModal(null)}>Закрити</button><button className={styles.primary} disabled={saving} onClick={() => void saveModal()}>{saving ? "Зберігаю…" : modal.id ? "Зберегти зміни" : "Додати у план"}</button></div>
    </section></div>}
  </div>;
}

function DayColumn({ day, today, items, colorForPost, onOpen, onAdd, onDrop }: { day: string; today: boolean; items: Appointment[]; colorForPost: (postId: string | null) => string; onOpen: (item: Appointment) => void; onAdd: (day: string) => void; onDrop: (event: DragEvent, targetDay: string) => Promise<void> }) {
  return <article className={`${styles.dayColumn} ${today ? styles.todayColumn : ""}`} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={(e) => void onDrop(e, day)}>
    <header><div><strong>{formatDayShort(day)}</strong><span>{new Date(`${day}T12:00:00`).getDate()}</span></div><b>{items.length}</b></header>
    <div className={styles.dayBody}>{items.length ? items.map((item) => <WorkCard key={item.id} item={item} color={colorForPost(item.postId)} onOpen={() => onOpen(item)} />) : <div className={styles.freeSlot}>Вільно</div>}</div>
    <button className={styles.addButton} onClick={() => onAdd(day)}>+ <span>Додати</span></button>
  </article>;
}

function WorkCard({ item, color, onOpen }: { item: Appointment; color: string; onOpen: () => void }) {
  const meta = STATUS_META[item.status];
  const style = { "--post-color": color } as CSSProperties;
  return <button className={styles.workCard} style={style} type="button" draggable={!["COMPLETED", "NO_SHOW", "CANCELLED"].includes(item.status)} onDragStart={(e) => { e.dataTransfer.setData("text/planner-appointment", item.id); e.dataTransfer.effectAllowed = "move"; }} onClick={onOpen}>
    <div className={styles.workCardTop}><span>{formatClock(item.plannedStartAt)}–{formatClock(item.plannedEndAt)}</span><em className={`${styles.statusBadge} ${styles[`status_${meta.tone}`]}`}>{meta.label}</em></div>
    <strong className={styles.plate}>{item.plateNumber || "БЕЗ НОМЕРА"}</strong>
    <b>{item.vehicleLabel || "Автомобіль"}</b>
    {item.customerName && <span className={styles.client}>{item.customerName}</span>}
    {item.problem && <small>{item.problem}</small>}
    <div className={styles.workCardFoot}><span>{item.post?.name || "Зона приймання"}</span><span>{item.mechanic?.name || "Без майстра"}</span>{money(item.estimatedAmount) && <b>{money(item.estimatedAmount)}</b>}</div>
  </button>;
}
