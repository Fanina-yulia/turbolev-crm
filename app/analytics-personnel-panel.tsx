"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-personnel.module.css";

type PersonnelPayload = {
  ok: boolean;
  permitted: boolean;
  emptyScope?: boolean;
  error?: string;
  personnel: null | {
    filters: {
      mechanics: Array<{ id: string; name: string; locationId: string }>;
      posts: Array<{ id: string; name: string; locationId: string }>;
      selectedMechanicId: string | null;
      selectedPostId: string | null;
    };
    summary: {
      mechanics: number;
      completedLaborLines: number;
      workOrders: number;
      normHours: number;
      trackedLaborHours: number;
      efficiencyPct: number | null;
      timingCoveragePct: number | null;
      assignedHours: number;
      actualAppointmentHours: number;
      assignedTimeUsePct: number | null;
      averageCycleMinutes: number | null;
      cycleCoveragePct: number | null;
      onTimePct: number | null;
      blockerHours: number;
      blockedWorkOrders: number;
      blockerOrderRatePct: number | null;
      qcFirstPassPct: number | null;
      qcCoveragePct: number | null;
    };
    mechanics: Array<{
      mechanicId: string;
      employeeId: string | null;
      locationId: string | null;
      name: string;
      completedJobs: number;
      workOrders: number;
      normHours: number;
      trackedLaborHours: number;
      efficiencyPct: number | null;
      timingCoveragePct: number | null;
      assignedHours: number;
      actualAppointmentHours: number;
      assignedTimeUsePct: number | null;
      averageCycleMinutes: number | null;
      onTimePct: number | null;
      blockerHours: number;
      blockedWorkOrders: number;
      blockerOrderRatePct: number | null;
      qcFirstPassPct: number | null;
      qcEligibleWorkOrders: number;
    }>;
    cases: Array<{
      workOrderId: string;
      appointmentId: string | null;
      vehicleLabel: string;
      plateNumber: string | null;
      mechanicIds: string[];
      completedAt: string | null;
      blockerCount: number;
      qcFirstPass: boolean | null;
    }>;
    semantics: {
      efficiency: string;
      assignedTimeUse: string;
      blockerRate: string;
      firstPassQc: string;
    };
  };
};

function number(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits }).format(value);
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${number(value, 1)}%`;
}

function hours(value: number | null | undefined) {
  return value == null ? "—" : `${number(value, 1)} год`;
}

function duration(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  const value = Math.max(0, Math.round(minutes));
  if (value >= 1440) return `${number(value / 1440, 1)} д`;
  if (value >= 60) return `${number(value / 60, 1)} год`;
  return `${value} хв`;
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tone(value: number | null, good: number, warn: number, invert = false) {
  if (value == null) return styles.neutral;
  const goodEnough = invert ? value <= good : value >= good;
  const warnEnough = invert ? value <= warn : value >= warn;
  if (goodEnough) return styles.good;
  if (warnEnough) return styles.warn;
  return styles.bad;
}

function Metric({ label, value, hint, className = styles.neutral }: { label: string; value: string; hint: string; className?: string }) {
  return <article className={`${styles.metric} ${className}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{hint}</small>
  </article>;
}

export function AnalyticsPersonnelPanel({ from, to, locationId }: { from: string; to: string; locationId: string }) {
  const [mechanicId, setMechanicId] = useState("");
  const [postId, setPostId] = useState("");
  const [payload, setPayload] = useState<PersonnelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drillMechanicId, setDrillMechanicId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (locationId) params.set("locationId", locationId);
      if (mechanicId) params.set("mechanicId", mechanicId);
      if (postId) params.set("postId", postId);
      const response = await fetch(`/api/analytics/personnel?${params.toString()}`, { cache: "no-store" });
      const next = await response.json().catch(() => ({}));
      if (!response.ok || !next?.ok) throw new Error(next?.error || "Не вдалося завантажити аналітику персоналу");
      setPayload(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити аналітику персоналу");
    } finally {
      setLoading(false);
    }
  }, [from, to, locationId, mechanicId, postId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setMechanicId(""); setPostId(""); setDrillMechanicId(""); }, [locationId]);

  const personnel = payload?.personnel;
  const summary = personnel?.summary;
  const mechanics = personnel?.mechanics ?? [];
  const drillCases = useMemo(() => {
    if (!personnel) return [];
    const target = drillMechanicId || mechanicId;
    return target ? personnel.cases.filter((item) => item.mechanicIds.includes(target)) : personnel.cases;
  }, [personnel, drillMechanicId, mechanicId]);

  if (payload && !payload.permitted) {
    return <section className={styles.root}><div className={styles.state}>Немає дозволу на аналітику персоналу.</div></section>;
  }

  return <section className={styles.root} data-personnel-analytics="true">
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>P2-01 · ПЕРСОНАЛ</span>
        <h2>Продуктивність та якість роботи команди</h2>
        <p>Фактичні Work Order, labor lines, часові мітки, Operational Blocker та QC. Blocker — це вплив на роботу, а не автоматично вина механіка.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
    </header>

    <div className={styles.filters}>
      <label><span>Механік</span><select value={mechanicId} onChange={(event) => { setMechanicId(event.target.value); setDrillMechanicId(""); }}>
        <option value="">Усі механіки</option>
        {(personnel?.filters.mechanics ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label><span>Пост</span><select value={postId} onChange={(event) => { setPostId(event.target.value); setDrillMechanicId(""); }}>
        <option value="">Усі пости</option>
        {(personnel?.filters.posts ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className={styles.scope}><span>Період із загального фільтра</span><strong>{from} — {to}</strong></div>
    </div>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !personnel && <div className={styles.state}>Збираю фактичні події роботи персоналу…</div>}
    {!loading && payload?.emptyScope && <div className={styles.state}>У вашому station-scope немає доступних СТО.</div>}

    {summary && <>
      <div className={styles.metrics}>
        <Metric label="Виконано робіт" value={String(summary.completedLaborLines)} hint={`${summary.workOrders} Work Order · ${summary.mechanics} механіків`} />
        <Metric label="Нормогодини" value={hours(summary.normHours)} hint={`факт таймера ${hours(summary.trackedLaborHours)}`} />
        <Metric label="Ефективність" value={percent(summary.efficiencyPct)} hint="нормогодини / elapsed-time" className={tone(summary.efficiencyPct, 95, 75)} />
        <Metric label="Покриття таймінгом" value={percent(summary.timingCoveragePct)} hint="labor lines із start + complete" className={tone(summary.timingCoveragePct, 90, 70)} />
        <Metric label="Цикл авто" value={duration(summary.averageCycleMinutes)} hint={`coverage ${percent(summary.cycleCoveragePct)}`} />
        <Metric label="Вчасно завершено" value={percent(summary.onTimePct)} hint="actualEnd ≤ plannedEnd" className={tone(summary.onTimePct, 90, 75)} />
        <Metric label="Авто з блокерами" value={percent(summary.blockerOrderRatePct)} hint={`${summary.blockedWorkOrders} WO · ${hours(summary.blockerHours)} exposure`} className={tone(summary.blockerOrderRatePct, 10, 25, true)} />
        <Metric label="QC з першого разу" value={percent(summary.qcFirstPassPct)} hint={`QC coverage ${percent(summary.qcCoveragePct)}`} className={tone(summary.qcFirstPassPct, 90, 75)} />
      </div>

      {(summary.timingCoveragePct != null && summary.timingCoveragePct < 80) && <div className={styles.qualityWarning}>
        <strong>Дані часу неповні.</strong> Ефективність показана тільки для labor lines, де CRM має обидві мітки `startedAt` і `completedAt`. Відсутні мітки не підміняються оцінкою.
      </div>}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><span>КОМАНДА</span><h3>По механіках</h3></div><small>Клік по рядку → деталізація WO</small></div>
          <div className={styles.tableWrap}><table>
            <thead><tr><th>Механік</th><th>Робіт</th><th>Н/г</th><th>Факт</th><th>Ефект.</th><th>Цикл</th><th>Вчасно</th><th>Blocker</th><th>QC 1st</th></tr></thead>
            <tbody>{mechanics.length ? mechanics.map((row) => <tr key={row.mechanicId} className={drillMechanicId === row.mechanicId ? styles.selectedRow : ""} onClick={() => setDrillMechanicId(row.mechanicId)}>
              <td><strong>{row.name}</strong><small>{row.workOrders} WO · timing {percent(row.timingCoveragePct)}</small></td>
              <td>{row.completedJobs}</td>
              <td>{number(row.normHours)}</td>
              <td>{number(row.trackedLaborHours)}</td>
              <td className={tone(row.efficiencyPct, 95, 75)}>{percent(row.efficiencyPct)}</td>
              <td>{duration(row.averageCycleMinutes)}</td>
              <td className={tone(row.onTimePct, 90, 75)}>{percent(row.onTimePct)}</td>
              <td className={tone(row.blockerOrderRatePct, 10, 25, true)}>{percent(row.blockerOrderRatePct)}</td>
              <td className={tone(row.qcFirstPassPct, 90, 75)}>{percent(row.qcFirstPassPct)}</td>
            </tr>) : <tr><td colSpan={9} className={styles.empty}>За обраний період немає завершених labor lines.</td></tr>}</tbody>
          </table></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><span>DRILL-DOWN</span><h3>{drillMechanicId || mechanicId ? "Роботи механіка" : "Останні завершені роботи"}</h3></div><small>до 100 WO</small></div>
          <div className={styles.cases}>{drillCases.length ? drillCases.slice(0, 20).map((item) => <button type="button" key={item.workOrderId} onClick={() => navigateCrm("Наряди та ремонт", { workOrderId: item.workOrderId })}>
            <div><strong>{item.vehicleLabel}</strong><span>{item.plateNumber || item.workOrderId}</span></div>
            <div><span>{dateTime(item.completedAt)}</span><small>{item.blockerCount ? `blockers: ${item.blockerCount}` : "без blocker"} · {item.qcFirstPass == null ? "QC —" : item.qcFirstPass ? "QC first-pass" : "QC recheck"}</small></div>
            <b>Відкрити →</b>
          </button>) : <div className={styles.empty}>Немає Work Order для drill-down у цьому зрізі.</div>}</div>
        </section>
      </div>

      <details className={styles.methodology}>
        <summary>Як рахуються показники</summary>
        <p><b>Ефективність:</b> {personnel?.semantics.efficiency}</p>
        <p><b>Використання призначеного часу:</b> {personnel?.semantics.assignedTimeUse}</p>
        <p><b>Blocker rate:</b> {personnel?.semantics.blockerRate}</p>
        <p><b>First-pass QC:</b> {personnel?.semantics.firstPassQc}</p>
      </details>
    </>}
  </section>;
}
