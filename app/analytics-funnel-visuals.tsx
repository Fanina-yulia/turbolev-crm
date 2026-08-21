"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-funnel-visuals.module.css";

type FunnelSnapshot = {
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

type TimelineRow = { date: string; scheduled: number; arrived: number; completed: number };
type TimelinePayload = { ok: boolean; timeline?: TimelineRow[]; error?: string };

type Transition = {
  key: string;
  label: string;
  shortLabel: string;
  from: number;
  to: number;
  conversionPct: number;
  open: () => void;
};

function pct(value: number) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function dateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
function paramsFor(from: string, to: string, locationId: string) {
  const params = new URLSearchParams({ from, to });
  if (locationId) params.set("locationId", locationId);
  return params.toString();
}

function makePath(rows: TimelineRow[], field: "scheduled" | "arrived" | "completed", maxValue: number) {
  const left = 42;
  const right = 704;
  const top = 18;
  const bottom = 210;
  const width = right - left;
  const height = bottom - top;
  if (!rows.length) return "";
  return rows.map((row, index) => {
    const x = rows.length === 1 ? left + width / 2 : left + (index / (rows.length - 1)) * width;
    const y = bottom - (Math.max(0, row[field]) / maxValue) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function AnalyticsFunnelVisuals({ funnel, from, to, locationId }: {
  funnel: FunnelSnapshot;
  from: string;
  to: string;
  locationId: string;
}) {
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/analytics/funnel-visuals?${paramsFor(from, to, locationId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as TimelinePayload;
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити динаміку воронки");
        if (!cancelled) setTimeline(payload.timeline || []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не вдалося завантажити динаміку воронки");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, locationId]);

  const transitions = useMemo<Transition[]>(() => {
    const rows: Transition[] = [];
    if (funnel.lead) {
      rows.push({
        key: "lead-booking",
        label: "Звернення → запис",
        shortLabel: "Зверн.→запис",
        from: funnel.lead.leads,
        to: funnel.lead.booked,
        conversionPct: funnel.lead.conversionPct,
        open: () => navigateCrm("Ліди"),
      });
    }
    rows.push(
      { key: "booking-arrival", label: "Запис → візит", shortLabel: "Запис→візит", from: funnel.scheduled, to: funnel.arrived, conversionPct: funnel.bookingToArrivalPct, open: () => navigateCrm("Планувальник", { date: to, scope: "week" }) },
      { key: "arrival-diagnostics", label: "Візит → діагностика", shortLabel: "Візит→діагн.", from: funnel.arrived, to: funnel.diagnosticsReached, conversionPct: funnel.arrivalToDiagnosticsPct, open: () => navigateCrm("Діагностика") },
      { key: "diagnostics-wo", label: "Діагностика → ЗН", shortLabel: "Діагн.→ЗН", from: funnel.diagnosticsReached, to: funnel.workOrderLinked, conversionPct: funnel.diagnosticsToWorkOrderPct, open: () => navigateCrm("Замовлення-наряди") },
      { key: "wo-repair", label: "ЗН → ремонт", shortLabel: "ЗН→ремонт", from: funnel.workOrderLinked, to: funnel.repairReached, conversionPct: funnel.workOrderToRepairPct, open: () => navigateCrm("Виробництво") },
      { key: "repair-complete", label: "Ремонт → завершено", shortLabel: "Ремонт→готово", from: funnel.repairReached, to: funnel.completed, conversionPct: funnel.repairToCompletedPct, open: () => navigateCrm("Виробництво") },
    );
    return rows;
  }, [funnel, to]);

  const lossRows = transitions.map((row) => ({
    ...row,
    lost: Math.max(0, row.from - row.to),
    lossPct: row.from > 0 ? (Math.max(0, row.from - row.to) / row.from) * 100 : 0,
  }));
  const maxLoss = Math.max(1, ...lossRows.map((row) => row.lost));
  const worstLoss = lossRows.reduce<(typeof lossRows)[number] | null>((worst, row) => !worst || row.lost > worst.lost ? row : worst, null);

  const conversionRows = [...transitions, {
    key: "booking-complete",
    label: "Запис → завершено",
    shortLabel: "Запис→готово",
    from: funnel.scheduled,
    to: funnel.completed,
    conversionPct: funnel.bookingToCompletedPct,
    open: () => navigateCrm("Планувальник", { status: "COMPLETED", date: to, scope: "week" }),
  }];
  const visibleConversions = conversionRows.slice(-6);

  const timelineMax = Math.max(1, ...timeline.flatMap((row) => [row.scheduled, row.arrived, row.completed]));
  const labelStep = Math.max(1, Math.ceil(timeline.length / 7));
  const xAt = (index: number) => timeline.length === 1 ? 373 : 42 + (index / Math.max(1, timeline.length - 1)) * 662;
  const yAt = (value: number) => 210 - (Math.max(0, value) / timelineMax) * 192;
  const yTicks = [0, .25, .5, .75, 1].map((ratio) => Math.round(timelineMax * ratio));

  return <div className={styles.visuals}>
    <section className={styles.panel}>
      <header className={styles.header}><div><small>ВТРАТИ</small><h3>Де губимо клієнтів</h3></div><span>Кількість і частка клієнтів, які не перейшли на наступний етап</span></header>
      <div className={styles.lossList}>
        {lossRows.map((row) => <button type="button" key={row.key} className={`${styles.lossRow} ${row.lost === 0 ? styles.zeroLoss : ""}`} onClick={row.open} title={`Було ${row.from}, перейшло ${row.to}, втрачено ${row.lost}`}>
          <div className={styles.lossMeta}><span>{row.label}</span><b>−{row.lost}</b><em>{row.lost ? pct(row.lossPct) : "без втрат"}</em></div>
          <div className={styles.lossTrack}><i style={{ width: `${row.lost ? Math.max(4, (row.lost / maxLoss) * 100) : 2}%` }} /></div>
        </button>)}
      </div>
      {worstLoss && <div className={styles.insight}><span>Найбільша втрата за вибраний період</span><b>{worstLoss.label}: −{worstLoss.lost}</b></div>}
    </section>

    <section className={styles.panel}>
      <header className={styles.header}><div><small>КОНВЕРСІЯ</small><h3>Етапи у відсотках</h3></div><span>Чим нижчий стовпчик, тим сильніший провал між етапами</span></header>
      <div className={styles.conversionChart}>
        {visibleConversions.map((row) => <button type="button" key={row.key} className={styles.conversionItem} onClick={row.open} title={`${row.label}: ${pct(row.conversionPct)} (${row.from} → ${row.to})`}>
          <b className={styles.conversionValue}>{pct(row.conversionPct)}</b>
          <span className={styles.conversionTrack}><i className={styles.conversionBar} style={{ height: `${Math.max(2, Math.min(100, row.conversionPct))}%` }} /></span>
          <span className={styles.conversionLabel}>{row.shortLabel}</span>
        </button>)}
      </div>
    </section>

    <section className={`${styles.panel} ${styles.timelinePanel}`}>
      <header className={styles.header}><div><small>ДИНАМІКА</small><h3>Записано → приїхало → завершено</h3></div><span>Когортно за датою запланованого візиту · {from} — {to}</span></header>
      {loading && <div className={styles.loading}>Завантажую графік…</div>}
      {!loading && error && <div className={styles.empty}>{error}</div>}
      {!loading && !error && timeline.length === 0 && <div className={styles.empty}>У вибраному періоді ще немає записів.</div>}
      {!loading && !error && timeline.length > 0 && <div className={styles.timelineWrap}>
        <div className={styles.timelineLegend}><span><i className={styles.legendBooked}/>Записано</span><span><i className={styles.legendArrived}/>Приїхало</span><span><i className={styles.legendCompleted}/>Завершено</span></div>
        <svg className={styles.timelineSvg} viewBox="0 0 720 250" role="img" aria-label="Динаміка воронки по днях">
          {yTicks.map((tick) => {
            const y = yAt(tick);
            return <g key={`y-${tick}`}><line className={styles.gridLine} x1="42" x2="704" y1={y} y2={y}/><text className={styles.axisText} x="4" y={y + 3}>{tick}</text></g>;
          })}
          <path className={styles.bookedPath} d={makePath(timeline, "scheduled", timelineMax)} />
          <path className={styles.arrivedPath} d={makePath(timeline, "arrived", timelineMax)} />
          <path className={styles.completedPath} d={makePath(timeline, "completed", timelineMax)} />
          {timeline.map((row, index) => <g key={row.date}>
            <circle className={styles.bookedPoint} cx={xAt(index)} cy={yAt(row.scheduled)} r="3.2"><title>{`${dateLabel(row.date)} · записано ${row.scheduled}`}</title></circle>
            <circle className={styles.arrivedPoint} cx={xAt(index)} cy={yAt(row.arrived)} r="3"><title>{`${dateLabel(row.date)} · приїхало ${row.arrived}`}</title></circle>
            <circle className={styles.completedPoint} cx={xAt(index)} cy={yAt(row.completed)} r="3"><title>{`${dateLabel(row.date)} · завершено ${row.completed}`}</title></circle>
            {(index % labelStep === 0 || index === timeline.length - 1) && <text className={styles.axisText} x={xAt(index)} y="238" textAnchor="middle">{dateLabel(row.date)}</text>}
          </g>)}
        </svg>
      </div>}
    </section>
  </div>;
}
