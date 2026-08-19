"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./financial-center.module.css";

type FinanceSummary = {
  ok: boolean;
  currency: string;
  range: { from: string; to: string; timezone: string };
  selectedLocationId: string | null;
  locations: Array<{ id: string; name: string }>;
  hasFinancialData: boolean;
  pnl: { revenue: number; cogs: number; grossProfit: number; grossMarginPercent: number | null; opex: number; operatingProfit: number; otherIncome: number; otherExpense: number; tax: number; netProfit: number; netMarginPercent: number | null };
  cashFlow: { inflow: number; outflow: number; net: number; operating: number; investing: number; financing: number; currentCash: number };
  workingCapital: { receivables: number; payables: number; overdueReceivables: number; overduePayables: number };
  accounts: Array<{ id: string; name: string; type: string; openingBalance: number; locationId: string | null }>;
  counts: { postedEvents: number; postedCashTransactions: number; openObligations: number; activeMoneyAccounts: number };
};
type DrillRow = { id: string; type: string; date: string | null; amount: number; description: string; workOrderId: string | null; workOrderLabel: string | null };
type Metric = "revenue" | "grossProfit" | "netProfit" | "currentCash" | "receivables" | "payables" | "overdueReceivables" | "overduePayables";
type Preset = "today" | "week" | "month" | "custom";

const METRIC_LABEL: Record<Metric, string> = {
  revenue: "Виручка",
  grossProfit: "Валовий прибуток",
  netProfit: "Чистий управлінський прибуток",
  currentCash: "Гроші зараз",
  receivables: "Дебіторка",
  payables: "Кредиторка",
  overdueReceivables: "Прострочена дебіторка",
  overduePayables: "Прострочена кредиторка",
};

function money(value: number, currency = "UAH") { return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
function percent(value: number | null) { return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`; }
function displayMoney(data: FinanceSummary | null, value: number | undefined) { return !data || !data.hasFinancialData || value == null ? "—" : money(value, data.currency); }
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function presetRange(preset: Exclude<Preset, "custom">) {
  const today = new Date();
  const to = isoDate(today);
  if (preset === "today") return { from: to, to };
  if (preset === "week") { const from = new Date(today); const day = (from.getDay() + 6) % 7; from.setDate(from.getDate() - day); return { from: isoDate(from), to }; }
  return { from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, to };
}
function dateText(value: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date); }

export function FinancialCenter() {
  const initial = useMemo(() => presetRange("month"), []);
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [locationId, setLocationId] = useState("");
  const [metric, setMetric] = useState<Metric | null>(null);
  const [detailRows, setDetailRows] = useState<DrillRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const query = useMemo(() => { const p = new URLSearchParams({ from, to }); if (locationId) p.set("locationId", locationId); return p.toString(); }, [from, to, locationId]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch(`/api/finance/summary?${query}`, { cache: "no-store" }); const next = await response.json(); if (!response.ok) throw new Error(next.error || "Не вдалося завантажити фінанси"); setData(next); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Помилка фінансового центру"); }
    finally { setLoading(false); }
  }, [query]);

  useEffect(() => { void load(); const handler = () => void load(); window.addEventListener("turbolev:data-changed", handler); return () => window.removeEventListener("turbolev:data-changed", handler); }, [load]);
  useEffect(() => { setMetric(null); setDetailRows([]); }, [query]);

  function choosePreset(next: Exclude<Preset, "custom">) { const range = presetRange(next); setPreset(next); setFrom(range.from); setTo(range.to); }
  async function openDrill(nextMetric: Metric) {
    setMetric(nextMetric); setDetailLoading(true); setDetailRows([]);
    try { const response = await fetch(`/api/finance/details?metric=${nextMetric}&${query}`, { cache: "no-store" }); const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося відкрити деталізацію"); setDetailRows(payload.rows || []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка деталізації"); }
    finally { setDetailLoading(false); }
  }

  const empty = data && !data.hasFinancialData;
  const periodLabel = `${dateText(`${from}T12:00:00+03:00`)} — ${dateText(`${to}T12:00:00+03:00`)}`;

  return <>
    <header className="topbar">
      <div><p className="eyebrow">TURBO LEV · FINANCIAL CORE</p><h1>Фінансовий центр</h1><span className="muted">{loading ? "Синхронізую…" : `P&L · Cash Flow · ${periodLabel}`}</span></div>
      <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>Оновити</button>
    </header>

    <section className={styles.filters}>
      <div className={styles.presets}>
        <button className={preset === "today" ? styles.activePreset : ""} onClick={() => choosePreset("today")}>Сьогодні</button>
        <button className={preset === "week" ? styles.activePreset : ""} onClick={() => choosePreset("week")}>Тиждень</button>
        <button className={preset === "month" ? styles.activePreset : ""} onClick={() => choosePreset("month")}>Місяць</button>
        <button className={preset === "custom" ? styles.activePreset : ""} onClick={() => setPreset("custom")}>Період</button>
      </div>
      {preset === "custom" && <div className={styles.dateRange}><label>Від<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>До<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>}
      <label className={styles.location}>Локація<select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Усі локації</option>{data?.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
    </section>

    {error && <div className="alert"><strong>Не вдалося оновити фінанси</strong><span>{error}</span><button onClick={() => void load()}>Повторити</button></div>}
    {empty && <div className={styles.emptyState}><strong>Фінансове ядро готове до даних</strong><span>За вибраний період/локацію немає проведених фінансових фактів. CRM не підставляє demo-цифри.</span></div>}

    <section className={styles.kpiGrid}>
      <button className={styles.kpi} onClick={() => void openDrill("revenue")}><span>Виручка</span><strong>{displayMoney(data, data?.pnl.revenue)}</strong><small>визнаний дохід · натисніть для деталей</small></button>
      <button className={styles.kpi} onClick={() => void openDrill("grossProfit")}><span>Валовий прибуток</span><strong>{displayMoney(data, data?.pnl.grossProfit)}</strong><small>маржа {data?.hasFinancialData ? percent(data.pnl.grossMarginPercent) : "—"}</small></button>
      <button className={styles.kpi} onClick={() => void openDrill("netProfit")}><span>Чистий управлінський прибуток</span><strong>{displayMoney(data, data?.pnl.netProfit)}</strong><small>net margin {data?.hasFinancialData ? percent(data.pnl.netMarginPercent) : "—"}</small></button>
      <button className={styles.kpi} onClick={() => void openDrill("currentCash")}><span>Гроші зараз</span><strong>{displayMoney(data, data?.cashFlow.currentCash)}</strong><small>{data?.counts.activeMoneyAccounts ?? 0} активних рахунків</small></button>
      <button className={styles.kpi} onClick={() => void openDrill("receivables")}><span>Дебіторка</span><strong>{displayMoney(data, data?.workingCapital.receivables)}</strong><small>прострочено {data?.hasFinancialData ? money(data.workingCapital.overdueReceivables, data.currency) : "—"}</small></button>
      <button className={styles.kpi} onClick={() => void openDrill("payables")}><span>Кредиторка</span><strong>{displayMoney(data, data?.workingCapital.payables)}</strong><small>прострочено {data?.hasFinancialData ? money(data.workingCapital.overduePayables, data.currency) : "—"}</small></button>
    </section>

    {metric && <section className={styles.drilldown}>
      <div className={styles.drillHead}><div><p className="eyebrow">DRILL-DOWN</p><h2>{METRIC_LABEL[metric]}</h2><span>{periodLabel}{locationId ? ` · ${data?.locations.find((item) => item.id === locationId)?.name || locationId}` : " · усі локації"}</span></div><button onClick={() => setMetric(null)}>Закрити</button></div>
      {detailLoading ? <div className={styles.drillState}>Завантажую деталізацію…</div> : detailRows.length === 0 ? <div className={styles.drillState}>За цим показником немає рядків.</div> : <div className={styles.detailTable}>
        <div className={styles.detailHead}><span>Дата</span><span>Опис</span><span>Тип</span><span>ЗН</span><span>Сума</span></div>
        {detailRows.map((row) => <div className={styles.detailRow} key={row.id}><span>{dateText(row.date)}</span><span>{row.description}</span><span>{row.type}</span><span>{row.workOrderId ? <a href={`/?section=workorders&filter=${encodeURIComponent(row.workOrderId)}`}>{row.workOrderLabel || "Відкрити ЗН"}</a> : "—"}</span><strong>{money(row.amount, data?.currency || "UAH")}</strong></div>)}
      </div>}
    </section>}

    <section className={styles.columns}>
      <article className={styles.panel}><div className={styles.panelHead}><div><p className="eyebrow">P&L</p><h2>Прибутки та збитки</h2></div><span>{periodLabel}</span></div><div className={styles.rows}>
        <div><span>Виручка</span><strong>{displayMoney(data, data?.pnl.revenue)}</strong></div><div><span>− Прямі витрати / COGS</span><strong>{displayMoney(data, data?.pnl.cogs)}</strong></div><div className={styles.emphasis}><span>= Валовий прибуток</span><strong>{displayMoney(data, data?.pnl.grossProfit)}</strong></div><div><span>− OPEX</span><strong>{displayMoney(data, data?.pnl.opex)}</strong></div><div><span>= Операційний прибуток</span><strong>{displayMoney(data, data?.pnl.operatingProfit)}</strong></div><div><span>+ Інші доходи</span><strong>{displayMoney(data, data?.pnl.otherIncome)}</strong></div><div><span>− Інші витрати</span><strong>{displayMoney(data, data?.pnl.otherExpense)}</strong></div><div><span>− Податки</span><strong>{displayMoney(data, data?.pnl.tax)}</strong></div><div className={styles.total}><span>= Чистий управлінський прибуток</span><strong>{displayMoney(data, data?.pnl.netProfit)}</strong></div>
      </div></article>
      <article className={styles.panel}><div className={styles.panelHead}><div><p className="eyebrow">CASH FLOW</p><h2>Рух грошей</h2></div><span>{periodLabel}</span></div><div className={styles.rows}>
        <div><span>Надходження</span><strong>{displayMoney(data, data?.cashFlow.inflow)}</strong></div><div><span>Виплати</span><strong>{displayMoney(data, data?.cashFlow.outflow)}</strong></div><div className={styles.emphasis}><span>Чистий Cash Flow</span><strong>{displayMoney(data, data?.cashFlow.net)}</strong></div><div><span>Операційний</span><strong>{displayMoney(data, data?.cashFlow.operating)}</strong></div><div><span>Інвестиційний</span><strong>{displayMoney(data, data?.cashFlow.investing)}</strong></div><div><span>Фінансовий</span><strong>{displayMoney(data, data?.cashFlow.financing)}</strong></div><div className={styles.total}><span>Гроші на рахунках</span><strong>{displayMoney(data, data?.cashFlow.currentCash)}</strong></div>
      </div></article>
    </section>

    <section className={styles.integrity}><div><p className="eyebrow">КОНТРОЛЬ ДАНИХ</p><h2>Фінансовий ledger</h2></div><div className={styles.integrityGrid}><span><b>{data?.counts.postedEvents ?? 0}</b> P&L-подій за період</span><span><b>{data?.counts.postedCashTransactions ?? 0}</b> рухів коштів за період</span><span><b>{data?.counts.openObligations ?? 0}</b> відкритих зобов’язань</span><span><b>{data?.counts.activeMoneyAccounts ?? 0}</b> грошових рахунків</span></div><p>Фінансовий центр читає тільки проведені факти. Період і локація застосовуються сервером до ledger-запитів.</p></section>
  </>;
}
