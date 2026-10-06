"use client";

import type { FinanceExpenseSummary } from "./finance-expenses-v2";
import type { FinanceV2, ProfitTab, Tab } from "./financial-center-legacy";
import styles from "./financial-center-v2.module.css";

export type FinancialDrilldownKey =
  | "currentCash"
  | "revenue"
  | "cogs"
  | "grossProfit"
  | "opex"
  | "netProfit"
  | "cashInflow"
  | "cashOutflow"
  | "cashNet"
  | "receivables"
  | "overdueReceivables"
  | "payables"
  | "overduePayables"
  | "forecastMinimum"
  | "plan";

function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}
function percent(value: number | null | undefined) {
  return value == null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}
function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function ContextKpi({ label, value, note, onClick }: { label: string; value: string; note?: string; onClick?: () => void }) {
  const content = <><span>{label}</span><strong>{value}</strong><small>{note || ""}</small></>;
  if (!onClick) return <div className={styles.kpi}>{content}</div>;
  return <button type="button" className={`${styles.kpi} ${styles.kpiButton}`} onClick={onClick}>{content}</button>;
}

function budgetSummary(data: FinanceV2) {
  const withPercent = data.budgets.filter((item) => item.completionPercent != null);
  return {
    count: data.budgets.length,
    plan: data.budgets.reduce((sum, item) => sum + item.amount, 0),
    actual: data.budgets.reduce((sum, item) => sum + item.actual, 0),
    average: withPercent.length ? withPercent.reduce((sum, item) => sum + (item.completionPercent || 0), 0) / withPercent.length : null,
    outOfRange: withPercent.filter((item) => Math.abs((item.completionPercent || 0) - 100) >= 20).length,
  };
}

function profitabilitySummary(data: FinanceV2, active: ProfitTab) {
  const rows = active === "workOrders"
    ? data.profitability.workOrders.map((row) => ({ revenue: row.revenue, directCost: row.directCost, profit: row.grossProfit, margin: row.marginPercent }))
    : active === "services"
      ? data.profitability.services.map((row) => ({ revenue: row.revenue, directCost: row.directCost, profit: row.profit, margin: row.marginPercent }))
      : active === "mechanics"
        ? data.profitability.mechanics.map((row) => ({ revenue: row.revenue, directCost: row.directCost, profit: row.profit, margin: row.marginPercent }))
        : active === "parts"
          ? data.profitability.parts.map((row) => ({ revenue: row.revenue, directCost: row.directCost, profit: row.profit, margin: row.marginPercent }))
          : data.profitability.suppliers.map((row) => ({ revenue: row.revenue, directCost: row.directCost, profit: row.profit, margin: row.marginPercent }));
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const directCost = rows.reduce((sum, row) => sum + row.directCost, 0);
  const profit = rows.reduce((sum, row) => sum + row.profit, 0);
  return {
    revenue,
    directCost,
    profit,
    margin: revenue > 0 ? profit / revenue * 100 : null,
    lowMargin: rows.filter((row) => row.margin != null && row.margin < data.settings.warningGrossMarginPercent).length,
  };
}

function forecastPoint(data: FinanceV2, days: number) {
  if (!data.forecast.points.length) return null;
  const target = new Date();
  target.setDate(target.getDate() + days);
  const targetKey = target.toISOString().slice(0, 10);
  return data.forecast.points.find((point) => point.date >= targetKey) || data.forecast.points[data.forecast.points.length - 1] || null;
}

export function FinanceContextKpis({
  data,
  tab,
  profitTab,
  expenseSummary,
  onDrilldown,
}: {
  data: FinanceV2;
  tab: Tab;
  profitTab: ProfitTab;
  expenseSummary: FinanceExpenseSummary;
  onDrilldown: (key: FinancialDrilldownKey) => void;
}) {
  if (tab === "overview" || tab === "accounts" || tab === "settings") return null;

  if (tab === "pnl") return <section className={styles.contextKpiGrid}>
    <ContextKpi label="Виручка" value={money(data.pnl.revenue)} onClick={() => onDrilldown("revenue")} />
    <ContextKpi label="Собівартість (COGS)" value={money(data.pnl.cogs)} onClick={() => onDrilldown("cogs")} />
    <ContextKpi label="Валовий прибуток" value={money(data.pnl.grossProfit)} onClick={() => onDrilldown("grossProfit")} />
    <ContextKpi label="Валова маржа" value={percent(data.pnl.grossMarginPercent)} note={`ціль ${percent(data.settings.targetGrossMarginPercent)}`} />
    <ContextKpi label="Операційні витрати (OPEX)" value={money(data.pnl.opex)} onClick={() => onDrilldown("opex")} />
    <ContextKpi label="Чистий прибуток" value={money(data.pnl.netProfit)} onClick={() => onDrilldown("netProfit")} />
  </section>;

  if (tab === "cash") return <section className={styles.contextKpiGrid}>
    <ContextKpi label="Залишок зараз" value={money(data.kpi.currentCash)} note="не залежить від періоду" onClick={() => onDrilldown("currentCash")} />
    <ContextKpi label="Надійшло" value={money(data.cashFlow.inflow)} onClick={() => onDrilldown("cashInflow")} />
    <ContextKpi label="Сплачено" value={money(data.cashFlow.outflow)} onClick={() => onDrilldown("cashOutflow")} />
    <ContextKpi label="Net Cash Flow" value={money(data.cashFlow.net)} note="надходження − виплати" onClick={() => onDrilldown("cashNet")} />
  </section>;

  if (tab === "plan") {
    const summary = budgetSummary(data);
    return <section className={styles.contextKpiGrid}>
      <ContextKpi label="Активних планів" value={String(summary.count)} />
      <ContextKpi label="План загалом" value={money(summary.plan)} note="сума активних бюджетів" onClick={() => onDrilldown("plan")} />
      <ContextKpi label="Факт загалом" value={money(summary.actual)} onClick={() => onDrilldown("plan")} />
      <ContextKpi label="Середнє виконання" value={percent(summary.average)} />
      <ContextKpi label="Поза коридором ±20%" value={String(summary.outOfRange)} note={summary.outOfRange ? "потребує уваги" : "відхилень немає"} />
    </section>;
  }

  if (tab === "calendar") {
    const expectedIn = data.calendar.filter((item) => item.direction === "INFLOW").reduce((sum, item) => sum + item.weightedAmount, 0);
    const expectedOut = data.calendar.filter((item) => item.direction === "OUTFLOW").reduce((sum, item) => sum + item.weightedAmount, 0);
    const minimum = data.forecast.points.reduce<FinanceV2["forecast"]["points"][number] | null>((best, point) => !best || point.closingCash < best.closingCash ? point : best, null);
    const day7 = forecastPoint(data, 7);
    const day30 = forecastPoint(data, 30);
    return <section className={styles.contextKpiGrid}>
      <ContextKpi label="Залишок зараз" value={money(data.kpi.currentCash)} onClick={() => onDrilldown("currentCash")} />
      <ContextKpi label="Очікуємо надходжень" value={money(expectedIn)} />
      <ContextKpi label="Очікуємо виплат" value={money(expectedOut)} />
      <ContextKpi label="Через 7 днів" value={money(day7?.closingCash)} />
      <ContextKpi label="Через 30 днів" value={money(day30?.closingCash)} />
      <ContextKpi label="Мінімум прогнозу" value={money(data.forecast.minimumForecastCash)} note={minimum ? dateText(minimum.date) : "—"} onClick={() => onDrilldown("forecastMinimum")} />
    </section>;
  }

  if (tab === "debts") return <section className={styles.contextKpiGrid}>
    <ContextKpi label="Дебіторка" value={money(data.kpi.receivables)} onClick={() => onDrilldown("receivables")} />
    <ContextKpi label="Прострочена дебіторка" value={money(data.kpi.overdueReceivables)} onClick={() => onDrilldown("overdueReceivables")} />
    <ContextKpi label="Кредиторка" value={money(data.kpi.payables)} onClick={() => onDrilldown("payables")} />
    <ContextKpi label="Прострочена кредиторка" value={money(data.kpi.overduePayables)} onClick={() => onDrilldown("overduePayables")} />
  </section>;

  if (tab === "profitability") {
    const summary = profitabilitySummary(data, profitTab);
    return <section className={styles.contextKpiGrid}>
      <ContextKpi label="Виручка зрізу" value={money(summary.revenue)} />
      <ContextKpi label="Прямі витрати" value={money(summary.directCost)} />
      <ContextKpi label="Валовий прибуток" value={money(summary.profit)} />
      <ContextKpi label="Зважена маржа" value={percent(summary.margin)} note={`ціль ${percent(data.settings.targetGrossMarginPercent)}`} />
      <ContextKpi label="Нижче порогу маржі" value={String(summary.lowMargin)} />
    </section>;
  }

  if (tab === "expenses") return <section className={styles.contextKpiGrid}>
    <ContextKpi label="Документів" value={String(expenseSummary.rowsCount)} />
    <ContextKpi label="Сума витрат" value={money(expenseSummary.totalAmount)} />
    <ContextKpi label="Оплачено" value={money(expenseSummary.paidAmount)} />
    <ContextKpi label="До оплати" value={money(expenseSummary.outstanding)} />
    <ContextKpi label="Прострочено" value={money(expenseSummary.overdueOutstanding)} />
    <ContextKpi label="На погодженні" value={String(expenseSummary.pendingApprovalCount)} />
  </section>;

  return null;
}

type ControlIssue = { level: "INFO" | "WARNING" | "CRITICAL"; code: string; title: string; message: string; tab: Tab };

export function financialControlIssues(data: FinanceV2): ControlIssue[] {
  const items: ControlIssue[] = data.alerts.map((alert) => ({
    level: alert.level,
    code: alert.code,
    title: alert.title,
    message: alert.message,
    tab: alert.code.includes("BUDGET") ? "plan" : alert.code.includes("OVERDUE") ? "debts" : alert.code.includes("MARGIN") ? "profitability" : alert.code.includes("CASH") || alert.code.includes("RESERVE") ? "calendar" : "pnl",
  }));
  if (data.pnl.revenue > 0 && data.pnl.cogs === 0) items.push({ level: "WARNING", code: "COGS_ZERO", title: "Перевірте собівартість", message: "Є виручка, але COGS за період дорівнює 0. Для діагностики це може бути нормально; для ремонту або запчастин перевірте прямі витрати.", tab: "pnl" });
  if (data.settings.fixedMonthlyCosts <= 0) items.push({ level: "WARNING", code: "FIXED_COSTS_ZERO", title: "Не задані постійні витрати", message: "Точка беззбитковості та прогноз управлінського прибутку будуть неповними.", tab: "settings" });
  if (!data.budgets.length) items.push({ level: "INFO", code: "NO_BUDGETS", title: "План не заданий", message: "Додайте бюджет виручки або витрат, щоб бачити план/факт і темп виконання.", tab: "plan" });
  if (!data.recurring.length) items.push({ level: "INFO", code: "NO_RECURRING", title: "Немає регулярних операцій", message: "Оренда, зарплати та інші регулярні платежі покращують точність прогнозу грошей.", tab: "calendar" });

  const seen = new Set<string>();
  const priority: Record<ControlIssue["level"], number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return items.filter((item) => {
    const key = `${item.code}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => priority[a.level] - priority[b.level]);
}

export function FinancialControlPanel({ data, onTab }: { data: FinanceV2; onTab: (tab: Tab) => void }) {
  const issues = financialControlIssues(data);
  const actionable = issues.filter((item) => item.level !== "INFO");
  return <section className={styles.panel}>
    <div className={styles.panelHeader}>
      <div>
        <span className={styles.eyebrow}>КОНТРОЛЬ ДАНИХ</span>
        <h2>Якість фінансової картини</h2>
        <p>Перевірки, які впливають на довіру до управлінських цифр. Різниця між P&L і Cash Flow сама по собі не є помилкою.</p>
      </div>
      <span className={`${styles.controlStatus} ${actionable.some((item) => item.level === "CRITICAL") ? styles.bad : actionable.length ? styles.warn : styles.good}`}>
        {actionable.some((item) => item.level === "CRITICAL") ? "Є критичні питання" : actionable.length ? `Є питань: ${actionable.length}` : "Критичних питань немає"}
      </span>
    </div>
    <div className={styles.alertStack}>
      {issues.length ? issues.slice(0, 8).map((issue) => <button type="button" key={issue.code} className={`${styles.controlIssue} ${issue.level === "CRITICAL" ? styles.alertCritical : issue.level === "WARNING" ? styles.alertWarning : styles.alertInfo}`} onClick={() => onTab(issue.tab)}>
        <span className={styles.alertDot} />
        <span><strong>{issue.title}</strong><small>{issue.message}</small></span>
        <span>Відкрити →</span>
      </button>) : <div className={styles.empty}>За доступними фінансовими даними критичних сигналів немає.</div>}
    </div>
  </section>;
}

function modalTitle(key: FinancialDrilldownKey) {
  return ({
    currentCash: "Звідки взявся поточний залишок",
    revenue: "Звідки взялася виручка",
    cogs: "Звідки взялася собівартість",
    grossProfit: "Склад валового прибутку",
    opex: "Звідки взялися операційні витрати",
    netProfit: "Склад чистого прибутку",
    cashInflow: "Фактичні надходження",
    cashOutflow: "Фактичні виплати",
    cashNet: "Фактичний рух грошей",
    receivables: "Хто винен нам",
    overdueReceivables: "Прострочена дебіторка",
    payables: "Кому винні ми",
    overduePayables: "Прострочена кредиторка",
    forecastMinimum: "Мінімальна точка прогнозу",
    plan: "З чого складається план / факт",
  } as Record<FinancialDrilldownKey, string>)[key];
}

export function FinanceDrilldownModal({ drilldown, data, onClose }: { drilldown: FinancialDrilldownKey; data: FinanceV2; onClose: () => void }) {
  const eventSections =
    drilldown === "revenue" ? ["REVENUE"] :
    drilldown === "cogs" ? ["COGS"] :
    drilldown === "grossProfit" ? ["REVENUE", "COGS"] :
    drilldown === "opex" ? ["OPEX"] :
    drilldown === "netProfit" ? ["REVENUE", "COGS", "OPEX", "OTHER_INCOME", "OTHER_EXPENSE", "TAX"] : null;

  const cashKinds =
    drilldown === "cashInflow" ? ["INFLOW"] :
    drilldown === "cashOutflow" ? ["OUTFLOW"] :
    drilldown === "cashNet" ? ["INFLOW", "OUTFLOW"] : null;

  const obligationFilter =
    drilldown === "receivables" ? { direction: "RECEIVABLE", overdue: false } :
    drilldown === "overdueReceivables" ? { direction: "RECEIVABLE", overdue: true } :
    drilldown === "payables" ? { direction: "PAYABLE", overdue: false } :
    drilldown === "overduePayables" ? { direction: "PAYABLE", overdue: true } : null;

  const minimum = data.forecast.points.reduce<FinanceV2["forecast"]["points"][number] | null>((best, point) => !best || point.closingCash < best.closingCash ? point : best, null);

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true">
      <div className={styles.modalHeader}><div><span className={styles.eyebrow}>ДЕТАЛІ ПОКАЗНИКА</span><h2>{modalTitle(drilldown)}</h2></div><button type="button" className={styles.iconButton} onClick={onClose}>✕</button></div>

      {drilldown === "currentCash" && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Рахунок</th><th>Тип</th><th className={styles.numberCell}>Старт</th><th className={styles.numberCell}>Зараз</th></tr></thead><tbody>{data.accounts.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.type}</td><td className={styles.numberCell}>{money(row.openingBalance)}</td><td className={styles.numberCell}><strong>{money(row.balance)}</strong></td></tr>)}</tbody></table></div>}

      {eventSections && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Секція</th><th>Категорія</th><th>Джерело</th><th className={styles.numberCell}>Сума</th></tr></thead><tbody>{data.pnl.events.filter((row) => eventSections.includes(row.pnlSection)).map((row) => <tr key={row.id}><td>{dateText(row.recognizedAt)}</td><td>{row.pnlSection}</td><td>{row.category?.name || "Без категорії"}</td><td>{row.description || "—"}<small>{row.workOrderId ? `ЗН ${row.workOrderId}` : ""}</small></td><td className={styles.numberCell}><strong>{money(row.amount)}</strong></td></tr>)}</tbody></table></div>}

      {cashKinds && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Тип</th><th>Діяльність</th><th>Опис</th><th className={styles.numberCell}>Сума</th></tr></thead><tbody>{data.cashFlow.transactions.filter((row) => cashKinds.includes(row.kind)).map((row) => <tr key={row.id}><td>{dateText(row.occurredAt)}</td><td>{row.kind === "INFLOW" ? "Надходження" : "Виплата"}</td><td>{row.flowSection}</td><td>{row.description || "—"}</td><td className={styles.numberCell}><strong>{money(row.amount)}</strong></td></tr>)}</tbody></table></div>}

      {obligationFilter && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Контрагент</th><th>Джерело</th><th>Строк</th><th>Прострочення</th><th className={styles.numberCell}>Залишок</th></tr></thead><tbody>{data.obligations.filter((row) => row.direction === obligationFilter.direction && (!obligationFilter.overdue || row.isOverdue)).map((row) => <tr key={row.id}><td>{row.counterpartyName || "Без контрагента"}</td><td>{row.workOrderId ? `ЗН ${row.workOrderId}` : row.sourceEntity || row.description || "—"}</td><td>{dateText(row.dueAt)}</td><td>{row.isOverdue ? `${row.overdueDays} дн.` : "в строк"}</td><td className={styles.numberCell}><strong>{money(row.outstanding)}</strong></td></tr>)}</tbody></table></div>}

      {drilldown === "forecastMinimum" && <div>
        <div className={styles.miniCards}>
          <div className={styles.miniCard}><span>Мінімальний залишок</span><strong>{money(minimum?.closingCash)}</strong></div>
          <div className={styles.miniCard}><span>Дата</span><strong>{dateText(minimum?.date)}</strong></div>
          <div className={styles.miniCard}><span>Резерв</span><strong>{money(data.forecast.minimumReserve)}</strong></div>
        </div>
        <div className={styles.tableWrap} style={{ marginTop: 12 }}><table className={styles.table}><thead><tr><th>Подія на дату мінімуму</th><th>Напрям</th><th>Контрагент / опис</th><th className={styles.numberCell}>Сума</th></tr></thead><tbody>{data.calendar.filter((item) => minimum && item.expectedAt.slice(0, 10) === minimum.date).map((item) => <tr key={item.id}><td>{item.sourceType}</td><td>{item.direction === "INFLOW" ? "Надходження" : "Виплата"}</td><td>{item.counterparty || item.description || "—"}</td><td className={styles.numberCell}>{money(item.weightedAmount)}</td></tr>)}</tbody></table></div>
      </div>}

      {drilldown === "plan" && <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>План</th><th>Період</th><th className={styles.numberCell}>План</th><th className={styles.numberCell}>Факт</th><th className={styles.numberCell}>Відхилення</th><th>Виконання</th></tr></thead><tbody>{data.budgets.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.categoryName || row.metric}</small></td><td>{dateText(row.periodStart)} — {dateText(row.periodEnd)}</td><td className={styles.numberCell}>{money(row.amount)}</td><td className={styles.numberCell}>{money(row.actual)}</td><td className={styles.numberCell}>{money(row.variance)}</td><td>{percent(row.completionPercent)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
