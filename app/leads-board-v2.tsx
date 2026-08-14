"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "ESTIMATE" | "WAITING" | "NO_ANSWER" | "BOOKED" | "ARRIVED" | "LOST" | "SPAM_WRONG" | "SUPPLIER_PARTNER";
type KpiKey = "new" | "unanswered" | "overdue" | "booked" | "conversion";
type UserOption = { id: string; name: string; internalNumber?: string | null };
type Lead = {
  id: string; name: string | null; phone: string; phoneNormalized: string; status: LeadStatus; source: string;
  carBrand: string | null; carModel: string | null; carYear: number | null; plateNumber: string | null; vin: string | null;
  need: string | null; comment: string | null; nextAction: string | null; nextContactAt: string | null; contactAttempts: number;
  lastActivityAt: string; preliminaryAmount: string | number | null; assignedUserId: string | null; createdAt: string; updatedAt: string;
  assignedUser?: UserOption | null; _count?: { calls: number };
};
type PlannerLocation = { id: string; name: string; posts: Array<{ id: string; name: string }>; mechanics: Array<{ id: string; name: string }> };
type BookingState = { lead: Lead; locationId: string; postId: string; mechanicId: string; date: string; time: string; duration: string };

const columns: Array<{ key: LeadStatus; label: string }> = [
  { key: "NEW", label: "Нові" }, { key: "CONTACTED", label: "Контакт" }, { key: "QUALIFIED", label: "Потреба" },
  { key: "ESTIMATE", label: "Прорахунок" }, { key: "WAITING", label: "Думає / очікує" }, { key: "NO_ANSWER", label: "Не додзвонились" },
  { key: "BOOKED", label: "Записані" }, { key: "LOST", label: "Неуспішні" },
];
const sourceLabels: Record<string, string> = { PHONE: "Телефон", BINOTEL: "Binotel", WEBSITE: "Сайт", MESSENGER: "Messenger", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", GOOGLE_MAPS: "Google Maps", VIBER: "Viber", WHATSAPP: "WhatsApp", OLX: "OLX", TIKTOK: "TikTok", REFERRAL: "Рекомендація", WALK_IN: "Без запису", OTHER: "Інше" };
const lossReasons = ["Дорого", "Немає часу / місць", "Послугу не надаємо", "Невірний номер", "Передумав / інше"];

function formatTime(value?: string | null) { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d); }
function toLocalInput(value?: string | null) { if (!value) return ""; const d = new Date(value); if (Number.isNaN(d.getTime())) return ""; const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function isOverdue(lead: Lead, slaMinutes: number) { if (["BOOKED","ARRIVED","LOST","SPAM_WRONG","SUPPLIER_PARTNER"].includes(lead.status)) return false; const stale = Date.now() - new Date(lead.lastActivityAt).getTime() > slaMinutes * 60_000; const followup = lead.nextContactAt ? new Date(lead.nextContactAt).getTime() < Date.now() : false; return stale || followup; }
function carLabel(lead: Lead) { return [lead.carBrand, lead.carModel, lead.carYear].filter(Boolean).join(" ") || "Авто уточнюється"; }
function lossReasonCode(value: string) { if (value.includes("Дорого")) return "TOO_EXPENSIVE"; if (value.includes("час") || value.includes("місць")) return "NO_CAPACITY_NO_TIME"; if (value.includes("надаємо")) return "SERVICE_NOT_PROVIDED"; if (value.includes("номер")) return "WRONG_NUMBER"; return "OTHER"; }

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
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося завантажити ліди");
      setLeads(Array.isArray(data.leads) ? data.leads : []); setUsers(Array.isArray(data.users) ? data.users : []); setSlaMinutes(Number(data.meta?.slaMinutes || 120));
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося завантажити ліди"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const handler = () => void load(); window.addEventListener("turbolev:data-changed", handler); return () => window.removeEventListener("turbolev:data-changed", handler); }, [load]);

  const stats = useMemo(() => {
    const open = leads.filter((x) => !["BOOKED","ARRIVED","LOST","SPAM_WRONG","SUPPLIER_PARTNER"].includes(x.status));
    const booked = leads.filter((x) => x.status === "BOOKED").length;
    return { newCount: leads.filter((x) => x.status === "NEW").length, unanswered: leads.filter((x) => x.status === "NO_ANSWER").length, overdue: open.filter((x) => isOverdue(x, slaMinutes)).length, booked, conversion: leads.length ? Math.round((booked / leads.filter((x)=>!["SPAM_WRONG","SUPPLIER_PARTNER"].includes(x.status)).length) * 100) || 0 : 0 };
  }, [leads, slaMinutes]);

  const visible = useMemo(() => leads.filter((lead) => {
    const text = `${lead.name || ""} ${lead.phone} ${lead.plateNumber || ""} ${carLabel(lead)} ${lead.need || ""}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (!manager || lead.assignedUserId === manager);
  }), [leads, query, manager]);

  const kpiLeads = useMemo(() => {
    if (!activeKpi) return visible;
    if (activeKpi === "new") return visible.filter((x) => x.status === "NEW");
    if (activeKpi === "unanswered") return visible.filter((x) => x.status === "NO_ANSWER");
    if (activeKpi === "overdue") return visible.filter((x) => isOverdue(x, slaMinutes));
    if (activeKpi === "booked") return visible.filter((x) => x.status === "BOOKED");
    return visible.filter((x) => !["LOST","SPAM_WRONG","SUPPLIER_PARTNER"].includes(x.status));
  }, [activeKpi, visible, slaMinutes]);

  async function patchLead(id: string, patch: Record<string, unknown>, success?: string) {
    const previous = leads;
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...patch, lastActivityAt: new Date().toISOString() } as Lead : lead));
    try {
      const response = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося зберегти зміну");
      setLeads((current) => current.map((lead) => lead.id === id ? data.lead : lead));
      if (success) notify(success);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "lead", id } }));
    } catch (e) { setLeads(previous); setError(e instanceof Error ? e.message : "Не вдалося зберегти зміну"); }
  }

  async function addAttempt(lead: Lead) {
    try {
      const response = await fetch(`/api/leads/${lead.id}/attempt`, { method: "POST" }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Помилка");
      setLeads((current) => current.map((x) => x.id === lead.id ? data.lead : x)); notify(`Спроба контакту №${data.lead.contactAttempts} зафіксована.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зафіксувати спробу"); }
  }

  async function openBooking(lead: Lead) {
    try {
      const now = new Date(); const to = new Date(now.getTime() + 24*60*60*1000);
      const response = await fetch(`/api/planner?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.message || "Планувальник недоступний");
      const nextLocations = Array.isArray(data.locations) ? data.locations : []; setLocations(nextLocations);
      const d = new Date(Date.now() + 60*60*1000); const pad=(n:number)=>String(n).padStart(2,"0");
      setBooking({ lead, locationId: data.activeLocationId || nextLocations[0]?.id || "", postId: "", mechanicId: "", date: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:00`, duration: "60" });
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося відкрити запис"); }
  }

  async function saveBooking() {
    if (!booking) return; setSavingBooking(true); setError("");
    try {
      const start = new Date(`${booking.date}T${booking.time}:00`); const end = new Date(start.getTime() + Number(booking.duration) * 60_000);
      const response = await fetch(`/api/leads/${booking.lead.id}/book`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: booking.locationId, postId: booking.postId || null, mechanicId: booking.mechanicId || null, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Не вдалося записати клієнта");
      setBooking(null); notify("Лід записано: запис з'явився у Планувальнику."); await load(); window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "booking" } }));
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося записати клієнта"); }
    finally { setSavingBooking(false); }
  }

  const filtered = activeKpi ? kpiLeads : visible;
  const location = booking ? locations.find((x) => x.id === booking.locationId) : null;

  return <div className="leadsPage">
    {flash && <div className="leadFlash">{flash}</div>}
    <header className="leadsHeader"><div><p className="eyebrow">ПРОДАЖІ · NEON SERVER</p><h1>Ліди</h1><p className="leadsSubtitle">Єдина база для всіх менеджерів. Жодних локальних копій у браузері.</p></div><button className="primary" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлення…" : "Оновити"}</button></header>
    {error && <div className="alert"><strong>Помилка</strong><span>{error}</span><button onClick={()=>setError("")}>Закрити</button></div>}

    <section className="leadKpis">
      <button type="button" className={activeKpi==="new"?"activeKpi":""} onClick={()=>setActiveKpi(activeKpi==="new"?null:"new")}><span>Нові</span><strong>{stats.newCount}</strong><small>потребують першого контакту</small></button>
      <button type="button" className={activeKpi==="unanswered"?"activeKpi":""} onClick={()=>setActiveKpi(activeKpi==="unanswered"?null:"unanswered")}><span>Не додзвонились</span><strong>{stats.unanswered}</strong><small>повторний контакт</small></button>
      <button type="button" className={`dangerKpi ${activeKpi==="overdue"?"activeKpi":""}`} onClick={()=>setActiveKpi(activeKpi==="overdue"?null:"overdue")}><span>Прострочені</span><strong>{stats.overdue}</strong><small>SLA / next action</small></button>
      <button type="button" className={activeKpi==="booked"?"activeKpi":""} onClick={()=>setActiveKpi(activeKpi==="booked"?null:"booked")}><span>Записані</span><strong>{stats.booked}</strong><small>є запис у планувальнику</small></button>
      <button type="button" className={activeKpi==="conversion"?"activeKpi":""} onClick={()=>setActiveKpi(activeKpi==="conversion"?null:"conversion")}><span>Конверсія в запис</span><strong>{stats.conversion}%</strong><small>від робочих лідів</small></button>
    </section>

    <div className="leadsToolbar"><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Пошук: клієнт, телефон, номер, авто…"/><select value={manager} onChange={(e)=>setManager(e.target.value)}><option value="">Всі менеджери</option>{users.map((u)=><option key={u.id} value={u.id}>{u.name}</option>)}</select><div className="viewSwitch"><button className={view==="kanban"?"active":""} onClick={()=>setView("kanban")}>Канбан</button><button className={view==="table"?"active":""} onClick={()=>setView("table")}>Таблиця</button></div></div>

    {loading && !leads.length ? <div className="emptyColumn">Завантажую ліди з Neon…</div> : view === "kanban" ? <div className="leadKanban">{columns.map((column)=><section className="leadColumn" key={column.key}><header><strong>{column.label}</strong><span>{filtered.filter((x)=>x.status===column.key).length}</span></header><div className="leadColumnBody">{filtered.filter((x)=>x.status===column.key).map((lead)=><LeadCard key={lead.id} lead={lead} slaMinutes={slaMinutes} users={users} onPatch={patchLead} onAttempt={addAttempt} onBook={openBooking}/>) }{!filtered.some((x)=>x.status===column.key)&&<div className="emptyColumn">Порожньо</div>}</div></section>)}</div> : <div className="leadTableWrap"><table className="leadTable"><thead><tr><th>Клієнт</th><th>Авто</th><th>Потреба</th><th>Відповідальний</th><th>Наступна дія</th><th>Статус</th></tr></thead><tbody>{filtered.map((lead)=><tr key={lead.id} className={isOverdue(lead,slaMinutes)?"overdueRow":""}><td><strong>{lead.name || "Без імені"}</strong><small>{lead.phone}</small><small>{lead.id}</small></td><td><strong>{lead.plateNumber || "—"}</strong><small>{carLabel(lead)}</small></td><td>{lead.need || "—"}</td><td><select value={lead.assignedUserId || ""} onChange={(e)=>void patchLead(lead.id,{assignedUserId:e.target.value||null})}><option value="">Не призначено</option>{users.map((u)=><option key={u.id} value={u.id}>{u.name}</option>)}</select></td><td><strong>{lead.nextAction || "—"}</strong><small>{formatTime(lead.nextContactAt)}</small></td><td><select value={lead.status} onChange={(e)=>e.target.value==="BOOKED"?void openBooking(lead):void patchLead(lead.id,{status:e.target.value})}>{columns.map((c)=><option key={c.key} value={c.key}>{c.label}</option>)}</select></td></tr>)}</tbody></table></div>}

    {booking && <div className="leadModalBackdrop" onMouseDown={()=>setBooking(null)}><section className="leadModal" onMouseDown={(e)=>e.stopPropagation()}><header><div><p className="eyebrow">ЛІД → ПЛАНУВАЛЬНИК</p><h2>Записати {booking.lead.name || "клієнта"}</h2></div><button onClick={()=>setBooking(null)}>×</button></header><div className="leadFormGrid"><label><span>Дата</span><input type="date" value={booking.date} onChange={(e)=>setBooking({...booking,date:e.target.value})}/></label><label><span>Час</span><input type="time" step="1800" value={booking.time} onChange={(e)=>setBooking({...booking,time:e.target.value})}/></label><label><span>Локація</span><select value={booking.locationId} onChange={(e)=>setBooking({...booking,locationId:e.target.value,postId:"",mechanicId:""})}>{locations.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span>Тривалість</span><select value={booking.duration} onChange={(e)=>setBooking({...booking,duration:e.target.value})}>{[30,60,90,120,180,240].map((x)=><option key={x} value={x}>{x<60?`${x} хв`:`${x/60} год`}</option>)}</select></label><label><span>Пост</span><select value={booking.postId} onChange={(e)=>setBooking({...booking,postId:e.target.value})}><option value="">Черга / без поста</option>{location?.posts.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label><span>Механік</span><select value={booking.mechanicId} onChange={(e)=>setBooking({...booking,mechanicId:e.target.value})}><option value="">Не призначено</option>{location?.mechanics.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div><footer><button className="secondary" onClick={()=>setBooking(null)}>Скасувати</button><button className="primary" disabled={savingBooking||!booking.locationId||!booking.date||!booking.time} onClick={()=>void saveBooking()}>{savingBooking?"Записую…":"Записати в планувальник"}</button></footer></section></div>}
  </div>;
}

function LeadCard({ lead, slaMinutes, users, onPatch, onAttempt, onBook }: { lead: Lead; slaMinutes: number; users: UserOption[]; onPatch: (id:string,patch:Record<string,unknown>,success?:string)=>Promise<void>; onAttempt:(lead:Lead)=>Promise<void>; onBook:(lead:Lead)=>Promise<void> }) {
  const overdue = isOverdue(lead, slaMinutes);
  return <article className={`leadCard ${overdue?"leadCardOverdue":""}`}><div className="leadCardTop"><span className="leadId">{lead.id.slice(-8).toUpperCase()}</span><span className={`leadSla ${overdue?"late":"ok"}`}>{overdue?"ПОТРІБНА ДІЯ":"SLA OK"}</span></div><strong className="leadName">{lead.name || "Без імені"}</strong><a className="leadPhone" href={`tel:${lead.phoneNormalized}`}>{lead.phone}</a><div className="leadVehicle"><b>{lead.plateNumber || "БЕЗ НОМЕРА"}</b><span>{carLabel(lead)}</span>{lead.vin&&<span>VIN {lead.vin}</span>}</div><p className="leadNeed">{lead.need || "Потреба ще не описана"}</p><div className="leadMeta"><span>{sourceLabels[lead.source] || lead.source}</span><span>{lead.assignedUser?.name || "Не призначено"}</span><span>{lead._count?.calls || 0} дзв.</span></div><label className="leadNextLabel"><span>Наступна дія</span><input value={lead.nextAction || ""} onBlur={(e)=>void onPatch(lead.id,{nextAction:e.target.value})} onChange={(e)=>{const value=e.target.value; /* local field is updated by server on blur; keep input uncontrolled after refresh */}} placeholder="Що зробити далі" defaultValue={undefined}/></label><label className="leadNextLabel"><span>Наступний контакт</span><input type="datetime-local" defaultValue={toLocalInput(lead.nextContactAt)} onBlur={(e)=>void onPatch(lead.id,{nextContactAt:e.target.value?new Date(e.target.value).toISOString():null})}/></label><div className="attempts"><span>Спроби: {lead.contactAttempts}</span><button type="button" onClick={()=>void onAttempt(lead)}>+ зафіксувати дзвінок</button></div><select className="leadStatusSelect" value={lead.status} onChange={(e)=>e.target.value==="BOOKED"?void onBook(lead):void onPatch(lead.id,{status:e.target.value},"Статус ліда змінено.")}>{columns.map((c)=><option key={c.key} value={c.key}>{c.label}</option>)}</select><select className="leadStatusSelect" value={lead.assignedUserId || ""} onChange={(e)=>void onPatch(lead.id,{assignedUserId:e.target.value||null})}><option value="">Не призначено</option>{users.map((u)=><option key={u.id} value={u.id}>{u.name}</option>)}</select>{lead.status==="LOST"&&<select className="lossReason" defaultValue="Передумав / інше" onChange={(e)=>void onPatch(lead.id,{rejectReason:lossReasonCode(e.target.value)})}>{lossReasons.map((x)=><option key={x}>{x}</option>)}</select>}</article>;
}
