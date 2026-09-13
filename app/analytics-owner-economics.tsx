"use client";

import { useEffect, useState, type ReactNode } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-dashboard.module.css";

type WorkOrderEconomics = {
  workOrderId: string;
  number: number | null;
  displayNumber: string;
  closedAt: string | null;
  clientId: string;
  clientName: string;
  vehicleId: string;
  vehicle: string;
  plateNumber: string | null;
  vin: string | null;
  currency: string;
  grossRevenue: number;
  directCost: number;
  grossProfit: number;
  grossMarginPct: number;
  costMix: { parts: number; labor: number; external: number; consumables: number; other: number };
};

type ClientLtv = {
  clientId: string;
  name: string;
  phone: string;
  visits: number;
  vehicles: number;
  financeSnapshots: number;
  financeCoveragePct: number;
  warrantyClaims: number;
  warrantyCostCapturedClaims: number;
  warrantyCostCoveragePct: number;
  currency: string | null;
  lifetimeRevenue: number | null;
  lifetimeGrossProfit: number | null;
  warrantyCost: number | null;
  lifetimeContribution: number | null;
  averageCheck: number | null;
  grossMarginPct: number | null;
  firstClosedAt: string | null;
  lastClosedAt: string | null;
  lifetimeDays: number | null;
  daysSinceLastVisit: number | null;
  acquisitionSource: string | null;
  acquisitionSourceCoverage: boolean;
  acquisitionCost: null;
  acquisitionCostCoverage: false;
  complete: boolean;
  blockers: string[];
  workOrderIds: string[];
};

type Payload = {
  ok: boolean;
  permitted: boolean;
  error?: string;
  economics: null | {
    workOrders: WorkOrderEconomics[];
    clientLtv: ClientLtv[];
    cohort: {
      servedClients: number;
      lifetimeOrders: number;
      lifetimeRevenue: number | null;
      lifetimeGrossProfit: number | null;
      lifetimeContribution: number | null;
      financeCoveragePct: number;
      warrantyCostCoveragePct: number;
      completeClients: number;
    };
  };
};

type Props = { from: string; to: string; locationId: string };

function money(value: number | null, currency = "UAH") {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
function percent(value: number | null) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}
function drillButton(onClick: () => void, children: ReactNode) {
  return <button type="button" onClick={onClick} style={{ border: 0, background: "transparent", padding: 0, color: "inherit", font: "inherit", fontSize: 12, fontWeight: 750, cursor: "pointer", textAlign: "left" }}>{children}</button>;
}

export function AnalyticsOwnerEconomics({ from, to, locationId }: Props) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from, to });
    if (locationId) params.set("locationId", locationId);
    setLoading(true);
    setError("");
    fetch(`/api/analytics/owner-economics?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as Payload;
        if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити економіку по авто та клієнтах.");
        if (!cancelled) setPayload(data);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити економіку власника."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, locationId]);

  if (loading && !payload) return <div className={styles.state}>Завантажую економіку по авто та LTV клієнтів…</div>;
  if (error) return <div className={styles.state}>{error}</div>;
  if (payload && !payload.permitted) return <div className={styles.state}>Економіка по авто та LTV доступні лише з фінансовим дозволом.</div>;
  const data = payload?.economics;
  if (!data) return null;

  const cohortComplete = data.cohort.completeClients === data.cohort.servedClients;

  return <>
    <section className={styles.financeCardsWide}>
      <div><small>Клієнтів у когорті</small><strong>{data.cohort.servedClients}</strong></div>
      <div><small>Lifetime візитів</small><strong>{data.cohort.lifetimeOrders}</strong></div>
      <div><small>Lifetime net revenue</small><strong>{money(data.cohort.lifetimeRevenue)}</strong></div>
      <div><small>LTV · gross contribution</small><strong>{money(data.cohort.lifetimeContribution)}</strong></div>
    </section>

    {!cohortComplete && <p className={styles.note}>LTV когорти приховано, доки coverage не стане повним: ACTUAL finance {percent(data.cohort.financeCoveragePct)}, warranty cost {percent(data.cohort.warrantyCostCoveragePct)}, повністю верифікованих клієнтів {data.cohort.completeClients}/{data.cohort.servedClients}. CRM не екстраполює пропущені дані.</p>}

    <section className={styles.panel}>
      <header><div><small>ACTUAL · ЗАКРИТІ КП</small><h2>Прибуток по авто / замовленнях</h2></div><span>без алокації OPEX</span></header>
      <p className={styles.note}>Валовий прибуток = фактична net-виручка − прямі витрати. Net-виручка вже враховує знижки та refund. OPEX не розподіляється по конкретному авто без canonical allocation.</p>
      <div className={styles.tableWrap}><table>
        <thead><tr><th>КП / авто</th><th>Клієнт</th><th>Виручка</th><th>Прямі витрати</th><th>Валовий прибуток</th><th>Маржа</th><th>Закрито</th></tr></thead>
        <tbody>{data.workOrders.length ? data.workOrders.map((row) => <tr key={row.workOrderId}>
          <td>{drillButton(() => navigateCrm("Комерційна пропозиція", { workOrderId: row.workOrderId }), <><b>{row.displayNumber}</b><br/><span>{row.vehicle} · {row.plateNumber || row.vin || "—"}</span></>)}</td>
          <td>{drillButton(() => navigateCrm("Клієнти", { clientId: row.clientId }), row.clientName)}</td>
          <td>{money(row.grossRevenue, row.currency)}</td>
          <td>{money(row.directCost, row.currency)}</td>
          <td><strong>{money(row.grossProfit, row.currency)}</strong></td>
          <td><strong>{percent(row.grossMarginPct)}</strong></td>
          <td>{date(row.closedAt)}</td>
        </tr>) : <tr><td colSpan={7}>У вибраному періоді немає закритих КП з ACTUAL finance snapshot.</td></tr>}</tbody>
      </table></div>
    </section>

    <section className={styles.panel} data-customer-ltv="true">
      <header><div><small>CLIENT LTV · VERIFIED FACT</small><h2>LTV клієнтів, обслугованих у періоді</h2></div><span>customerId · усі авто · весь доступний lifetime</span></header>
      <p className={styles.note}>Період формує когорту. LTV = lifetime gross profit − фактичні гарантійні витрати. Показник доступний лише при 100% ACTUAL-finance і warranty-cost coverage в одній валюті. CAC поки не віднімається: немає canonical client-level acquisition-cost attribution.</p>
      <div className={styles.tableWrap}><table>
        <thead><tr><th>Клієнт</th><th>Візити / авто</th><th>Net revenue</th><th>Gross profit</th><th>Warranty cost</th><th>LTV contribution</th><th>Джерело</th><th>Coverage</th><th>Перший / останній</th></tr></thead>
        <tbody>{data.clientLtv.length ? data.clientLtv.map((row) => <tr key={row.clientId}>
          <td>{drillButton(() => navigateCrm("Клієнти", { clientId: row.clientId }), <><b>{row.name}</b><br/><span>{row.phone}</span></>)}</td>
          <td>{row.visits} / {row.vehicles}</td>
          <td>{money(row.lifetimeRevenue, row.currency || "UAH")}</td>
          <td>{money(row.lifetimeGrossProfit, row.currency || "UAH")}</td>
          <td>{money(row.warrantyCost, row.currency || "UAH")}</td>
          <td><strong>{money(row.lifetimeContribution, row.currency || "UAH")}</strong></td>
          <td>{row.acquisitionSource || "—"}<br/><span>CAC: n.a.</span></td>
          <td>{row.complete ? "100%" : <span title={row.blockers.join("; ")}>finance {percent(row.financeCoveragePct)}<br/>warranty {percent(row.warrantyCostCoveragePct)}</span>}</td>
          <td>{date(row.firstClosedAt)}<br/><span>{date(row.lastClosedAt)}{row.daysSinceLastVisit != null ? ` · ${row.daysSinceLastVisit} дн.` : ""}</span></td>
        </tr>) : <tr><td colSpan={9}>Для клієнтів вибраного періоду ще немає lifetime-економіки.</td></tr>}</tbody>
      </table></div>
    </section>
  </>;
}
