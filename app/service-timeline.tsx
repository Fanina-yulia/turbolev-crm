"use client";

import { useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm } from "./crm-route";
import styles from "./service-timeline.module.css";

type TimelineKind = "STATUS" | "APPOINTMENT" | "DIAGNOSTIC" | "ESTIMATE" | "PARTS" | "WORK" | "QC" | "PAYMENT" | "FINANCE" | "SYSTEM";
type TimelineEvent = {
  id: string;
  occurredAt: string;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  actor?: string | null;
  workOrderId?: string | null;
  workOrderNumber?: number | null;
  vehicleId?: string | null;
  clientId?: string | null;
  plateNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
};

type Props = {
  workOrderId?: string;
  clientId?: string;
  vehicleId?: string;
  limit?: number;
  compact?: boolean;
};

type Filter = "ALL" | "SERVICE" | "COMMERCIAL" | "PARTS" | "QC" | "PAYMENT";

const FILTERS: Array<[Filter, string]> = [
  ["ALL", "Усі"],
  ["SERVICE", "Сервіс"],
  ["COMMERCIAL", "Кошторис"],
  ["PARTS", "Запчастини"],
  ["QC", "QC"],
  ["PAYMENT", "Оплати"],
];
const FILTER_KINDS: Record<Exclude<Filter, "ALL">, TimelineKind[]> = {
  SERVICE: ["STATUS", "APPOINTMENT", "DIAGNOSTIC", "WORK", "SYSTEM"],
  COMMERCIAL: ["ESTIMATE"],
  PARTS: ["PARTS"],
  QC: ["QC"],
  PAYMENT: ["PAYMENT", "FINANCE"],
};
const KIND_LABEL: Record<TimelineKind, string> = {
  STATUS: "Статус", APPOINTMENT: "Запис", DIAGNOSTIC: "Діагностика", ESTIMATE: "Кошторис", PARTS: "Запчастини",
  WORK: "Робота", QC: "QC", PAYMENT: "Оплата", FINANCE: "Фінанси", SYSTEM: "Система",
};

function endpoint({ workOrderId, clientId, vehicleId }: Props) {
  if (workOrderId) return `/api/work-orders/${encodeURIComponent(workOrderId)}/timeline`;
  if (clientId) return `/api/clients/${encodeURIComponent(clientId)}/timeline`;
  if (vehicleId) return `/api/vehicles/${encodeURIComponent(vehicleId)}/timeline`;
  return null;
}
function fullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function dayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}
function money(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function ServiceTimeline(props: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const url = endpoint(props);

  useEffect(() => {
    if (!url) { setEvents([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити хронологію.");
        setEvents(Array.isArray(payload.events) ? payload.events : []);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка хронології.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [url]);

  const visible = useMemo(() => {
    const filtered = filter === "ALL" ? events : events.filter((event) => FILTER_KINDS[filter].includes(event.kind));
    return filtered.slice(0, Math.max(1, props.limit || 120));
  }, [events, filter, props.limit]);

  const groups = useMemo(() => {
    const result: Array<{ day: string; events: TimelineEvent[] }> = [];
    for (const event of visible) {
      const key = dayKey(event.occurredAt);
      const current = result[result.length - 1];
      if (!current || current.day !== key) result.push({ day: key, events: [event] });
      else current.events.push(event);
    }
    return result;
  }, [visible]);

  const canOpenContext = !props.workOrderId;
  function openWorkOrder(event: TimelineEvent) {
    if (!event.workOrderId) return;
    navigateCrm("Комерційна пропозиція", { workOrderId: event.workOrderId, workOrderTab: "history" });
  }

  return <section className={`${styles.timeline} ${props.compact ? styles.compact : ""}`}>
    <div className={styles.toolbar}>
      <div><strong>Хронологія</strong><span>{events.length} подій</span></div>
      <div className={styles.filters}>{FILTERS.map(([code, label]) => {
        const count = code === "ALL" ? events.length : events.filter((event) => FILTER_KINDS[code].includes(event.kind)).length;
        if (code !== "ALL" && count === 0) return null;
        return <button type="button" key={code} className={filter === code ? styles.active : ""} onClick={() => setFilter(code)}>{label}<b>{count}</b></button>;
      })}</div>
    </div>

    {loading && <div className={styles.state}>Завантажую історію…</div>}
    {error && <div className={styles.error}>{error}</div>}
    {!loading && !error && visible.length === 0 && <div className={styles.state}>Подій за цим фільтром поки немає.</div>}

    {!loading && !error && groups.map((group) => <div className={styles.day} key={group.day || "unknown"}>
      <div className={styles.dayLabel}>{dayLabel(group.day)}</div>
      <div className={styles.events}>{group.events.map((event) => <article className={styles.event} key={event.id}>
        <span className={`${styles.dot} ${styles[`kind${event.kind}`] || ""}`} aria-hidden="true" />
        <div className={styles.eventBody}>
          <div className={styles.eventHead}>
            <span className={styles.kind}>{KIND_LABEL[event.kind]}</span>
            <time title={fullDate(event.occurredAt)}>{new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurredAt))}</time>
          </div>
          <strong>{event.title}</strong>
          {event.detail && <p>{event.detail}</p>}
          {event.amount != null && <b className={styles.amount}>{money(event.amount, event.currency || "UAH")}</b>}
          <div className={styles.meta}>
            {event.workOrderId && <button type="button" disabled={!canOpenContext} onClick={() => openWorkOrder(event)}>{formatWorkOrderNumber(event.workOrderNumber)}{event.plateNumber ? ` · ${event.plateNumber}` : ""}{canOpenContext ? " →" : ""}</button>}
            {event.actor && <span>Виконав: {event.actor}</span>}
          </div>
        </div>
      </article>)}</div>
    </div>)}
  </section>;
}
