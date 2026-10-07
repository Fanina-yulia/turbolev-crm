"use client";

import { useMemo, useState } from "react";
import { navigateCrm } from "./crm-route";
import styles from "./financial-center-v3-control.module.css";

export type FinanceV3Tab = "overview" | "pnl" | "cash" | "plan" | "calendar" | "debts" | "profitability" | "expenses" | "accounts";
export type FinanceDrilldownMetric =
  | "currentCash" | "revenue" | "grossProfit" | "netProfit"
  | "cashIn" | "cashOut" | "cashNet" | "receivables" | "payables"
  | "cogs" | "opex" | "overdueReceivables" | "overduePayables"
  | "ownerNetIncome" | "serviceTurnover" | "partsMargin" | "payroll" | "ownerGrossIncome" | "totalExpenses";

type Account = { id: string; name: string; type: string; balance: number; openingBalance: number; locationId: string | null };
type Obligation = { id: string; direction: "RECEIVABLE" | "PAYABLE"; status: string; amount: number; settledAmount: number; outstanding: number; dueAt: string | null; counterpartyName: string | null; description: string | null; workOrderId: string | null; overdueDays: number; isOverdue: boolean };
type PnlEvent = { id: string; pnlSection: string; amount: number; recognizedAt: string; description: string | null; workOrderId: string | null; employeeId?: string | null; sourceEntity?: string | null; category: { name: string; code?: string | null } | null };
type CashTx = { id: string; kind: string; flowSection: string; amount: number; occurredAt: string; description: string | null; workOrderId?: string | null };

type Control = {
  today: { date: string; revenue: number; cashIn: number; cashOut: number; netCashFlow: number; receivablesCreated: number; receivablesCollected: number };
  reconciliation: {
    status: "OK" | "WARNING" | "CRITICAL";
    issueCount: number;
    criticalCount: number;
    warningCount: number;
    issues: Array<{ code: string; level: "WARNING" | "CRITICAL"; title: string; message: string; count: number; amount: number; samples: string[] }>;
  };
  margins: Array<{ label: string; revenue: number; directCost: number; grossProfit: number; marginPercent: number | null; costTracked: boolean; state: "UNKNOWN" | "LOW" | "WATCH" | "GOOD" }>;
  plan: {
    elapsedPercent: number;
    metrics: Array<{ metric: string; label: string; source: "BUDGET" | "AUTO" | "NONE"; plan: number; actual: number; variance: number; completionPercent: number | null; paceForecast: number; projectedCompletionPercent: number | null }>;
  };
  forecast: {
    currentCash: number;
    in7Days: number;
    in30Days: number;
    minimum: { date: string; closingCash: number } | null;
    firstGap: { date: string; closingCash: number } | null;
    firstReserveWarning: { date: string; closingCash: number } | null;
    drivers: Array<{ id: string; sourceType: string; direction: "INFLOW" | "OUTFLOW"; amount: number; weightedAmount: number; expectedAt: string; counterparty: string | null; description: string | null; sourceId: string | null }>;
  };
  profitability: {
    topWorkOrder: { workOrderId: string; client: string | null; vehicle: string | null; plateNumber: string | null; grossProfit: number; marginPercent: number | null } | null;
    losingWorkOrders: Array<{ workOrderId: string; client: string | null; vehicle: string | null; plateNumber: string | null; grossProfit: number; marginPercent: number | null }>;
    losingCount: number;
    lowMarginParts: Array<{ name: string; article: string | null; brand: string | null; profit: number; marginPercent: number | null }>;
    lowMarginPartsCount: number;
    topMechanic: { mechanicId: string; name: string; profit: number; marginPercent: number | null } | null;
    topSupplier: { supplierId: string; name: string; profit: number; marginPercent: number | null } | null;
  };
  cashClose: {
    businessDate: string;
    accounts: Array<Account & { close: { id: string; systemAmount: number; countedAmount: number; difference: number; note: string | null; closedAt: string } | null }>;
    recent: Array<{ id: string; businessDate: string; moneyAccountId: string; accountName: string; systemAmount: number; countedAmount: number; difference: number; note: string | null; closedAt: string }>;
  };
};

export type FinanceV3Data = {
  currency: string;
  viewer?: { persona: "OWNER" | "CASHIER" | "STATION_MANAGER" | "FINANCE" | "STANDARD"; primaryRole: string | null; userName: string | null; roles: Array<{ code: string; name: string; isPrimary: boolean }> };
  control?: Control;
  kpi: { currentCash: number; revenue: number; grossProfit: number; netProfit: number; cashFlow: number; grossMarginPercent: number | null; receivables: number; payables: number; overdueReceivables: number; overduePayables: number };
  pnl: { revenue: number; cogs: number; grossProfit: number; opex: number; otherExpense: number; tax: number; netProfit: number; grossMarginPercent: number | null; events: PnlEvent[] };
  cashFlow: { inflow: number; outflow: number; net: number; transactions: CashTx[] };
  accounts: Account[];
  obligations: Obligation[];
  forecast: { minimumForecastCash: number; minimumReserve: number; horizonDays: number };
  calendar: Array<{ id: string; sourceType: string; direction: "INFLOW" | "OUTFLOW"; amount: number; weightedAmount: number; expectedAt: string; status: string; counterparty: string | null; description: string | null; sourceId: string | null }>;
  settings: { warningGrossMarginPercent: number; targetGrossMarginPercent: number };
  ownerSummary?: {
    netIncome: number;
    serviceTurnover: number;
    partsMargin: number;
    payrollAccrued: number;
    payrollDue: number;
    grossIncome: number;
    totalExpenses: number;
    cash: number;
    partsRevenue: number;
    partsCost: number;
    serviceBreakdown: { labor: number; diagnostics: number; external: number; other: number };
    expenseBreakdown: { payroll: number; otherDirect: number; otherOperating: number; otherExpense: number; tax: number };
    payrollEmployees: Array<{ employeeId: string; name: string; position: string | null; accrued: number; due: number; labor: number; sales: number; baseAndOther: number; profitShare: number }>;
  };
};

function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}
function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00+03:00` : value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function accountGroup(data: FinanceV3Data, types: string[]) {
  return data.accounts.filter((account) => types.includes(account.type)).reduce((sum, account) => sum + account.balance, 0);
}

function Card({ label, value, note, tone = "default", onClick }: { label: string; value: string; note?: string; tone?: "default" | "good" | "warn" | "bad"; onClick?: () => void }) {
  const body = <><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</>;
  return onClick
    ? <button type="button" className={`${styles.kpi} ${styles[`tone_${tone}`]}`} onClick={onClick}>{body}</button>
    : <div className={`${styles.kpi} ${styles[`tone_${tone}`]}`}>{body}</div>;
}

function overviewMetrics(data: FinanceV3Data) {
  const persona = data.viewer?.persona || "STANDARD";
  const base = [
    { key: "currentCash" as const, label: "Залишок коштів зараз", value: data.kpi.currentCash, note: "на рахунках зараз" },
    { key: "revenue" as const, label: "Виконано / нараховано", value: data.kpi.revenue, note: "виручка за період" },
    { key: "grossProfit" as const, label: "Валовий прибуток", value: data.kpi.grossProfit, note: `маржа ${percent(data.kpi.grossMarginPercent)}` },
    { key: "netProfit" as const, label: "Чистий прибуток", value: data.kpi.netProfit, note: "управлінський" },
    { key: "cashIn" as const, label: "Отримано грошей", value: data.cashFlow.inflow, note: "фактичні надходження" },
    { key: "cashOut" as const, label: "Витрачено грошей", value: data.cashFlow.outflow, note: "фактичні виплати" },
    { key: "receivables" as const, label: "Нам винні", value: data.kpi.receivables, note: `прострочено ${money(data.kpi.overdueReceivables)}` },
    { key: "payables" as const, label: "Ми винні", value: data.kpi.payables, note: `прострочено ${money(data.kpi.overduePayables)}` },
  ];
  if (persona === "CASHIER") return [base[0], base[4], base[5], base[6], base[7]];
  if (persona === "STATION_MANAGER") return [base[1], base[4], base[6], base[5], base[0]];
  return base;
}

export function FinanceContextKpis({ data, tab, onMetric }: { data: FinanceV3Data; tab: FinanceV3Tab; onMetric: (metric: FinanceDrilldownMetric) => void }) {
  const control = data.control;
  let items: Array<{ key: FinanceDrilldownMetric; label: string; value: number; note?: string; tone?: "default" | "good" | "warn" | "bad" }> = [];
  if (tab === "overview") items = overviewMetrics(data);
  if (tab === "pnl") items = [
    { key: "revenue", label: "Виручка", value: data.pnl.revenue },
    { key: "cogs", label: "Собівартість (COGS)", value: data.pnl.cogs },
    { key: "grossProfit", label: "Валовий прибуток", value: data.pnl.grossProfit, note: `маржа ${percent(data.pnl.grossMarginPercent)}` },
    { key: "opex", label: "Операційні витрати", value: data.pnl.opex },
    { key: "netProfit", label: "Чистий прибуток", value: data.pnl.netProfit },
  ];
  if (tab === "cash") items = [
    { key: "cashIn", label: "Надійшло", value: data.cashFlow.inflow },
    { key: "cashOut", label: "Витрачено", value: data.cashFlow.outflow },
    { key: "cashNet", label: "Рух грошей за період", value: data.cashFlow.net, note: "Net Cash Flow" },
    { key: "currentCash", label: "Залишок коштів зараз", value: data.kpi.currentCash, note: "не залежить від періоду" },
  ];
  if (tab === "plan") {
    const planRows = control?.plan.metrics || [];
    items = planRows.slice(0, 4).map((row) => ({
      key: row.metric === "REVENUE" ? "revenue" : row.metric === "GROSS_PROFIT" ? "grossProfit" : row.metric === "OPEX" ? "opex" : "currentCash",
      label: `${row.label}: факт`,
      value: row.actual,
      note: row.plan > 0 ? `план ${money(row.plan)} · ${row.completionPercent == null ? "—" : percent(row.completionPercent)}` : "план ще не визначено",
    })) as typeof items;
  }
  if (tab === "calendar") {
    const expectedIn = data.calendar.filter((item) => item.direction === "INFLOW").reduce((sum, item) => sum + item.weightedAmount, 0);
    const expectedOut = data.calendar.filter((item) => item.direction === "OUTFLOW").reduce((sum, item) => sum + item.weightedAmount, 0);
    items = [
      { key: "currentCash", label: "Залишок коштів зараз", value: data.kpi.currentCash },
      { key: "cashIn", label: "Очікувані надходження", value: expectedIn },
      { key: "cashOut", label: "Майбутні виплати", value: expectedOut },
      { key: "currentCash", label: "Мінімальний прогноз", value: data.forecast.minimumForecastCash, note: control?.forecast.minimum ? dateText(control.forecast.minimum.date) : `${data.forecast.horizonDays} днів`, tone: data.forecast.minimumForecastCash < data.forecast.minimumReserve ? "warn" : "default" },
    ];
  }
  if (tab === "debts") items = [
    { key: "receivables", label: "Дебіторка", value: data.kpi.receivables },
    { key: "overdueReceivables", label: "Прострочена дебіторка", value: data.kpi.overdueReceivables, tone: data.kpi.overdueReceivables > 0 ? "warn" : "good" },
    { key: "payables", label: "Кредиторка", value: data.kpi.payables },
    { key: "overduePayables", label: "Прострочена кредиторка", value: data.kpi.overduePayables, tone: data.kpi.overduePayables > 0 ? "warn" : "good" },
  ];
  if (tab === "profitability") items = [
    { key: "grossProfit", label: "Середня валова маржа", value: data.kpi.grossProfit, note: percent(data.kpi.grossMarginPercent) },
    { key: "grossProfit", label: "Найприбутковіший ЗН", value: control?.profitability.topWorkOrder?.grossProfit || 0, note: control?.profitability.topWorkOrder?.plateNumber || control?.profitability.topWorkOrder?.workOrderId || "немає даних" },
    { key: "netProfit", label: "Збиткових ЗН", value: control?.profitability.losingCount || 0, note: "кількість", tone: (control?.profitability.losingCount || 0) > 0 ? "warn" : "good" },
    { key: "cogs", label: "Запчастин нижче порогу", value: control?.profitability.lowMarginPartsCount || 0, note: `поріг ${percent(data.settings.warningGrossMarginPercent)}`, tone: (control?.profitability.lowMarginPartsCount || 0) > 0 ? "warn" : "good" },
  ];
  if (tab === "expenses") items = [
    { key: "opex", label: "Витрати P&L", value: data.pnl.cogs + data.pnl.opex + data.pnl.otherExpense + data.pnl.tax },
    { key: "cashOut", label: "Фактично сплачено", value: data.cashFlow.outflow },
    { key: "payables", label: "До оплати", value: data.kpi.payables },
    { key: "overduePayables", label: "Прострочено", value: data.kpi.overduePayables, tone: data.kpi.overduePayables > 0 ? "warn" : "good" },
  ];
  if (tab === "accounts") items = [
    { key: "currentCash", label: "Разом на рахунках", value: data.kpi.currentCash },
    { key: "currentCash", label: "Каса", value: accountGroup(data, ["CASH"]) },
    { key: "currentCash", label: "POS / картка", value: accountGroup(data, ["ACQUIRING", "CARD"]) },
    { key: "currentCash", label: "Банк", value: accountGroup(data, ["BANK"]) },
  ];

  return <section className={styles.kpiGrid}>{items.map((item, index) => (
    <Card key={`${item.key}:${index}`} label={item.label} value={item.label.includes("кількість") || (tab === "profitability" && ["Збиткових ЗН","Запчастин нижче порогу"].includes(item.label)) ? String(item.value) : money(item.value)} note={item.note} tone={item.tone} onClick={() => onMetric(item.key)} />
  ))}</section>;
}

export function FinanceOverviewControl({ data }: { data: FinanceV3Data }) {
  const control = data.control;
  if (!control) return null;
  const persona = data.viewer?.persona || "STANDARD";
  const fullFinance = persona === "OWNER" || persona === "FINANCE";
  const cashOnly = persona === "CASHIER" || persona === "STANDARD";
  const statusLabel = control.reconciliation.status === "OK" ? "Фінанси узгоджені" : `Є ${control.reconciliation.issueCount} розбіжностей`;
  return <div className={fullFinance ? styles.twoColumns : undefined}>
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span>СЬОГОДНІ</span><h2>Операційна картина</h2><p>{dateText(control.today.date)} · окремо від вибраного періоду</p></div></div>
      <div className={styles.todayGrid}>
        {!cashOnly && <div><span>Нараховано виручки</span><strong>{money(control.today.revenue)}</strong></div>}
        <div><span>Отримано</span><strong>{money(control.today.cashIn)}</strong></div>
        <div><span>Витрачено</span><strong>{money(control.today.cashOut)}</strong></div>
        <div><span>Net Cash Flow</span><strong>{money(control.today.netCashFlow)}</strong></div>
        {!cashOnly && <div><span>Нова дебіторка</span><strong>{money(control.today.receivablesCreated)}</strong></div>}
        <div><span>Погашено дебіторки</span><strong>{money(control.today.receivablesCollected)}</strong></div>
      </div>
    </section>
    {fullFinance && <section className={`${styles.panel} ${styles.reconciliation} ${styles[`recon_${control.reconciliation.status.toLowerCase()}`]}`}>
      <div className={styles.panelHeader}><div><span>ЗВІРКА ФІНАНСІВ</span><h2>{statusLabel}</h2><p>Перевірка зв'язків між нарахуваннями, боргами та фактичними платежами.</p></div></div>
      {control.reconciliation.issues.length ? <div className={styles.issueList}>{control.reconciliation.issues.map((issue) => <details key={issue.code}><summary><strong>{issue.title}</strong><span>{issue.count} · {money(issue.amount)}</span></summary><p>{issue.message}</p>{issue.samples.length > 0 && <small>Приклади: {issue.samples.join(", ")}</small>}</details>)}</div> : <div className={styles.okState}>✓ Критичних розбіжностей у перевірених інваріантах немає.</div>}
    </section>}
  </div>;
}

export function FinanceAccrualBridge({ data }: { data: FinanceV3Data }) {
  const persona = data.viewer?.persona || "STANDARD";
  if (persona === "CASHIER" || persona === "STANDARD") return null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>НАРАХОВАНО ≠ ОТРИМАНО</span><h2>Від послуги до грошей</h2><p>Прибуток і рух грошей — різні події.</p></div></div>
    <div className={styles.bridgeGrid}>
      <div><span>Виконано / нараховано</span><strong>{money(data.kpi.revenue)}</strong><small>P&L</small></div>
      <div className={styles.arrow}>→</div>
      <div><span>Отримано грошей</span><strong>{money(data.cashFlow.inflow)}</strong><small>Cash Flow</small></div>
      <div className={styles.arrow}>→</div>
      <div><span>Ще до отримання</span><strong>{money(data.kpi.receivables)}</strong><small>Дебіторка</small></div>
    </div>
  </section>;
}

export function FinanceMarginControl({ data }: { data: FinanceV3Data }) {
  if (!data.control) return null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>МАРЖА</span><h2>Маржа за напрямами</h2><p>Поріг уваги {percent(data.settings.warningGrossMarginPercent)} · ціль {percent(data.settings.targetGrossMarginPercent)}</p></div></div>
    <div className={styles.marginGrid}>{data.control.margins.map((row) => <div key={row.label} className={`${styles.marginCard} ${styles[`margin_${row.state.toLowerCase()}`]}`}>
      <span>{row.label}</span><strong>{row.marginPercent == null ? "—" : percent(row.marginPercent)}</strong>
      <small>Виручка {money(row.revenue)} · прямі витрати {money(row.directCost)}</small>
      {!row.costTracked && <em>Собівартість ще не розподілена — 100% не показуємо.</em>}
    </div>)}</div>
  </section>;
}

export function FinancePlanPace({ data, onCreatePlan }: { data: FinanceV3Data; onCreatePlan: () => void }) {
  const plan = data.control?.plan;
  if (!plan) return null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>ТЕМП ВИКОНАННЯ</span><h2>План, факт і прогноз темпу</h2><p>Минуло {percent(plan.elapsedPercent)} вибраного періоду. «Автоплан» використовується тільки якщо ручного бюджету немає.</p></div><button type="button" className={styles.primaryButton} onClick={onCreatePlan}>+ Створити план</button></div>
    <div className={styles.planGrid}>{plan.metrics.map((row) => <div key={row.metric} className={styles.planCard}>
      <div><span>{row.label}</span><b>{row.source === "BUDGET" ? "Ручний план" : row.source === "AUTO" ? "Автоплан" : "Без плану"}</b></div>
      <strong>{money(row.actual)} <small>/ {row.plan > 0 ? money(row.plan) : "—"}</small></strong>
      <div className={styles.progress}><i style={{ width: `${Math.max(0, Math.min(100, row.completionPercent || 0))}%` }} /></div>
      <small>За поточним темпом: {money(row.paceForecast)} · прогноз виконання {percent(row.projectedCompletionPercent)}</small>
    </div>)}</div>
  </section>;
}

export function FinanceForecastReasons({ data }: { data: FinanceV3Data }) {
  const forecast = data.control?.forecast;
  if (!forecast) return null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>ПРОГНОЗ ГРОШЕЙ</span><h2>Коли і чому зміниться залишок</h2></div></div>
    <div className={styles.forecastKpis}>
      <div><span>Зараз</span><strong>{money(forecast.currentCash)}</strong></div>
      <div><span>Через 7 днів</span><strong>{money(forecast.in7Days)}</strong></div>
      <div><span>Через 30 днів</span><strong>{money(forecast.in30Days)}</strong></div>
      <div><span>Найнижча точка</span><strong>{money(forecast.minimum?.closingCash)}</strong><small>{dateText(forecast.minimum?.date)}</small></div>
    </div>
    {forecast.drivers.length > 0 && <div className={styles.driverList}><h3>Що формує найнижчу точку</h3>{forecast.drivers.map((item) => <div key={item.id}><span>{item.direction === "OUTFLOW" ? "−" : "+"}{money(item.weightedAmount)} · {item.counterparty || item.description || item.sourceType}</span><small>{item.sourceType} · {dateText(item.expectedAt)}</small></div>)}</div>}
  </section>;
}

export function FinanceProfitabilityHighlights({ data }: { data: FinanceV3Data }) {
  const p = data.control?.profitability;
  if (!p) return null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>КОНТРОЛЬ ПРИБУТКОВОСТІ</span><h2>Що заробляє, а що забирає маржу</h2></div></div>
    <div className={styles.highlightGrid}>
      <div><span>Найприбутковіший ЗН</span><strong>{money(p.topWorkOrder?.grossProfit || 0)}</strong><small>{p.topWorkOrder?.plateNumber || p.topWorkOrder?.vehicle || "немає даних"}</small></div>
      <div className={p.losingCount ? styles.badBox : styles.goodBox}><span>Збиткові ЗН</span><strong>{p.losingCount}</strong><small>{p.losingWorkOrders[0] ? `найгірший ${money(p.losingWorkOrders[0].grossProfit)}` : "немає"}</small></div>
      <div className={p.lowMarginPartsCount ? styles.warnBox : styles.goodBox}><span>Запчастини нижче маржі</span><strong>{p.lowMarginPartsCount}</strong><small>{p.lowMarginParts[0]?.name || "немає"}</small></div>
      <div><span>Найкращий внесок механіка</span><strong>{money(p.topMechanic?.profit || 0)}</strong><small>{p.topMechanic?.name || "немає даних"}</small></div>
      <div><span>Постачальник за маржею</span><strong>{p.topSupplier?.marginPercent == null ? "—" : percent(p.topSupplier.marginPercent)}</strong><small>{p.topSupplier?.name || "немає даних"}</small></div>
    </div>
  </section>;
}

export function FinanceCalendarActions({ data, onDebts, onSettings }: { data: FinanceV3Data; onDebts: () => void; onSettings: () => void }) {
  const upcoming = useMemo(() => [...(data.control?.forecast.drivers || [])], [data.control?.forecast.drivers]);
  if (!upcoming.length) return null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>ДІЇ</span><h2>Що можна зробити з прогнозом</h2></div></div>
    <div className={styles.actionRows}>{upcoming.map((item) => <div key={item.id}><span><strong>{item.direction === "OUTFLOW" ? "Виплата" : "Надходження"} {money(item.weightedAmount)}</strong><small>{item.counterparty || item.description || item.sourceType}</small></span><button type="button" onClick={item.sourceType === "RECURRING" ? onSettings : onDebts}>{item.sourceType === "RECURRING" ? "Відкрити правило" : "Відкрити борги"}</button></div>)}</div>
  </section>;
}

export function FinanceCashClosePanel({ data, onCloseDay }: { data: FinanceV3Data; onCloseDay: (payload: { moneyAccountId: string; countedAmount: number; businessDate: string; note?: string }) => Promise<void> }) {
  const cashClose = data.control?.cashClose;
  const [accountId, setAccountId] = useState(cashClose?.accounts[0]?.id || "");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  if (!cashClose || !cashClose.accounts.length) return <section className={styles.panel}><div className={styles.empty}>Активної каси не налаштовано. Створіть CASH-рахунок у фінансових рахунках.</div></section>;
  const selected = cashClose.accounts.find((row) => row.id === accountId) || cashClose.accounts[0];
  const countedNumber = Number(counted.replace(",", "."));
  const previewDifference = Number.isFinite(countedNumber) ? countedNumber - selected.balance : null;
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span>ЗАКРИТТЯ ДНЯ</span><h2>Звірити касу</h2><p>Фактичний перерахунок не змінює ledger автоматично.</p></div></div>
    <div className={styles.cashCloseGrid}>
      <label>Каса<select value={selected.id} onChange={(event) => { setAccountId(event.target.value); setCounted(""); }}>{cashClose.accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
      <div><span>За системою</span><strong>{money(selected.balance)}</strong></div>
      <label>Фактично<input inputMode="decimal" value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0,00" /></label>
      <div className={previewDifference == null ? "" : previewDifference === 0 ? styles.goodBox : styles.badBox}><span>Розбіжність</span><strong>{previewDifference == null ? "—" : money(previewDifference)}</strong></div>
      <label className={styles.noteField}>Коментар<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Причина розбіжності, якщо є" /></label>
      <button type="button" className={styles.primaryButton} disabled={saving || !Number.isFinite(countedNumber) || countedNumber < 0} onClick={async () => { setSaving(true); try { await onCloseDay({ moneyAccountId: selected.id, countedAmount: countedNumber, businessDate: cashClose.businessDate, note: note || undefined }); setCounted(""); setNote(""); } finally { setSaving(false); } }}>{saving ? "Зберігаю…" : selected.close ? "Оновити закриття" : "Закрити касовий день"}</button>
    </div>
    {selected.close && <div className={`${styles.closeResult} ${selected.close.difference === 0 ? styles.goodBox : styles.badBox}`}><strong>{selected.close.difference === 0 ? "✓ Каса закрита без розбіжностей" : `Розбіжність ${money(selected.close.difference)}`}</strong><small>Фактично {money(selected.close.countedAmount)} · система {money(selected.close.systemAmount)} · {dateText(selected.close.closedAt)}</small></div>}
  </section>;
}

export function FinanceDrilldown({ data, metric, onClose }: { data: FinanceV3Data; metric: FinanceDrilldownMetric | null; onClose: () => void }) {
  if (!metric) return null;
  const titles: Record<FinanceDrilldownMetric, string> = {
    currentCash: "Залишок коштів зараз", revenue: "Виручка", grossProfit: "Валовий прибуток", netProfit: "Чистий прибуток",
    cashIn: "Надходження", cashOut: "Виплати", cashNet: "Net Cash Flow", receivables: "Дебіторка", payables: "Кредиторка",
    cogs: "Собівартість", opex: "Операційні витрати", overdueReceivables: "Прострочена дебіторка", overduePayables: "Прострочена кредиторка",
  };
  const eventSections = metric === "revenue" ? ["REVENUE"] : metric === "cogs" ? ["COGS"] : metric === "opex" ? ["OPEX","OTHER_EXPENSE","TAX"] : [];
  const events = eventSections.length ? data.pnl.events.filter((event) => eventSections.includes(event.pnlSection)) : [];
  const cash = metric === "cashIn" ? data.cashFlow.transactions.filter((tx) => tx.kind === "INFLOW") : metric === "cashOut" ? data.cashFlow.transactions.filter((tx) => tx.kind === "OUTFLOW") : [];
  const obligations = ["receivables","overdueReceivables"].includes(metric)
    ? data.obligations.filter((row) => row.direction === "RECEIVABLE" && (metric !== "overdueReceivables" || row.isOverdue))
    : ["payables","overduePayables"].includes(metric)
      ? data.obligations.filter((row) => row.direction === "PAYABLE" && (metric !== "overduePayables" || row.isOverdue))
      : [];

  return <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer}>
      <header><div><span>ДЕТАЛІЗАЦІЯ</span><h2>{titles[metric]}</h2></div><button type="button" onClick={onClose}>✕</button></header>
      {metric === "currentCash" && <div className={styles.drawerList}>{data.accounts.map((row) => <div key={row.id}><span><strong>{row.name}</strong><small>{row.type} · початково {money(row.openingBalance)}</small></span><strong>{money(row.balance)}</strong></div>)}</div>}
      {metric === "cashNet" && <div className={styles.drawerList}><div><span>Надійшло</span><strong>{money(data.cashFlow.inflow)}</strong></div><div><span>− Витрачено</span><strong>{money(data.cashFlow.outflow)}</strong></div><div><span>= Net Cash Flow</span><strong>{money(data.cashFlow.net)}</strong></div></div>}
      {(metric === "grossProfit" || metric === "netProfit") && <div className={styles.drawerList}>
        <div><span>Виручка</span><strong>{money(data.pnl.revenue)}</strong></div>
        <div><span>− Собівартість</span><strong>{money(data.pnl.cogs)}</strong></div>
        <div><span>= Валовий прибуток</span><strong>{money(data.pnl.grossProfit)}</strong></div>
        {metric === "netProfit" && <><div><span>− OPEX</span><strong>{money(data.pnl.opex)}</strong></div><div><span>= Чистий прибуток</span><strong>{money(data.pnl.netProfit)}</strong></div></>}
      </div>}
      {events.length > 0 && <div className={styles.drawerList}>{events.map((row) => <button type="button" key={row.id} onClick={() => row.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: row.workOrderId })}><span><strong>{row.category?.name || row.pnlSection}</strong><small>{dateText(row.recognizedAt)} · {row.description || "без опису"}{row.workOrderId ? ` · ЗН ${row.workOrderId}` : ""}</small></span><strong>{money(row.amount)}</strong></button>)}</div>}
      {cash.length > 0 && <div className={styles.drawerList}>{cash.map((row) => <div key={row.id}><span><strong>{row.description || row.flowSection}</strong><small>{dateText(row.occurredAt)}</small></span><strong>{money(row.amount)}</strong></div>)}</div>}
      {obligations.length > 0 && <div className={styles.drawerList}>{obligations.map((row) => <button type="button" key={row.id} onClick={() => row.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: row.workOrderId })}><span><strong>{row.counterpartyName || row.description || "Зобов'язання"}</strong><small>{row.status} · до {dateText(row.dueAt)}{row.isOverdue ? ` · прострочено ${row.overdueDays} дн.` : ""}</small></span><strong>{money(row.outstanding)}</strong></button>)}</div>}
      {!events.length && !cash.length && !obligations.length && metric !== "currentCash" && metric !== "grossProfit" && metric !== "netProfit" && metric !== "cashNet" && <div className={styles.empty}>Для цього показника немає окремих фактичних рядків у вибраному періоді.</div>}
    </aside>
  </div>;
}
