"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./owner-dashboard-visual.module.css";
import pipelineStyles from "./owner-dashboard-pipeline.module.css";

export type OwnerPeriodKey = "TODAY" | "7D" | "30D" | "90D" | "YEAR";

type AnalyticsVisualPayload = {
  range?: { from: string; to: string; days: number };
  kpi?: {
    grossRevenue: number | null;
    grossProfit: number | null;
    bookingToArrivalPct: number;
    averageCheck: number | null;
    grossMarginPct: number | null;
    postUtilizationPct: number;
    repeatClientPct: number;
    activeNow: number;
    readyNow: number;
    overdueNow: number;
  };
  previous?: {
    grossRevenue: number | null;
    grossProfit: number | null;
    bookingToArrivalPct: number;
    grossMarginPct: number | null;
    postUtilizationPct: number;
  };
  operations?: {
    activeNow: number;
    inRepairNow: number;
    waitingPartsNow: number;
    waitingApprovalNow: number;
    readyNow: number;
    overdueNow: number;
    delayReasons: Array<{ code: string; label: string; count: number }>;
  };
  funnel?: { noShow: number };
  trend?: Array<{ date: string; closed: number; revenue: number | null; grossProfit: number | null }>;
};

type Props = {
  analytics: AnalyticsVisualPayload | null;
  period: OwnerPeriodKey;
  onPeriodChange: (period: OwnerPeriodKey) => void;
  loading?: boolean;
};

type Tone = "orange" | "green" | "red" | "neutral";
type ChartRow = { label: string; value: number; tone: Tone; formatted?: string; detail?: string };

type PaymentRow = {
  outstanding: number;
  paid: number;
  overdue: boolean;
  flags: { due: boolean; partial: boolean; debt: boolean; paidToday: boolean };
};

type PaymentsPayload = { ok?: boolean; rows?: PaymentRow[] };
type MarginApprovalRow = { workOrderId?: string; revenue?: number; grossMarginPercent?: number; warningMarginPercent?: number };
type MarginApprovalsPayload = { ok?: boolean; pending?: MarginApprovalRow[] };
type AttentionItem = { id?: string; issues?: Array<{ code: string }> };
type DashboardPayload = {
  ok?: boolean;
  blockers?: { approval?: number; waitingParts?: number; noShow?: number };
  attention?: AttentionItem[];
};

type OwnerFactsPayload = {
  ok?: boolean;
  pipeline?: {
    currency: string | null;
    mixedCurrency: boolean;
    total: number | null;
    scheduledAmount: number;
    scheduledCount: number;
    diagnosticsAmount: number;
    diagnosticsCount: number;
    approvedAmount: number;
    approvedCount: number;
    pendingApprovalAmount: number | null;
    pendingApprovalCount: number;
    openWorkOrders: number;
    unpricedCount: number;
  } | null;
  directRevenue?: {
    current: number;
    previous: number;
    count: number;
    averageCheck: number | null;
    trend: Array<{ date: string; amount: number }>;
  } | null;
  retention?: {
    servedClients: number;
    returningClients: number;
    repeatClientPct: number | null;
  } | null;
  dataQuality?: {
    pipelineUnpricedCount: number;
    waitingPaymentUnpricedCount: number;
  } | null;
};

type OwnerControlSnapshot = {
  receivables: {
    total: number;
    count: number;
    due: number;
    dueCount: number;
    partial: number;
    partialCount: number;
    debt: number;
    debtCount: number;
  };
  decisions: { total: number; margin: number; marginRevenue: number; warranty: number; paused: number };
  risk: { noShow: number; paused: number };
};

const EMPTY_CONTROL: OwnerControlSnapshot = {
  receivables: { total: 0, count: 0, due: 0, dueCount: 0, partial: 0, partialCount: 0, debt: 0, debtCount: 0 },
  decisions: { total: 0, margin: 0, marginRevenue: 0, warranty: 0, paused: 0 },
  risk: { noShow: 0, paused: 0 },
};

const EMPTY_FACTS: OwnerFactsPayload = {
  pipeline: null,
  directRevenue: null,
  retention: null,
  dataQuality: null,
};

const PERIODS: Array<{ key: OwnerPeriodKey; label: string }> = [
  { key: "TODAY", label: "Сьогодні" },
  { key: "7D", label: "7 днів" },
  { key: "30D", label: "30 днів" },
  { key: "90D", label: "90 днів" },
  { key: "YEAR", label: "Рік" },
];

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

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function relativeDelta(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function DeltaLabel({ current, previous, invert = false }: { current: number | null | undefined; previous: number | null | undefined; invert?: boolean }) {
  const value = relativeDelta(current, previous);
  if (value == null) return <span className={styles.deltaNeutral}>поточний період</span>;
  const good = invert ? value <= 0 : value >= 0;
  return <span className={good ? styles.deltaGood : styles.deltaBad}>{value > 0 ? "↑" : value < 0 ? "↓" : "•"} {Math.abs(value).toFixed(1)}% <small>до попереднього</small></span>;
}

function compactDate(value: string | undefined, withYear = false) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(date);
}

function rangeLabel(range: AnalyticsVisualPayload["range"]) {
  if (!range) return "Поточний період";
  if (range.days <= 1) return compactDate(range.from);
  const crossesYear = range.from.slice(0, 4) !== range.to.slice(0, 4);
  return `${compactDate(range.from, crossesYear)} — ${compactDate(range.to, crossesYear)}`;
}

function chartValues(values: Array<number | null | undefined>) {
  const clean = values.map((value) => Number.isFinite(Number(value)) ? Number(value) : 0);
  return clean.length ? clean : [0];
}

function Sparkline({ values, tone = "orange", area = false }: { values: Array<number | null | undefined>; tone?: Tone; area?: boolean }) {
  const data = chartValues(values);
  const width = 180;
  const height = 54;
  const pad = 4;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(1, max - min);
  const pointList = data.map((value, index) => {
    const x = data.length === 1 ? width / 2 : pad + (index / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return { x, y };
  });
  const points = pointList.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const polygon = area && points ? `${pad},${height - pad} ${points} ${width - pad},${height - pad}` : "";
  return <svg className={`${styles.sparkline} ${styles[`tone${tone}`]}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    {area && <polygon points={polygon} className={styles.sparkArea} />}
    <polyline points={points} fill="none" className={styles.sparkLine} />
    {pointList.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="2.2" className={styles.sparkDot} />)}
  </svg>;
}

function MiniBars({ values, tone = "orange" }: { values: Array<number | null | undefined>; tone?: Tone }) {
  const data = chartValues(values);
  const max = Math.max(...data.map((value) => Math.abs(value)), 1);
  return <div className={`${styles.miniBars} ${styles[`tone${tone}`]}`} aria-hidden="true">
    {data.map((value, index) => <i key={index} style={{ height: `${Math.max(8, Math.abs(value) / max * 100)}%` }} />)}
  </div>;
}

function Gauge({ value, tone = "orange", label }: { value: number | null | undefined; tone?: Tone; label?: string }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const accent = tone === "green" ? "var(--owner-green)" : tone === "red" ? "var(--owner-red)" : tone === "neutral" ? "var(--owner-muted)" : "var(--owner-orange)";
  return <div className={styles.gaugeWrap} aria-hidden="true">
    <div className={styles.gauge} style={{ background: `conic-gradient(${accent} ${safe * 3.6}deg, var(--owner-chart-track) 0deg)` }}>
      <div><strong>{percent(value)}</strong>{label && <small>{label}</small>}</div>
    </div>
  </div>;
}

function MetricIcon({ children, tone = "orange" }: { children: string; tone?: Tone }) {
  return <span className={`${styles.metricIcon} ${styles[`icon${tone}`]}`} aria-hidden="true">{children}</span>;
}

function TrendMetricCard({ title, value, icon, values, previous, current, onClick, chart = "line", tone = "orange", subtitle, invertDelta = false }: {
  title: string; value: string; icon: string; values: Array<number | null | undefined>; previous?: number | null; current?: number | null;
  onClick: () => void; chart?: "line" | "bars"; tone?: Tone; subtitle?: string; invertDelta?: boolean;
}) {
  return <button type="button" className={styles.metricCard} onClick={onClick} aria-label={`${title}: ${value}`}>
    <div className={styles.metricHead}><MetricIcon tone={tone}>{icon}</MetricIcon><span>{title}</span><em>›</em></div>
    <strong>{value}</strong>
    {subtitle && <small className={styles.metricSubtitle}>{subtitle}</small>}
    <div className={styles.metricChart}>{chart === "bars" ? <MiniBars values={values} tone={tone} /> : <Sparkline values={values} tone={tone} area />}</div>
    <DeltaLabel current={current} previous={previous} invert={invertDelta} />
  </button>;
}

function GaugeMetricCard({ title, value, icon, gaugeValue, previous, current, onClick, tone = "orange", subtitle, gaugeLabel }: {
  title: string; value: string; icon: string; gaugeValue: number | null | undefined; previous?: number | null; current?: number | null;
  onClick: () => void; tone?: Tone; subtitle?: string; gaugeLabel?: string;
}) {
  return <button type="button" className={styles.metricCard} onClick={onClick} aria-label={`${title}: ${value}`}>
    <div className={styles.metricHead}><MetricIcon tone={tone}>{icon}</MetricIcon><span>{title}</span><em>›</em></div>
    <div className={styles.gaugeCardBody}>
      <div><strong>{value}</strong>{subtitle && <small className={styles.metricSubtitle}>{subtitle}</small>}</div>
      <Gauge value={gaugeValue} tone={tone} label={gaugeLabel} />
    </div>
    <DeltaLabel current={current} previous={previous} />
  </button>;
}

function RetentionMetricCard({ value, servedClients, onClick }: { value: number | null | undefined; servedClients: number; onClick: () => void }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return <button type="button" className={styles.metricCard} onClick={onClick} aria-label={`Повторні клієнти: ${percent(value)}`}>
    <div className={styles.metricHead}><MetricIcon>↻</MetricIcon><span>Повторні клієнти</span><em>›</em></div>
    <div className={styles.gaugeCardBody}>
      <div><strong>{percent(value)}</strong><small className={styles.metricSubtitle}>{servedClients > 0 ? `${servedClients} клієнтів у періоді` : "ще немає достатніх даних"}</small></div>
      <Gauge value={value} tone={safe > 0 ? "green" : "neutral"} label="повторні" />
    </div>
    <span className={styles.deltaNeutral}>факт за вибраний період</span>
  </button>;
}

function Tooltip({ row }: { row: ChartRow }) {
  return <span className={styles.chartTooltip}><strong>{row.label}</strong><b>{row.formatted ?? number(row.value)}</b>{row.detail && <small>{row.detail}</small>}</span>;
}

function InteractiveStackedBar({ rows }: { rows: ChartRow[] }) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  return <div className={styles.stackedWrap} aria-hidden="true">
    <div className={styles.stackedBar}>
      {total > 0 ? rows.map((row) => <span key={row.label} className={`${styles.stackSegment} ${styles[`stack${row.tone}`]}`} style={{ width: `${Math.max(3, row.value / total * 100)}%` }}><Tooltip row={row} /></span>) : <span className={`${styles.stackSegment} ${styles.stackneutral}`} style={{ width: "100%" }} />}
    </div>
    <div className={styles.stackLegend}>{rows.map((row) => <span key={row.label}><i className={styles[`dot${row.tone}`]} />{row.label}<b>{row.formatted ?? number(row.value)}</b></span>)}</div>
  </div>;
}

function InteractiveVerticalBars({ rows }: { rows: ChartRow[] }) {
  const max = Math.max(1, ...rows.map((row) => Math.max(0, row.value)));
  return <div className={styles.verticalBars} aria-hidden="true">
    {rows.map((row) => <div className={styles.verticalItem} key={row.label}>
      <div className={styles.verticalTrack}>
        <i className={styles[`vertical${row.tone}`]} style={{ height: `${row.value > 0 ? Math.max(12, row.value / max * 100) : 4}%` }}><Tooltip row={row} /></i>
      </div>
      <span>{row.label}</span>
      <b>{row.formatted ?? number(row.value)}</b>
    </div>)}
  </div>;
}

function BreakdownChart({ rows }: { rows: ChartRow[] }) {
  const max = Math.max(1, ...rows.map((row) => Math.max(0, row.value)));
  return <div className={styles.breakdownChart} aria-hidden="true">
    {rows.map((row) => <div className={styles.breakdownRow} key={row.label}>
      <span>{row.label}</span>
      <div className={styles.breakdownTrack}><i className={styles[`bar${row.tone}`]} style={{ width: `${row.value > 0 ? Math.max(5, row.value / max * 100) : 0}%` }} /><Tooltip row={row} /></div>
      <b>{row.formatted ?? number(row.value)}</b>
    </div>)}
  </div>;
}

function InteractiveDonut({ rows, total }: { rows: ChartRow[]; total: number }) {
  const [active, setActive] = useState<number | null>(null);
  const positiveRows = rows.filter((row) => row.value > 0);
  const safeTotal = Math.max(1, positiveRows.reduce((sum, row) => sum + row.value, 0));
  let offset = 0;
  const activeRow = active == null ? null : positiveRows[active] ?? null;
  return <div className={styles.donutLayout} aria-hidden="true" onMouseLeave={() => setActive(null)}>
    <div className={styles.donutShell}>
      <svg className={styles.donut} viewBox="0 0 100 100">
        <circle className={styles.donutTrack} cx="50" cy="50" r="38" pathLength="100" />
        {positiveRows.map((row, index) => {
          const share = row.value / safeTotal * 100;
          const dashOffset = -offset;
          offset += share;
          return <circle key={row.label} className={`${styles.donutSegment} ${styles[`donut${row.tone}`]} ${active === index ? styles.donutActive : ""}`} cx="50" cy="50" r="38" pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={dashOffset} onMouseEnter={() => setActive(index)} />;
        })}
      </svg>
      <div className={styles.donutCenter}><strong>{number(activeRow?.value ?? total)}</strong><span>{activeRow?.label ?? "ризики"}</span></div>
    </div>
    <div className={styles.donutLegend}>{rows.map((row) => <span key={row.label}><i className={styles[`dot${row.tone}`]} />{row.label}<b>{number(row.value)}</b></span>)}</div>
  </div>;
}

function sumRows(rows: PaymentRow[], predicate: (row: PaymentRow) => boolean) {
  return rows.filter(predicate).reduce((sum, row) => sum + Math.max(0, safeNumber(row.outstanding)), 0);
}

function issueCount(attention: AttentionItem[], code: string) {
  return attention.filter((item) => item.issues?.some((issue) => issue.code === code)).length;
}

export function OwnerDashboardVisual({ analytics, period, onPeriodChange, loading = false }: Props) {
  const [control, setControl] = useState<OwnerControlSnapshot>(EMPTY_CONTROL);
  const [facts, setFacts] = useState<OwnerFactsPayload>(EMPTY_FACTS);
  const [controlLoading, setControlLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadControl = async () => {
      setControlLoading(true);
      const factsQuery = analytics?.range
        ? `?from=${encodeURIComponent(analytics.range.from)}&to=${encodeURIComponent(analytics.range.to)}`
        : "";
      const responses = await Promise.allSettled([
        fetch("/api/payments", { cache: "no-store", credentials: "include" }),
        fetch("/api/finance/margin-approvals", { cache: "no-store", credentials: "include" }),
        fetch("/api/dashboard", { cache: "no-store", credentials: "include" }),
        fetch(`/api/analytics/owner-dashboard-facts${factsQuery}`, { cache: "no-store", credentials: "include" }),
      ]);
      if (cancelled) return;
      try {
        const payments = responses[0].status === "fulfilled" && responses[0].value.ok ? await responses[0].value.json() as PaymentsPayload : null;
        const margins = responses[1].status === "fulfilled" && responses[1].value.ok ? await responses[1].value.json() as MarginApprovalsPayload : null;
        const dashboard = responses[2].status === "fulfilled" && responses[2].value.ok ? await responses[2].value.json() as DashboardPayload : null;
        const ownerFacts = responses[3].status === "fulfilled" && responses[3].value.ok ? await responses[3].value.json() as OwnerFactsPayload : EMPTY_FACTS;
        const paymentRows = payments?.rows ?? [];
        const openRows = paymentRows.filter((row) => safeNumber(row.outstanding) > 0);
        const attention = dashboard?.attention ?? [];
        const marginRows = margins?.pending ?? [];
        const warranty = issueCount(attention, "WARRANTY_OPEN");
        const paused = issueCount(attention, "PAUSED_STALLED");
        setControl({
          receivables: {
            total: openRows.reduce((sum, row) => sum + Math.max(0, safeNumber(row.outstanding)), 0),
            count: openRows.length,
            due: sumRows(openRows, (row) => row.flags?.due),
            dueCount: openRows.filter((row) => row.flags?.due).length,
            partial: sumRows(openRows, (row) => row.flags?.partial),
            partialCount: openRows.filter((row) => row.flags?.partial).length,
            debt: sumRows(openRows, (row) => row.flags?.debt || row.overdue),
            debtCount: openRows.filter((row) => row.flags?.debt || row.overdue).length,
          },
          decisions: {
            total: marginRows.length + warranty + paused,
            margin: marginRows.length,
            marginRevenue: marginRows.reduce((sum, row) => sum + Math.max(0, safeNumber(row.revenue)), 0),
            warranty,
            paused,
          },
          risk: {
            noShow: Math.max(0, safeNumber(dashboard?.blockers?.noShow)),
            paused,
          },
        });
        setFacts(ownerFacts);
      } finally {
        if (!cancelled) setControlLoading(false);
      }
    };
    void loadControl();
    const onDataChanged = () => void loadControl();
    window.addEventListener("turbolev:data-changed", onDataChanged);
    const timer = window.setInterval(() => void loadControl(), 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("turbolev:data-changed", onDataChanged);
      window.clearInterval(timer);
    };
  }, [analytics?.range?.from, analytics?.range?.to]);

  const kpi = analytics?.kpi;
  const previous = analytics?.previous;
  const operations = analytics?.operations;
  const trend = analytics?.trend ?? [];
  const directRevenue = facts.directRevenue?.current ?? 0;
  const previousDirectRevenue = facts.directRevenue?.previous ?? 0;
  const displayedRevenue = kpi?.grossRevenue == null ? null : safeNumber(kpi.grossRevenue) + directRevenue;
  const displayedPreviousRevenue = previous?.grossRevenue == null ? null : safeNumber(previous.grossRevenue) + previousDirectRevenue;
  const revenueTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of trend) map.set(item.date, safeNumber(item.revenue));
    for (const item of facts.directRevenue?.trend ?? []) map.set(item.date, (map.get(item.date) || 0) + safeNumber(item.amount));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [trend, facts.directRevenue]);
  const profitTrend = trend.map((item) => item.grossProfit);
  const hasClosedOrderRevenue = safeNumber(kpi?.grossRevenue) > 0;
  const grossProfitForDisplay = hasClosedOrderRevenue && directRevenue === 0 ? kpi?.grossProfit : null;
  const grossMarginForDisplay = hasClosedOrderRevenue && directRevenue === 0 ? kpi?.grossMarginPct : null;
  const averageCheckForDisplay = hasClosedOrderRevenue && directRevenue === 0
    ? kpi?.averageCheck
    : facts.directRevenue?.averageCheck ?? null;
  const repeatClientPct = facts.retention?.repeatClientPct ?? null;
  const servedClients = facts.retention?.servedClients ?? 0;
  const overdue = operations?.overdueNow ?? 0;
  const delayReasons = operations?.delayReasons?.slice(0, 4) ?? [];
  const waitingApproval = operations?.waitingApprovalNow ?? 0;
  const noShow = Math.max(control.risk.noShow, analytics?.funnel?.noShow ?? 0);
  const revenueRiskCount = noShow + waitingApproval + control.risk.paused;
  const pipeline = facts.pipeline;
  const dataQuality = facts.dataQuality;

  const pipelineRows = useMemo<ChartRow[]>(() => [
    { label: "Заплановано", value: pipeline?.scheduledAmount ?? 0, tone: "orange", formatted: money(pipeline?.scheduledAmount ?? 0), detail: `${pipeline?.scheduledCount ?? 0} записів` },
    { label: "Діагностика", value: pipeline?.diagnosticsAmount ?? 0, tone: "neutral", formatted: money(pipeline?.diagnosticsAmount ?? 0), detail: `${pipeline?.diagnosticsCount ?? 0} авто` },
    { label: "Погоджено", value: pipeline?.approvedAmount ?? 0, tone: "green", formatted: money(pipeline?.approvedAmount ?? 0), detail: `${pipeline?.approvedCount ?? 0} робіт/позицій` },
  ], [pipeline]);

  const receivableRows = useMemo<ChartRow[]>(() => [
    { label: "До сплати", value: control.receivables.due, tone: "orange", formatted: money(control.receivables.due), detail: `${control.receivables.dueCount} оплат` },
    { label: "Частково", value: control.receivables.partial, tone: "neutral", formatted: money(control.receivables.partial), detail: `${control.receivables.partialCount} оплат` },
    { label: "Прострочено", value: control.receivables.debt, tone: "red", formatted: money(control.receivables.debt), detail: `${control.receivables.debtCount} боргів` },
  ], [control.receivables]);

  const decisionRows = useMemo<ChartRow[]>(() => [
    { label: "Низька маржа", value: control.decisions.margin, tone: "orange", detail: control.decisions.marginRevenue > 0 ? `${money(control.decisions.marginRevenue)} КП` : `${control.decisions.margin} КП` },
    { label: "Гарантія", value: control.decisions.warranty, tone: "red", detail: `${control.decisions.warranty} відкритих рішень` },
    { label: "Зупинені", value: control.decisions.paused, tone: "neutral", detail: `${control.decisions.paused} процесів` },
  ], [control.decisions]);

  const overdueRows = useMemo<ChartRow[]>(() => delayReasons.length
    ? delayReasons.map((row) => ({ label: row.label, value: row.count, tone: "red", detail: `${row.count} прострочених процесів` }))
    : [{ label: "Без критичних прострочень", value: 0, tone: "neutral", detail: "SLA у нормі" }], [delayReasons]);

  const riskRows = useMemo<ChartRow[]>(() => [
    { label: "No-show", value: noShow, tone: "red", detail: `${noShow} клієнтів не приїхали` },
    { label: "Погодження", value: waitingApproval, tone: "orange", detail: `${waitingApproval} очікують рішення` },
    { label: "Зупинені", value: control.risk.paused, tone: "neutral", detail: `${control.risk.paused} процесів на паузі` },
  ], [noShow, waitingApproval, control.risk.paused]);

  return <section className={styles.visualDashboard} aria-label="Ключова аналітика власника">
    <div className={styles.periodRow}>
      <div className={styles.periodTabs} role="group" aria-label="Період аналітики">
        {PERIODS.map((item) => <button key={item.key} type="button" aria-pressed={period === item.key} className={period === item.key ? styles.periodActive : ""} onClick={() => onPeriodChange(item.key)}>{item.label}</button>)}
      </div>
      <span className={styles.rangeLabel}>{loading ? "Оновлюю…" : rangeLabel(analytics?.range)}</span>
    </div>

    <div className={styles.metricGrid}>
      <TrendMetricCard title="Виручка за період" value={money(displayedRevenue)} icon="₴" values={revenueTrend} current={displayedRevenue} previous={displayedPreviousRevenue} chart="line" subtitle={directRevenue > 0 ? `включно з ${money(directRevenue)} прямих оплат` : undefined} onClick={() => navigateCrm("Фінансовий центр")} />
      <TrendMetricCard title="Валовий прибуток" value={money(grossProfitForDisplay)} icon="▥" values={profitTrend} current={grossProfitForDisplay} previous={previous?.grossProfit} chart="bars" subtitle={grossProfitForDisplay == null ? "немає повних даних про собівартість" : undefined} onClick={() => navigateCrm("Фінансовий центр")} />
      <GaugeMetricCard title="Валова маржа" value={percent(grossMarginForDisplay)} icon="%" gaugeValue={grossMarginForDisplay} current={grossMarginForDisplay} previous={previous?.grossMarginPct} subtitle={`середній чек ${money(averageCheckForDisplay)}`} gaugeLabel="маржа" onClick={() => navigateCrm("Аналітика")} />
      <GaugeMetricCard title="Завантаження постів" value={percent(kpi?.postUtilizationPct)} icon="⌁" gaugeValue={kpi?.postUtilizationPct} current={kpi?.postUtilizationPct} previous={previous?.postUtilizationPct} gaugeLabel="зайнято" onClick={() => navigateCrm("Аналітика")} />
      <RetentionMetricCard value={repeatClientPct} servedClients={servedClients} onClick={() => navigateCrm("Аналітика")} />
      <GaugeMetricCard title="Запис → приїзд" value={percent(kpi?.bookingToArrivalPct)} icon="✓" gaugeValue={kpi?.bookingToArrivalPct} current={kpi?.bookingToArrivalPct} previous={previous?.bookingToArrivalPct} tone="green" gaugeLabel="конверсія" onClick={() => navigateCrm("Планувальник")} />
    </div>

    <div className={styles.controlSectionHead}>
      <div><span>КОНТРОЛЬ ВЛАСНИКА</span><strong>Гроші, рішення та ризики</strong></div>
      <small>{controlLoading ? "Оновлюю контрольні дані…" : "станом на зараз · наведіть на графік для деталей"}</small>
    </div>

    <div className={`${styles.controlGrid} ${pipelineStyles.controlGridFive}`}>
      <button type="button" className={`${styles.controlCard} ${pipelineStyles.controlCardFinance}`} onClick={() => navigateCrm("Планувальник")} aria-label={`Гроші в роботі: ${money(pipeline?.total)}`}>
        <div className={styles.controlHead}><div><MetricIcon>₴</MetricIcon><span>Гроші в роботі</span></div><em>›</em></div>
        <div className={styles.controlValue}><strong>{pipeline?.mixedCurrency ? "кілька валют" : money(pipeline?.total)}</strong><span>ще маємо виконати / довести до оплати</span></div>
        <InteractiveStackedBar rows={pipelineRows} />
        <div className={styles.controlFoot}><span>{pipeline?.pendingApprovalCount ? `На погодженні: ${pipeline.pendingApprovalCount}` : "Поточний портфель"}</span><b className={(dataQuality?.pipelineUnpricedCount ?? 0) > 0 ? pipelineStyles.dataGap : ""}>{(dataQuality?.pipelineUnpricedCount ?? 0) > 0 ? `${dataQuality?.pipelineUnpricedCount} без суми` : "оцінено"}</b></div>
      </button>

      <button type="button" className={`${styles.controlCard} ${pipelineStyles.controlCardFinance}`} onClick={() => navigateCrm("Оплати", { scope: "due" })} aria-label={`Дебіторка: ${money(control.receivables.total)}`}>
        <div className={styles.controlHead}><div><MetricIcon>₴</MetricIcon><span>Дебіторка</span></div><em>›</em></div>
        <div className={styles.controlValue}><strong>{money(control.receivables.total)}</strong><span>{control.receivables.count} відкритих фінансових зобов'язань</span></div>
        <InteractiveStackedBar rows={receivableRows} />
        <div className={styles.controlFoot}><span>Прострочений борг</span><b className={(dataQuality?.waitingPaymentUnpricedCount ?? 0) > 0 ? pipelineStyles.dataGap : control.receivables.debt > 0 ? styles.textDanger : ""}>{(dataQuality?.waitingPaymentUnpricedCount ?? 0) > 0 ? `${dataQuality?.waitingPaymentUnpricedCount} очікують оплату без суми` : money(control.receivables.debt)}</b></div>
      </button>

      <button type="button" className={`${styles.controlCard} ${control.decisions.total > 0 ? styles.controlAttention : ""}`} onClick={() => navigateCrm("Фінансовий центр")} aria-label={`Потрібне моє рішення: ${control.decisions.total}`}>
        <div className={styles.controlHead}><div><MetricIcon tone={control.decisions.total > 0 ? "orange" : "neutral"}>!</MetricIcon><span>Потрібне моє рішення</span></div><em>›</em></div>
        <div className={styles.controlValue}><strong>{control.decisions.total}</strong><span>рішень, де потрібен власник</span></div>
        <InteractiveVerticalBars rows={decisionRows} />
        <div className={styles.controlFoot}><span>КП з низькою маржею</span><b>{control.decisions.marginRevenue > 0 ? money(control.decisions.marginRevenue) : "—"}</b></div>
      </button>

      <button type="button" className={`${styles.controlCard} ${overdue > 0 ? styles.controlDanger : ""}`} onClick={() => navigateCrm("Аналітика")} aria-label={`Критичні прострочення: ${overdue}`}>
        <div className={styles.controlHead}><div><MetricIcon tone={overdue > 0 ? "red" : "neutral"}>!</MetricIcon><span>Критичні прострочення</span></div><em>›</em></div>
        <div className={styles.controlValue}><strong>{overdue}</strong><span>процесів вийшли за плановий час</span></div>
        <BreakdownChart rows={overdueRows} />
        <div className={styles.controlFoot}><span>Контроль SLA</span><b className={overdue > 0 ? styles.textDanger : ""}>{overdue > 0 ? "потрібне втручання" : "норма"}</b></div>
      </button>

      <button type="button" className={`${styles.controlCard} ${revenueRiskCount > 0 ? styles.controlRisk : ""}`} onClick={() => navigateCrm("Аналітика")} aria-label={`Ризик втрати виручки: ${revenueRiskCount} ситуацій`}>
        <div className={styles.controlHead}><div><MetricIcon tone={revenueRiskCount > 0 ? "orange" : "green"}>↘</MetricIcon><span>Ризик втрати виручки</span></div><em>›</em></div>
        <div className={styles.controlValue}><strong>{revenueRiskCount}</strong><span>ситуацій можуть не конвертуватися у виручку</span></div>
        <InteractiveDonut rows={riskRows} total={revenueRiskCount} />
        <div className={styles.controlFoot}><span>Факт без штучної оцінки</span><b>{revenueRiskCount > 0 ? "контролювати" : "ризиків немає"}</b></div>
      </button>
    </div>
  </section>;
}
