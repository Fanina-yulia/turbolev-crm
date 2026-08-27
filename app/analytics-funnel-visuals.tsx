"use client";

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

type VisualVariant = "all" | "side" | "timeline";

type Stage = {
  key: string;
  label: string;
  count: number;
  conversion: number | null;
  open: () => void;
};

type Transition = {
  key: string;
  label: string;
  shortLabel: string;
  from: number;
  to: number;
  conversionPct: number;
  open: () => void;
};

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

function clampPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function stageConversion(from: number, to: number) {
  return from > 0 ? (Math.max(0, to) / from) * 100 : 0;
}

function KpiCard({ icon, label, value, hint, tone }: {
  icon: string;
  label: string;
  value: number;
  hint: string;
  tone: "orange" | "green" | "violet" | "red";
}) {
  return <article className={`${styles.kpiCard} ${styles[`kpi_${tone}`]}`}>
    <div className={styles.kpiIcon} aria-hidden="true">{icon}</div>
    <div className={styles.kpiBody}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  </article>;
}

function PathCard({ stages }: { stages: Stage[] }) {
  return <section className={`${styles.card} ${styles.pathCard}`}>
    <header className={styles.cardHeader}>
      <div><small>КОНВЕРСІЯ</small><h3>Повний шлях</h3></div>
    </header>
    <div className={styles.pathList}>
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1] : null;
        const loss = previous ? Math.max(0, previous.count - stage.count) : 0;
        return <div className={styles.stageWrap} key={stage.key}>
          {previous && <div className={styles.stageMeta}>
            <span>↓ {stage.conversion == null ? "—" : pct(stage.conversion)}</span>
            <b className={loss > 0 ? styles.lossBad : styles.lossGood}>{loss > 0 ? `−${loss}` : "без втрат"}</b>
          </div>}
          <button type="button" className={styles.stageButton} onClick={stage.open}>
            <span className={styles.stageIndex}>{index + 1}</span>
            <strong className={styles.stageLabel}>{stage.label}</strong>
            <b className={styles.stageCount}>{stage.count}</b>
          </button>
        </div>;
      })}
    </div>
    <button type="button" className={styles.cardAction} onClick={() => navigateCrm("Планувальник")}>Переглянути записи →</button>
  </section>;
}

function OutcomeCard({ funnel }: { funnel: FunnelSnapshot }) {
  const booked = Math.max(0, funnel.scheduled);
  const arrived = Math.max(0, Math.min(booked, funnel.arrived));
  const noShow = Math.max(0, Math.min(Math.max(0, booked - arrived), funnel.noShow));
  const withoutVisit = Math.max(0, booked - arrived - noShow);
  const arrivedShare = booked > 0 ? (arrived / booked) * 100 : 0;
  const noShowShare = booked > 0 ? (noShow / booked) * 100 : 0;
  const withoutVisitShare = booked > 0 ? (withoutVisit / booked) * 100 : 0;
  const repairShare = booked > 0 ? (Math.min(booked, funnel.repairReached) / booked) * 100 : 0;
  const completedShare = booked > 0 ? (Math.min(booked, funnel.completed) / booked) * 100 : 0;
  const ringBackground = booked > 0
    ? `conic-gradient(#65d5a0 0 ${arrivedShare}%, #ff7373 ${arrivedShare}% ${arrivedShare + noShowShare}%, var(--orange) ${arrivedShare + noShowShare}% 100%)`
    : "var(--panel-2)";

  return <section className={`${styles.card} ${styles.outcomeCard}`}>
    <header className={styles.cardHeader}>
      <div><small>ЗАПИСИ</small><h3>Результат записів</h3></div>
    </header>

    <div className={styles.outcomeRing} style={{ background: ringBackground }} aria-label={`Приїхало ${arrived} із ${booked}`}>
      <div className={styles.outcomeRingInner}>
        <strong>{arrived}/{booked}</strong>
        <span>{pct(arrivedShare)} приїхало</span>
      </div>
    </div>

    <div className={styles.outcomeLegend}>
      <div><i className={styles.dotGreen}/><span>Приїхали</span><b>{arrived} · {pct(arrivedShare)}</b></div>
      <div><i className={styles.dotRed}/><span>No-show</span><b>{noShow} · {pct(noShowShare)}</b></div>
      <div><i className={styles.dotOrange}/><span>Без зафіксованого візиту</span><b>{withoutVisit} · {pct(withoutVisitShare)}</b></div>
    </div>

    <div className={styles.depthStats}>
      <div>
        <div><span>Дійшли до ремонту</span><b>{pct(repairShare)}</b></div>
        <div className={styles.depthTrack}><i style={{ width: `${clampPct(repairShare)}%` }}/></div>
      </div>
      <div>
        <div><span>Завершено від записів</span><b>{pct(completedShare)}</b></div>
        <div className={styles.depthTrack}><i style={{ width: `${clampPct(completedShare)}%` }}/></div>
      </div>
    </div>

    <button type="button" className={styles.cardAction} onClick={() => navigateCrm("Планувальник")}>Переглянути записи →</button>
  </section>;
}

function LossesCard({ transitions }: { transitions: Transition[] }) {
  const rows = transitions.map((row) => ({
    ...row,
    lost: Math.max(0, row.from - row.to),
    lossPct: row.from > 0 ? (Math.max(0, row.from - row.to) / row.from) * 100 : 0,
  }));
  const worst = rows.reduce<(typeof rows)[number] | null>((current, row) => !current || row.lost > current.lost ? row : current, null);

  return <section className={`${styles.card} ${styles.lossesCard}`}>
    <header className={styles.cardHeader}>
      <div><small>ВТРАТИ</small><h3>Де губимо клієнтів</h3></div>
      <span>Не перейшли на наступний етап</span>
    </header>
    <div className={styles.lossList}>
      {rows.map((row) => <button type="button" className={styles.lossRow} key={row.key} onClick={row.open}>
        <div className={styles.lossTop}>
          <span>{row.label}</span>
          <b>{row.lost > 0 ? `−${row.lost}` : "−0"}</b>
          <em className={row.lost > 0 ? styles.lossBad : styles.lossGood}>{row.lost > 0 ? pct(row.lossPct) : "без втрат"}</em>
        </div>
        <div className={`${styles.lossTrack} ${row.lost === 0 ? styles.lossTrackGood : ""}`}>
          <i style={{ width: `${row.lost === 0 ? 2 : clampPct(row.lossPct)}%` }}/>
        </div>
      </button>)}
    </div>
    <div className={styles.insight}>
      <span>Найбільший провал</span>
      <b>{worst ? `${worst.label}: −${worst.lost}` : "—"}</b>
    </div>
  </section>;
}

function ConversionCard({ rows, funnel }: { rows: Transition[]; funnel: FunnelSnapshot }) {
  const visible = [...rows, {
    key: "booking-complete",
    label: "Запис → завершено",
    shortLabel: "Запис→готово",
    from: funnel.scheduled,
    to: funnel.completed,
    conversionPct: funnel.bookingToCompletedPct,
    open: () => navigateCrm("Планувальник", { status: "COMPLETED" }),
  }].slice(-6);
  const noShowPct = funnel.scheduled > 0 ? (funnel.noShow / funnel.scheduled) * 100 : 0;

  return <section className={`${styles.card} ${styles.conversionCard}`}>
    <header className={styles.cardHeader}>
      <div><small>КОНВЕРСІЯ</small><h3>Етапи у відсотках</h3></div>
      <span>Нижчий стовпчик = слабша ланка</span>
    </header>
    <div className={styles.conversionChart}>
      {visible.map((row) => <button type="button" className={styles.conversionItem} key={row.key} onClick={row.open}>
        <b>{pct(row.conversionPct)}</b>
        <div className={styles.conversionTrack}>
          <i style={{ height: `${Math.max(row.conversionPct > 0 ? 8 : 2, clampPct(row.conversionPct))}%` }}/>
        </div>
        <span>{row.shortLabel}</span>
      </button>)}
    </div>
    <div className={styles.quickStats}>
      <div><span>Запис → завершено</span><b>{pct(funnel.bookingToCompletedPct)}</b></div>
      <div><span>No-show</span><b>{funnel.noShow} · {pct(noShowPct)}</b></div>
    </div>
  </section>;
}

export function AnalyticsFunnelVisuals({ funnel, from, to, locationId, variant = "all" }: {
  funnel: FunnelSnapshot;
  from: string;
  to: string;
  locationId: string;
  variant?: VisualVariant;
}) {
  void locationId;

  const leadCount = funnel.lead?.leads ?? funnel.scheduled;
  const leadToBooking = funnel.lead?.conversionPct ?? stageConversion(leadCount, funnel.scheduled);

  const stages: Stage[] = [
    { key: "lead", label: "Звернення / Активні", count: leadCount, conversion: null, open: () => navigateCrm("Ліди") },
    { key: "scheduled", label: "Записано на СТО", count: funnel.scheduled, conversion: leadToBooking, open: () => navigateCrm("Планувальник", { date: from, scope: "week" }) },
    { key: "arrived", label: "Приїхали", count: funnel.arrived, conversion: funnel.bookingToArrivalPct, open: () => navigateCrm("Планувальник", { status: "ARRIVED", date: to, scope: "day" }) },
    { key: "diagnostics", label: "Дійшли до діагностики", count: funnel.diagnosticsReached, conversion: funnel.arrivalToDiagnosticsPct, open: () => navigateCrm("Діагностика") },
    { key: "workOrder", label: "Створено КП", count: funnel.workOrderLinked, conversion: funnel.diagnosticsToWorkOrderPct, open: () => navigateCrm("Комерційна пропозиція") },
    { key: "repair", label: "Передано в ремонт", count: funnel.repairReached, conversion: funnel.workOrderToRepairPct, open: () => navigateCrm("Виробництво") },
    { key: "completed", label: "Роботу завершено", count: funnel.completed, conversion: funnel.repairToCompletedPct, open: () => navigateCrm("Планувальник", { status: "COMPLETED", date: to, scope: "day" }) },
  ];

  const transitions: Transition[] = [
    { key: "lead-booking", label: "Звернення → запис", shortLabel: "Зверн.→запис", from: leadCount, to: funnel.scheduled, conversionPct: leadToBooking, open: () => navigateCrm("Ліди") },
    { key: "booking-arrival", label: "Запис → візит", shortLabel: "Запис→візит", from: funnel.scheduled, to: funnel.arrived, conversionPct: funnel.bookingToArrivalPct, open: () => navigateCrm("Планувальник", { date: to, scope: "week" }) },
    { key: "arrival-diagnostics", label: "Візит → діагностика", shortLabel: "Візит→діагн.", from: funnel.arrived, to: funnel.diagnosticsReached, conversionPct: funnel.arrivalToDiagnosticsPct, open: () => navigateCrm("Діагностика") },
    { key: "diagnostics-wo", label: "Діагностика → КП", shortLabel: "Діагн.→КП", from: funnel.diagnosticsReached, to: funnel.workOrderLinked, conversionPct: funnel.diagnosticsToWorkOrderPct, open: () => navigateCrm("Комерційна пропозиція") },
    { key: "wo-repair", label: "КП → ремонт", shortLabel: "КП→ремонт", from: funnel.workOrderLinked, to: funnel.repairReached, conversionPct: funnel.workOrderToRepairPct, open: () => navigateCrm("Виробництво") },
    { key: "repair-complete", label: "Ремонт → завершено", shortLabel: "Ремонт→готово", from: funnel.repairReached, to: funnel.completed, conversionPct: funnel.repairToCompletedPct, open: () => navigateCrm("Виробництво") },
  ];

  if (variant === "side") return <div className={styles.sideOnly}><LossesCard transitions={transitions}/><ConversionCard rows={transitions} funnel={funnel}/></div>;
  if (variant === "timeline") return null;

  return <section className={styles.nativeRoot} data-analytics-funnel-native="true">
    <div className={styles.sectionIntro}>
      <div><h2>Воронка</h2><span>Де саме губляться клієнти між зверненням і завершеним ремонтом.</span></div>
      <button type="button" onClick={() => navigateCrm("Ліди")}>Відкрити Активні →</button>
    </div>

    <div className={styles.kpiGrid}>
      <KpiCard icon="▣" label="Записів" value={funnel.scheduled} hint="за період" tone="orange"/>
      <KpiCard icon="✓" label="Приїхало" value={funnel.arrived} hint={pct(funnel.bookingToArrivalPct)} tone="green"/>
      <KpiCard icon="✓" label="Завершено" value={funnel.completed} hint={`${pct(funnel.bookingToCompletedPct)} від записів`} tone="violet"/>
      <KpiCard icon="×" label="No-show" value={funnel.noShow} hint="втрачений візит" tone="red"/>
    </div>

    <div className={styles.mainGrid}>
      <PathCard stages={stages}/>
      <OutcomeCard funnel={funnel}/>
      <div className={styles.rightColumn}>
        <LossesCard transitions={transitions}/>
        <ConversionCard rows={transitions} funnel={funnel}/>
      </div>
    </div>
  </section>;
}
