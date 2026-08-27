"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import { VehicleRender } from "./vehicle-render";
import styles from "./owner-dashboard.module.css";

type AnalyticsPayload = {
  ok: boolean;
  range?: { from: string; to: string; days: number };
  locations?: Array<{ id: string; name: string }>;
  permissions?: { financial: boolean; personnel: boolean };
  kpi?: {
    grossRevenue: number | null;
    grossProfit: number | null;
    bookingToArrivalPct: number;
    averageCheck: number | null;
    grossMarginPct: number | null;
    postUtilizationPct: number;
    repeatClientPct: number;
    closedWorkOrders: number;
    arrivedVehicles: number;
    completedVehicles: number;
    activeNow: number;
    readyNow: number;
    overdueNow: number;
  };
  previous?: {
    grossRevenue: number | null;
    grossProfit: number | null;
    bookingToArrivalPct: number;
    averageCheck: number | null;
    grossMarginPct: number | null;
    postUtilizationPct: number;
    closedWorkOrders: number;
    arrivedVehicles: number;
    completedVehicles: number;
    leads: number | null;
  };
  funnel?: {
    lead: null | { leads: number; booked: number; conversionPct: number };
    scheduled: number;
    arrived: number;
    diagnosticsReached: number;
    workOrderLinked: number;
    repairReached: number;
    completed: number;
    noShow: number;
    bookingToArrivalPct: number;
    arrivalToDiagnosticsPct: number;
    diagnosticsToWorkOrderPct: number;
    workOrderToRepairPct: number;
    repairToCompletedPct: number;
    bookingToCompletedPct: number;
  };
  operations?: {
    activeNow: number;
    inRepairNow: number;
    waitingPartsNow: number;
    waitingApprovalNow: number;
    readyNow: number;
    overdueNow: number;
    averageCycleMinutes: number;
    onTimeCompletedPct: number;
    timedCompleted: number;
    delayReasons: Array<{ code: string; label: string; count: number }>;
    overdue: Array<{
      appointmentId: string;
      vehicleLabel: string;
      plateNumber: string | null;
      status: string;
      statusLabel: string;
      plannedEndAt: string;
      delayMinutes: number;
    }>;
  };
  trend?: Array<{ date: string; closed: number; revenue: number | null; grossProfit: number | null }>;
};

type DashboardAttention = {
  id: string;
  plate: string;
  vehicle: string;
  status: string;
  attentionTitle: string;
  attentionReason: string;
  nextAction: string;
  attentionLevel: "CRITICAL" | "HIGH" | "MEDIUM";
  attentionAt: string;
  issues?: Array<{ code: string }>;
  workOrderId: string | null;
  vehicleId: string | null;
  appointmentId: string;
};

type DashboardPayload = {
  ok: boolean;
  blockers?: { approval: number; waitingParts: number; noShow: number };
  attention?: DashboardAttention[];
};

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}

function number(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits }).format(value || 0);
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${number(value, 1)}%`;
}

function duration(minutes: number | null | undefined) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (!value) return "—";
  if (value >= 1440) return `${Math.floor(value / 1440)} д ${Math.floor((value % 1440) / 60)} год`;
  if (value >= 60) return `${Math.floor(value / 60)} год ${value % 60} хв`;
  return `${value} хв`;
}

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(date);
}

function delta(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function Delta({ current, previous, invert = false }: { current: number | null | undefined; previous: number | null | undefined; invert?: boolean }) {
  const value = delta(current, previous);
  if (value == null) return <small className={styles.deltaNeutral}>поточний період</small>;
  const good = invert ? value <= 0 : value >= 0;
  return <small className={good ? styles.deltaGood : styles.deltaBad}>{value > 0 ? "↑" : value < 0 ? "↓" : "•"} {Math.abs(value).toFixed(1)}%</small>;
}

function routeAttention(item: DashboardAttention) {
  const workOrderId = item.workOrderId;
  if (workOrderId) return () => navigateCrm("Комерційна пропозиція", { workOrderId });
  const vehicleId = item.vehicleId;
  if (vehicleId) return () => navigateCrm("Авто", { vehicleId });
  return () => navigateCrm("Планувальник", { appointmentId: item.appointmentId });
}

const OWNER_DECISION_CODES = new Set(["PAUSED_STALLED", "WARRANTY_OPEN"]);

function needsOwnerDecision(item: DashboardAttention) {
  return item.issues?.some((issue) => OWNER_DECISION_CODES.has(issue.code)) ?? false;
}

function attentionIssueLabel(item: DashboardAttention) {
  for (const prefix of [item.plate, item.vehicle]) {
    if (prefix && item.attentionTitle.startsWith(`${prefix}:`)) return item.attentionTitle.slice(prefix.length + 1).trim();
  }
  return item.attentionTitle;
}

function attentionDelay(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `Прострочено ${minutes} хв`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Прострочено ${hours} год`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return `Прострочено ${days} д${restHours ? ` ${restHours} год` : ""}`;
}

export function OwnerControlCenter({ userName }: { userName?: string | null }) {
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attentionTab, setAttentionTab] = useState<"OWNER" | "TEAM">("OWNER");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [analyticsResponse, dashboardResponse] = await Promise.all([
        fetch("/api/analytics", { cache: "no-store", credentials: "include" }),
        fetch("/api/dashboard", { cache: "no-store", credentials: "include" }),
      ]);
      const analyticsBody = await analyticsResponse.json().catch(() => null) as AnalyticsPayload | null;
      if (!analyticsResponse.ok || !analyticsBody?.ok) throw new Error("Не вдалося завантажити управлінську аналітику");
      const dashboardBody = await dashboardResponse.json().catch(() => null) as DashboardPayload | null;
      setAnalytics(analyticsBody);
      setDashboard(dashboardResponse.ok && dashboardBody?.ok ? dashboardBody : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Помилка кабінету власника");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener("turbolev:data-changed", handler);
      window.clearInterval(timer);
    };
  }, [load]);

  const kpi = analytics?.kpi;
  const previous = analytics?.previous;
  const operations = analytics?.operations;
  const funnel = analytics?.funnel;
  const attention = dashboard?.attention ?? [];
  const ownerAttention = attention.filter(needsOwnerDecision);
  const teamAttention = attention.filter((item) => !needsOwnerDecision(item));
  const selectedAttention = (attentionTab === "OWNER" ? ownerAttention : teamAttention).slice(0, 5);
  const trend = analytics?.trend?.slice(-10) ?? [];
  const trendMax = Math.max(1, ...trend.map((item) => Math.abs(item.revenue || item.closed || 0)));
  const scopeLabel = useMemo(() => {
    const names = analytics?.locations?.map((item) => item.name) ?? [];
    if (!names.length) return "вся мережа";
    if (names.length === 1) return names[0];
    return `${names.length} станції · вся мережа`;
  }, [analytics?.locations]);

  useEffect(() => {
    if (!ownerAttention.length && teamAttention.length) setAttentionTab("TEAM");
  }, [ownerAttention.length, teamAttention.length]);

  return <>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">TURBO LEV · OWNER CONTROL CENTER</p>
        <h1>Пульт власника</h1>
        <span className="muted">{userName || "Власник"} · {scopeLabel} · {loading ? "оновлюю дані…" : "живі управлінські дані"}</span>
      </div>
      <div className={styles.headerActions}>
        <button type="button" onClick={() => navigateCrm("Аналітика")}>Повна аналітика</button>
        <button type="button" className={styles.primary} onClick={() => navigateCrm("Фінансовий центр")}>Фінансовий центр →</button>
      </div>
    </header>

    {error && <div className={styles.error}><strong>Не вдалося оновити пульт власника</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторити</button></div>}

    <section className={styles.kpis}>
      <button type="button" onClick={() => navigateCrm("Фінансовий центр")}><span>Виручка за період</span><strong>{money(kpi?.grossRevenue)}</strong><Delta current={kpi?.grossRevenue} previous={previous?.grossRevenue} /></button>
      <button type="button" onClick={() => navigateCrm("Фінансовий центр")}><span>Валовий прибуток</span><strong>{money(kpi?.grossProfit)}</strong><Delta current={kpi?.grossProfit} previous={previous?.grossProfit} /></button>
      <button type="button" onClick={() => navigateCrm("Аналітика")}><span>Валова маржа</span><strong>{percent(kpi?.grossMarginPct)}</strong><small>середній чек {money(kpi?.averageCheck)}</small></button>
      <button type="button" onClick={() => navigateCrm("Аналітика")}><span>Завантаження постів</span><strong>{percent(kpi?.postUtilizationPct)}</strong><Delta current={kpi?.postUtilizationPct} previous={previous?.postUtilizationPct} /></button>
      <button type="button" onClick={() => navigateCrm("Аналітика")}><span>Повторні клієнти</span><strong>{percent(kpi?.repeatClientPct)}</strong><small>утримання клієнтської бази</small></button>
      <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Запис → приїзд</span><strong>{percent(kpi?.bookingToArrivalPct)}</strong><Delta current={kpi?.bookingToArrivalPct} previous={previous?.bookingToArrivalPct} /></button>
    </section>

    <section className={styles.liveStrip} aria-label="Стан мережі зараз">
      <button type="button" onClick={() => navigateCrm("Комерційна пропозиція")}><span>Активні авто</span><strong>{operations?.activeNow ?? 0}</strong><small>у потоці мережі зараз</small></button>
      <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { status: "IN_REPAIR" })}><span>У ремонті</span><strong>{operations?.inRepairNow ?? 0}</strong><small>фактична активна робота</small></button>
      <button type="button" className={(operations?.overdueNow ?? 0) > 0 ? styles.danger : ""} onClick={() => navigateCrm("Аналітика")}><span>Протерміновано</span><strong>{operations?.overdueNow ?? 0}</strong><small>вийшли за плановий час</small></button>
      <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { status: "READY_FOR_PICKUP" })}><span>Готові до видачі</span><strong>{operations?.readyNow ?? 0}</strong><small>оплата контролюється окремо</small></button>
    </section>

    <div className={styles.twoColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ВІД ЗВЕРНЕННЯ ДО ЗАВЕРШЕННЯ</p><h2>Конверсія сервісного потоку</h2></div><button type="button" onClick={() => navigateCrm("Аналітика")}>Детально →</button></div>
        <div className={styles.funnel}>
          <button type="button" onClick={() => navigateCrm("Активні")}><span>Активні заявки</span><strong>{funnel?.lead?.leads ?? "—"}</strong><small>{funnel?.lead ? `${percent(funnel.lead.conversionPct)} записано` : "мережевий показник"}</small></button>
          <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Заплановано</span><strong>{funnel?.scheduled ?? 0}</strong><small>за вибраний період</small></button>
          <button type="button" onClick={() => navigateCrm("Планувальник")}><span>Приїхали</span><strong>{funnel?.arrived ?? 0}</strong><small>{percent(funnel?.bookingToArrivalPct)} від запису</small></button>
          <button type="button" onClick={() => navigateCrm("Діагностика")}><span>Діагностика</span><strong>{funnel?.diagnosticsReached ?? 0}</strong><small>{percent(funnel?.arrivalToDiagnosticsPct)} від приїздів</small></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція")}><span>Комерційна пропозиція</span><strong>{funnel?.workOrderLinked ?? 0}</strong><small>{percent(funnel?.diagnosticsToWorkOrderPct)} від діагностики</small></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { status: "IN_REPAIR" })}><span>Ремонт</span><strong>{funnel?.repairReached ?? 0}</strong><small>{percent(funnel?.workOrderToRepairPct)} від КП</small></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція")}><span>Завершено</span><strong>{funnel?.completed ?? 0}</strong><small>{percent(funnel?.bookingToCompletedPct)} від запису</small></button>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ОПЕРАЦІЙНА ЯКІСТЬ</p><h2>Швидкість і дисципліна</h2></div></div>
        <div className={styles.qualityGrid}>
          <button type="button" onClick={() => navigateCrm("Аналітика")}><span>Середній цикл</span><strong>{duration(operations?.averageCycleMinutes)}</strong><small>від приймання до завершення</small></button>
          <button type="button" onClick={() => navigateCrm("Аналітика")}><span>Вчасно завершено</span><strong>{percent(operations?.onTimeCompletedPct)}</strong><small>{operations?.timedCompleted ?? 0} авто з фактичним часом</small></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { status: "WAITING_PARTS" })}><span>Очікують деталі</span><strong>{operations?.waitingPartsNow ?? 0}</strong><small>операційний блокер</small></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { status: "WAITING_APPROVAL" })}><span>Очікують рішення</span><strong>{operations?.waitingApprovalNow ?? 0}</strong><small>погодження / калькуляція</small></button>
        </div>
        <div className={styles.delayList}>{operations?.delayReasons?.length ? operations.delayReasons.slice(0, 5).map((item) => <div key={item.code}><span>{item.label}</span><strong>{item.count}</strong></div>) : <div className={styles.empty}>Критичних причин затримки зараз не зафіксовано.</div>}</div>
      </section>
    </div>

    <div className={styles.twoColumns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">КОНТРОЛЬ СЕРВІСУ</p><h2>Потрібна дія</h2></div><button type="button" onClick={() => navigateCrm("Авто")}>Усі авто →</button></div>
        <div className={styles.attentionTabs} role="tablist" aria-label="Категорії автомобілів, які потребують уваги">
          <button type="button" role="tab" aria-selected={attentionTab === "OWNER"} className={attentionTab === "OWNER" ? styles.attentionTabActive : ""} onClick={() => setAttentionTab("OWNER")}>Моє рішення <b>{ownerAttention.length}</b></button>
          <button type="button" role="tab" aria-selected={attentionTab === "TEAM"} className={attentionTab === "TEAM" ? styles.attentionTabActive : ""} onClick={() => setAttentionTab("TEAM")}>Контроль команди <b>{teamAttention.length}</b></button>
        </div>
        {selectedAttention.length ? <div className={styles.attentionCards}>{selectedAttention.map((item) => <article key={item.id} className={`${styles.attentionCard} ${item.attentionLevel === "CRITICAL" ? styles.attentionCritical : item.attentionLevel === "HIGH" ? styles.attentionHigh : ""}`}>
          {item.vehicleId ? <VehicleRender id={item.vehicleId} brand={item.vehicle} size="mini" className={styles.attentionVehicleImage} /> : <span className={styles.attentionVehicleFallback} aria-label="Зображення автомобіля недоступне">🚗</span>}
          <div className={styles.attentionCardBody}>
            <div className={styles.attentionIdentity}><b>{item.plate}</b><span>{item.vehicle}</span></div>
            <strong>{attentionIssueLabel(item)}</strong>
            <span>{item.attentionReason}</span>
          </div>
          <div className={styles.attentionCardAction}>
            <small>{attentionDelay(item.attentionAt)}</small>
            <button type="button" onClick={routeAttention(item)}>{item.nextAction}</button>
          </div>
        </article>)}</div> : <div className={styles.empty}>{attentionTab === "OWNER" ? "Зараз немає автомобілів, які очікують особистого рішення власника." : "Команда опрацювала всі автомобілі, які потребували уваги."}</div>}
        {(attentionTab === "OWNER" ? ownerAttention : teamAttention).length > selectedAttention.length && <button type="button" className={styles.attentionMore} onClick={() => navigateCrm("Авто")}>Показати ще {(attentionTab === "OWNER" ? ownerAttention : teamAttention).length - selectedAttention.length} →</button>}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ТРЕНД</p><h2>Закриті ЗН та виручка</h2></div><button type="button" onClick={() => navigateCrm("Аналітика")}>Періоди →</button></div>
        <div className={styles.trend}>{trend.length ? trend.map((item) => <div key={item.date}><span>{dateLabel(item.date)}</span><i><b style={{ width: `${Math.max(4, (Math.abs(item.revenue || item.closed || 0) / trendMax) * 100)}%` }} /></i><strong>{item.revenue != null ? money(item.revenue) : `${item.closed} ЗН`}</strong></div>) : <div className={styles.empty}>Ще немає даних для тренду за період.</div>}</div>
      </section>
    </div>

    <section className={styles.quickActions}>
      <button type="button" onClick={() => navigateCrm("Аналітика")}><strong>Аналітика</strong><span>KPI, воронка, виробництво, фінанси →</span></button>
      <button type="button" onClick={() => navigateCrm("Фінансовий центр")}><strong>Фінанси</strong><span>виручка, прибуток, cash flow →</span></button>
      <button type="button" onClick={() => navigateCrm("Комерційна пропозиція")}><strong>Сервісний потік</strong><span>активні авто та блокери →</span></button>
      <button type="button" onClick={() => navigateCrm("Закупівлі та склад")}><strong>Запчастини</strong><span>закупівлі, склад і постачання →</span></button>
      <button type="button" onClick={() => navigateCrm("Планувальник")}><strong>Планувальник</strong><span>завантаження та майбутні записи →</span></button>
      <button type="button" onClick={() => navigateCrm("Активні")}><strong>Активні</strong><span>поточні звернення та конверсія →</span></button>
    </section>
  </>;
}
