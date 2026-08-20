"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-dashboard.module.css";

const KYIV_TZ = "Europe/Kyiv";

type AnalyticsData = {
  ok: boolean;
  error?: string;
  emptyScope?: boolean;
  range: {
    from: string;
    to: string;
    timezone: string;
    days: number;
    previousFrom?: string;
    previousTo?: string;
  };
  scope?: { selectedLocationId: string | null };
  locations: Array<{ id: string; name: string }>;
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
    averageCheck: number | null;
    grossMarginPct: number | null;
    bookingToArrivalPct: number;
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
  finance?: null | {
    grossRevenue: number;
    grossProfit: number;
    grossMarginPct: number;
    averageCheck: number;
    finalizedOrders: number;
  };
  utilization?: {
    bookedMinutes: number;
    capacityMinutes: number;
    utilizationPct: number;
    activePosts: number;
    posts: Array<{
      postId: string;
      name: string;
      locationId: string;
      locationName: string;
      appointments: number;
      bookedMinutes: number;
      capacityMinutes: number;
      utilizationPct: number;
    }>;
  };
  retention?: { servedClients: number; returningClients: number; repeatClientPct: number };
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
    liveStatusBreakdown: Array<{ status: string; label: string; count: number }>;
    delayReasons: Array<{ code: string; label: string; count: number }>;
    overdue: Array<{
      appointmentId: string;
      customerName: string;
      vehicleLabel: string;
      plateNumber: string | null;
      status: string;
      statusLabel: string;
      plannedStartAt: string;
      plannedEndAt: string;
      delayMinutes: number;
    }>;
  };
  mechanics?: Array<{
    mechanicId: string;
    name: string;
    completedJobs: number;
    workOrders: number;
    normHours: number;
    actualHours: number;
    efficiencyPct: number | null;
  }>;
  trend?: Array<{ date: string; closed: number; revenue: number | null; grossProfit: number | null }>;
};

type Preset = "today" | "7d" | "30d" | "month" | "year" | "custom";
type AnalyticsTab = "overview" | "funnel" | "workshop";

function kyivDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function monthStart(value: string) { return `${value.slice(0, 7)}-01`; }
function yearStart(value: string) { return `${value.slice(0, 4)}-01-01`; }
function presetRange(preset: Preset) {
  const today = kyivDateString();
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: addDays(today, -6), to: today };
  if (preset === "30d") return { from: addDays(today, -29), to: today };
  if (preset === "year") return { from: yearStart(today), to: today };
  return { from: monthStart(today), to: today };
}
function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value) + " ₴";
}
function number(value: number | null | undefined) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value || 0);
}
function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function hours(minutes: number | undefined) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format((minutes || 0) / 60)} год`;
}
function durationLabel(minutes: number | null | undefined) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (!value) return "—";
  const days = Math.floor(value / 1440);
  const hrs = Math.floor((value % 1440) / 60);
  const mins = value % 60;
  if (days) return `${days} д ${hrs} год`;
  if (hrs) return `${hrs} год ${mins} хв`;
  return `${mins} хв`;
}
function dateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: KYIV_TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function dateKeyFromIso(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function deltaValue(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function DeltaBadge({ current, previous, invert = false }: { current: number | null | undefined; previous: number | null | undefined; invert?: boolean }) {
  const delta = deltaValue(current, previous);
  if (delta == null) return <span className={styles.deltaNeutral}>новий період</span>;
  const positive = invert ? delta <= 0 : delta >= 0;
  return <span className={positive ? styles.deltaGood : styles.deltaBad}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "•"} {Math.abs(delta).toFixed(1)}%</span>;
}

function KpiCard({
  label, value, hint, current, previous, onClick, tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  current?: number | null;
  previous?: number | null;
  onClick?: () => void;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const className = `${styles.kpiCard} ${styles[`tone_${tone}`]} ${onClick ? styles.kpiClickable : ""}`;
  const content = <>
    <div className={styles.kpiTop}><small>{label}</small>{current !== undefined && <DeltaBadge current={current} previous={previous} />}</div>
    <strong>{value}</strong>
    <span>{hint}</span>
  </>;
  return onClick
    ? <button type="button" className={className} onClick={onClick}>{content}</button>
    : <article className={className}>{content}</article>;
}

function MiniProgress({ value }: { value: number }) {
  return <div className={styles.miniProgress}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function AnalyticsDashboard() {
  const initial = presetRange("month");
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [locationId, setLocationId] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/analytics?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити аналітику");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити аналітику");
    } finally {
      setLoading(false);
    }
  }, [from, to, locationId]);

  useEffect(() => { void load(); }, [load]);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = presetRange(next);
    setFrom(range.from);
    setTo(range.to);
  };

  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend || []).map((row) => Math.max(row.closed, (row.revenue || 0) / 1000))), [data?.trend]);
  const maxDelay = useMemo(() => Math.max(1, ...(data?.operations?.delayReasons || []).map((row) => row.count)), [data?.operations?.delayReasons]);
  const kpi = data?.kpi;
  const previous = data?.previous;
  const operations = data?.operations;
  const funnel = data?.funnel;

  const funnelStages = useMemo(() => {
    if (!funnel) return [];
    const stages: Array<{ key: string; label: string; count: number; conversion: number | null; route?: () => void }> = [];
    if (funnel.lead) stages.push({ key: "lead", label: "Звернення / ліди", count: funnel.lead.leads, conversion: null });
    stages.push({ key: "scheduled", label: "Записано на СТО", count: funnel.scheduled, conversion: funnel.lead?.conversionPct ?? null, route: () => navigateCrm("Планувальник", { date: from, scope: "week" }) });
    stages.push({ key: "arrived", label: "Приїхали", count: funnel.arrived, conversion: funnel.bookingToArrivalPct, route: () => navigateCrm("Планувальник", { status: "ARRIVED", date: to, scope: "day" }) });
    stages.push({ key: "diagnostics", label: "Дійшли до діагностики", count: funnel.diagnosticsReached, conversion: funnel.arrivalToDiagnosticsPct, route: () => navigateCrm("Діагностика") });
    stages.push({ key: "workOrder", label: "Створено ЗН", count: funnel.workOrderLinked, conversion: funnel.diagnosticsToWorkOrderPct, route: () => navigateCrm("Замовлення-наряди") });
    stages.push({ key: "repair", label: "Передано в ремонт", count: funnel.repairReached, conversion: funnel.workOrderToRepairPct, route: () => navigateCrm("Виробництво") });
    stages.push({ key: "completed", label: "Роботу завершено", count: funnel.completed, conversion: funnel.repairToCompletedPct, route: () => navigateCrm("Планувальник", { status: "COMPLETED", date: to, scope: "day" }) });
    return stages;
  }, [funnel, from, to]);
  const funnelMax = Math.max(1, ...funnelStages.map((stage) => stage.count));

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · ЦЕНТР УПРАВЛІННЯ</p>
        <h1>Аналітика</h1>
        <span>Не просто графіки: показник → відхилення → причина → перехід до операційної роботи.</span>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>↻ {loading ? "Оновлюю" : "Оновити"}</button>
    </header>

    <nav className={styles.tabs} aria-label="Розділи аналітики">
      <button type="button" className={tab === "overview" ? styles.tabActive : ""} onClick={() => setTab("overview")}>Загальне</button>
      <button type="button" className={tab === "funnel" ? styles.tabActive : ""} onClick={() => setTab("funnel")}>Воронка</button>
      <button type="button" className={tab === "workshop" ? styles.tabActive : ""} onClick={() => setTab("workshop")}>СТО / Виробництво</button>
      <span className={styles.nextModules}>Далі: Діагностика · Фінанси · Запчастини · Персонал · Клієнти · Канали</span>
    </nav>

    <section className={styles.filters}>
      <div className={styles.presets}>
        {(["today", "7d", "30d", "month", "year", "custom"] as Preset[]).map((item) => <button key={item} type="button" className={preset === item ? styles.activePreset : ""} onClick={() => applyPreset(item)}>{item === "today" ? "Сьогодні" : item === "7d" ? "7 днів" : item === "30d" ? "30 днів" : item === "month" ? "Місяць" : item === "year" ? "Рік" : "Період"}</button>)}
      </div>
      <label><span>Від</span><input type="date" value={from} max={to} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); }} /></label>
      <label><span>До</span><input type="date" value={to} min={from} onChange={(event) => { setPreset("custom"); setTo(event.target.value); }} /></label>
      {(data?.locations?.length || 0) > 0 && <label className={styles.location}><span>Станція</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Уся доступна мережа</option>{data!.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
      {data?.range.previousFrom && data?.range.previousTo && <div className={styles.compare}><small>Порівнюємо з</small><b>{data.range.previousFrom} — {data.range.previousTo}</b></div>}
    </section>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !data && <div className={styles.state}>Завантажую показники…</div>}
    {data?.emptyScope && <div className={styles.state}>Для Вашої ролі немає доступної станції для аналітики.</div>}

    {data && !data.emptyScope && tab === "overview" && <>
      <section className={styles.kpis}>
        <KpiCard label="Виручка" value={data.permissions?.financial ? money(kpi?.grossRevenue) : "Обмежено"} hint="фіналізовані ЗН" current={kpi?.grossRevenue} previous={previous?.grossRevenue} />
        <KpiCard label="Валовий прибуток" value={data.permissions?.financial ? money(kpi?.grossProfit) : "Обмежено"} hint={data.permissions?.financial ? `маржа ${percent(kpi?.grossMarginPct)}` : "немає фінансового доступу"} current={kpi?.grossProfit} previous={previous?.grossProfit} />
        <KpiCard label="Середній чек" value={data.permissions?.financial ? money(kpi?.averageCheck) : "Обмежено"} hint={`${kpi?.closedWorkOrders || 0} закритих ЗН`} current={kpi?.averageCheck} previous={previous?.averageCheck} onClick={() => navigateCrm("Замовлення-наряди", { status: "CLOSED" })} />
        <KpiCard label="Авто приїхало" value={number(kpi?.arrivedVehicles)} hint={`конверсія запис → візит ${percent(kpi?.bookingToArrivalPct)}`} current={kpi?.arrivedVehicles} previous={previous?.arrivedVehicles} onClick={() => navigateCrm("Планувальник", { date: to, scope: "day" })} />
        <KpiCard label="Зараз у роботі" value={number(kpi?.activeNow)} hint="оперативний стан зараз" onClick={() => navigateCrm("Виробництво")} tone="good" />
        <KpiCard label="Готово до видачі" value={number(kpi?.readyNow)} hint="можна завершувати клієнта" onClick={() => navigateCrm("Замовлення-наряди", { status: "READY_FOR_PICKUP" })} tone="good" />
        <KpiCard label="Завантаження постів" value={percent(kpi?.postUtilizationPct)} hint={`${data.utilization?.activePosts || 0} активних постів`} current={kpi?.postUtilizationPct} previous={previous?.postUtilizationPct} onClick={() => setTab("workshop")} />
        <KpiCard label="Прострочені авто" value={number(kpi?.overdueNow)} hint="плановий час уже минув" onClick={() => setTab("workshop")} tone={(kpi?.overdueNow || 0) > 0 ? "danger" : "good"} />
      </section>

      <section className={styles.alertRail}>
        <button type="button" onClick={() => navigateCrm("Планувальник", { status: "NO_SHOW", date: to, scope: "day" })}><span>No-show за період</span><b>{funnel?.noShow || 0}</b></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "WAITING_APPROVAL" })}><span>Очікують погодження</span><b>{operations?.waitingApprovalNow || 0}</b></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "WAITING_PARTS" })}><span>Очікують запчастини</span><b>{operations?.waitingPartsNow || 0}</b></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><span>Безпосередньо в ремонті</span><b>{operations?.inRepairNow || 0}</b></button>
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <header><div><small>ВОРОНКА</small><h2>Шлях клієнта</h2></div><button type="button" className={styles.linkButton} onClick={() => setTab("funnel")}>Детально →</button></header>
          {funnel?.lead && <div className={styles.funnelRow}><span>Ліди → запис</span><b>{funnel.lead.leads} → {funnel.lead.booked}</b><strong>{percent(funnel.lead.conversionPct)}</strong></div>}
          {!funnel?.lead && <p className={styles.note}>Для вибраної станції починаємо воронку із записів: у ліда поки немає власного locationId, тому не підмішуємо неточні дані.</p>}
          <div className={styles.funnelRow}><span>Запис → візит</span><b>{funnel?.scheduled || 0} → {funnel?.arrived || 0}</b><strong>{percent(funnel?.bookingToArrivalPct)}</strong></div>
          <div className={styles.funnelRow}><span>Візит → діагностика</span><b>{funnel?.arrived || 0} → {funnel?.diagnosticsReached || 0}</b><strong>{percent(funnel?.arrivalToDiagnosticsPct)}</strong></div>
          <div className={styles.funnelRow}><span>Ремонт → завершено</span><b>{funnel?.repairReached || 0} → {funnel?.completed || 0}</b><strong>{percent(funnel?.repairToCompletedPct)}</strong></div>
        </section>

        <section className={styles.panel}>
          <header><div><small>СТО ЗАРАЗ</small><h2>Операційний пульс</h2></div><button type="button" className={styles.linkButton} onClick={() => setTab("workshop")}>Детально →</button></header>
          <div className={styles.liveGrid}>
            <div><small>У роботі</small><b>{operations?.activeNow || 0}</b></div>
            <div><small>У ремонті</small><b>{operations?.inRepairNow || 0}</b></div>
            <div><small>Запчастини</small><b>{operations?.waitingPartsNow || 0}</b></div>
            <div><small>Погодження</small><b>{operations?.waitingApprovalNow || 0}</b></div>
            <div><small>До видачі</small><b>{operations?.readyNow || 0}</b></div>
            <div className={(operations?.overdueNow || 0) ? styles.liveDanger : ""}><small>Прострочено</small><b>{operations?.overdueNow || 0}</b></div>
          </div>
          <div className={styles.progressBlock}><div><span>Завантаження постів</span><b>{percent(data.utilization?.utilizationPct)}</b></div><MiniProgress value={data.utilization?.utilizationPct || 0} /></div>
        </section>
      </div>

      {data.permissions?.financial && data.finance && <section className={styles.panel}>
        <header><div><small>ЕКОНОМІКА</small><h2>Фіналізовані замовлення</h2></div><span>{data.finance.finalizedOrders} ЗН з ACTUAL snapshot</span></header>
        <div className={styles.financeCards}>
          <div><small>Виручка</small><strong>{money(data.finance.grossRevenue)}</strong><DeltaBadge current={data.finance.grossRevenue} previous={previous?.grossRevenue} /></div>
          <div><small>Валовий прибуток</small><strong>{money(data.finance.grossProfit)}</strong><DeltaBadge current={data.finance.grossProfit} previous={previous?.grossProfit} /></div>
          <div><small>Середній чек</small><strong>{money(data.finance.averageCheck)}</strong><DeltaBadge current={data.finance.averageCheck} previous={previous?.averageCheck} /></div>
          <div><small>Маржа</small><strong>{percent(data.finance.grossMarginPct)}</strong><DeltaBadge current={data.finance.grossMarginPct} previous={previous?.grossMarginPct} /></div>
        </div>
      </section>}

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <header><div><small>ДИНАМІКА</small><h2>Закриті ЗН за днями</h2></div><span>{from} — {to}</span></header>
          {(data.trend?.length || 0) === 0 ? <p className={styles.note}>У вибраному періоді ще немає закритих ЗН.</p> : <div className={styles.trend}>{data.trend!.map((row) => <div className={styles.trendRow} key={row.date}><time>{dateLabel(row.date)}</time><div className={styles.barTrack}><i style={{ width: `${Math.max(3, (Math.max(row.closed, (row.revenue || 0) / 1000) / maxTrend) * 100)}%` }} /></div><b>{row.closed} ЗН</b>{data.permissions?.financial && <span>{money(row.revenue)}</span>}</div>)}</div>}
        </section>
        <section className={styles.panel}>
          <header><div><small>КЛІЄНТИ</small><h2>Повернення клієнтів</h2></div><strong>{percent(data.retention?.repeatClientPct)}</strong></header>
          <div className={styles.retentionRing} style={{ "--value": `${Math.min(100, data.retention?.repeatClientPct || 0) * 3.6}deg` } as CSSProperties}><div><strong>{data.retention?.returningClients || 0}</strong><span>повторних</span></div></div>
          <p className={styles.note}>{data.retention?.returningClients || 0} із {data.retention?.servedClients || 0} клієнтів, обслугованих у вибраному періоді, вже мали закритий ЗН раніше.</p>
        </section>
      </div>
    </>}

    {data && !data.emptyScope && tab === "funnel" && <>
      <section className={styles.sectionIntro}>
        <div><p className={styles.eyebrow}>КОНВЕРСІЯ</p><h2>Воронка від звернення до завершеного ремонту</h2><span>На кожному кроці видно кількість, конверсію та місце втрати.</span></div>
        <button type="button" className={styles.secondaryButton} onClick={() => navigateCrm("Планувальник", { status: "NO_SHOW", date: to, scope: "day" })}>No-show: {funnel?.noShow || 0} →</button>
      </section>

      <section className={styles.funnelSummary}>
        <article><small>Звернень</small><strong>{funnel?.lead ? number(funnel.lead.leads) : "—"}</strong><span>{funnel?.lead ? "глобальна воронка" : "не атрибутуємо до станції"}</span></article>
        <article><small>Запис → візит</small><strong>{percent(funnel?.bookingToArrivalPct)}</strong><span>{funnel?.scheduled || 0} → {funnel?.arrived || 0}</span></article>
        <article><small>Запис → завершено</small><strong>{percent(funnel?.bookingToCompletedPct)}</strong><span>{funnel?.scheduled || 0} → {funnel?.completed || 0}</span></article>
        <article className={(funnel?.noShow || 0) ? styles.summaryDanger : ""}><small>No-show</small><strong>{funnel?.noShow || 0}</strong><span>втрачені візити</span></article>
      </section>

      <section className={styles.panel}>
        <header><div><small>ЕТАПИ</small><h2>Де губимо клієнта</h2></div><span>натисни на етап, щоб перейти в робочий модуль</span></header>
        <div className={styles.funnelFlow}>
          {funnelStages.map((stage, index) => {
            const previousStage = index > 0 ? funnelStages[index - 1] : null;
            const lost = previousStage ? Math.max(0, previousStage.count - stage.count) : 0;
            return <div className={styles.funnelStageWrap} key={stage.key}>
              {index > 0 && <div className={styles.stageLoss}><span>↓ {stage.conversion == null ? "—" : percent(stage.conversion)}</span>{lost > 0 && <b>−{lost}</b>}</div>}
              <button type="button" className={styles.funnelStage} style={{ width: `${Math.max(42, (stage.count / funnelMax) * 100)}%` }} onClick={stage.route} disabled={!stage.route}>
                <span>{stage.label}</span><strong>{stage.count}</strong>{stage.route && <small>відкрити →</small>}
              </button>
            </div>;
          })}
        </div>
      </section>

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <header><div><small>КОНВЕРСІЇ</small><h2>Між етапами</h2></div></header>
          <div className={styles.conversionList}>
            <div><span>Запис → візит</span><b>{percent(funnel?.bookingToArrivalPct)}</b></div>
            <div><span>Візит → діагностика</span><b>{percent(funnel?.arrivalToDiagnosticsPct)}</b></div>
            <div><span>Діагностика → ЗН</span><b>{percent(funnel?.diagnosticsToWorkOrderPct)}</b></div>
            <div><span>ЗН → ремонт</span><b>{percent(funnel?.workOrderToRepairPct)}</b></div>
            <div><span>Ремонт → завершено</span><b>{percent(funnel?.repairToCompletedPct)}</b></div>
          </div>
        </section>
        <section className={styles.panel}>
          <header><div><small>ПРИНЦИП</small><h2>Що вважаємо етапом</h2></div></header>
          <p className={styles.noteStrong}>Воронка не будується з вигаданих оцінок. Етап зараховується лише тоді, коли в CRM є відповідний факт: запис, факт прибуття, статус діагностики, прив’язаний ЗН, перехід у ремонт або завершення.</p>
          {!funnel?.lead && <p className={styles.note}>Ліди не показуємо для окремої станції, поки Lead не має locationId. Це навмисний захист від хибної конверсії.</p>}
        </section>
      </div>
    </>}

    {data && !data.emptyScope && tab === "workshop" && <>
      <section className={styles.sectionIntro}>
        <div><p className={styles.eyebrow}>СТО / ВИРОБНИЦТВО</p><h2>Що відбувається на станції прямо зараз</h2><span>Завантаження, вузькі місця, прострочення та ефективність постів.</span></div>
        <button type="button" className={styles.secondaryButton} onClick={() => navigateCrm("Виробництво")}>Відкрити виробництво →</button>
      </section>

      <section className={styles.liveCards}>
        <button type="button" onClick={() => navigateCrm("Виробництво")}><small>У роботі зараз</small><strong>{operations?.activeNow || 0}</strong><span>усі активні авто</span></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><small>У ремонті</small><strong>{operations?.inRepairNow || 0}</strong><span>на виконанні</span></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "WAITING_PARTS" })}><small>Чекають запчастини</small><strong>{operations?.waitingPartsNow || 0}</strong><span>ризик простою</span></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "WAITING_APPROVAL" })}><small>Чекають погодження</small><strong>{operations?.waitingApprovalNow || 0}</strong><span>потрібна дія менеджера</span></button>
        <button type="button" onClick={() => navigateCrm("Замовлення-наряди", { status: "READY_FOR_PICKUP" })}><small>Готово до видачі</small><strong>{operations?.readyNow || 0}</strong><span>можна закривати</span></button>
        <button type="button" className={(operations?.overdueNow || 0) ? styles.liveCardDanger : ""}><small>Прострочено</small><strong>{operations?.overdueNow || 0}</strong><span>плановий час минув</span></button>
      </section>

      <div className={styles.twoColumnsWide}>
        <section className={styles.panel}>
          <header><div><small>ПОСТИ</small><h2>Завантаження потужностей</h2></div><strong>{percent(data.utilization?.utilizationPct)}</strong></header>
          <div className={styles.postList}>
            {(data.utilization?.posts || []).length === 0 ? <p className={styles.note}>Активних постів у вибраному контурі немає.</p> : data.utilization!.posts.map((post) => <div className={styles.postRow} key={post.postId}>
              <div className={styles.postTitle}><span><b>{post.name}</b><small>{post.locationName}</small></span><strong>{percent(post.utilizationPct)}</strong></div>
              <MiniProgress value={post.utilizationPct} />
              <div className={styles.postMeta}><span>{post.appointments} записів</span><span>{hours(post.bookedMinutes)} зайнято</span><span>{hours(post.capacityMinutes)} доступно</span></div>
            </div>)}
          </div>
        </section>

        <section className={styles.panel}>
          <header><div><small>ЦИКЛ</small><h2>Швидкість роботи СТО</h2></div></header>
          <div className={styles.cycleCards}>
            <div><small>Середній цикл авто</small><strong>{durationLabel(operations?.averageCycleMinutes)}</strong><span>від фактичного прибуття до завершення</span></div>
            <div><small>Вчасно завершено</small><strong>{percent(operations?.onTimeCompletedPct)}</strong><span>{operations?.timedCompleted || 0} авто з фактичним завершенням</span></div>
            <div><small>Планова потужність</small><strong>{hours(data.utilization?.capacityMinutes)}</strong><span>за вибраний період</span></div>
            <div><small>Зайнято постів</small><strong>{hours(data.utilization?.bookedMinutes)}</strong><span>планове бронювання</span></div>
          </div>
          {(operations?.liveStatusBreakdown || []).length > 0 && <div className={styles.statusCloud}>{operations!.liveStatusBreakdown.map((row) => <span key={row.status}>{row.label} <b>{row.count}</b></span>)}</div>}
        </section>
      </div>

      <div className={styles.twoColumns}>
        <section className={styles.panel}>
          <header><div><small>ЗАТРИМКИ</small><h2>Чому авто прострочені</h2></div><strong>{operations?.overdueNow || 0}</strong></header>
          {(operations?.delayReasons || []).length === 0 ? <p className={styles.note}>Зараз немає прострочених активних авто — чудовий стан.</p> : <div className={styles.reasonList}>{operations!.delayReasons.map((reason) => <div key={reason.code}><div><span>{reason.label}</span><b>{reason.count}</b></div><div className={styles.reasonTrack}><i style={{ width: `${Math.max(6, (reason.count / maxDelay) * 100)}%` }} /></div></div>)}</div>}
        </section>
        <section className={styles.panel}>
          <header><div><small>УВАГА</small><h2>Прострочені авто</h2></div><span>клік відкриває запис</span></header>
          {(operations?.overdue || []).length === 0 ? <p className={styles.note}>Список порожній.</p> : <div className={styles.overdueList}>{operations!.overdue.map((item) => <button key={item.appointmentId} type="button" onClick={() => navigateCrm("Планувальник", { appointmentId: item.appointmentId, date: dateKeyFromIso(item.plannedStartAt), scope: "day" })}>
            <div><strong>{item.vehicleLabel}</strong><span>{item.plateNumber || item.customerName}</span></div>
            <div><b>{item.statusLabel}</b><span>план до {dateTimeLabel(item.plannedEndAt)}</span></div>
            <em>+{durationLabel(item.delayMinutes)}</em>
          </button>)}</div>}
        </section>
      </div>

      {data.permissions?.personnel && <section className={styles.panel}>
        <header><div><small>КОМАНДА</small><h2>Продуктивність механіків</h2></div><span>за завершеними LABOR-рядками</span></header>
        {(data.mechanics?.length || 0) === 0 ? <p className={styles.note}>У вибраному періоді немає завершених робіт із призначеним механіком.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Механік</th><th>Робіт</th><th>ЗН</th><th>Нормогодини</th><th>Факт. год</th><th>Ефективність</th></tr></thead><tbody>{data.mechanics!.map((row) => <tr key={row.mechanicId}><td>{row.name}</td><td>{row.completedJobs}</td><td>{row.workOrders}</td><td>{row.normHours}</td><td>{row.actualHours}</td><td><strong>{row.efficiencyPct == null ? "—" : percent(row.efficiencyPct)}</strong></td></tr>)}</tbody></table></div>}
      </section>}
    </>}
  </div>;
}
