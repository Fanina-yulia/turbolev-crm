"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
type VisualVariant = "all" | "side" | "timeline";

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

export function AnalyticsFunnelVisuals({ funnel, from, to, locationId, variant = "all" }: {
  funnel: FunnelSnapshot;
  from: string;
  to: string;
  locationId: string;
  variant?: VisualVariant;
}) {
  const needsTimeline = variant !== "side";
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(needsTimeline);
  const [error, setError] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const [outcomeTarget, setOutcomeTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!needsTimeline) {
      setLoading(false);
      setError("");
      return;
    }
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
  }, [from, to, locationId, needsTimeline]);

  useEffect(() => {
    if (variant !== "all") return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("section"));
    const pathSection = sections.find((section) => section.querySelector("h2")?.textContent?.trim() === "Повний шлях") || null;
    const conversionSection = sections.find((section) => section.querySelector("h2")?.textContent?.trim() === "Конверсія етапів") || null;
    if (!pathSection || !conversionSection) return;

    const restore: Array<() => void> = [];
    const rememberStyle = (element: HTMLElement) => {
      const previous = element.getAttribute("style");
      restore.push(() => previous == null ? element.removeAttribute("style") : element.setAttribute("style", previous));
    };

    const desktop = window.matchMedia("(min-width: 1051px)").matches;
    const grid = pathSection.parentElement as HTMLElement | null;
    if (grid) {
      rememberStyle(grid);
      grid.style.gridTemplateColumns = "minmax(0,1.04fr) minmax(430px,.96fr)";
      grid.style.alignItems = "start";
    }

    const flow = pathSection.querySelector<HTMLElement>('div[class*="funnelFlow"]');
    if (flow) {
      rememberStyle(flow);
      flow.style.alignItems = "flex-start";
      flow.style.maxWidth = "none";
      flow.style.margin = "0";
      flow.style.padding = "4px 0 2px";
      if (desktop) flow.style.width = "58%";
    }

    const wraps = Array.from(pathSection.querySelectorAll<HTMLElement>('div[class*="funnelStageWrap"]'));
    wraps.forEach((wrap) => {
      rememberStyle(wrap);
      wrap.style.alignItems = "flex-start";
    });

    const losses = Array.from(pathSection.querySelectorAll<HTMLElement>('div[class*="stageLoss"]'));
    losses.forEach((loss) => {
      rememberStyle(loss);
      loss.style.justifyContent = "flex-start";
      loss.style.paddingLeft = "10px";
      loss.style.height = "34px";
    });

    const buttons = Array.from(pathSection.querySelectorAll<HTMLButtonElement>('button[class*="funnelStage"]'));
    const counts = buttons.map((button) => Number((button.querySelector("strong")?.textContent || "0").replace(/\s/g, "")) || 0);
    const maxCount = Math.max(1, ...counts);
    buttons.forEach((button, index) => {
      rememberStyle(button);
      const count = counts[index] || 0;
      const width = count > 0 ? Math.max(32, Math.min(100, 32 + (count / maxCount) * 68)) : 28;
      button.style.width = `${width}%`;
      button.style.minWidth = "0";
      button.style.borderLeft = "3px solid var(--orange)";
      button.style.borderRadius = "11px 6px 6px 11px";
      button.style.background = "linear-gradient(90deg,color-mix(in srgb,var(--orange) 15%,var(--panel-2)),color-mix(in srgb,var(--orange) 4%,var(--panel-2)))";
    });

    if (desktop) {
      rememberStyle(pathSection);
      pathSection.style.position = "relative";
    }
    const outcomeMount = document.createElement("div");
    outcomeMount.dataset.analyticsFunnelOutcome = "true";
    outcomeMount.className = desktop ? styles.outcomeMount : styles.outcomeMountMobile;
    pathSection.appendChild(outcomeMount);
    setOutcomeTarget(outcomeMount);

    const originalChildren = Array.from(conversionSection.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    originalChildren.forEach((child) => {
      rememberStyle(child);
      child.style.display = "none";
    });
    rememberStyle(conversionSection);
    conversionSection.style.padding = "0";
    conversionSection.style.border = "0";
    conversionSection.style.background = "transparent";
    conversionSection.style.marginBottom = "0";

    const mount = document.createElement("div");
    mount.dataset.analyticsFunnelSide = "true";
    mount.style.minWidth = "0";
    conversionSection.appendChild(mount);
    setPortalTarget(mount);

    return () => {
      setPortalTarget(null);
      setOutcomeTarget(null);
      if (mount.parentElement) mount.parentElement.removeChild(mount);
      if (outcomeMount.parentElement) outcomeMount.parentElement.removeChild(outcomeMount);
      restore.reverse().forEach((fn) => fn());
    };
  }, [variant, funnel]);

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
  const noShowPct = funnel.scheduled > 0 ? (funnel.noShow / funnel.scheduled) * 100 : 0;

  const bookedCount = Math.max(0, funnel.scheduled);
  const arrivedCount = Math.max(0, Math.min(bookedCount, funnel.arrived));
  const noShowCount = Math.max(0, Math.min(Math.max(0, bookedCount - arrivedCount), funnel.noShow));
  const withoutVisitCount = Math.max(0, bookedCount - arrivedCount - noShowCount);
  const arrivedShare = bookedCount > 0 ? (arrivedCount / bookedCount) * 100 : 0;
  const noShowShare = bookedCount > 0 ? (noShowCount / bookedCount) * 100 : 0;
  const withoutVisitShare = bookedCount > 0 ? (withoutVisitCount / bookedCount) * 100 : 0;
  const repairShare = bookedCount > 0 ? (Math.min(bookedCount, funnel.repairReached) / bookedCount) * 100 : 0;
  const completedShare = bookedCount > 0 ? (Math.min(bookedCount, funnel.completed) / bookedCount) * 100 : 0;
  const outcomeBackground = bookedCount > 0
    ? `conic-gradient(#65d5a0 0 ${arrivedShare}%, #ff7373 ${arrivedShare}% ${arrivedShare + noShowShare}%, var(--orange) ${arrivedShare + noShowShare}% 100%)`
    : "var(--panel-2)";

  const timelineMax = Math.max(1, ...timeline.flatMap((row) => [row.scheduled, row.arrived, row.completed]));
  const labelStep = Math.max(1, Math.ceil(timeline.length / 7));
  const xAt = (index: number) => timeline.length === 1 ? 373 : 42 + (index / Math.max(1, timeline.length - 1)) * 662;
  const yAt = (value: number) => 210 - (Math.max(0, value) / timelineMax) * 192;
  const yTicks = [0, .25, .5, .75, 1].map((ratio) => Math.round(timelineMax * ratio));

  const outcomePanel = <section className={styles.outcomePanel}>
    <header className={styles.outcomeHeader}>
      <div><small>ЗАПИСИ</small><h3>Результат записів</h3></div>
      <span>Що сталося із записами за вибраний період</span>
    </header>
    <div className={styles.outcomeRing} style={{ background: outcomeBackground }} aria-label={`Приїхало ${arrivedCount} із ${bookedCount}`}>
      <div className={styles.outcomeCenter}><strong>{arrivedCount}/{bookedCount}</strong><span>{pct(arrivedShare)} приїхало</span></div>
    </div>
    <div className={styles.outcomeLegend}>
      <div><i className={styles.dotArrived}/><span>Приїхали</span><b>{arrivedCount} · {pct(arrivedShare)}</b></div>
      <div><i className={styles.dotNoShow}/><span>No-show</span><b>{noShowCount} · {pct(noShowShare)}</b></div>
      <div><i className={styles.dotNoVisit}/><span>Без зафіксованого візиту</span><b>{withoutVisitCount} · {pct(withoutVisitShare)}</b></div>
    </div>
    <div className={styles.outcomeDepth}>
      <div><div><span>Дійшли до ремонту</span><b>{pct(repairShare)}</b></div><div className={styles.outcomeTrack}><i style={{ width: `${Math.max(0, Math.min(100, repairShare))}%` }}/></div></div>
      <div><div><span>Завершено від записів</span><b>{pct(completedShare)}</b></div><div className={styles.outcomeTrack}><i style={{ width: `${Math.max(0, Math.min(100, completedShare))}%` }}/></div></div>
    </div>
    <button type="button" className={styles.outcomeAction} onClick={() => navigateCrm("Планувальник", { date: to, scope: "week" })}>Переглянути записи →</button>
  </section>;

  const lossesPanel = <section className={`${styles.panel} ${variant === "side" || portalTarget ? styles.compactPanel : ""}`}>
    <header className={styles.header}><div><small>ВТРАТИ</small><h3>Де губимо клієнтів</h3></div><span>Не перейшли на наступний етап</span></header>
    <div className={styles.lossList}>
      {lossRows.map((row) => <button type="button" key={row.key} className={`${styles.lossRow} ${row.lost === 0 ? styles.zeroLoss : ""}`} onClick={row.open} title={`Було ${row.from}, перейшло ${row.to}, втрачено ${row.lost}`}>
        <div className={styles.lossMeta}><span>{row.label}</span><b>−{row.lost}</b><em>{row.lost ? pct(row.lossPct) : "без втрат"}</em></div>
        <div className={styles.lossTrack}><i style={{ width: `${row.lost ? Math.max(4, (row.lost / maxLoss) * 100) : 2}%` }} /></div>
      </button>)}
    </div>
    {worstLoss && <div className={styles.insight}><span>Найбільший провал</span><b>{worstLoss.label}: −{worstLoss.lost}</b></div>}
  </section>;

  const conversionPanel = <section className={`${styles.panel} ${variant === "side" || portalTarget ? styles.compactPanel : ""}`}>
    <header className={styles.header}><div><small>КОНВЕРСІЯ</small><h3>Етапи у відсотках</h3></div><span>Нижчий стовпчик = слабша ланка</span></header>
    <div className={`${styles.conversionChart} ${variant === "side" || portalTarget ? styles.compactConversion : ""}`}>
      {visibleConversions.map((row) => <button type="button" key={row.key} className={styles.conversionItem} onClick={row.open} title={`${row.label}: ${pct(row.conversionPct)} (${row.from} → ${row.to})`}>
        <b className={styles.conversionValue}>{pct(row.conversionPct)}</b>
        <span className={styles.conversionTrack}><i className={styles.conversionBar} style={{ height: `${Math.max(2, Math.min(100, row.conversionPct))}%` }} /></span>
        <span className={styles.conversionLabel}>{row.shortLabel}</span>
      </button>)}
    </div>
    <div className={styles.quickStats}>
      <div><span>Запис → завершено</span><b>{pct(funnel.bookingToCompletedPct)}</b></div>
      <div className={funnel.noShow > 0 ? styles.quickDanger : ""}><span>No-show</span><b>{funnel.noShow} · {pct(noShowPct)}</b></div>
    </div>
  </section>;

  const timelinePanel = <section className={`${styles.panel} ${styles.timelinePanel}`}>
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
  </section>;

  if (variant === "side") return <div className={styles.sideVisuals}>{lossesPanel}{conversionPanel}</div>;
  if (variant === "timeline") return <div className={styles.timelineOnly}>{timelinePanel}</div>;
  if (portalTarget || outcomeTarget) return <>{outcomeTarget && createPortal(outcomePanel, outcomeTarget)}{portalTarget && createPortal(<div className={styles.sideVisuals}>{lossesPanel}{conversionPanel}</div>, portalTarget)}<div className={styles.timelineOnly}>{timelinePanel}</div></>;
  return <div className={styles.visuals}>{lossesPanel}{conversionPanel}{timelinePanel}</div>;
}
