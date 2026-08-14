"use client";

import { useEffect, useMemo, useState } from "react";

type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "ESTIMATE" | "WAITING" | "NO_ANSWER" | "BOOKED" | "LOST";
type LeadSource = "Телефон" | "Instagram" | "Facebook" | "Google Maps" | "Сайт" | "Viber" | "WhatsApp" | "OLX" | "Рекомендація";

type Lead = {
  id: string;
  name: string;
  phone: string;
  plate: string;
  car: string;
  need: string;
  source: LeadSource;
  status: LeadStatus;
  responsible: string;
  nextAction: string;
  nextContactAt: string;
  contactAttempts: number;
  lastActivityAt: string;
  lossReason?: string;
};

const STORAGE_KEY = "turbolev-leads-v1";
const SLA_MS = 2 * 60 * 60 * 1000;

const columns: { key: LeadStatus; label: string }[] = [
  { key: "NEW", label: "Нові" },
  { key: "CONTACTED", label: "Контакт" },
  { key: "QUALIFIED", label: "Потреба" },
  { key: "ESTIMATE", label: "Прорахунок" },
  { key: "WAITING", label: "Думає / очікує" },
  { key: "NO_ANSWER", label: "Не додзвонились" },
  { key: "BOOKED", label: "Записані" },
  { key: "LOST", label: "Неуспішні" },
];

const sources: LeadSource[] = ["Телефон", "Instagram", "Facebook", "Google Maps", "Сайт", "Viber", "WhatsApp", "OLX", "Рекомендація"];
const managers = ["Марія", "Юрій", "Продавник 1", "Продавник 2"];
const lossReasons = ["Дорого", "Далеко", "Передумав", "Не додзвонились", "Поїхав на інше СТО", "Інше"];

const initialLeads: Lead[] = [
  { id: "L-1042", name: "Олександр", phone: "+380 67 425 18 30", plate: "KA7584CI", car: "Авто уточнюється", need: "Стук у передній підвісці", source: "Телефон", status: "NEW", responsible: "Марія", nextAction: "Передзвонити та уточнити симптоми", nextContactAt: new Date(Date.now() + 35 * 60 * 1000).toISOString(), contactAttempts: 0, lastActivityAt: new Date(Date.now() - 55 * 60 * 1000).toISOString() },
  { id: "L-1041", name: "Ірина", phone: "+380 93 771 42 15", plate: "BH3057TE", car: "Renault Scenic · 2013", need: "ТО + діагностика ходової", source: "Google Maps", status: "CONTACTED", responsible: "Продавник 1", nextAction: "Підтвердити дату заїзду", nextContactAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(), contactAttempts: 1, lastActivityAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() },
  { id: "L-1040", name: "Андрій", phone: "+380 50 902 66 71", plate: "AI5523PM", car: "Ford S-Max · 2014", need: "Заміна сайлентблоків", source: "Facebook", status: "ESTIMATE", responsible: "Юрій", nextAction: "Надіслати прорахунок робіт", nextContactAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), contactAttempts: 1, lastActivityAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
  { id: "L-1039", name: "Віктор", phone: "+380 68 114 37 22", plate: "AA4271KI", car: "Mazda 6 · 2016", need: "Гальма", source: "WhatsApp", status: "WAITING", responsible: "Марія", nextAction: "Передзвонити після 17:00", nextContactAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), contactAttempts: 2, lastActivityAt: new Date(Date.now() - 70 * 60 * 1000).toISOString() },
  { id: "L-1038", name: "Сергій", phone: "+380 99 730 11 08", plate: "CE1038EA", car: "BMW 3 · 2018", need: "Комп'ютерна діагностика", source: "OLX", status: "NO_ANSWER", responsible: "Продавник 2", nextAction: "Третя спроба дзвінка", nextContactAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(), contactAttempts: 2, lastActivityAt: new Date(Date.now() - 110 * 60 * 1000).toISOString() },
];

function formatTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function isOverdue(lead: Lead) {
  if (["BOOKED", "LOST"].includes(lead.status)) return false;
  return Date.now() - new Date(lead.lastActivityAt).getTime() > SLA_MS || new Date(lead.nextContactAt).getTime() < Date.now();
}

export function LeadsBoard() {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [query, setQuery] = useState("");
  const [manager, setManager] = useState("Всі менеджери");
  const [openNew, setOpenNew] = useState(false);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setLeads(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads)); } catch {}
  }, [leads]);

  const visible = useMemo(() => leads.filter((lead) => {
    const text = `${lead.name} ${lead.phone} ${lead.plate} ${lead.car} ${lead.need}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (manager === "Всі менеджери" || lead.responsible === manager);
  }), [leads, query, manager]);

  const stats = useMemo(() => {
    const open = leads.filter((x) => !["BOOKED", "LOST"].includes(x.status));
    const booked = leads.filter((x) => x.status === "BOOKED").length;
    return {
      newCount: leads.filter((x) => x.status === "NEW").length,
      unanswered: leads.filter((x) => x.status === "NO_ANSWER").length,
      overdue: open.filter(isOverdue).length,
      booked,
      conversion: leads.length ? Math.round((booked / leads.length) * 100) : 0,
    };
  }, [leads]);

  function patchLead(id: string, patch: Partial<Lead>) {
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, ...patch, lastActivityAt: new Date().toISOString() } : lead));
  }

  function changeStatus(lead: Lead, status: LeadStatus) {
    if (status === "BOOKED") {
      patchLead(lead.id, { status, nextAction: "Створено заявку на заїзд" });
      setFlash(`Лід ${lead.id} записаний. Заявку створено автоматично.`);
      window.setTimeout(() => setFlash(""), 3200);
      return;
    }
    if (status === "LOST" && !lead.lossReason) {
      patchLead(lead.id, { status, lossReason: "Інше", nextAction: "Лід закрито" });
      return;
    }
    patchLead(lead.id, { status });
  }

  function addAttempt(lead: Lead) {
    const attempts = Math.min(3, lead.contactAttempts + 1);
    patchLead(lead.id, {
      contactAttempts: attempts,
      status: attempts >= 3 ? "NO_ANSWER" : lead.status,
      nextAction: attempts >= 3 ? "Закрити або призначити повторний контакт" : `Спроба зв'язку ${attempts + 1} з 3`,
    });
  }

  function addLead(form: HTMLFormElement) {
    const fd = new FormData(form);
    const now = new Date();
    const next = new Date(now.getTime() + 60 * 60 * 1000);
    const lead: Lead = {
      id: `L-${Math.floor(1100 + Math.random() * 8900)}`,
      name: String(fd.get("name") || "Новий клієнт"),
      phone: String(fd.get("phone") || ""),
      plate: String(fd.get("plate") || "").toUpperCase(),
      car: String(fd.get("car") || "Авто уточнюється"),
      need: String(fd.get("need") || "Потреба уточнюється"),
      source: String(fd.get("source") || "Телефон") as LeadSource,
      status: "NEW",
      responsible: String(fd.get("responsible") || managers[0]),
      nextAction: String(fd.get("nextAction") || "Зв'язатися з клієнтом"),
      nextContactAt: next.toISOString(),
      contactAttempts: 0,
      lastActivityAt: now.toISOString(),
    };
    setLeads((current) => [lead, ...current]);
    setOpenNew(false);
  }

  return (
    <div className="leadsPage">
      {flash && <div className="leadFlash">{flash}</div>}
      <header className="leadsHeader">
        <div><p className="eyebrow">ВІДДІЛ ПРОДАЖІВ · SLA 2 ГОДИНИ</p><h1>Ліди</h1><p className="leadsSubtitle">Кому зараз треба подзвонити і кого ми ризикуємо втратити.</p></div>
        <button className="primary" onClick={() => setOpenNew(true)}>+ Новий лід</button>
      </header>

      <section className="leadKpis">
        <article><span>Нові</span><strong>{stats.newCount}</strong><small>потребують першого контакту</small></article>
        <article><span>Не додзвонились</span><strong>{stats.unanswered}</strong><small>максимум 3 спроби</small></article>
        <article className={stats.overdue ? "dangerKpi" : ""}><span>Прострочені</span><strong>{stats.overdue}</strong><small>SLA або наступна дія</small></article>
        <article><span>Записані</span><strong>{stats.booked}</strong><small>конверсія {stats.conversion}%</small></article>
        <article><span>Конверсія в запис</span><strong>{stats.conversion}%</strong><small>від усіх лідів</small></article>
      </section>

      <section className="leadsToolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Пошук: ім'я, телефон, номер авто…" />
        <select value={manager} onChange={(e) => setManager(e.target.value)}><option>Всі менеджери</option>{managers.map((x) => <option key={x}>{x}</option>)}</select>
        <div className="viewSwitch"><button className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>Kanban</button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Таблиця</button></div>
      </section>

      {view === "kanban" ? (
        <div className="leadKanban">
          {columns.map((column) => {
            const items = visible.filter((lead) => lead.status === column.key);
            return <section className="leadColumn" key={column.key}>
              <header><strong>{column.label}</strong><span>{items.length}</span></header>
              <div className="leadColumnBody">{items.map((lead) => <LeadCard key={lead.id} lead={lead} onPatch={patchLead} onStatus={changeStatus} onAttempt={addAttempt} />)}{!items.length && <div className="emptyColumn">Немає лідів</div>}</div>
            </section>;
          })}
        </div>
      ) : (
        <div className="leadTableWrap"><table className="leadTable"><thead><tr><th>Клієнт</th><th>Авто</th><th>Звернення</th><th>Статус</th><th>Відповідальний</th><th>Наступна дія</th><th>SLA</th></tr></thead><tbody>{visible.map((lead) => <tr key={lead.id} className={isOverdue(lead) ? "overdueRow" : ""}><td><strong>{lead.name}</strong><small>{lead.phone}</small></td><td><strong>{lead.plate || "—"}</strong><small>{lead.car}</small></td><td>{lead.need}<small>{lead.source}</small></td><td><select value={lead.status} onChange={(e) => changeStatus(lead, e.target.value as LeadStatus)}>{columns.map((c) => <option value={c.key} key={c.key}>{c.label}</option>)}</select></td><td>{lead.responsible}</td><td>{lead.nextAction}<small>{formatTime(lead.nextContactAt)}</small></td><td>{isOverdue(lead) ? <span className="slaLate">ПРОСТРОЧЕНО</span> : <span className="slaOk">В нормі</span>}</td></tr>)}</tbody></table></div>
      )}

      {openNew && <div className="leadModalBackdrop" onMouseDown={() => setOpenNew(false)}><div className="leadModal" onMouseDown={(e) => e.stopPropagation()}><header><div><p className="eyebrow">НОВЕ ЗВЕРНЕННЯ</p><h2>Створити лід</h2></div><button onClick={() => setOpenNew(false)}>×</button></header><form onSubmit={(e) => { e.preventDefault(); addLead(e.currentTarget); }}><div className="leadFormGrid"><label>Ім'я<input name="name" required /></label><label>Телефон<input name="phone" required placeholder="+380…" /></label><label>Держномер<input name="plate" /></label><label>Авто<input name="car" placeholder="Марка, модель, рік" /></label><label className="wide">Що потрібно<input name="need" required /></label><label>Джерело<select name="source">{sources.map((x) => <option key={x}>{x}</option>)}</select></label><label>Відповідальний<select name="responsible">{managers.map((x) => <option key={x}>{x}</option>)}</select></label><label className="wide">Наступна дія<input name="nextAction" required defaultValue="Зв'язатися з клієнтом" /></label></div><footer><button type="button" className="ghost" onClick={() => setOpenNew(false)}>Скасувати</button><button className="primary" type="submit">Створити лід</button></footer></form></div></div>}
    </div>
  );
}

function LeadCard({ lead, onPatch, onStatus, onAttempt }: { lead: Lead; onPatch: (id: string, patch: Partial<Lead>) => void; onStatus: (lead: Lead, status: LeadStatus) => void; onAttempt: (lead: Lead) => void }) {
  const overdue = isOverdue(lead);
  return <article className={`leadCard ${overdue ? "leadCardOverdue" : ""}`}>
    <div className="leadCardTop"><span className="leadId">{lead.id}</span><span className={`leadSla ${overdue ? "late" : "ok"}`}>{overdue ? "SLA прострочено" : "SLA в нормі"}</span></div>
    <strong className="leadName">{lead.name}</strong><a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="leadPhone">{lead.phone}</a>
    <div className="leadVehicle"><b>{lead.plate || "Без номера"}</b><span>{lead.car}</span></div>
    <p className="leadNeed">{lead.need}</p><div className="leadMeta"><span>{lead.source}</span><span>{lead.responsible}</span></div>
    <label className="leadNextLabel">Наступна дія<input value={lead.nextAction} onChange={(e) => onPatch(lead.id, { nextAction: e.target.value })} /></label>
    <div className="leadNextTime">до {formatTime(lead.nextContactAt)}</div>
    <div className="attempts"><span>Спроби контакту: <b>{lead.contactAttempts}/3</b></span>{lead.contactAttempts < 3 && <button onClick={() => onAttempt(lead)}>+ спроба</button>}</div>
    <select className="leadStatusSelect" value={lead.status} onChange={(e) => onStatus(lead, e.target.value as LeadStatus)}>{columns.map((c) => <option value={c.key} key={c.key}>{c.label}</option>)}</select>
    {lead.status === "LOST" && <select className="lossReason" value={lead.lossReason || "Інше"} onChange={(e) => onPatch(lead.id, { lossReason: e.target.value })}>{lossReasons.map((x) => <option key={x}>{x}</option>)}</select>}
  </article>;
}
