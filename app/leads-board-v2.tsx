"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LeadBookingModal, LeadCard, LeadKpi } from "./leads-board-v2.components";
import {
  businessStatusLabel,
  carLabel,
  isLeadInBusinessInbox,
  isOverdue,
  leadBusinessStatus,
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
  RejectReasonCode,
  UserOption,
} from "./leads-board-v2.types";
import { navigateCrm, readCrmRoute } from "./crm-route";

const CANCELLATION_REASONS: Array<{ code: RejectReasonCode; label: string }> = [
  { code: "TOO_EXPENSIVE", label: "Дорого" },
  { code: "NO_CAPACITY_NO_TIME", label: "Немає зручного часу / місця" },
  { code: "SERVICE_NOT_PROVIDED", label: "Послугу не надаємо" },
  { code: "WRONG_NUMBER", label: "Помилковий номер" },
  { code: "SPAM_ADS", label: "Спам / реклама" },
  { code: "OTHER", label: "Інше" },
];

function routeKpi(scope?: string): KpiKey | null {
  if (scope === "new" || scope === "overdue" || scope === "booked" || scope === "cancelled" || scope === "conversion") return scope;
  return null;
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
      if (!response.ok) throw new Error(payloadMessage(payload, "Не вдалося завантажити звернення"));

      setLeads(parseLeadList(readPayloadField(payload, "leads")));
      setUsers(parseUserOptions(readPayloadField(payload, "users")));
      const nextSla = Number(readPayloadField(readPayloadField(payload, "meta"), "slaMinutes"));
      setSlaMinutes(Number.isFinite(nextSla) && nextSla > 0 ? nextSla : 120);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити звернення");
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
  useEffect(() => {
    const syncRoute = () => {
      const route = readCrmRoute();
      setManager(route.assignedUserId || "");
      setActiveKpi(routeKpi(route.scope));
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const visible = useMemo(() => leads.filter((lead) => {
    const haystack = `${lead.name || ""} ${lead.phone} ${lead.plateNumber || ""} ${carLabel(lead)} ${lead.need || ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase()) && (!manager || lead.assignedUserId === manager);
  }), [leads, query, manager]);

  const businessVisible = useMemo(() => visible.filter(isLeadInBusinessInbox), [visible]);

  const stats = useMemo(() => {
    const newCount = businessVisible.filter((lead) => leadBusinessStatus(lead) === "NEW").length;
    const booked = businessVisible.filter((lead) => leadBusinessStatus(lead) === "BOOKED").length;
    const cancelled = businessVisible.filter((lead) => leadBusinessStatus(lead) === "CANCELLED").length;
    const overdue = businessVisible.filter((lead) => isOverdue(lead, slaMinutes)).length;
    const converted = visible.filter((lead) => ["BOOKED", "ARRIVED"].includes(lead.status)).length;
    const denominator = visible.filter((lead) => !["SPAM_WRONG", "SUPPLIER_PARTNER"].includes(lead.status)).length;
    return {
      newCount,
      overdue,
      booked,
      cancelled,
      conversion: denominator ? Math.round((converted / denominator) * 100) : 0,
    };
  }, [businessVisible, visible, slaMinutes]);

  const filtered = useMemo(() => {
    if (!activeKpi) return businessVisible;
    if (activeKpi === "new") return businessVisible.filter((lead) => leadBusinessStatus(lead) === "NEW");
    if (activeKpi === "overdue") return businessVisible.filter((lead) => isOverdue(lead, slaMinutes));
    if (activeKpi === "booked") return businessVisible.filter((lead) => leadBusinessStatus(lead) === "BOOKED");
    if (activeKpi === "cancelled") return businessVisible.filter((lead) => leadBusinessStatus(lead) === "CANCELLED");
    return businessVisible;
  }, [activeKpi, businessVisible, slaMinutes]);

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
      notify(`Спроба контакту №${updatedLead.contactAttempts} зафіксована. Статус лишився «Нове».`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося зафіксувати контакт");
    }
  }

  async function cancelLead(lead: Lead) {
    const menu = CANCELLATION_REASONS.map((item, index) => `${index + 1}. ${item.label}`).join("\n");
    const selected = window.prompt(`Причина скасування:\n${menu}\n\nВведіть номер 1–6.`);
    if (selected == null) return;
    const index = Number(selected.trim()) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= CANCELLATION_REASONS.length) {
      setError("Оберіть причину скасування номером від 1 до 6.");
      return;
    }
    const reason = CANCELLATION_REASONS[index];
    let comment = lead.comment;
    if (reason.code === "OTHER") {
      const details = window.prompt("Коротко вкажіть причину скасування:");
      if (details == null) return;
      const text = details.trim();
      if (!text) {
        setError("Для причини «Інше» потрібен короткий коментар.");
        return;
      }
      comment = [lead.comment, `Причина скасування: ${text}`].filter(Boolean).join("\n");
    }
    await patchLead(lead.id, { status: "LOST", rejectReason: reason.code, comment }, `Звернення скасовано: ${reason.label}.`);
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
      notify("Звернення записано — запис створено у Планувальнику.");
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
        <p className="eyebrow">ЗВЕРНЕННЯ · БІЗНЕС-СТАН</p>
        <h1>Звернення</h1>
        <p className="leadsSubtitle">Тільки три результати: Нове → Записаний або Скасоване. Дзвінки, прорахунок і очікування лишаються діями та історією, а не окремими статусами.</p>
      </div>
      <button className="primary" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлення…" : "Оновити"}</button>
    </header>

    {error && <div className="alert"><strong>Помилка</strong><span>{error}</span><button type="button" onClick={() => setError("")}>Закрити</button></div>}

    <section className="leadKpis">
      <LeadKpi active={activeKpi === "new"} label="Нові" value={stats.newCount} sub="потребують дії" onClick={() => setActiveKpi(activeKpi === "new" ? null : "new")} />
      <LeadKpi active={activeKpi === "overdue"} danger label="Прострочені" value={stats.overdue} sub="SLA / наступна дія" onClick={() => setActiveKpi(activeKpi === "overdue" ? null : "overdue")} />
      <LeadKpi active={activeKpi === "booked"} label="Записані" value={stats.booked} sub="у Планувальнику" onClick={() => setActiveKpi(activeKpi === "booked" ? null : "booked")} />
      <LeadKpi active={activeKpi === "cancelled"} label="Скасовані" value={stats.cancelled} sub="з причиною" onClick={() => setActiveKpi(activeKpi === "cancelled" ? null : "cancelled")} />
      <LeadKpi active={activeKpi === "conversion"} label="Конверсія в запис" value={`${stats.conversion}%`} sub="від усіх звернень" onClick={() => setActiveKpi(activeKpi === "conversion" ? null : "conversion")} />
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
      ? <div className="emptyColumn">Завантажую звернення з Neon…</div>
      : view === "kanban"
        ? <div className="leadKanban">{leadColumns.map((column) => <section className="leadColumn" key={column.key}>
          <header><strong>{column.label}</strong><span>{filtered.filter((lead) => leadBusinessStatus(lead) === column.key).length}</span></header>
          <div className="leadColumnBody">
            {filtered.filter((lead) => leadBusinessStatus(lead) === column.key).map((lead) =>
              <LeadCard key={lead.id} lead={lead} slaMinutes={slaMinutes} users={users} onPatch={patchLead} onAttempt={addAttempt} onBook={openBooking} onCancel={cancelLead} onOpenPlanner={() => navigateCrm("Планувальник")} />)}
            {!filtered.some((lead) => leadBusinessStatus(lead) === column.key) && <div className="emptyColumn">Порожньо</div>}
          </div>
        </section>)}</div>
        : <div className="leadTableWrap"><table className="leadTable">
          <thead><tr><th>Клієнт</th><th>Авто</th><th>Потреба</th><th>Відповідальний</th><th>Наступна дія</th><th>Статус</th></tr></thead>
          <tbody>{filtered.map((lead) => {
            const state = leadBusinessStatus(lead);
            return <tr key={lead.id} className={isOverdue(lead, slaMinutes) ? "overdueRow" : ""}>
              <td><strong>{lead.name || "Без імені"}</strong><small>{lead.phone}</small></td>
              <td><strong>{lead.plateNumber || "—"}</strong><small>{carLabel(lead)}</small></td>
              <td>{lead.need || "—"}</td>
              <td><select value={lead.assignedUserId || ""} onChange={(event) => void patchLead(lead.id, { assignedUserId: event.target.value || null })}>
                <option value="">Не призначено</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select></td>
              <td>{state === "NEW" ? <><strong>{lead.nextAction || "—"}</strong><small>{lead.nextContactAt ? new Date(lead.nextContactAt).toLocaleString("uk-UA") : "—"}</small></> : <strong>{businessStatusLabel(lead)}</strong>}</td>
              <td>{state === "NEW"
                ? <select value="NEW" onChange={(event) => {
                    if (event.target.value === "BOOKED") void openBooking(lead);
                    else if (event.target.value === "CANCELLED") void cancelLead(lead);
                  }}>{leadColumns.map((column) => <option key={column.key} value={column.key}>{column.statusLabel}</option>)}</select>
                : state === "BOOKED"
                  ? <button type="button" onClick={() => navigateCrm("Планувальник")}>Записаний → Планувальник</button>
                  : <button type="button" onClick={() => void patchLead(lead.id, { status: "NEW", rejectReason: null }, "Звернення повернуто в Нове.")}>Скасоване · повернути</button>}
              </td>
            </tr>;
          })}</tbody>
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
