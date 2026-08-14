"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "ESTIMATE" | "WAITING" | "NO_ANSWER" | "BOOKED" | "ARRIVED" | "LOST" | "SPAM_WRONG" | "SUPPLIER_PARTNER";
type KpiKey = "new" | "unanswered" | "overdue" | "booked" | "conversion";
type UserOption = { id: string; name: string; internalNumber?: string | null };
type Lead = {
  id: string;
  name: string | null;
  phone: string;
  phoneNormalized: string;
  status: LeadStatus;
  source: string;
  carBrand: string | null;
  carModel: string | null;
  carYear: number | null;
  plateNumber: string | null;
  vin: string | null;
  need: string | null;
  comment: string | null;
  nextAction: string | null;
  nextContactAt: string | null;
  contactAttempts: number;
  lastActivityAt: string;
  preliminaryAmount: string | number | null;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  assignedUser?: UserOption | null;
  _count?: { calls: number };
};
type PlannerLocation = { id: string; name: string; posts: Array<{ id: string; name: string }>; mechanics: Array<{ id: string; name: string }> };
type BookingState = { lead: Lead; locationId: string; postId: string; mechanicId: string; date: string; time: string; duration: string };

const columns: Array<{ key: LeadStatus; label: string }> = [
  { key: "NEW", label: "Нові" },
  { key: "CONTACTED", label: "Контакт" },
  { key: "QUALIFIED", label: "Потреба" },
  { key: "ESTIMATE", label: "Прорахунок" },
  { key: "WAITING", label: "Думає / очікує" },
  { key: "NO_ANSWER", label: "Не додзвонились" },
  { key: "BOOKED", label: "Записані" },
  { key: "LOST", label: "Неуспішні" },
];
const sourceLabels: Record<string, string> = {
  PHONE: "Телефон", BINOTEL: "Binotel", WEBSITE: "Сайт", MESSENGER: "Messenger", INSTAGRAM: "Instagram", FACEBOOK: "Facebook",
  GOOGLE_MAPS: "Google Maps", VIBER: "Viber", WHATSAPP: "WhatsApp", OLX: "OLX", TIKTOK: "TikTok", REFERRAL: "Рекомендація", WALK_IN: "Без запису", OTHER: "Інше",
};

function pad(value: number) { return String(value).padStart(2, "0"); }
function carLabel(lead: Lead) { return [lead.carBrand, lead.carModel, lead.carYear].filter(Boolean).join(" ") || "Авто уточнюється"; }
function isOverdue(lead: Lead, slaMinutes: number) {
  if (["BOOKED", "ARRIVED", "LOST", "SPAM_WRONG", "SUPPLIER_PARTNER"].includes(lead.status)) return false;
  const stale = Date.now() - new Date(lead.lastActivityAt).getTime() > slaMinutes * 60_000;
  const followup = lead.nextContactAt ? new Date(lead.nextContactAt).getTime() < Date.now() : false;
  return stale || followup;
}
function toLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function LeadsBoardV2() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [slaMinutes, setSlaMinutes] = useState(120);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [query, setQuery] = useState("");
  const [manager, setManager] = useState("");
  const [activeKpi, setActiveKpi] = useState<KpiKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [locations, setLocations] = useState<PlannerLocation[]>([]);
  const [savingBooking, setSavingBooking] = useState(false);

  const notify = (message: string) => { setFlash(message); window.setTimeout(() => setFlash(""), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося завантажити ліди");
      setLeads(Array.isArray(data.leads) ? data.leads : []);
      setUsers(Array.isArray(data.users) ? data.users : []);
      setSlaMinutes(Number(data.meta?.slaMinutes || 120));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити ліди");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    return () => window.removeEventListener("turbolev:data-changed", handler);
  }, [load]);

  const visible = useMemo(() => leads.filter((lead) => {
    const haystack = `${lead.name || ""} ${lead.phone} ${lead.plateNumber || ""} ${carLabel(lead)} ${lead.need || ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase()) && (!manager || lead.assignedUserId === manager);
  }), [leads, query, manager]);

  const stats = useMemo(() => {
    const business = visible.filter((lead) => !["SPAM_WRONG", "SUPPLIER_PARTNER"].includes(lead.status));
    const booked = business.filter((lead) => lead.status === "BOOKED").length;
    return {
      newCount: business.filter((lead) => lead.status === "NEW").length,
      unanswered: business.filter((lead) => lead.status === "NO_ANSWER").length,
      overdue: business.filter((lead) => isOverdue(lead, slaMinutes)).length,
      booked,
      conversion: business.length ? Math.round((booked / business.length) * 100) : 0,
    };
  }, [visible, slaMinutes]);

  const filtered = useMemo(() => {
    if (!activeKpi) return visible;
    if (activeKpi === "new") return visible.filter((lead) => lead.status === "NEW");
    if (activeKpi === "unanswered") return visible.filter((lead) => lead.status === "NO_ANSWER");
    if (activeKpi === "overdue") return visible.filter((lead) => isOverdue(lead, slaMinutes));
    if (activeKpi === "booked") return visible.filter((lead) => lead.status === "BOOKED");
    return visible.filter((lead) => !["LOST", "SPAM_WRONG", "SUPPLIER_PARTNER"].includes(lead.status));
  }, [activeKpi, visible, slaMinutes]);

  async function patchLead(id: string, patch: Record<string, unknown>, success?: string) {
    try {
      const response = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося зберегти зміну");
      setLeads((current) => current.map((lead) => lead.id === id ? data.lead : lead));
      if (success) notify(success);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "lead", id } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти зміну");
    }
  }

  async function addAttempt(lead: Lead) {
    try {
      const response = await fetch(`/api/leads/${lead.id}/attempt`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося зафіксувати контакт");
      setLeads((current) => current.map((item) => item.id === lead.id ? data.lead : item));
      notify(`Спроба контакту №${data.lead.contactAttempts} зафіксована.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зафіксувати контакт");
    }
  }

  async function openBooking(lead: Lead) {
    try {
      const now = new Date();
      const to = new Date(now.getTime() + 24 * 60 * 60_000);
      const response = await fetch(`/api/planner?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Планувальник недоступний");
      const nextLocations: PlannerLocation[] = Array.isArray(data.locations) ? data.locations : [];
      setLocations(nextLocations);
      const start = new Date(Date.now() + 60 * 60_000);
      setBooking({
        lead,
        locationId: data.activeLocationId || nextLocations[0]?.id || "",
        postId: "",
        mechanicId: "",
        date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
        time: `${pad(start.getHours())}:00`,
        duration: "60",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося відкрити запис");
    }
  }

  async function saveBooking() {
    if (!booking) return;
    setSavingBooking(true);
    setError("");
    try {
      const start = new Date(`${booking.date}T${booking.time}:00`);
      const end = new Date(start.getTime() + Number(booking.duration) * 60_000);
      const response = await fetch(`/api/leads/${booking.lead.id}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: booking.locationId, postId: booking.postId || null, mechanicId: booking.mechanicId || null, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося записати клієнта");
      setBooking(null);
      notify("Лід записано — запис створено у Планувальнику.");
      await load();
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "booking" } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося записати клієнта");
    } finally {
      setSavingBooking(false);
    }
  }

  const bookingLocation = booking ? locations.find((location) => location.id === booking.locationId) : null;

  return <div className="leadsPage">
    {flash && <div className="leadFlash">{flash}</div>}
    <header className="leadsHeader">
      <div><p className="eyebrow">ПРОДАЖІ · NEON SERVER</p><h1>Ліди</h1><p className="leadsSubtitle">Єдина серверна база для всіх менеджерів.</p></div>
      <button className="primary" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлення…" : "Оновити"}</button>
    </header>

    {error && <div className="alert"><strong>Помилка</strong><span>{error}</span><button onClick={() => setError("")}>Закрити</button></div>}

    <section className="leadKpis">
      <Kpi active={activeKpi === "new"} label="Нові" value={stats.newCount} sub="потребують першого контакту" onClick={() => setActiveKpi(activeKpi === "new" ? null : "new")} />
      <Kpi active={activeKpi === "unanswered"} label="Не додзвонились" value={stats.unanswered} sub="повторний контакт" onClick={() => setActiveKpi(activeKpi === "unanswered" ? null : "unanswered")} />
      <Kpi active={activeKpi === "overdue"} danger label="Прострочені" value={stats.overdue} sub="SLA / next action" onClick={() => setActiveKpi(activeKpi === "overdue" ? null : "overdue")} />
      <Kpi active={activeKpi === "booked"} label="Записані" value={stats.booked} sub="у планувальнику" onClick={() => setActiveKpi(activeKpi === "booked" ? null : "booked")} />
      <Kpi active={activeKpi === "conversion"} label="Конверсія в запис" value={`${stats.conversion}%`} sub="від робочих лідів" onClick={() => setActiveKpi(activeKpi === "conversion" ? null : "conversion")} />
    </section>

    <div className="leadsToolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук: клієнт, телефон, номер, авто…" />
      <select value={manager} onChange={(event) => setManager(event.target.value)}><option value="">Всі менеджери</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
      <div className="viewSwitch"><button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>Канбан</button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Таблиця</button></div>
    </div>

    {loading && !leads.length ? <div className="emptyColumn">Завантажую ліди з Neon…</div> : view === "kanban" ?
      <div className="leadKanban">{columns.map((column) => <section className="leadColumn" key={column.key}>
        <header><strong>{column.label}</strong><span>{filtered.filter((lead) => lead.status === column.key).length}</span></header>
        <div className="leadColumnBody">{filtered.filter((lead) => lead.status === column.key).map((lead) =>
          <LeadCard key={lead.id} lead={lead} slaMinutes={slaMinutes} users={users} onPatch={patchLead} onAttempt={addAttempt} onBook={openBooking} />)}
          {!filtered.some((lead) => lead.status === column.key) && <div className="emptyColumn">Порожньо</div>}
        </div>
      </section>)}</div>
      : <div className="leadTableWrap"><table className="leadTable"><thead><tr><th>Клієнт</th><th>Авто</th><th>Потреба</th><th>Відповідальний</th><th>Наступна дія</th><th>Статус</th></tr></thead><tbody>{filtered.map((lead) =>
        <tr key={lead.id} className={isOverdue(lead, slaMinutes) ? "overdueRow" : ""}>
          <td><strong>{lead.name || "Без імені"}</strong><small>{lead.phone}</small></td>
          <td><strong>{lead.plateNumber || "—"}</strong><small>{carLabel(lead)}</small></td>
          <td>{lead.need || "—"}</td>
          <td><select value={lead.assignedUserId || ""} onChange={(event) => void patchLead(lead.id, { assignedUserId: event.target.value || null })}><option value="">Не призначено</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></td>
          <td><strong>{lead.nextAction || "—"}</strong><small>{lead.nextContactAt ? new Date(lead.nextContactAt).toLocaleString("uk-UA") : "—"}</small></td>
          <td><select value={lead.status} onChange={(event) => event.target.value === "BOOKED" ? void openBooking(lead) : void patchLead(lead.id, { status: event.target.value })}>{columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></td>
        </tr>)}</tbody></table></div>}

    {booking && <div className="leadModalBackdrop" onMouseDown={() => setBooking(null)}><section className="leadModal" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">ЛІД → ПЛАНУВАЛЬНИК</p><h2>Записати {booking.lead.name || "клієнта"}</h2></div><button onClick={() => setBooking(null)}>×</button></header>
      <div className="leadFormGrid">
        <label><span>Дата</span><input type="date" value={booking.date} onChange={(event) => setBooking({ ...booking, date: event.target.value })} /></label>
        <label><span>Час</span><input type="time" step="1800" value={booking.time} onChange={(event) => setBooking({ ...booking, time: event.target.value })} /></label>
        <label><span>Локація</span><select value={booking.locationId} onChange={(event) => setBooking({ ...booking, locationId: event.target.value, postId: "", mechanicId: "" })}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label><span>Тривалість</span><select value={booking.duration} onChange={(event) => setBooking({ ...booking, duration: event.target.value })}>{[30, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} хв` : `${minutes / 60} год`}</option>)}</select></label>
        <label><span>Пост</span><select value={booking.postId} onChange={(event) => setBooking({ ...booking, postId: event.target.value })}><option value="">Черга / без поста</option>{bookingLocation?.posts.map((post) => <option key={post.id} value={post.id}>{post.name}</option>)}</select></label>
        <label><span>Механік</span><select value={booking.mechanicId} onChange={(event) => setBooking({ ...booking, mechanicId: event.target.value })}><option value="">Не призначено</option>{bookingLocation?.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
      </div>
      <footer><button className="secondary" onClick={() => setBooking(null)}>Скасувати</button><button className="primary" disabled={savingBooking || !booking.locationId || !booking.date || !booking.time} onClick={() => void saveBooking()}>{savingBooking ? "Записую…" : "Записати в планувальник"}</button></footer>
    </section></div>}
  </div>;
}

function Kpi({ active, danger, label, value, sub, onClick }: { active: boolean; danger?: boolean; label: string; value: string | number; sub: string; onClick: () => void }) {
  return <button type="button" className={`${active ? "activeKpi" : ""} ${danger ? "dangerKpi" : ""}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{sub}</small></button>;
}

function LeadCard({ lead, slaMinutes, users, onPatch, onAttempt, onBook }: {
  lead: Lead;
  slaMinutes: number;
  users: UserOption[];
  onPatch: (id: string, patch: Record<string, unknown>, success?: string) => Promise<void>;
  onAttempt: (lead: Lead) => Promise<void>;
  onBook: (lead: Lead) => Promise<void>;
}) {
  const overdue = isOverdue(lead, slaMinutes);
  return <article className={`leadCard ${overdue ? "leadCardOverdue" : ""}`}>
    <div className="leadCardTop"><span className="leadId">{lead.id.slice(-8).toUpperCase()}</span><span className={`leadSla ${overdue ? "late" : "ok"}`}>{overdue ? "ПОТРІБНА ДІЯ" : "SLA OK"}</span></div>
    <strong className="leadName">{lead.name || "Без імені"}</strong>
    <a className="leadPhone" href={`tel:${lead.phoneNormalized}`}>{lead.phone}</a>
    <div className="leadVehicle"><b>{lead.plateNumber || "БЕЗ НОМЕРА"}</b><span>{carLabel(lead)}</span>{lead.vin && <span>VIN {lead.vin}</span>}</div>
    <p className="leadNeed">{lead.need || "Потреба ще не описана"}</p>
    <div className="leadMeta"><span>{sourceLabels[lead.source] || lead.source}</span><span>{lead.assignedUser?.name || "Не призначено"}</span><span>{lead._count?.calls || 0} дзв.</span></div>
    <label className="leadNextLabel"><span>Наступна дія</span><input key={`${lead.id}-${lead.nextAction || ""}`} defaultValue={lead.nextAction || ""} onBlur={(event) => void onPatch(lead.id, { nextAction: event.target.value })} placeholder="Що зробити далі" /></label>
    <label className="leadNextLabel"><span>Наступний контакт</span><input key={`${lead.id}-${lead.nextContactAt || ""}`} type="datetime-local" defaultValue={toLocalInput(lead.nextContactAt)} onBlur={(event) => void onPatch(lead.id, { nextContactAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
    <div className="attempts"><span>Спроби: {lead.contactAttempts}</span><button type="button" onClick={() => void onAttempt(lead)}>+ зафіксувати дзвінок</button></div>
    <select className="leadStatusSelect" value={lead.status} onChange={(event) => event.target.value === "BOOKED" ? void onBook(lead) : void onPatch(lead.id, { status: event.target.value }, "Статус ліда змінено.")}>{columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select>
    <select className="leadStatusSelect" value={lead.assignedUserId || ""} onChange={(event) => void onPatch(lead.id, { assignedUserId: event.target.value || null })}><option value="">Не призначено</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
  </article>;
}
