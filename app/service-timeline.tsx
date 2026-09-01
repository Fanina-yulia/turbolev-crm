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
type DayGroup = { day: string; events: TimelineEvent[] };
type VisitGroup = { key: string; workOrderId: string | null; events: TimelineEvent[]; days: DayGroup[]; latestAt: string };

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
const KIND_ICON: Record<TimelineKind, string> = {
  STATUS: "↻", APPOINTMENT: "▣", DIAGNOSTIC: "⌕", ESTIMATE: "▤", PARTS: "⚙", WORK: "⚒", QC: "✓", PAYMENT: "₴", FINANCE: "◈", SYSTEM: "⋯",
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
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function dayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function dayLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (value === today) return "Сьогодні";
  if (value === yesterday) return "Вчора";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "long", year: "numeric" }).format(date);
}
function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(date);
}
function money(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function ServiceTimeline(props: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showTechnical, setShowTechnical] = useState(false);
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
    const withoutTechnical = showTechnical ? filtered : filtered.filter((event) => event.kind !== "SYSTEM");
    return withoutTechnical.slice(0, Math.max(1, props.limit || 120));
  }, [events, filter, props.limit, showTechnical]);

  const groups = useMemo(() => {
    const byVisit = new Map<string, { workOrderId: string | null; events: TimelineEvent[] }>();
    for (const event of visible) {
      const key = event.workOrderId ? `work-order:${event.workOrderId}` : `unlinked:${dayKey(event.occurredAt)}`;
      const current = byVisit.get(key);
      if (current) current.events.push(event);
      else byVisit.set(key, { workOrderId: event.workOrderId || null, events: [event] });
    }
    return [...byVisit.entries()].map(([key, group]) => {
      const days: DayGroup[] = [];
      for (const event of group.events) {
        const day = dayKey(event.occurredAt);
        const current = days[days.length - 1];
        if (!current || current.day !== day) days.push({ day, events: [event] });
        else current.events.push(event);
      }
      return { key, ...group, days, latestAt: group.events[0]?.occurredAt || "" };
    });
  }, [visible]);

  const canOpenContext = !props.workOrderId;
  function openWorkOrder(event: TimelineEvent) {
    if (!event.workOrderId) return;
    navigateCrm("Комерційна пропозиція", { workOrderId: event.workOrderId, workOrderTab: "history" });
  }

  function visitLabel(group: VisitGroup) {
    return group.workOrderId ? `Сервісне звернення ${formatWorkOrderNumber(group.events.find((event) => event.workOrderId === group.workOrderId)?.workOrderNumber)}` : "Окремі події автомобіля";
  }

  return <section className={`${styles.timeline} ${props.compact ? styles.compact : ""}`}>
    <div className={styles.toolbar}>
      <div className={styles.toolbarTitle}><strong>Хронологія сервісу</strong><span>{events.length} подій · {groups.length} звернень</span></div>
      <div className={styles.filters}>{FILTERS.map(([code, label]) => {
        const count = code === "ALL" ? events.length : events.filter((event) => FILTER_KINDS[code].includes(event.kind)).length;
        if (code !== "ALL" && count === 0) return null;
        return <button type="button" key={code} className={filter === code ? styles.active : ""} onClick={() => setFilter(code)}>{label}<b>{count}</b></button>;
      })}</div>
    </div>
    <div className={styles.timelineTools}>
      <div className={styles.legend} aria-label="Типи подій"><span><i className={styles.legendService} />Сервіс</span><span><i className={styles.legendDiagnostic} />Діагностика</span><span><i className={styles.legendCommercial} />КП</span><span><i className={styles.legendWork} />Роботи</span><span><i className={styles.legendPayment} />Оплата</span></div>
      <button type="button" className={styles.technicalToggle} onClick={() => setShowTechnical((value) => !value)}>{showTechnical ? "Приховати технічні події" : "Показати технічні події"}</button>
    </div>

    {loading && <div className={styles.state}>Завантажую історію…</div>}
    {error && <div className={styles.error}>{error}</div>}
    {!loading && !error && visible.length === 0 && <div className={styles.state}>Подій за цим фільтром поки немає.</div>}

    {!loading && !error && groups.map((group, groupIndex) => <section className={`${styles.visit} ${groupIndex === 0 ? styles.currentVisit : ""}`} key={group.key}>
      <header className={styles.visitHead}>
        <div><span className={styles.visitKicker}>{groupIndex === 0 ? "ПОТОЧНИЙ ВІЗИТ" : "СЕРВІСНИЙ ВІЗИТ"}</span><strong>{visitLabel(group)}</strong><span>{group.events.length} подій · остання {timeLabel(group.latestAt)}</span></div>
        {group.workOrderId && canOpenContext ? <button type="button" className={styles.visitLink} onClick={() => openWorkOrder(group.events[0])}>Відкрити звернення →</button> : null}
      </header>
      {group.days.map((day) => <div className={styles.day} key={`${group.key}:${day.day || "unknown"}`}>
        <div className={styles.dayLabel}>{dayLabel(day.day)}</div>
        <div className={styles.events}>{day.events.map((event) => <article className={`${styles.event} ${styles[`event${event.kind}`] || ""}`} key={event.id}>
          <span className={`${styles.dot} ${styles[`kind${event.kind}`] || ""}`} aria-hidden="true" />
          <div className={styles.eventBody}>
            <div className={styles.eventHead}>
              <span className={styles.eventType}><span className={`${styles.eventIcon} ${styles[`kind${event.kind}`] || ""}`} aria-hidden="true">{KIND_ICON[event.kind]}</span><span className={styles.kind}>{KIND_LABEL[event.kind]}</span></span>
              <time title={fullDate(event.occurredAt)}>{timeLabel(event.occurredAt)}</time>
            </div>
            <strong>{event.title}</strong>
            {event.detail && <p>{event.detail}</p>}
            {event.amount != null && <b className={styles.amount}>{money(event.amount, event.currency || "UAH")}</b>}
            <div className={styles.meta}>
              {event.workOrderId && (canOpenContext ? <button type="button" onClick={() => openWorkOrder(event)}>{formatWorkOrderNumber(event.workOrderNumber)}{event.plateNumber ? ` · ${event.plateNumber}` : ""} →</button> : <span>{formatWorkOrderNumber(event.workOrderNumber)}</span>)}
              {event.actor && <span>Виконав: {event.actor}</span>}
            </div>
          </div>
        </article>)}</div>
      </div>)}
    </section>)}
  </section>;
}
