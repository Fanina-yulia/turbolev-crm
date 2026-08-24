"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CrmAccessSnapshot } from "./use-crm-access";
import { carLabel, isOverdue, leadBusinessStatus, parseLeadList, parseUserOptions, payloadMessage, readPayloadField } from "./leads-board-v2.model";
import type { Lead, UserOption } from "./leads-board-v2.types";
import { navigateCrm } from "./crm-route";
import styles from "./leads-sales-role-cabinet-home.module.css";

type SalesRole = "HEAD_OF_SALES" | "SALES";
type QueueItem = { lead: Lead; kind: "OVERDUE" | "DUE" | "NEW" };

function minutesAgo(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} хв`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} год ${minutes % 60} хв`;
  return `${Math.floor(minutes / 1440)} дн ${Math.floor((minutes % 1440) / 60)} год`;
}

function dueToday(value: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function time(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function queueLabel(kind: QueueItem["kind"]) {
  if (kind === "OVERDUE") return "Прострочено";
  if (kind === "DUE") return "Контакт сьогодні";
  return "Нове";
}

function openActive(scope?: string, assignedUserId?: string | null) {
  navigateCrm("Активні", { scope: scope || undefined, assignedUserId: assignedUserId || undefined });
}

export function SalesRoleCabinetHome({ role, access }: { role: SalesRole; access: CrmAccessSnapshot }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [slaMinutes, setSlaMinutes] = useState(120);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isHead = role === "HEAD_OF_SALES";
  const currentUserId = access.user?.id || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/leads", { cache: "no-store", credentials: "include" });
      const payload: unknown = await response.json().catch(() => null);
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

  useEffect(() => {
    void load();
    const handler = () => void load();
    const timer = window.setInterval(() => void load(), 30_000);
    window.addEventListener("turbolev:data-changed", handler);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("turbolev:data-changed", handler);
    };
  }, [load]);

  const scoped = useMemo(() => isHead ? leads : leads.filter((lead) => lead.assignedUserId === currentUserId), [isHead, leads, currentUserId]);
  const open = useMemo(() => scoped.filter((lead) => leadBusinessStatus(lead) === "NEW"), [scoped]);
  const overdue = useMemo(() => open.filter((lead) => isOverdue(lead, slaMinutes)), [open, slaMinutes]);
  const due = useMemo(() => open.filter((lead) => dueToday(lead.nextContactAt)), [open]);
  const booked = useMemo(() => scoped.filter((lead) => leadBusinessStatus(lead) === "BOOKED"), [scoped]);
  const cancelled = useMemo(() => scoped.filter((lead) => leadBusinessStatus(lead) === "CANCELLED"), [scoped]);
  const unassigned = useMemo(() => isHead ? leads.filter((lead) => leadBusinessStatus(lead) === "NEW" && !lead.assignedUserId) : [], [isHead, leads]);

  const conversion = useMemo(() => {
    const denominator = scoped.filter((lead) => !["SPAM_WRONG", "SUPPLIER_PARTNER"].includes(lead.status)).length;
    const converted = scoped.filter((lead) => ["BOOKED", "ARRIVED"].includes(lead.status)).length;
    return denominator ? Math.round((converted / denominator) * 100) : 0;
  }, [scoped]);

  const queue = useMemo<QueueItem[]>(() => {
    const result = open.map((lead): QueueItem => ({ lead, kind: isOverdue(lead, slaMinutes) ? "OVERDUE" : dueToday(lead.nextContactAt) ? "DUE" : "NEW" }));
    const rank: Record<QueueItem["kind"], number> = { OVERDUE: 0, DUE: 1, NEW: 2 };
    return result.sort((a, b) => rank[a.kind] - rank[b.kind] || new Date(a.lead.lastActivityAt).getTime() - new Date(b.lead.lastActivityAt).getTime()).slice(0, 12);
  }, [open, slaMinutes]);

  const workload = useMemo(() => {
    if (!isHead) return [];
    const byUser = new Map<string, { user: UserOption; active: number; overdue: number; booked: number }>();
    const userMap = new Map(users.map((user) => [user.id, user]));
    for (const lead of leads) {
      if (!lead.assignedUserId) continue;
      const user = lead.assignedUser || userMap.get(lead.assignedUserId);
      if (!user) continue;
      const row = byUser.get(user.id) || { user, active: 0, overdue: 0, booked: 0 };
      const business = leadBusinessStatus(lead);
      if (business === "NEW") row.active += 1;
      if (business === "BOOKED") row.booked += 1;
      if (business === "NEW" && isOverdue(lead, slaMinutes)) row.overdue += 1;
      byUser.set(user.id, row);
    }
    return [...byUser.values()].sort((a, b) => b.overdue - a.overdue || b.active - a.active || a.user.name.localeCompare(b.user.name, "uk"));
  }, [isHead, users, leads, slaMinutes]);

  if (loading && !leads.length) return <div className={styles.state}><strong>Завантажую робочий кабінет…</strong><span>Формую чергу звернень і прострочених дій.</span></div>;
  if (error && !leads.length) return <div className={styles.state}><strong>Не вдалося відкрити кабінет продажів</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторити</button></div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · {isHead ? "КЕРІВНИК ВІДДІЛУ ПРОДАЖІВ" : "МЕНЕДЖЕР З ПРОДАЖУ"}</p>
        <h1>{isHead ? "Пульт воронки звернень" : "Моя робоча черга"}</h1>
        <span>{access.user?.name || (isHead ? "Керівник відділу продажів" : "Менеджер з продажу")} · Нове → Записаний або Скасоване → передача в сервіс</span>
      </div>
      <button className={styles.primary} type="button" onClick={() => openActive(undefined, isHead ? null : currentUserId)}>Відкрити Активні →</button>
    </header>

    {error && <div className={styles.notice}>{error}</div>}

    <section className={styles.kpis}>
      <button type="button" onClick={() => openActive("new", isHead ? null : currentUserId)}><span>{isHead ? "Активні звернення" : "Мої активні"}</span><strong>{open.length}</strong><small>потребують наступної дії</small></button>
      <button type="button" className={overdue.length ? styles.danger : ""} onClick={() => openActive("overdue", isHead ? null : currentUserId)}><span>Прострочені</span><strong>{overdue.length}</strong><small>SLA або наступний контакт</small></button>
      <button type="button" onClick={() => openActive("booked", isHead ? null : currentUserId)}><span>Записані</span><strong>{booked.length}</strong><small>передані в Планувальник</small></button>
      <button type="button" onClick={() => openActive(undefined, isHead ? null : currentUserId)}><span>Конверсія в запис</span><strong>{conversion}%</strong><small>{cancelled.length} скасовано з причиною</small></button>
      {isHead && <button type="button" className={unassigned.length ? styles.warning : ""} onClick={() => openActive("new")}><span>Без відповідального</span><strong>{unassigned.length}</strong><small>потрібно розподілити</small></button>}
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>ПОТРЕБУЄ ДІЇ</p><h2>{isHead ? "Пріоритетна черга команди" : "Що робити зараз"}</h2></div><span className={styles.badge}>{queue.length}</span></div>
        {queue.length ? <div className={styles.queue}>{queue.map(({ lead, kind }) => <button type="button" key={lead.id} className={`${styles.queueRow} ${kind === "OVERDUE" ? styles.queueDanger : kind === "DUE" ? styles.queueWarning : ""}`} onClick={() => openActive(kind === "OVERDUE" ? "overdue" : "new", isHead ? lead.assignedUserId : currentUserId)}>
          <div className={styles.queueTop}><strong>{lead.name || lead.phone}</strong><em>{queueLabel(kind)}</em></div>
          <span>{carLabel(lead)}{lead.plateNumber ? ` · ${lead.plateNumber}` : ""}</span>
          <b>{lead.need || lead.nextAction || "Уточнити потребу клієнта"}</b>
          <small>{lead.assignedUser?.name || "Без відповідального"} · без руху {minutesAgo(lead.lastActivityAt)}{lead.nextContactAt ? ` · контакт ${time(lead.nextContactAt)}` : ""}</small>
        </button>)}</div> : <div className={styles.empty}>Активних звернень, що потребують дії, немає.</div>}
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className={styles.eyebrow}>{isHead ? "КОМАНДА" : "СЬОГОДНІ"}</p><h2>{isHead ? "Навантаження менеджерів" : "Наступні контакти"}</h2></div></div>
        {isHead ? <div className={styles.teamList}>{workload.length ? workload.slice(0, 10).map((row) => <button type="button" key={row.user.id} className={styles.teamRow} onClick={() => openActive(undefined, row.user.id)}>
          <div><strong>{row.user.name}</strong><span>{row.active} активних · {row.booked} записаних</span></div><em className={row.overdue ? styles.teamDanger : ""}>{row.overdue} простр.</em>
        </button>) : <div className={styles.empty}>У зверненнях ще немає призначених менеджерів.</div>}</div> : <div className={styles.followups}>{due.length ? [...due].sort((a, b) => new Date(a.nextContactAt || 0).getTime() - new Date(b.nextContactAt || 0).getTime()).slice(0, 10).map((lead) => <button type="button" key={lead.id} onClick={() => openActive("new", currentUserId)}><time>{time(lead.nextContactAt)}</time><div><strong>{lead.name || lead.phone}</strong><span>{lead.nextAction || lead.need || "Зв’язатися з клієнтом"}</span></div></button>) : <div className={styles.empty}>На сьогодні окремих повторних контактів немає.</div>}</div>}

        <div className={styles.quickHead}><p className={styles.eyebrow}>ШВИДКІ ДІЇ</p></div>
        <div className={styles.quick}>
          <button type="button" onClick={() => navigateCrm("Нові звернення")}>Нові звернення<span>ще не опрацьовані канали →</span></button>
          <button type="button" onClick={() => openActive(undefined, isHead ? null : currentUserId)}>Активні<span>воронка і картки клієнтів →</span></button>
          <button type="button" onClick={() => navigateCrm("Комунікації")}>Комунікації<span>дзвінки та повідомлення →</span></button>
          <button type="button" onClick={() => navigateCrm("Планувальник")}>Планувальник<span>перевірити записи →</span></button>
        </div>
      </aside>
    </div>
  </div>;
}