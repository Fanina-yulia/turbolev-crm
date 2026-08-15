"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./financial-center.module.css";

type FinanceSummary = {
  ok: boolean;
  currency: string;
  range: { from: string; to: string; timezone: string };
  hasFinancialData: boolean;
  pnl: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    opex: number;
    operatingProfit: number;
    otherIncome: number;
    otherExpense: number;
    tax: number;
    netProfit: number;
    netMarginPercent: number | null;
  };
  cashFlow: {
    inflow: number;
    outflow: number;
    net: number;
    operating: number;
    investing: number;
    financing: number;
    currentCash: number;
  };
  workingCapital: {
    receivables: number;
    payables: number;
    overdueReceivables: number;
    overduePayables: number;
  };
  accounts: Array<{ id: string; name: string; type: string; openingBalance: number; locationId: string | null }>;
  counts: { postedEvents: number; postedCashTransactions: number; openObligations: number; activeMoneyAccounts: number };
};

function money(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

function displayMoney(data: FinanceSummary | null, value: number | undefined) {
  if (!data || !data.hasFinancialData || value == null) return "—";
  return money(value, data.currency);
}

export function FinancialCenter() {
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/finance/summary", { cache: "no-store" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Не вдалося завантажити фінанси");
      setData(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Помилка фінансового центру");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    return () => window.removeEventListener("turbolev:data-changed", handler);
  }, [load]);

  const empty = data && !data.hasFinancialData;

  return <>
    <header className="topbar">
      <div>
        <p className="eyebrow">TURBO LEV · FINANCIAL CORE</p>
        <h1>Фінансовий центр</h1>
        <span className="muted">{loading ? "Синхронізую…" : "P&L · Cash Flow · дебіторка · кредиторка"}</span>
      </div>
      <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>Оновити</button>
    </header>

    {error && <div className="alert"><strong>Не вдалося оновити фінанси</strong><span>{error}</span><button onClick={() => void load()}>Повторити</button></div>}

    {empty && <div className={styles.emptyState}>
      <strong>Фінансове ядро готове до даних</strong>
      <span>Поки немає проведених фінансових подій, рухів коштів або налаштованих грошових рахунків. CRM навмисно не підставляє demo-цифри.</span>
    </div>}

    <section className={styles.kpiGrid}>
      <article><span>Виручка</span><strong>{displayMoney(data, data?.pnl.revenue)}</strong><small>визнаний дохід за період</small></article>
      <article><span>Валовий прибуток</span><strong>{displayMoney(data, data?.pnl.grossProfit)}</strong><small>маржа {data?.hasFinancialData ? percent(data.pnl.grossMarginPercent) : "—"}</small></article>
      <article><span>Чистий управлінський прибуток</span><strong>{displayMoney(data, data?.pnl.netProfit)}</strong><small>net margin {data?.hasFinancialData ? percent(data.pnl.netMarginPercent) : "—"}</small></article>
      <article><span>Гроші зараз</span><strong>{displayMoney(data, data?.cashFlow.currentCash)}</strong><small>{data?.counts.activeMoneyAccounts ?? 0} активних рахунків</small></article>
      <article><span>Дебіторка</span><strong>{displayMoney(data, data?.workingCapital.receivables)}</strong><small>прострочено {data?.hasFinancialData ? money(data.workingCapital.overdueReceivables, data.currency) : "—"}</small></article>
      <article><span>Кредиторка</span><strong>{displayMoney(data, data?.workingCapital.payables)}</strong><small>прострочено {data?.hasFinancialData ? money(data.workingCapital.overduePayables, data.currency) : "—"}</small></article>
    </section>

    <section className={styles.columns}>
      <article className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">P&L</p><h2>Прибутки та збитки</h2></div><span>за поточний місяць</span></div>
        <div className={styles.rows}>
          <div><span>Виручка</span><strong>{displayMoney(data, data?.pnl.revenue)}</strong></div>
          <div><span>− Прямі витрати / COGS</span><strong>{displayMoney(data, data?.pnl.cogs)}</strong></div>
          <div className={styles.emphasis}><span>= Валовий прибуток</span><strong>{displayMoney(data, data?.pnl.grossProfit)}</strong></div>
          <div><span>− OPEX</span><strong>{displayMoney(data, data?.pnl.opex)}</strong></div>
          <div><span>= Операційний прибуток</span><strong>{displayMoney(data, data?.pnl.operatingProfit)}</strong></div>
          <div><span>+ Інші доходи</span><strong>{displayMoney(data, data?.pnl.otherIncome)}</strong></div>
          <div><span>− Інші витрати</span><strong>{displayMoney(data, data?.pnl.otherExpense)}</strong></div>
          <div><span>− Податки</span><strong>{displayMoney(data, data?.pnl.tax)}</strong></div>
          <div className={styles.total}><span>= Чистий управлінський прибуток</span><strong>{displayMoney(data, data?.pnl.netProfit)}</strong></div>
        </div>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">CASH FLOW</p><h2>Рух грошей</h2></div><span>фактичні платежі</span></div>
        <div className={styles.rows}>
          <div><span>Надходження</span><strong>{displayMoney(data, data?.cashFlow.inflow)}</strong></div>
          <div><span>Виплати</span><strong>{displayMoney(data, data?.cashFlow.outflow)}</strong></div>
          <div className={styles.emphasis}><span>Чистий Cash Flow</span><strong>{displayMoney(data, data?.cashFlow.net)}</strong></div>
          <div><span>Операційний</span><strong>{displayMoney(data, data?.cashFlow.operating)}</strong></div>
          <div><span>Інвестиційний</span><strong>{displayMoney(data, data?.cashFlow.investing)}</strong></div>
          <div><span>Фінансовий</span><strong>{displayMoney(data, data?.cashFlow.financing)}</strong></div>
          <div className={styles.total}><span>Гроші на рахунках</span><strong>{displayMoney(data, data?.cashFlow.currentCash)}</strong></div>
        </div>
      </article>
    </section>

    <section className={styles.integrity}>
      <div><p className="eyebrow">КОНТРОЛЬ ДАНИХ</p><h2>Фінансовий ledger</h2></div>
      <div className={styles.integrityGrid}>
        <span><b>{data?.counts.postedEvents ?? 0}</b> проведених P&L-подій</span>
        <span><b>{data?.counts.postedCashTransactions ?? 0}</b> проведених рухів коштів</span>
        <span><b>{data?.counts.openObligations ?? 0}</b> відкритих зобов’язань</span>
        <span><b>{data?.counts.activeMoneyAccounts ?? 0}</b> грошових рахунків</span>
      </div>
      <p>Фінансовий центр читає тільки проведені факти. Demo-суми та припущення в розрахунки не потрапляють.</p>
    </section>
  </>;
}
