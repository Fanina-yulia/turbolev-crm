"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-dashboard.module.css";

const KYIV_TZ = "Europe/Kyiv";

type AnalyticsData = {
  ok: boolean;
  error?: string;
  emptyScope?: boolean;
  range: { from: string; to: string; timezone: string; days: number; previousFrom?: string; previousTo?: string };
  locations: Array<{ id: string; name: string }>;
  permissions?: { financial: boolean; personnel: boolean };
  kpi?: {
    grossRevenue: number | null; grossProfit: number | null; bookingToArrivalPct: number; averageCheck: number | null;
    grossMarginPct: number | null; postUtilizationPct: number; repeatClientPct: number; closedWorkOrders: number;
    arrivedVehicles: number; completedVehicles: number; activeNow: number; readyNow: number; overdueNow: number;
  };
  previous?: {
    grossRevenue: number | null; grossProfit: number | null; averageCheck: number | null; grossMarginPct: number | null;
    bookingToArrivalPct: number; postUtilizationPct: number; closedWorkOrders: number; arrivedVehicles: number;
    completedVehicles: number; leads: number | null;
  };
  funnel?: {
    lead: null | { leads: number; booked: number; conversionPct: number };
    scheduled: number; arrived: number; diagnosticsReached: number; workOrderLinked: number; repairReached: number;
    completed: number; noShow: number; bookingToArrivalPct: number; arrivalToDiagnosticsPct: number;
    diagnosticsToWorkOrderPct: number; workOrderToRepairPct: number; repairToCompletedPct: number; bookingToCompletedPct: number;
  };
  finance?: null | { grossRevenue: number; grossProfit: number; grossMarginPct: number; averageCheck: number; finalizedOrders: number };
  utilization?: {
    bookedMinutes: number; capacityMinutes: number; utilizationPct: number; activePosts: number;
    posts: Array<{ postId: string; name: string; locationId: string; locationName: string; appointments: number; bookedMinutes: number; capacityMinutes: number; utilizationPct: number }>;
  };
  retention?: { servedClients: number; returningClients: number; repeatClientPct: number };
  operations?: {
    activeNow: number; inRepairNow: number; waitingPartsNow: number; waitingApprovalNow: number; readyNow: number;
    overdueNow: number; averageCycleMinutes: number; onTimeCompletedPct: number; timedCompleted: number;
    liveStatusBreakdown: Array<{ status: string; label: string; count: number }>;
    delayReasons: Array<{ code: string; label: string; count: number }>;
    overdue: Array<{ appointmentId: string; customerName: string; vehicleLabel: string; plateNumber: string | null; status: string; statusLabel: string; plannedStartAt: string; plannedEndAt: string; delayMinutes: number }>;
  };
  mechanics?: Array<{ mechanicId: string; name: string; completedJobs: number; workOrders: number; normHours: number; actualHours: number; efficiencyPct: number | null }>;
  trend?: Array<{ date: string; closed: number; revenue: number | null; grossProfit: number | null }>;
};

type DiagnosticAnalytics = {
  ok: boolean; permitted: boolean; emptyScope?: boolean; error?: string;
  diagnostics: null | {
    created: number; confirmed: number; completed: number; convertedToWorkOrder: number; conversionPct: number; averageInspectionMinutes: number;
    checks: { checked: number; ok: number; attention: number; defect: number; critical: number };
    topIssues: Array<{ name: string; attention: number; defect: number; total: number }>;
    topSuggestedParts: Array<{ name: string; count: number }>;
    topSuggestedWorks: Array<{ name: string; count: number }>;
    daily: Array<{ date: string; created: number; completed: number; issues: number }>;
  };
};

type FinanceAnalytics = {
  ok: boolean; permitted: boolean; emptyScope?: boolean; error?: string;
  finance: null | {
    hasFinancialData: boolean;
    pnl: { revenue: number; cogs: number; grossProfit: number; grossMarginPct: number | null; opex: number; operatingProfit: number; otherIncome: number; otherExpense: number; tax: number; netProfit: number; netMarginPct: number | null };
    cashFlow: { inflow: number; outflow: number; net: number; operating: number; investing: number; financing: number };
    workingCapital: { receivables: number; payables: number; overdueReceivables: number; overduePayables: number };
    orderEconomics: {
      finalizedOrders: number; grossRevenue: number; grossProfit: number; grossMarginPct: number; averageCheck: number;
      revenueMix: { labor: number; parts: number; external: number; other: number };
      costMix: { parts: number; labor: number; external: number; consumables: number; other: number };
    };
    counts: { postedEvents: number; postedCashTransactions: number; openObligations: number; activeMoneyAccounts: number };
  };
};

type PartsAnalytics = {
  ok: boolean; permitted: boolean; financial: boolean; emptyScope?: boolean; error?: string;
  parts: null | {
    requests: number; items: number; requestedQty: number; receivedQty: number; installedQty: number; pendingRequiredQty: number;
    overdueEtaItems: number; averageSupplyHours: number; purchaseValue: number | null; installedRevenue: number | null;
    installedProfit: number | null; installedMarginPct: number | null; stockLedgerAvailable: boolean;
    statusBreakdown: Array<{ status: string; label: string; count: number }>;
    topItems: Array<{ name: string; article: string | null; brand: string | null; requestedQty: number; receivedQty: number; installedQty: number; revenue: number | null; profit: number | null }>;
    suppliers: Array<{ supplierId: string; name: string; requests: number; items: number; requestedQty: number; receivedQty: number; fulfillmentPct: number; purchaseValue: number | null }>;
  };
};

type Preset = "today" | "7d" | "30d" | "month" | "year" | "custom";
type AnalyticsTab = "overview" | "funnel" | "workshop" | "diagnostics" | "finance" | "parts";

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
function number(value: number | null | undefined, digits = 0) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits }).format(value || 0);
}
function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function hoursFromMinutes(minutes: number | null | undefined) {
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
function supplyTime(hours: number | null | undefined) {
  const value = Math.max(0, hours || 0);
  if (!value) return "—";
  if (value >= 24) return `${number(value / 24, 1)} д`;
  return `${number(value, 1)} год`;
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
function paramsFor(from: string, to: string, locationId: string) {
  const params = new URLSearchParams({ from, to });
  if (locationId) params.set("locationId", locationId);
  return params.toString();
}

function DeltaBadge({ current, previous, invert = false }: { current: number | null | undefined; previous: number | null | undefined; invert?: boolean }) {
  const delta = deltaValue(current, previous);
  if (delta == null) return <span className={styles.deltaNeutral}>новий період</span>;
  const positive = invert ? delta <= 0 : delta >= 0;
  return <span className={positive ? styles.deltaGood : styles.deltaBad}>{delta > 0 ? "↑" : delta < 0 ? "↓" : "•"} {Math.abs(delta).toFixed(1)}%</span>;
}

function KpiCard({ label, value, hint, current, previous, onClick, tone = "default" }: {
  label: string; value: string; hint: string; current?: number | null; previous?: number | null; onClick?: () => void;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const className = `${styles.kpiCard} ${styles[`tone_${tone}`]} ${onClick ? styles.kpiClickable : ""}`;
  const content = <>
    <div className={styles.kpiTop}><small>{label}</small>{current !== undefined && <DeltaBadge current={current} previous={previous} />}</div>
    <strong>{value}</strong><span>{hint}</span>
  </>;
  return onClick ? <button type="button" className={className} onClick={onClick}>{content}</button> : <article className={className}>{content}</article>;
}
function MiniProgress({ value, danger = false }: { value: number; danger?: boolean }) {
  return <div className={`${styles.miniProgress} ${danger ? styles.progressDanger : ""}`}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
function Restricted({ text }: { text: string }) {
  return <div className={styles.state}>{text}</div>;
}
function LoadingDetail() { return <div className={styles.state}>Завантажую детальну аналітику…</div>; }
function PanelTitle({ eyebrow, title, right }: { eyebrow: string; title: string; right?: React.ReactNode }) {
  return <header><div><small>{eyebrow}</small><h2>{title}</h2></div>{right}</header>;
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [diagnostics, setDiagnostics] = useState<DiagnosticAnalytics | null>(null);
  const [finance, setFinance] = useState<FinanceAnalytics | null>(null);
  const [parts, setParts] = useState<PartsAnalytics | null>(null);

  const loadCore = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/analytics?${paramsFor(from, to, locationId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити аналітику");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити аналітику");
    } finally { setLoading(false); }
  }, [from, to, locationId]);

  const loadDetail = useCallback(async (target: AnalyticsTab = tab) => {
    if (!["diagnostics", "finance", "parts"].includes(target)) return;
    setDetailLoading(true); setDetailError("");
    try {
      const endpoint = target === "diagnostics" ? "diagnostics" : target === "finance" ? "finance" : "parts";
      const response = await fetch(`/api/analytics/${endpoint}?${paramsFor(from, to, locationId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити деталізацію");
      if (target === "diagnostics") setDiagnostics(payload);
      if (target === "finance") setFinance(payload);
      if (target === "parts") setParts(payload);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : "Не вдалося завантажити деталізацію");
    } finally { setDetailLoading(false); }
  }, [tab, from, to, locationId]);

  useEffect(() => { void loadCore(); }, [loadCore]);
  useEffect(() => { if (["diagnostics", "finance", "parts"].includes(tab)) void loadDetail(tab); }, [tab, loadDetail]);

  const refresh = async () => { await loadCore(); if (["diagnostics", "finance", "parts"].includes(tab)) await loadDetail(tab); };
  const applyPreset = (next: Preset) => {
    setPreset(next); if (next === "custom") return;
    const range = presetRange(next); setFrom(range.from); setTo(range.to);
  };

  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend || []).map((row) => Math.max(row.closed, (row.revenue || 0) / 1000))), [data?.trend]);
  const maxDelay = useMemo(() => Math.max(1, ...(data?.operations?.delayReasons || []).map((row) => row.count)), [data?.operations?.delayReasons]);
  const kpi = data?.kpi; const previous = data?.previous; const operations = data?.operations; const funnel = data?.funnel;
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
      <div><p className={styles.eyebrow}>TURBO LEV · ЦЕНТР УПРАВЛІННЯ</p><h1>Аналітика</h1><span>Показник → відхилення → причина → конкретна операційна дія.</span></div>
      <button type="button" className={styles.refresh} onClick={() => void refresh()} disabled={loading || detailLoading}>↻ {loading || detailLoading ? "Оновлюю" : "Оновити"}</button>
    </header>

    <nav className={styles.tabs} aria-label="Розділи аналітики">
      {([[
        "overview", "Загальне"], ["funnel", "Воронка"], ["workshop", "СТО / Виробництво"], ["diagnostics", "Діагностика"], ["finance", "Фінанси"], ["parts", "Запчастини"
      ]] as Array<[AnalyticsTab, string]>).flat().map(() => null)}
      {(["overview", "funnel", "workshop", "diagnostics", "finance", "parts"] as AnalyticsTab[]).map((item) => {
        const labels: Record<AnalyticsTab, string> = { overview: "Загальне", funnel: "Воронка", workshop: "СТО / Виробництво", diagnostics: "Діагностика", finance: "Фінанси", parts: "Запчастини" };
        return <button key={item} type="button" className={tab === item ? styles.tabActive : ""} onClick={() => setTab(item)}>{labels[item]}</button>;
      })}
      <span className={styles.nextModules}>Далі: Персонал · Клієнти · Канали · Якість</span>
    </nav>

    <section className={styles.filters}>
      <div className={styles.presets}>{(["today", "7d", "30d", "month", "year", "custom"] as Preset[]).map((item) => <button key={item} type="button" className={preset === item ? styles.activePreset : ""} onClick={() => applyPreset(item)}>{item === "today" ? "Сьогодні" : item === "7d" ? "7 днів" : item === "30d" ? "30 днів" : item === "month" ? "Місяць" : item === "year" ? "Рік" : "Період"}</button>)}</div>
      <label><span>Від</span><input type="date" value={from} max={to} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); }} /></label>
      <label><span>До</span><input type="date" value={to} min={from} onChange={(event) => { setPreset("custom"); setTo(event.target.value); }} /></label>
      {(data?.locations?.length || 0) > 0 && <label className={styles.location}><span>Станція</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Уся доступна мережа</option>{data!.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
      {data?.range.previousFrom && data?.range.previousTo && <div className={styles.compare}><small>Порівнюємо з</small><b>{data.range.previousFrom} — {data.range.previousTo}</b></div>}
    </section>

    {error && <div className={styles.error}>{error}</div>}
    {detailError && <div className={styles.error}>{detailError}</div>}
    {loading && !data && <div className={styles.state}>Завантажую показники…</div>}
    {data?.emptyScope && <Restricted text="Для Вашої ролі немає доступної станції для аналітики." />}

    {data && !data.emptyScope && tab === "overview" && <>
      <section className={styles.kpis}>
        <KpiCard label="Виручка" value={data.permissions?.financial ? money(kpi?.grossRevenue) : "Обмежено"} hint="фіналізовані ЗН" current={kpi?.grossRevenue} previous={previous?.grossRevenue} onClick={() => setTab("finance")} />
        <KpiCard label="Валовий прибуток" value={data.permissions?.financial ? money(kpi?.grossProfit) : "Обмежено"} hint={data.permissions?.financial ? `маржа ${percent(kpi?.grossMarginPct)}` : "немає фінансового доступу"} current={kpi?.grossProfit} previous={previous?.grossProfit} onClick={() => setTab("finance")} />
        <KpiCard label="Середній чек" value={data.permissions?.financial ? money(kpi?.averageCheck) : "Обмежено"} hint={`${kpi?.closedWorkOrders || 0} закритих ЗН`} current={kpi?.averageCheck} previous={previous?.averageCheck} onClick={() => navigateCrm("Замовлення-наряди", { status: "CLOSED" })} />
        <KpiCard label="Авто приїхало" value={number(kpi?.arrivedVehicles)} hint={`запис → візит ${percent(kpi?.bookingToArrivalPct)}`} current={kpi?.arrivedVehicles} previous={previous?.arrivedVehicles} onClick={() => navigateCrm("Планувальник", { date: to, scope: "day" })} />
        <KpiCard label="Зараз у роботі" value={number(kpi?.activeNow)} hint="оперативний стан" onClick={() => navigateCrm("Виробництво")} tone="good" />
        <KpiCard label="Готово до видачі" value={number(kpi?.readyNow)} hint="можна завершувати" onClick={() => navigateCrm("Замовлення-наряди", { status: "READY_FOR_PICKUP" })} tone="good" />
        <KpiCard label="Завантаження постів" value={percent(kpi?.postUtilizationPct)} hint={`${data.utilization?.activePosts || 0} активних постів`} current={kpi?.postUtilizationPct} previous={previous?.postUtilizationPct} onClick={() => setTab("workshop")} />
        <KpiCard label="Прострочені авто" value={number(kpi?.overdueNow)} hint="плановий час минув" onClick={() => setTab("workshop")} tone={(kpi?.overdueNow || 0) > 0 ? "danger" : "good"} />
      </section>
      <section className={styles.alertRail}>
        <button type="button" onClick={() => navigateCrm("Планувальник", { status: "NO_SHOW", date: to, scope: "day" })}><span>No-show</span><b>{funnel?.noShow || 0}</b></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "WAITING_APPROVAL" })}><span>Погодження</span><b>{operations?.waitingApprovalNow || 0}</b></button>
        <button type="button" onClick={() => navigateCrm("Закупівлі та склад", { scope: "ordered" })}><span>Очікують запчастини</span><b>{operations?.waitingPartsNow || 0}</b></button>
        <button type="button" onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><span>У ремонті</span><b>{operations?.inRepairNow || 0}</b></button>
      </section>
      <div className={styles.twoColumns}>
        <section className={styles.panel}><PanelTitle eyebrow="ВОРОНКА" title="Шлях клієнта" right={<button className={styles.linkButton} onClick={() => setTab("funnel")}>Детально →</button>} />
          {funnel?.lead && <div className={styles.funnelRow}><span>Ліди → запис</span><b>{funnel.lead.leads} → {funnel.lead.booked}</b><strong>{percent(funnel.lead.conversionPct)}</strong></div>}
          <div className={styles.funnelRow}><span>Запис → візит</span><b>{funnel?.scheduled || 0} → {funnel?.arrived || 0}</b><strong>{percent(funnel?.bookingToArrivalPct)}</strong></div>
          <div className={styles.funnelRow}><span>Візит → діагностика</span><b>{funnel?.arrived || 0} → {funnel?.diagnosticsReached || 0}</b><strong>{percent(funnel?.arrivalToDiagnosticsPct)}</strong></div>
          <div className={styles.funnelRow}><span>Ремонт → завершено</span><b>{funnel?.repairReached || 0} → {funnel?.completed || 0}</b><strong>{percent(funnel?.repairToCompletedPct)}</strong></div>
        </section>
        <section className={styles.panel}><PanelTitle eyebrow="СТО ЗАРАЗ" title="Операційний пульс" right={<button className={styles.linkButton} onClick={() => setTab("workshop")}>Детально →</button>} />
          <div className={styles.liveGrid}><div><small>У роботі</small><b>{operations?.activeNow || 0}</b></div><div><small>У ремонті</small><b>{operations?.inRepairNow || 0}</b></div><div><small>Запчастини</small><b>{operations?.waitingPartsNow || 0}</b></div><div><small>Погодження</small><b>{operations?.waitingApprovalNow || 0}</b></div><div><small>До видачі</small><b>{operations?.readyNow || 0}</b></div><div className={(operations?.overdueNow || 0) ? styles.liveDanger : ""}><small>Прострочено</small><b>{operations?.overdueNow || 0}</b></div></div>
          <div className={styles.progressBlock}><div><span>Завантаження постів</span><b>{percent(data.utilization?.utilizationPct)}</b></div><MiniProgress value={data.utilization?.utilizationPct || 0} /></div>
        </section>
      </div>
      <div className={styles.twoColumns}>
        <section className={styles.panel}><PanelTitle eyebrow="ДИНАМІКА" title="Закриті ЗН за днями" right={<span>{from} — {to}</span>} />
          {(data.trend?.length || 0) === 0 ? <p className={styles.note}>У періоді ще немає закритих ЗН.</p> : <div className={styles.trend}>{data.trend!.map((row) => <div className={styles.trendRow} key={row.date}><time>{dateLabel(row.date)}</time><div className={styles.barTrack}><i style={{ width: `${Math.max(3, (Math.max(row.closed, (row.revenue || 0) / 1000) / maxTrend) * 100)}%` }} /></div><b>{row.closed} ЗН</b>{data.permissions?.financial && <span>{money(row.revenue)}</span>}</div>)}</div>}
        </section>
        <section className={styles.panel}><PanelTitle eyebrow="КЛІЄНТИ" title="Повторні клієнти" />
          <div className={styles.bigStat}><strong>{percent(data.retention?.repeatClientPct)}</strong><span>{data.retention?.returningClients || 0} повторних із {data.retention?.servedClients || 0} обслугованих у періоді</span></div>
        </section>
      </div>
    </>}

    {data && !data.emptyScope && tab === "funnel" && <>
      <div className={styles.sectionIntro}><div><h2>Воронка</h2><span>Де саме губляться клієнти між зверненням і завершеним ремонтом.</span></div><button className={styles.secondaryButton} onClick={() => navigateCrm("Ліди")}>Відкрити ліди →</button></div>
      <section className={styles.funnelSummary}><article><small>Записів</small><strong>{funnel?.scheduled || 0}</strong><span>за період</span></article><article><small>Приїхало</small><strong>{funnel?.arrived || 0}</strong><span>{percent(funnel?.bookingToArrivalPct)}</span></article><article><small>Завершено</small><strong>{funnel?.completed || 0}</strong><span>{percent(funnel?.bookingToCompletedPct)} від записів</span></article><article className={(funnel?.noShow || 0) ? styles.summaryDanger : ""}><small>No-show</small><strong>{funnel?.noShow || 0}</strong><span>втрачений візит</span></article></section>
      <div className={styles.twoColumnsWide}><section className={styles.panel}><PanelTitle eyebrow="КОНВЕРСІЯ" title="Повний шлях" />
        <div className={styles.funnelFlow}>{funnelStages.map((stage, index) => { const previousStage = index > 0 ? funnelStages[index - 1] : null; const loss = previousStage ? Math.max(0, previousStage.count - stage.count) : 0; return <div className={styles.funnelStageWrap} key={stage.key}>{previousStage && <div className={styles.stageLoss}><span>↓ {stage.conversion == null ? "—" : percent(stage.conversion)}</span><b>{loss ? `−${loss}` : "без втрат"}</b></div>}<button type="button" className={styles.funnelStage} disabled={!stage.route} onClick={stage.route} style={{ width: `${Math.max(44, (stage.count / funnelMax) * 100)}%` }}><span>{stage.label}</span><strong>{stage.count}</strong><small>{stage.route ? "натисніть, щоб відкрити" : "верх воронки"}</small></button></div>; })}</div>
      </section><section className={styles.panel}><PanelTitle eyebrow="ПЕРЕХОДИ" title="Конверсія етапів" /><div className={styles.conversionList}><div><span>Запис → візит</span><b>{percent(funnel?.bookingToArrivalPct)}</b></div><div><span>Візит → діагностика</span><b>{percent(funnel?.arrivalToDiagnosticsPct)}</b></div><div><span>Діагностика → ЗН</span><b>{percent(funnel?.diagnosticsToWorkOrderPct)}</b></div><div><span>ЗН → ремонт</span><b>{percent(funnel?.workOrderToRepairPct)}</b></div><div><span>Ремонт → завершено</span><b>{percent(funnel?.repairToCompletedPct)}</b></div><div><span>Запис → завершено</span><b>{percent(funnel?.bookingToCompletedPct)}</b></div></div></section></div>
    </>}

    {data && !data.emptyScope && tab === "workshop" && <>
      <div className={styles.sectionIntro}><div><h2>СТО / Виробництво</h2><span>Поточний стан, завантаження постів, цикл авто і причини затримок.</span></div><button className={styles.secondaryButton} onClick={() => navigateCrm("Виробництво")}>Відкрити виробництво →</button></div>
      <section className={styles.liveCards}><button onClick={() => navigateCrm("Виробництво")}><small>У роботі</small><strong>{operations?.activeNow || 0}</strong><span>усі активні</span></button><button onClick={() => navigateCrm("Виробництво", { status: "IN_REPAIR" })}><small>У ремонті</small><strong>{operations?.inRepairNow || 0}</strong><span>зараз</span></button><button onClick={() => navigateCrm("Закупівлі та склад", { scope: "ordered" })}><small>Чекають запчастини</small><strong>{operations?.waitingPartsNow || 0}</strong><span>блокер</span></button><button onClick={() => navigateCrm("Виробництво", { status: "WAITING_APPROVAL" })}><small>Погодження</small><strong>{operations?.waitingApprovalNow || 0}</strong><span>клієнт / калькуляція</span></button><button onClick={() => navigateCrm("Замовлення-наряди", { status: "READY_FOR_PICKUP" })}><small>До видачі</small><strong>{operations?.readyNow || 0}</strong><span>готові</span></button><button className={(operations?.overdueNow || 0) ? styles.liveCardDanger : ""}><small>Прострочено</small><strong>{operations?.overdueNow || 0}</strong><span>потребує уваги</span></button></section>
      <div className={styles.twoColumnsWide}><section className={styles.panel}><PanelTitle eyebrow="ПОСТИ" title="Завантаження" right={<strong>{percent(data.utilization?.utilizationPct)}</strong>} /><div className={styles.postList}>{(data.utilization?.posts || []).map((post) => <div className={styles.postRow} key={post.postId}><div className={styles.postTitle}><span><b>{post.name}</b><small>{post.locationName}</small></span><strong>{percent(post.utilizationPct)}</strong></div><MiniProgress value={post.utilizationPct} /><div className={styles.postMeta}><span>{post.appointments} записів</span><span>{hoursFromMinutes(post.bookedMinutes)} зайнято</span><span>{hoursFromMinutes(post.capacityMinutes)} доступно</span></div></div>)}</div></section>
        <section className={styles.panel}><PanelTitle eyebrow="ШВИДКІСТЬ" title="Цикл автомобіля" /><div className={styles.cycleCards}><div><small>Середній цикл</small><strong>{durationLabel(operations?.averageCycleMinutes)}</strong><span>від фактичного прибуття до завершення</span></div><div><small>Вчасно завершено</small><strong>{percent(operations?.onTimeCompletedPct)}</strong><span>{operations?.timedCompleted || 0} авто з фактичним часом</span></div></div><div className={styles.statusCloud}>{(operations?.liveStatusBreakdown || []).map((row) => <span key={row.status}>{row.label} <b>{row.count}</b></span>)}</div></section></div>
      <div className={styles.twoColumns}><section className={styles.panel}><PanelTitle eyebrow="ЗАТРИМКИ" title="Причини прострочень" /><div className={styles.reasonList}>{(operations?.delayReasons || []).length === 0 ? <p className={styles.note}>Активних прострочень немає.</p> : operations!.delayReasons.map((row) => <div key={row.code}><div><span>{row.label}</span><b>{row.count}</b></div><div className={styles.reasonTrack}><i style={{ width: `${(row.count / maxDelay) * 100}%` }} /></div></div>)}</div></section>
        <section className={styles.panel}><PanelTitle eyebrow="КОНТРОЛЬ" title="Прострочені авто" /><div className={styles.overdueList}>{(operations?.overdue || []).length === 0 ? <p className={styles.note}>Немає прострочених активних автомобілів.</p> : operations!.overdue.map((row) => <button key={row.appointmentId} type="button" onClick={() => navigateCrm("Планувальник", { appointmentId: row.appointmentId, date: dateKeyFromIso(row.plannedStartAt), scope: "day" })}><div><strong>{row.vehicleLabel}</strong><span>{row.plateNumber || row.customerName}</span></div><div><b>{row.statusLabel}</b><span>план до {dateTimeLabel(row.plannedEndAt)}</span></div><em>+{durationLabel(row.delayMinutes)}</em></button>)}</div></section></div>
      {data.permissions?.personnel && <section className={styles.panel}><PanelTitle eyebrow="КОМАНДА" title="Продуктивність механіків" right={<span>нормогодини / фактичний час</span>} /><div className={styles.tableWrap}><table><thead><tr><th>Механік</th><th>Робіт</th><th>ЗН</th><th>Нормогодини</th><th>Факт. год</th><th>Ефективність</th></tr></thead><tbody>{(data.mechanics || []).map((row) => <tr key={row.mechanicId}><td>{row.name}</td><td>{row.completedJobs}</td><td>{row.workOrders}</td><td>{row.normHours}</td><td>{row.actualHours}</td><td><strong>{percent(row.efficiencyPct)}</strong></td></tr>)}</tbody></table></div></section>}
    </>}

    {tab === "diagnostics" && <>
      <div className={styles.sectionIntro}><div><h2>Діагностика</h2><span>Скільки перевірок виконано, що знаходять найчастіше і скільки діагностик переходить у ремонт.</span></div><button className={styles.secondaryButton} onClick={() => navigateCrm("Діагностика")}>Відкрити діагностику →</button></div>
      {detailLoading && !diagnostics && <LoadingDetail />}
      {diagnostics && !diagnostics.permitted && <Restricted text="Для Вашої ролі недоступна деталізація діагностики." />}
      {diagnostics?.permitted && diagnostics.diagnostics && (() => { const d = diagnostics.diagnostics; const issueCount = d.checks.attention + d.checks.defect; const issuePct = d.checks.checked ? (issueCount / d.checks.checked) * 100 : 0; return <>
        <section className={styles.kpisSix}><KpiCard label="Діагностик" value={number(d.created)} hint="створено за період" onClick={() => navigateCrm("Діагностика")} /><KpiCard label="Завершено" value={number(d.completed)} hint={`${d.confirmed} підтверджено`} /><KpiCard label="Зауважень" value={number(issueCount)} hint={`${percent(issuePct)} перевірених пунктів`} tone={issueCount ? "warn" : "good"} /><KpiCard label="Критичних" value={number(d.checks.critical)} hint="urgency CRITICAL" tone={d.checks.critical ? "danger" : "good"} /><KpiCard label="Діагностика → ЗН" value={percent(d.conversionPct)} hint={`${d.convertedToWorkOrder} ЗН створено`} onClick={() => navigateCrm("Замовлення-наряди")} /><KpiCard label="Середній час" value={durationLabel(d.averageInspectionMinutes)} hint="старт → завершення" /></section>
        <section className={styles.checkBand}><div><small>Перевірено пунктів</small><b>{d.checks.checked}</b></div><div className={styles.okStat}><small>Норма</small><b>{d.checks.ok}</b></div><div className={styles.warnStat}><small>Увага</small><b>{d.checks.attention}</b></div><div className={styles.dangerStat}><small>Дефект</small><b>{d.checks.defect}</b></div></section>
        <div className={styles.twoColumnsWide}><section className={styles.panel}><PanelTitle eyebrow="ТОП НЕСПРАВНОСТЕЙ" title="Що знаходимо найчастіше" /><div className={styles.tableWrap}><table><thead><tr><th>Вузол / деталь</th><th>Увага</th><th>Дефект</th><th>Всього</th></tr></thead><tbody>{d.topIssues.length ? d.topIssues.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.attention}</td><td>{row.defect}</td><td><strong>{row.total}</strong></td></tr>) : <tr><td colSpan={4}>Зауважень у періоді немає.</td></tr>}</tbody></table></div></section>
          <section className={styles.panel}><PanelTitle eyebrow="ДИНАМІКА" title="Діагностики по днях" /><div className={styles.compactSeries}>{d.daily.length ? d.daily.map((row) => { const max = Math.max(1, ...d.daily.map((x) => Math.max(x.created, x.completed, x.issues))); return <div key={row.date}><time>{dateLabel(row.date)}</time><div><span>Створено {row.created}</span><MiniProgress value={(row.created / max) * 100} /></div><div><span>Завершено {row.completed}</span><MiniProgress value={(row.completed / max) * 100} /></div><div><span>Зауважень {row.issues}</span><MiniProgress value={(row.issues / max) * 100} danger /></div></div>; }) : <p className={styles.note}>Немає даних за днями.</p>}</div></section></div>
        <div className={styles.twoColumns}><section className={styles.panel}><PanelTitle eyebrow="ЗАПЧАСТИНИ" title="Що діагностика рекомендує" /><div className={styles.rankList}>{d.topSuggestedParts.length ? d.topSuggestedParts.map((row, i) => <div key={row.name}><span><i>{i + 1}</i>{row.name}</span><b>{row.count}</b></div>) : <p className={styles.note}>Рекомендованих деталей ще немає.</p>}</div></section><section className={styles.panel}><PanelTitle eyebrow="РОБОТИ" title="Що рекомендують виконати" /><div className={styles.rankList}>{d.topSuggestedWorks.length ? d.topSuggestedWorks.map((row, i) => <div key={row.name}><span><i>{i + 1}</i>{row.name}</span><b>{row.count}</b></div>) : <p className={styles.note}>Рекомендованих робіт ще немає.</p>}</div></section></div>
      </>; })()}
    </>}

    {tab === "finance" && <>
      <div className={styles.sectionIntro}><div><h2>Фінанси</h2><span>P&amp;L, cash flow, оборотний капітал і фактична економіка закритих замовлень.</span></div><button className={styles.secondaryButton} onClick={() => navigateCrm("Фінанси")}>Відкрити фінанси →</button></div>
      {detailLoading && !finance && <LoadingDetail />}
      {finance && !finance.permitted && <Restricted text="Фінансові показники приховані для Вашої ролі." />}
      {finance?.permitted && !finance.finance && <Restricted text="Для вибраної станції фінансових даних немає." />}
      {finance?.permitted && finance.finance && (() => { const f = finance.finance; return <>
        <section className={styles.kpisSix}><KpiCard label="Доходи P&L" value={money(f.pnl.revenue)} hint="проведені фінансові події" /><KpiCard label="Валовий прибуток" value={money(f.pnl.grossProfit)} hint={`маржа ${percent(f.pnl.grossMarginPct)}`} /><KpiCard label="Чистий прибуток" value={money(f.pnl.netProfit)} hint={`чиста маржа ${percent(f.pnl.netMarginPct)}`} tone={f.pnl.netProfit >= 0 ? "good" : "danger"} /><KpiCard label="Грошовий потік" value={money(f.cashFlow.net)} hint={`${money(f.cashFlow.inflow)} вхід / ${money(f.cashFlow.outflow)} вихід`} tone={f.cashFlow.net >= 0 ? "good" : "warn"} /><KpiCard label="Дебіторка" value={money(f.workingCapital.receivables)} hint={`прострочено ${money(f.workingCapital.overdueReceivables)}`} tone={f.workingCapital.overdueReceivables ? "warn" : "default"} /><KpiCard label="Кредиторка" value={money(f.workingCapital.payables)} hint={`прострочено ${money(f.workingCapital.overduePayables)}`} tone={f.workingCapital.overduePayables ? "danger" : "default"} /></section>
        <div className={styles.twoColumnsWide}><section className={styles.panel}><PanelTitle eyebrow="P&L" title="Прибутки та витрати" /><div className={styles.pnlList}><div><span>Доходи</span><b>{money(f.pnl.revenue)}</b></div><div><span>− Собівартість</span><b>{money(f.pnl.cogs)}</b></div><div className={styles.pnlStrong}><span>= Валовий прибуток</span><b>{money(f.pnl.grossProfit)}</b></div><div><span>− Операційні витрати</span><b>{money(f.pnl.opex)}</b></div><div><span>= Операційний прибуток</span><b>{money(f.pnl.operatingProfit)}</b></div><div><span>Інші доходи / витрати</span><b>{money(f.pnl.otherIncome - f.pnl.otherExpense)}</b></div><div><span>− Податки</span><b>{money(f.pnl.tax)}</b></div><div className={`${styles.pnlStrong} ${f.pnl.netProfit < 0 ? styles.pnlNegative : ""}`}><span>= Чистий прибуток</span><b>{money(f.pnl.netProfit)}</b></div></div></section>
          <section className={styles.panel}><PanelTitle eyebrow="ЗН · ACTUAL" title="Економіка замовлень" /><div className={styles.financeCards}><div><small>Фіналізовано ЗН</small><strong>{f.orderEconomics.finalizedOrders}</strong></div><div><small>Виручка</small><strong>{money(f.orderEconomics.grossRevenue)}</strong></div><div><small>Середній чек</small><strong>{money(f.orderEconomics.averageCheck)}</strong></div><div><small>Валова маржа</small><strong>{percent(f.orderEconomics.grossMarginPct)}</strong></div></div><p className={styles.note}>Цей блок рахується тільки з ACTUAL finance snapshot закритих ЗН вибраного періоду.</p></section></div>
        <div className={styles.twoColumns}><section className={styles.panel}><PanelTitle eyebrow="СТРУКТУРА ВИРУЧКИ" title="За типом доходу" /><MixRows rows={[{ label: "Роботи", value: f.orderEconomics.revenueMix.labor }, { label: "Запчастини", value: f.orderEconomics.revenueMix.parts }, { label: "Зовнішні роботи", value: f.orderEconomics.revenueMix.external }, { label: "Інше", value: f.orderEconomics.revenueMix.other }]} /></section><section className={styles.panel}><PanelTitle eyebrow="ПРЯМІ ВИТРАТИ" title="За типом собівартості" /><MixRows rows={[{ label: "Запчастини", value: f.orderEconomics.costMix.parts }, { label: "Праця", value: f.orderEconomics.costMix.labor }, { label: "Зовнішні", value: f.orderEconomics.costMix.external }, { label: "Матеріали", value: f.orderEconomics.costMix.consumables }, { label: "Інше", value: f.orderEconomics.costMix.other }]} /></section></div>
        <div className={styles.twoColumns}><section className={styles.panel}><PanelTitle eyebrow="CASH FLOW" title="Рух грошей" /><div className={styles.cashGrid}><div><small>Надходження</small><b>{money(f.cashFlow.inflow)}</b></div><div><small>Вибуття</small><b>{money(f.cashFlow.outflow)}</b></div><div><small>Операційний</small><b>{money(f.cashFlow.operating)}</b></div><div><small>Інвестиційний</small><b>{money(f.cashFlow.investing)}</b></div><div><small>Фінансовий</small><b>{money(f.cashFlow.financing)}</b></div><div><small>Чистий потік</small><b>{money(f.cashFlow.net)}</b></div></div></section><section className={styles.panel}><PanelTitle eyebrow="ОБОРОТНИЙ КАПІТАЛ" title="Борги та зобов'язання" /><div className={styles.cashGrid}><div><small>Дебіторка</small><b>{money(f.workingCapital.receivables)}</b></div><div><small>Прострочена дебіторка</small><b>{money(f.workingCapital.overdueReceivables)}</b></div><div><small>Кредиторка</small><b>{money(f.workingCapital.payables)}</b></div><div><small>Прострочена кредиторка</small><b>{money(f.workingCapital.overduePayables)}</b></div></div></section></div>
      </>; })()}
    </>}

    {tab === "parts" && <>
      <div className={styles.sectionIntro}><div><h2>Запчастини / Закупівлі</h2><span>Що замовляємо, що затримується, що встановлюємо і які постачальники реально закривають потребу.</span></div><button className={styles.secondaryButton} onClick={() => navigateCrm("Закупівлі та склад")}>Відкрити закупівлі →</button></div>
      {detailLoading && !parts && <LoadingDetail />}
      {parts && !parts.permitted && <Restricted text="Для Вашої ролі недоступна аналітика закупівель і запчастин." />}
      {parts?.permitted && parts.parts && (() => { const p = parts.parts; return <>
        <section className={styles.kpisSix}><KpiCard label="Заявок" value={number(p.requests)} hint={`${p.items} позицій`} onClick={() => navigateCrm("Закупівлі та склад")} /><KpiCard label="Запитано" value={number(p.requestedQty, 1)} hint="одиниць за позиціями" /><KpiCard label="Отримано" value={number(p.receivedQty, 1)} hint={`${percent(p.requestedQty ? (p.receivedQty / p.requestedQty) * 100 : 0)} від запитаного`} /><KpiCard label="Встановлено" value={number(p.installedQty, 1)} hint="фактично на авто" tone="good" /><KpiCard label="Не вистачає для ремонту" value={number(p.pendingRequiredQty, 1)} hint="requiredForRepair" tone={p.pendingRequiredQty ? "warn" : "good"} /><KpiCard label="ETA прострочено" value={number(p.overdueEtaItems)} hint={`середня поставка ${supplyTime(p.averageSupplyHours)}`} tone={p.overdueEtaItems ? "danger" : "good"} /></section>
        {parts.financial && <section className={styles.financeCardsWide}><div><small>Закуплено / отримано</small><strong>{money(p.purchaseValue)}</strong></div><div><small>Виручка встановлених</small><strong>{money(p.installedRevenue)}</strong></div><div><small>Прибуток встановлених</small><strong>{money(p.installedProfit)}</strong></div><div><small>Маржа встановлених</small><strong>{percent(p.installedMarginPct)}</strong></div></section>}
        <div className={styles.twoColumnsWide}><section className={styles.panel}><PanelTitle eyebrow="РУХ ЗАПИТІВ" title="Статуси закупівель" /><div className={styles.statusPipeline}>{p.statusBreakdown.length ? p.statusBreakdown.map((row) => <button key={row.status} type="button" onClick={() => navigateCrm("Закупівлі та склад")}><span>{row.label}</span><b>{row.count}</b></button>) : <p className={styles.note}>У періоді заявок немає.</p>}</div></section><section className={styles.panel}><PanelTitle eyebrow="ПОСТАЧАННЯ" title="Контроль строків" /><div className={styles.bigStat}><strong>{supplyTime(p.averageSupplyHours)}</strong><span>середній час від «Замовлено» до «Отримано»</span></div><div className={styles.inlineWarnings}><span>Прострочених ETA <b>{p.overdueEtaItems}</b></span><span>Не отримано для ремонту <b>{number(p.pendingRequiredQty, 1)}</b></span></div></section></div>
        <section className={styles.panel}><PanelTitle eyebrow="РЕЙТИНГ ЗАПЧАСТИН" title="Що реально проходить через СТО" right={<span>за встановленою кількістю</span>} /><div className={styles.tableWrap}><table><thead><tr><th>Запчастина</th><th>Артикул</th><th>Запитано</th><th>Отримано</th><th>Встановлено</th>{parts.financial && <><th>Виручка</th><th>Прибуток</th></>}</tr></thead><tbody>{p.topItems.length ? p.topItems.map((row) => <tr key={`${row.article || ""}-${row.name}`}><td>{row.name}</td><td>{row.article || "—"}</td><td>{number(row.requestedQty, 1)}</td><td>{number(row.receivedQty, 1)}</td><td><strong>{number(row.installedQty, 1)}</strong></td>{parts.financial && <><td>{money(row.revenue)}</td><td>{money(row.profit)}</td></>}</tr>) : <tr><td colSpan={parts.financial ? 7 : 5}>Даних ще немає.</td></tr>}</tbody></table></div></section>
        <section className={styles.panel}><PanelTitle eyebrow="ПОСТАЧАЛЬНИКИ" title="Хто закриває потребу" /><div className={styles.tableWrap}><table><thead><tr><th>Постачальник</th><th>Заявок</th><th>Позицій</th><th>Запитано</th><th>Отримано</th><th>Виконання</th>{parts.financial && <th>Закупівля</th>}</tr></thead><tbody>{p.suppliers.length ? p.suppliers.map((row) => <tr key={row.supplierId}><td>{row.name}</td><td>{row.requests}</td><td>{row.items}</td><td>{number(row.requestedQty, 1)}</td><td>{number(row.receivedQty, 1)}</td><td><strong>{percent(row.fulfillmentPct)}</strong></td>{parts.financial && <td>{money(row.purchaseValue)}</td>}</tr>) : <tr><td colSpan={parts.financial ? 7 : 6}>Постачальники ще не прив'язані до позицій.</td></tr>}</tbody></table></div></section>
        {!p.stockLedgerAvailable && <div className={styles.infoBanner}><strong>Мертвий склад поки не рахуємо.</strong><span>У CRM ще немає повноцінного реєстру складських залишків і руху. Показувати «залежані запчастини 30/60/90 днів» зараз означало б вигадувати дані. Цей KPI додамо після складського ledger.</span></div>}
      </>; })()}
    </>}
  </div>;
}

function MixRows({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  return <div className={styles.mixRows}>{rows.map((row) => <div key={row.label}><div><span>{row.label}</span><b>{money(row.value)}</b></div><MiniProgress value={total > 0 ? (Math.max(0, row.value) / total) * 100 : 0} /></div>)}</div>;
}
