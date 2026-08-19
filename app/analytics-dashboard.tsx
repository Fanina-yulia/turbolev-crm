"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./analytics-dashboard.module.css";

const KYIV_TZ = "Europe/Kyiv";

type AnalyticsData = {
  ok: boolean;
  error?: string;
  emptyScope?: boolean;
  range: { from: string; to: string; timezone: string; days?: number };
  scope?: { selectedLocationId: string | null };
  locations: Array<{ id: string; name: string }>;
  selectedLocationId?: string | null;
  permissions?: { financial: boolean; personnel: boolean };
  kpi?: {
    bookingToArrivalPct: number;
    averageCheck: number | null;
    grossMarginPct: number | null;
    postUtilizationPct: number;
    repeatClientPct: number;
    closedWorkOrders: number;
  };
  funnel?: {
    lead: null | { leads: number; booked: number; conversionPct: number };
    scheduled: number;
    arrived: number;
    noShow: number;
    workOrderLinked: number;
    bookingToArrivalPct: number;
    bookingToWorkOrderPct: number;
  };
  finance?: null | { grossRevenue: number; grossProfit: number; grossMarginPct: number; averageCheck: number; finalizedOrders: number };
  utilization?: { bookedMinutes: number; capacityMinutes: number; utilizationPct: number; activePosts: number };
  retention?: { servedClients: number; returningClients: number; repeatClientPct: number };
  mechanics?: Array<{ mechanicId: string; name: string; completedJobs: number; workOrders: number; normHours: number; actualHours: number; efficiencyPct: number | null }>;
  trend?: Array<{ date: string; closed: number; revenue: number | null; grossProfit: number | null }>;
};

type Preset = "7d" | "30d" | "month" | "custom";

function kyivDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KYIV_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}
function presetRange(preset: Preset) {
  const today = kyivDateString();
  if (preset === "7d") return { from: addDays(today, -6), to: today };
  if (preset === "30d") return { from: addDays(today, -29), to: today };
  if (preset === "month") return { from: monthStart(today), to: today };
  return { from: monthStart(today), to: today };
}
function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value) + " ₴";
}
function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function hours(minutes: number | undefined) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format((minutes || 0) / 60)} год`;
}
function dateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function AnalyticsDashboard() {
  const initial = presetRange("month");
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
  const kpi = data?.kpi;

  const openClosedOrders = () => {
    window.dispatchEvent(new CustomEvent("turbolev:navigate", { detail: { section: "Замовлення-наряди", filter: "CLOSED", filterLabel: "Закриті" } }));
  };

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · УПРАВЛІННЯ</p>
        <h1>Аналітика</h1>
        <span>Воронка, економіка, завантаження, продуктивність і повторні клієнти — лише з реальних даних CRM.</span>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>↻ Оновити</button>
    </header>

    <section className={styles.filters}>
      <div className={styles.presets}>
        {(["7d", "30d", "month", "custom"] as Preset[]).map((item) => <button key={item} type="button" className={preset === item ? styles.activePreset : ""} onClick={() => applyPreset(item)}>{item === "7d" ? "7 днів" : item === "30d" ? "30 днів" : item === "month" ? "Місяць" : "Період"}</button>)}
      </div>
      <label><span>Від</span><input type="date" value={from} max={to} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); }} /></label>
      <label><span>До</span><input type="date" value={to} min={from} onChange={(event) => { setPreset("custom"); setTo(event.target.value); }} /></label>
      {(data?.locations?.length || 0) > 0 && <label className={styles.location}><span>Станція</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Уся доступна мережа</option>{data!.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
    </section>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !data && <div className={styles.state}>Завантажую показники…</div>}
    {data?.emptyScope && <div className={styles.state}>Для Вашої ролі немає доступної станції для аналітики.</div>}

    {data && !data.emptyScope && <>
      <section className={styles.kpis}>
        <article><small>Запис → візит</small><strong>{percent(kpi?.bookingToArrivalPct)}</strong><span>операційна конверсія</span></article>
        <article><small>Середній чек</small><strong>{money(kpi?.averageCheck)}</strong><span>{data.permissions?.financial ? "по фіналізованих ЗН" : "фінансовий доступ обмежено"}</span></article>
        <article><small>Валова маржа</small><strong>{percent(kpi?.grossMarginPct)}</strong><span>{data.permissions?.financial ? "ACTUAL finance snapshot" : "фінансовий доступ обмежено"}</span></article>
        <article><small>Завантаження постів</small><strong>{percent(kpi?.postUtilizationPct)}</strong><span>{data.utilization?.activePosts || 0} активних постів</span></article>
        <article><small>Повторні клієнти</small><strong>{percent(kpi?.repeatClientPct)}</strong><span>{data.retention?.returningClients || 0} з {data.retention?.servedClients || 0}</span></article>
        <article className={styles.clickable} onClick={openClosedOrders} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openClosedOrders(); }}><small>Закриті ЗН</small><strong>{kpi?.closedWorkOrders || 0}</strong><span>відкрити список →</span></article>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <header><div><small>ВОРОНКА</small><h2>Конверсія сервісу</h2></div></header>
          {data.funnel?.lead && <div className={styles.funnelRow}><span>Ліди → запис</span><b>{data.funnel.leads} → {data.funnel.lead.booked}</b><strong>{percent(data.funnel.lead.conversionPct)}</strong></div>}
          {!data.funnel?.lead && <p className={styles.note}>Для station-scoped перегляду lead→booking не показується: у ліда поки немає власного locationId. Це захищає аналітику від хибної конверсії.</p>}
          <div className={styles.funnelRow}><span>Запис → візит</span><b>{data.funnel?.scheduled || 0} → {data.funnel?.arrived || 0}</b><strong>{percent(data.funnel?.bookingToArrivalPct)}</strong></div>
          <div className={styles.funnelRow}><span>Запис → ЗН</span><b>{data.funnel?.scheduled || 0} → {data.funnel?.workOrderLinked || 0}</b><strong>{percent(data.funnel?.bookingToWorkOrderPct)}</strong></div>
          <div className={styles.miniStats}><span>No-show <b>{data.funnel?.noShow || 0}</b></span><span>Записів <b>{data.funnel?.scheduled || 0}</b></span><span>Візитів <b>{data.funnel?.arrived || 0}</b></span></div>
        </section>

        <section className={styles.panel}>
          <header><div><small>ПОТУЖНІСТЬ</small><h2>Завантаження постів</h2></div><strong>{percent(data.utilization?.utilizationPct)}</strong></header>
          <div className={styles.progress}><i style={{ width: `${Math.min(100, data.utilization?.utilizationPct || 0)}%` }} /></div>
          <div className={styles.capacity}><div><small>Зайнято</small><b>{hours(data.utilization?.bookedMinutes)}</b></div><div><small>Доступно</small><b>{hours(data.utilization?.capacityMinutes)}</b></div><div><small>Пости</small><b>{data.utilization?.activePosts || 0}</b></div></div>
          <p className={styles.note}>Доступна потужність рахується з робочого графіка локації × активні пости × календарні дні періоду.</p>
        </section>
      </div>

      {data.permissions?.financial && data.finance && <section className={styles.panel}>
        <header><div><small>ЕКОНОМІКА</small><h2>Фіналізовані замовлення</h2></div><span>{data.finance.finalizedOrders} ЗН з ACTUAL snapshot</span></header>
        <div className={styles.financeCards}><div><small>Виручка</small><strong>{money(data.finance.grossRevenue)}</strong></div><div><small>Валовий прибуток</small><strong>{money(data.finance.grossProfit)}</strong></div><div><small>Середній чек</small><strong>{money(data.finance.averageCheck)}</strong></div><div><small>Маржа</small><strong>{percent(data.finance.grossMarginPct)}</strong></div></div>
      </section>}

      <section className={styles.panel}>
        <header><div><small>ДИНАМІКА</small><h2>Закриті ЗН за днями</h2></div><span>{from} — {to}</span></header>
        {(data.trend?.length || 0) === 0 ? <p className={styles.note}>У вибраному періоді ще немає закритих ЗН.</p> : <div className={styles.trend}>{data.trend!.map((row) => <div className={styles.trendRow} key={row.date}><time>{dateLabel(row.date)}</time><div className={styles.barTrack}><i style={{ width: `${Math.max(3, (Math.max(row.closed, (row.revenue || 0) / 1000) / maxTrend) * 100)}%` }} /></div><b>{row.closed} ЗН</b>{data.permissions?.financial && <span>{money(row.revenue)}</span>}</div>)}</div>}
      </section>

      {data.permissions?.personnel && <section className={styles.panel}>
        <header><div><small>ВИРОБНИЦТВО</small><h2>Продуктивність механіків</h2></div><span>за завершеними LABOR-рядками</span></header>
        {(data.mechanics?.length || 0) === 0 ? <p className={styles.note}>У вибраному періоді немає завершених робіт із призначеним механіком.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Механік</th><th>Робіт</th><th>ЗН</th><th>Нормогодини</th><th>Факт. год</th><th>Ефективність</th></tr></thead><tbody>{data.mechanics!.map((row) => <tr key={row.mechanicId}><td><b>{row.name}</b></td><td>{row.completedJobs}</td><td>{row.workOrders}</td><td>{row.normHours}</td><td>{row.actualHours || "—"}</td><td><strong>{percent(row.efficiencyPct)}</strong></td></tr>)}</tbody></table></div>}
        <p className={styles.note}>Ефективність = нормогодини завершених робіт / фактичний час ремонту. Якщо фактичний час не зафіксовано, відсоток не вигадується.</p>
      </section>}
    </>}
  </div>;
}
