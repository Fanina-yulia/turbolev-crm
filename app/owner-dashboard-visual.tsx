"use client";

import { navigateCrm } from "./crm-route";
import styles from "./owner-dashboard-visual.module.css";

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
  trend?: Array<{ date: string; closed: number; revenue: number | null; grossProfit: number | null }>;
};

type Props = {
  analytics: AnalyticsVisualPayload | null;
  period: OwnerPeriodKey;
  onPeriodChange: (period: OwnerPeriodKey) => void;
  loading?: boolean;
};

type Tone = "orange" | "green" | "red" | "neutral";

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

function compactDate(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(date);
}

function rangeLabel(range: AnalyticsVisualPayload["range"]) {
  if (!range) return "Поточний період";
  return range.days <= 1 ? compactDate(range.from) : `${compactDate(range.from)} — ${compactDate(range.to)}`;
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
  const points = data.map((value, index) => {
    const x = data.length === 1 ? width / 2 : pad + (index / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const polygon = area && points ? `${pad},${height - pad} ${points} ${width - pad},${height - pad}` : "";
  return <svg className={`${styles.sparkline} ${styles[`tone${tone}`]}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    {area && <polygon points={polygon} className={styles.sparkArea} />}
    <polyline points={points} fill="none" className={styles.sparkLine} />
    {data.map((_, index) => {
      const [x, y] = points.split(" ")[index].split(",");
      return <circle key={index} cx={x} cy={y} r="2.2" className={styles.sparkDot} />;
    })}
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
      <div><strong>{percent(safe)}</strong>{label && <small>{label}</small>}</div>
    </div>
  </div>;
}

function MetricIcon({ children, tone = "orange" }: { children: string; tone?: Tone }) {
  return <span className={`${styles.metricIcon} ${styles[`icon${tone}`]}`} aria-hidden="true">{children}</span>;
}

function TrendMetricCard({
  title,
  value,
  icon,
  values,
  previous,
  current,
  onClick,
  chart = "line",
  tone = "orange",
  subtitle,
  invertDelta = false,
}: {
  title: string;
  value: string;
  icon: string;
  values: Array<number | null | undefined>;
  previous?: number | null;
  current?: number | null;
  onClick: () => void;
  chart?: "line" | "bars";
  tone?: Tone;
  subtitle?: string;
  invertDelta?: boolean;
}) {
  return <button type="button" className={styles.metricCard} onClick={onClick} aria-label={`${title}: ${value}`}>
    <div className={styles.metricHead}><MetricIcon tone={tone}>{icon}</MetricIcon><span>{title}</span><em>›</em></div>
    <strong>{value}</strong>
    {subtitle && <small className={styles.metricSubtitle}>{subtitle}</small>}
    <div className={styles.metricChart}>{chart === "bars" ? <MiniBars values={values} tone={tone} /> : <Sparkline values={values} tone={tone} area />}</div>
    <DeltaLabel current={current} previous={previous} invert={invertDelta} />
  </button>;
}

function GaugeMetricCard({
  title,
  value,
  icon,
  gaugeValue,
  previous,
  current,
  onClick,
  tone = "orange",
  subtitle,
  gaugeLabel,
}: {
  title: string;
  value: string;
  icon: string;
  gaugeValue: number | null | undefined;
  previous?: number | null;
  current?: number | null;
  onClick: () => void;
  tone?: Tone;
  subtitle?: string;
  gaugeLabel?: string;
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

function RetentionMetricCard({ value, onClick }: { value: number | null | undefined; onClick: () => void }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const bars = [0.35, 0.5, 0.42, 0.62, 0.56].map((factor, index, source) => index === source.length - 1 ? safe : safe * factor);
  return <button type="button" className={styles.metricCard} onClick={onClick} aria-label={`Повторні клієнти: ${percent(value)}`}>
    <div className={styles.metricHead}><MetricIcon>↻</MetricIcon><span>Повторні клієнти</span><em>›</em></div>
    <strong>{percent(value)}</strong>
    <small className={styles.metricSubtitle}>утримання клієнтської бази</small>
    <MiniBars values={bars} tone={safe > 0 ? "green" : "neutral"} />
    <span className={styles.deltaNeutral}>поточний період</span>
  </button>;
}

function StatusBar({ segments }: { segments: Array<{ value: number; tone: Tone; label: string }> }) {
  const total = Math.max(1, segments.reduce((sum, item) => sum + Math.max(0, item.value), 0));
  return <div className={styles.statusBar} aria-hidden="true">
    {segments.map((segment) => <i key={segment.label} className={styles[`status${segment.tone}`]} style={{ flexGrow: Math.max(0, segment.value) / total, flexBasis: segment.value > 0 ? 12 : 0 }} />)}
  </div>;
}

export function OwnerDashboardVisual({ analytics, period, onPeriodChange, loading = false }: Props) {
  const kpi = analytics?.kpi;
  const previous = analytics?.previous;
  const operations = analytics?.operations;
  const trend = analytics?.trend ?? [];
  const revenueTrend = trend.map((item) => item.revenue);
  const profitTrend = trend.map((item) => item.grossProfit);
  const closedTrend = trend.map((item) => item.closed);
  const overdue = operations?.overdueNow ?? 0;
  const active = operations?.activeNow ?? kpi?.activeNow ?? 0;
  const ready = operations?.readyNow ?? kpi?.readyNow ?? 0;
  const inRepair = operations?.inRepairNow ?? 0;
  const waitingParts = operations?.waitingPartsNow ?? 0;
  const waitingApproval = operations?.waitingApprovalNow ?? 0;
  const otherActive = Math.max(0, active - inRepair - waitingParts - waitingApproval - ready);
  const delayReasons = operations?.delayReasons?.slice(0, 4) ?? [];
  const readyPct = active > 0 ? Math.min(100, (ready / active) * 100) : 0;

  return <section className={styles.visualDashboard} aria-label="Ключова аналітика власника">
    <div className={styles.periodRow}>
      <div className={styles.periodTabs} role="group" aria-label="Період аналітики">
        {PERIODS.map((item) => <button key={item.key} type="button" aria-pressed={period === item.key} className={period === item.key ? styles.periodActive : ""} onClick={() => onPeriodChange(item.key)}>{item.label}</button>)}
      </div>
      <span className={styles.rangeLabel}>{loading ? "Оновлюю…" : rangeLabel(analytics?.range)}</span>
    </div>

    <div className={styles.metricGrid}>
      <TrendMetricCard title="Виручка за період" value={money(kpi?.grossRevenue)} icon="₴" values={revenueTrend} current={kpi?.grossRevenue} previous={previous?.grossRevenue} chart="line" onClick={() => navigateCrm("Фінансовий центр")} />
      <TrendMetricCard title="Валовий прибуток" value={money(kpi?.grossProfit)} icon="▥" values={profitTrend} current={kpi?.grossProfit} previous={previous?.grossProfit} chart="bars" onClick={() => navigateCrm("Фінансовий центр")} />
      <GaugeMetricCard title="Валова маржа" value={percent(kpi?.grossMarginPct)} icon="%" gaugeValue={kpi?.grossMarginPct} current={kpi?.grossMarginPct} previous={previous?.grossMarginPct} subtitle={`середній чек ${money(kpi?.averageCheck)}`} gaugeLabel="маржа" onClick={() => navigateCrm("Аналітика")} />
      <GaugeMetricCard title="Завантаження постів" value={percent(kpi?.postUtilizationPct)} icon="⌁" gaugeValue={kpi?.postUtilizationPct} current={kpi?.postUtilizationPct} previous={previous?.postUtilizationPct} gaugeLabel="зайнято" onClick={() => navigateCrm("Аналітика")} />
      <RetentionMetricCard value={kpi?.repeatClientPct} onClick={() => navigateCrm("Аналітика")} />
      <GaugeMetricCard title="Запис → приїзд" value={percent(kpi?.bookingToArrivalPct)} icon="✓" gaugeValue={kpi?.bookingToArrivalPct} current={kpi?.bookingToArrivalPct} previous={previous?.bookingToArrivalPct} tone="green" gaugeLabel="конверсія" onClick={() => navigateCrm("Планувальник")} />
    </div>

    <div className={styles.operationGrid}>
      <button type="button" className={styles.operationCard} onClick={() => navigateCrm("Комерційна пропозиція")}>
        <div className={styles.operationHead}><div><MetricIcon>▣</MetricIcon><span>Активні авто</span></div><em>›</em></div>
        <div className={styles.operationValue}><strong>{active}</strong><span>у поточній мережі зараз</span></div>
        <Sparkline values={closedTrend.length ? closedTrend : [active]} tone="orange" area />
        <div className={styles.legendRow}><span><i className={styles.legendOrange} />У ремонті {inRepair}</span><span><i className={styles.legendNeutral} />Інші {Math.max(0, active - inRepair)}</span></div>
      </button>

      <button type="button" className={styles.operationCard} onClick={() => navigateCrm("Комерційна пропозиція", { status: "IN_REPAIR" })}>
        <div className={styles.operationHead}><div><MetricIcon>⌁</MetricIcon><span>У ремонті</span></div><em>›</em></div>
        <div className={styles.operationValue}><strong>{inRepair}</strong><span>фактична активна робота</span></div>
        <StatusBar segments={[{ value: inRepair, tone: "orange", label: "У ремонті" }, { value: waitingParts, tone: "neutral", label: "Запчастини" }, { value: waitingApproval, tone: "green", label: "Погодження" }, { value: otherActive, tone: "neutral", label: "Інші" }]} />
        <div className={styles.legendColumn}><span><i className={styles.legendOrange} />У ремонті <b>{inRepair}</b></span><span><i className={styles.legendNeutral} />Очікують запчастини <b>{waitingParts}</b></span><span><i className={styles.legendGreen} />Очікують рішення <b>{waitingApproval}</b></span></div>
      </button>

      <button type="button" className={`${styles.operationCard} ${overdue > 0 ? styles.operationDanger : ""}`} onClick={() => navigateCrm("Аналітика")}>
        <div className={styles.operationHead}><div><MetricIcon tone={overdue > 0 ? "red" : "neutral"}>!</MetricIcon><span>Протерміновано</span></div><em>{overdue > 0 ? "Переглянути →" : "›"}</em></div>
        <div className={styles.operationValue}><strong>{overdue}</strong><span>вийшли за плановий час</span></div>
        {delayReasons.length ? <MiniBars values={delayReasons.map((item) => item.count)} tone="red" /> : <StatusBar segments={[{ value: overdue, tone: overdue > 0 ? "red" : "neutral", label: "Протерміновано" }, { value: Math.max(0, active - overdue), tone: "neutral", label: "В межах часу" }]} />}
        <div className={styles.legendColumn}>{delayReasons.length ? delayReasons.map((item) => <span key={item.code}><i className={styles.legendRed} />{item.label} <b>{item.count}</b></span>) : <span><i className={styles.legendRed} />Протерміновано <b>{overdue}</b></span>}</div>
      </button>

      <button type="button" className={styles.operationCard} onClick={() => navigateCrm("Комерційна пропозиція", { status: "READY_FOR_PICKUP" })}>
        <div className={styles.operationHead}><div><MetricIcon tone="green">✓</MetricIcon><span>Готові до видачі</span></div><em>›</em></div>
        <div className={styles.operationValue}><strong>{ready}</strong><span>оплата контролюється окремо</span></div>
        <div className={styles.readyProgress}><i style={{ width: `${readyPct}%` }} /><span>{ready} / {Math.max(active, ready)}</span></div>
        <div className={styles.legendRow}><span><i className={styles.legendGreen} />Готові {ready}</span><span><i className={styles.legendNeutral} />У потоці {Math.max(0, active - ready)}</span></div>
      </button>
    </div>
  </section>;
}
