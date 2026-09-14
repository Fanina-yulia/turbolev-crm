"use client";

import { useEffect, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./client-ltv-card.module.css";

type Ltv = {
  clientId: string;
  name: string;
  visits: number;
  vehicles: number;
  financeCoveragePct: number;
  warrantyClaims: number;
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
  daysSinceLastVisit: number | null;
  acquisitionSource: string | null;
  acquisitionSourceCoverage: boolean;
  complete: boolean;
  blockers: string[];
  workOrderIds: string[];
};

type Payload = {
  ok: boolean;
  permitted?: boolean;
  error?: string;
  ltv?: Ltv | null;
};

function money(value: number | null, currency: string | null) {
  if (value == null || !currency) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
function percent(value: number | null) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export function ClientLtvCard({ clientId }: { clientId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/analytics/client-ltv/${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as Payload;
        if (!response.ok && response.status !== 403) throw new Error(data.error || "LTV unavailable");
        if (!controller.signal.aborted) setPayload(data);
      })
      .catch(() => { if (!controller.signal.aborted) setPayload(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId]);

  if (loading) return <div className={styles.state}>Розраховую LTV…</div>;
  if (payload?.permitted === false) return <div className={styles.state}>LTV доступний користувачам із фінансовою аналітикою.</div>;
  const row = payload?.ltv;
  if (!row) return <div className={styles.state}>LTV ще недоступний для цього клієнта.</div>;

  return <div className={styles.root} data-client-ltv-card="true">
    <div className={styles.head}>
      <div><small>CLIENT LTV · ФАКТ</small><strong>{money(row.lifetimeContribution, row.currency)}</strong></div>
      <span className={row.complete ? styles.verified : styles.incomplete}>{row.complete ? "verified" : "coverage incomplete"}</span>
    </div>
    <div className={styles.metrics}>
      <span><small>Візити</small><b>{row.visits}</b></span>
      <span><small>Авто</small><b>{row.vehicles}</b></span>
      <span><small>Net revenue</small><b>{money(row.lifetimeRevenue, row.currency)}</b></span>
      <span><small>Gross profit</small><b>{money(row.lifetimeGrossProfit, row.currency)}</b></span>
      <span><small>Warranty cost</small><b>{money(row.warrantyCost, row.currency)}</b></span>
      <span><small>Середній чек</small><b>{money(row.averageCheck, row.currency)}</b></span>
    </div>
    <div className={styles.meta}>
      <span>Маржа <b>{percent(row.grossMarginPct)}</b></span>
      <span>Джерело <b>{row.acquisitionSource || "—"}</b></span>
      <span>Перший візит <b>{date(row.firstClosedAt)}</b></span>
      <span>Останній <b>{date(row.lastClosedAt)}{row.daysSinceLastVisit != null ? ` · ${row.daysSinceLastVisit} дн.` : ""}</b></span>
    </div>
    {!row.complete && <div className={styles.warning}><b>LTV не показується приблизно.</b><span>Finance coverage {percent(row.financeCoveragePct)} · warranty cost {percent(row.warrantyCostCoveragePct)}.</span>{row.blockers.map((item) => <small key={item}>{item}</small>)}</div>}
    <p>CAC: n.a. — client-level acquisition cost ще не має canonical attribution, тому не віднімається.</p>
    {row.workOrderIds.length > 0 && <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: row.workOrderIds[row.workOrderIds.length - 1] })}>Останній Work Order →</button>}
  </div>;
}
