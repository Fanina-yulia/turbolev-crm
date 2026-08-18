"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LeadBookingModal, LeadCard, LeadKpi } from "./leads-board-v2.components";
import {
  carLabel,
  isLeadStatus,
  isOverdue,
  leadColumns,
  pad,
  parseLeadList,
  parsePlannerLocations,
  parseUserOptions,
  payloadMessage,
  readPayloadField,
} from "./leads-board-v2.model";
import type {
  BookingState,
  KpiKey,
  Lead,
  LeadPatch,
  PlannerLocation,
  UserOption,
} from "./leads-board-v2.types";

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

  const notify = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(""), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payloadMessage(payload, "Не вдалося завантажити активні звернення"));

      setLeads(parseLeadList(readPayloadField(payload, "leads")));
      setUsers(parseUserOptions(readPayloadField(payload, "users")));
      const nextSla = Number(readPayloadField(readPayloadField(payload, "meta"), "slaMinutes"));
      setSlaMinutes(Number.isFinite(nextSla) && nextSla > 0 ? nextSla : 120);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити активні звернення");
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

  async function patchLead(id: string, patch: LeadPatch, success?: string) {
    try {
      const response = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payloadMessage(payload, "Не вдалося зберегти зміну"));
      const updatedLead = parseLeadList([readPayloadField(payload, "lead")])[0];
      if (!updatedLead) throw new Error("Сервер повернув некоректні дані звернення");
      setLeads((current) => current.map((lead) => lead.id === id ? updatedLead : lead));
      if (success) notify(success);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "lead", id } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зберегти зміну");
    }
  }

  async function addAttempt(lead: Lead) {
    try {
      const response = await fetch(`/api/leads/${lead.id}/attempt`, { method: "POST" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payloadMessage(payload, "Не вдалося зафіксувати контакт"));
      const updatedLead = parseLeadList([readPayloadField(payload, "lead")])[0];
      if (!updatedLead) throw new Error("Сервер повернув некоректні дані звернення");
      setLeads((current) => current.map((item) => item.id === lead.id ? updatedLead : item));
      notify(`Спроба контакту №${updatedLead.contactAttempts} зафіксована.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зафіксувати контакт");
    }
  }

  async function openBooking(lead: Lead) {
    try {
      const now = new Date();
      const to = new Date(now.getTime() + 24 * 60 * 60_000);
      const response = await fetch(`/api/planner?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payloadMessage(payload, "Планувальник недоступний"));
      const nextLocations = parsePlannerLocations(readPayloadField(payload, "locations"));
      setLocations(nextLocations);
      const start = new Date(Date.now() + 60 * 60_000);
      const activeLocationId = readPayloadField(payload, "activeLocationId");
      setBooking({
        lead,
        locationId: typeof activeLocationId === "string" ? activeLocationId : nextLocations[0]?.id || "",
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
        body: JSON.stringify({
          locationId: booking.locationId,
          postId: booking.postId || null,
          mechanicId: booking.mechanicId || null,
          plannedStartAt: start.toISOString(),
          plannedEndAt: end.toISOString(),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(payloadMessage(payload, "Не вдалося записати клієнта"));
      setBooking(null);
      notify("Клієнта записано — запис створено у Планувальнику.");
      await load();
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { entity: "booking" } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося записати клієнта");
    } finally {
      setSavingBooking(false);
    }
  }

  const bookingLocation = booking ? locations.find((location) => location.id === booking.locationId) || null : null;

  return <div className="leadsPage">
    {flash && <div className="leadFlash">{flash}</div>}
    <header className="leadsHeader">
      <div>
        <p className="eyebrow">ПРОДАЖІ · NEON SERVER</p>
        <h1>Активні</h1>
        <p className="leadsSubtitle">Клієнти та звернення, які зараз ведуть менеджери.</p>
      </div>
      <button className="primary" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлення…" : "Оновити"}</button>
    </header>

    {error && <div className="alert"><strong>Помилка</strong><span>{error}</span><button type="button" onClick={() => setError("")}>Закрити</button></div>}

    <section className="leadKpis">
      <LeadKpi active={activeKpi === "new"} label="Нові" value={stats.newCount} sub="потребують першого контакту" onClick={() => setActiveKpi(activeKpi === "new" ? null : "new")} />
      <LeadKpi active={activeKpi === "unanswered"} label="Не додзвонились" value={stats.unanswered} sub="повторний контакт" onClick={() => setActiveKpi(activeKpi === "unanswered" ? null : "unanswered")} />
      <LeadKpi active={activeKpi === "overdue"} danger label="Прострочені" value={stats.overdue} sub="SLA / next action" onClick={() => setActiveKpi(activeKpi === "overdue" ? null : "overdue")} />
      <LeadKpi active={activeKpi === "booked"} label="Записані" value={stats.booked} sub="у планувальнику" onClick={() => setActiveKpi(activeKpi === "booked" ? null : "booked")} />
      <LeadKpi active={activeKpi === "conversion"} label="Конверсія в запис" value={`${stats.conversion}%`} sub="від активних звернень" onClick={() => setActiveKpi(activeKpi === "conversion" ? null : "conversion")} />
    </section>

    <div className="leadsToolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук: клієнт, телефон, номер, авто…" />
      <select value={manager} onChange={(event) => setManager(event.target.value)}>
        <option value="">Всі менеджери</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select>
      <div className="viewSwitch">
        <button type="button" className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")}>Канбан</button>
        <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Таблиця</button>
      </div>
    </div>

    {loading && !leads.length
      ? <div className="emptyColumn">Завантажую активні звернення з Neon…</div>
      : view === "kanban"
        ? <div className="leadKanban">{leadColumns.map((column) => <section className="leadColumn" key={column.key}>
          <header><strong>{column.label}</strong><span>{filtered.filter((lead) => lead.status === column.key).length}</span></header>
          <div className="leadColumnBody">
            {filtered.filter((lead) => lead.status === column.key).map((lead) =>
              <LeadCard key={lead.id} lead={lead} slaMinutes={slaMinutes} users={users} onPatch={patchLead} onAttempt={addAttempt} onBook={openBooking} />)}
            {!filtered.some((lead) => lead.status === column.key) && <div className="emptyColumn">Порожньо</div>}
          </div>
        </section>)}</div>
        : <div className="leadTableWrap"><table className="leadTable">
          <thead><tr><th>Клієнт</th><th>Авто</th><th>Потреба</th><th>Відповідальний</th><th>Наступна дія</th><th>Статус</th></tr></thead>
          <tbody>{filtered.map((lead) => <tr key={lead.id} className={isOverdue(lead, slaMinutes) ? "overdueRow" : ""}>
            <td><strong>{lead.name || "Без імені"}</strong><small>{lead.phone}</small></td>
            <td><strong>{lead.plateNumber || "—"}</strong><small>{carLabel(lead)}</small></td>
            <td>{lead.need || "—"}</td>
            <td><select value={lead.assignedUserId || ""} onChange={(event) => void patchLead(lead.id, { assignedUserId: event.target.value || null })}>
              <option value="">Не призначено</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select></td>
            <td><strong>{lead.nextAction || "—"}</strong><small>{lead.nextContactAt ? new Date(lead.nextContactAt).toLocaleString("uk-UA") : "—"}</small></td>
            <td><select value={lead.status} onChange={(event) => {
              const nextStatus = event.target.value;
              if (nextStatus === "BOOKED") void openBooking(lead);
              else if (isLeadStatus(nextStatus)) void patchLead(lead.id, { status: nextStatus });
            }}>{leadColumns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></td>
          </tr>)}</tbody>
        </table></div>}

    {booking && <LeadBookingModal
      booking={booking}
      bookingLocation={bookingLocation}
      locations={locations}
      saving={savingBooking}
      onChange={setBooking}
      onClose={() => setBooking(null)}
      onSave={saveBooking}
    />}
  </div>;
}
