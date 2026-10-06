"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./financial-center-v2.module.css";

type Category = { id: string; name: string; code: string; pnlSection: string | null; cashFlowSection?: string | null; parentId: string | null };
type Account = { id: string; name: string; type: string; balance: number };
type ExpenseRow = {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  expenseDate: string;
  dueAt: string | null;
  description: string | null;
  counterpartyName: string | null;
  category: { id: string; name: string; code: string } | null;
  lines: Array<{ id: string; description: string; amount: number; categoryId: string | null }>;
};
type Attachment = { id: string; fileName: string; mimeType: string; sizeBytes: number | null; url: string; createdAt: string };

type FinanceEvent = {
  id: string;
  pnlSection: string;
  amount: number;
  recognizedAt: string;
  description: string | null;
  workOrderId: string | null;
  categoryId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  sourceEntity?: string | null;
  sourceEntityId?: string | null;
  category: { name: string } | null;
};
type CashRow = {
  id: string;
  kind: string;
  flowSection: string;
  amount: number;
  occurredAt: string;
  description: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryId?: string | null;
  supplierId?: string | null;
  workOrderId?: string | null;
  sourceEntity?: string | null;
  sourceEntityId?: string | null;
};
type Obligation = {
  id: string;
  direction: "RECEIVABLE" | "PAYABLE";
  status: string;
  amount: number;
  settledAmount: number;
  outstanding: number;
  issuedAt: string;
  dueAt: string | null;
  counterpartyName: string | null;
  description: string | null;
  workOrderId: string | null;
  sourceEntity: string | null;
  overdueDays: number;
  isOverdue: boolean;
};
type Budget = {
  id: string;
  name: string;
  metric: string;
  amount: number;
  actual: number;
  variance: number;
  completionPercent: number | null;
  categoryName: string | null;
  periodStart: string;
  periodEnd: string;
};
type Alert = { level: "INFO" | "WARNING" | "CRITICAL"; code: string; title: string; message: string; amount?: number; date?: string };
type FinanceSnapshot = {
  revenue: number;
  cogs: number;
  opex: number;
  otherExpense: number;
  tax: number;
  operatingProfit: number;
  netProfit: number;
  events: FinanceEvent[];
  cashOutflow: number;
  cashInflow: number;
  cashNet: number;
  transactions: CashRow[];
  obligations: Obligation[];
  budgets: Budget[];
  alerts: Alert[];
  financeCompleteness: {
    score: number;
    status: "COMPLETE" | "PARTIAL" | "LOW";
    preliminaryNetProfit: boolean;
    issues: Array<{ code: string; level: "INFO" | "WARNING" | "CRITICAL"; title: string; message: string; count: number }>;
    checks: { missingLaborAccruals: number; missingWalkInLabor: number; missingPartCosts: number; missingBaseAccrualEmployees: number };
  };
  profitabilityParts: Array<{ name: string; brand: string | null; article: string | null; supplierId: string | null; quantity: number; revenue: number; directCost: number; profit: number; markupPercent: number | null; marginPercent: number | null }>;
};
type InventoryFacts = {
  period: {
    receiptValue: number;
    receiptCount: number;
    issueValue: number;
    issueCount: number;
    returnValue: number;
    returnCount: number;
    missingReceiptCostCount: number;
    missingIssueCostCount: number;
  };
  inventory: {
    stockValue: number;
    stockLines: number;
    unknownCostLines: number;
    reservedUnits: number;
    onHandUnits: number;
    valuationMethod: "LAST_FACTUAL_UNIT_COST";
  };
};

type Props = {
  from: string;
  to: string;
  locationId: string;
  categories: Category[];
  accounts: Account[];
  finance: FinanceSnapshot;
  onCreate: () => void;
  onChanged: () => void;
};

type ExpenseSection = "ALL" | "OPERATING" | "PAYROLL" | "PARTS" | "OBLIGATIONS" | "BUDGET" | "ANALYTICS";
type Basis = "CASH" | "PNL";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Чернетка",
  PENDING_APPROVAL: "На погодженні",
  APPROVED: "Погоджено",
  POSTED: "Проведено",
  REJECTED: "Відхилено",
  REVERSED: "Сторновано",
  UNPAID: "Не оплачено",
  PARTIALLY_PAID: "Частково",
  PAID: "Оплачено",
  OVERDUE: "Прострочено",
  OPEN: "До оплати",
  CANCELLED: "Скасовано",
};

const SECTION_LABEL: Record<ExpenseSection, string> = {
  ALL: "Усі",
  OPERATING: "Операційні",
  PAYROLL: "Зарплати",
  PARTS: "Запчастини",
  OBLIGATIONS: "Зобов'язання",
  BUDGET: "Бюджет",
  ANALYTICS: "Аналітика",
};

function money(value: number) {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value || 0);
}
function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
function fileSize(value: number | null) { if (!value) return ""; return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} КБ` : `${(value / 1024 / 1024).toFixed(1)} МБ`; }
function includesAny(value: string | null | undefined, words: string[]) {
  const text = (value || "").toLowerCase();
  return words.some((word) => text.includes(word));
}

export function FinanceExpensesV2({ from, to, locationId, categories, accounts, finance, onCreate, onChanged }: Props) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [inventoryFacts, setInventoryFacts] = useState<InventoryFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<ExpenseSection>("ALL");
  const [basis, setBasis] = useState<Basis>("CASH");
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const categoryNameById = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ from, to, pageSize: "100" });
      if (locationId) query.set("locationId", locationId);
      if (search.trim()) query.set("search", search.trim());
      if (paymentFilter) query.set("paymentStatus", paymentFilter);
      if (statusFilter) query.set("status", statusFilter);
      const response = await fetch(`/api/finance/expenses?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити витрати.");
      setRows(data.rows || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити витрати.");
    } finally { setLoading(false); }
  }, [from, to, locationId, search, paymentFilter, statusFilter]);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const query = new URLSearchParams({ from, to });
      if (locationId) query.set("locationId", locationId);
      const response = await fetch(`/api/finance/expense-center?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити складські факти.");
      setInventoryFacts({ period: data.period, inventory: data.inventory });
    } catch (cause) {
      setInventoryFacts(null);
      setError((current) => current || (cause instanceof Error ? cause.message : "Не вдалося завантажити складські факти."));
    } finally { setInventoryLoading(false); }
  }, [from, to, locationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadInventory(); }, [loadInventory]);
  useEffect(() => { setPayAccountId((current) => current || accounts[0]?.id || ""); }, [accounts]);

  const expenseEvents = useMemo(
    () => finance.events.filter((item) => ["COGS", "OPEX", "OTHER_EXPENSE", "TAX"].includes(item.pnlSection)),
    [finance.events],
  );
  const outflows = useMemo(() => finance.transactions.filter((item) => item.kind === "OUTFLOW"), [finance.transactions]);

  const payrollEvents = useMemo(() => expenseEvents.filter((item) => {
    const category = item.categoryId ? categoryById.get(item.categoryId) : null;
    return category?.code === "OPEX_PAYROLL"
      || includesAny(item.sourceEntity, ["payroll", "salary"])
      || includesAny(item.description, ["заробіт", "зарплат"]);
  }), [categoryById, expenseEvents]);

  const supplierOutflows = useMemo(() => outflows.filter((item) => {
    const category = item.categoryId ? categoryById.get(item.categoryId) : null;
    return category?.code === "INVENTORY_PURCHASE"
      || Boolean(item.supplierId)
      || includesAny(item.sourceEntity, ["supplier"]);
  }), [categoryById, outflows]);

  const partsCogs = useMemo(
    () => finance.profitabilityParts.reduce((sum, item) => sum + item.directCost, 0),
    [finance.profitabilityParts],
  );
  const supplierPaid = useMemo(() => supplierOutflows.reduce((sum, item) => sum + item.amount, 0), [supplierOutflows]);
  const payroll = useMemo(() => payrollEvents.reduce((sum, item) => sum + item.amount, 0), [payrollEvents]);
  const payables = useMemo(() => finance.obligations.filter((item) => item.direction === "PAYABLE" && !["PAID", "CANCELLED"].includes(item.status)), [finance.obligations]);
  const payableTotal = useMemo(() => payables.reduce((sum, item) => sum + item.outstanding, 0), [payables]);
  const salaryPayable = useMemo(() => payables.filter((item) => includesAny(item.sourceEntity, ["payroll"]) || includesAny(item.description, ["заробіт", "зарплат"])).reduce((sum, item) => sum + item.outstanding, 0), [payables]);
  const supplierPayable = useMemo(() => payables.filter((item) => includesAny(item.sourceEntity, ["supplier"]) || includesAny(item.description, ["постачаль"])).reduce((sum, item) => sum + item.outstanding, 0), [payables]);

  const dueBuckets = useMemo(() => {
    const now = Date.now();
    return payables.reduce((acc, item) => {
      if (!item.dueAt) { acc.later += item.outstanding; return acc; }
      const diff = Math.ceil((new Date(item.dueAt).getTime() - now) / 86400000);
      if (diff < 0 || item.isOverdue) acc.overdue += item.outstanding;
      else if (diff <= 3) acc.days3 += item.outstanding;
      else if (diff <= 7) acc.days7 += item.outstanding;
      else if (diff <= 30) acc.days30 += item.outstanding;
      else acc.later += item.outstanding;
      return acc;
    }, { overdue: 0, days3: 0, days7: 0, days30: 0, later: 0 });
  }, [payables]);

  const pnlCategoryRows = useMemo(() => {
    const grouped = new Map<string, { name: string; amount: number; count: number }>();
    for (const item of expenseEvents) {
      const name = item.category?.name || item.pnlSection;
      const current = grouped.get(name) || { name, amount: 0, count: 0 };
      current.amount += item.amount;
      current.count += 1;
      grouped.set(name, current);
    }
    return [...grouped.values()].sort((a, b) => b.amount - a.amount);
  }, [expenseEvents]);

  const journalRows = useMemo(() => {
    if (basis === "PNL") {
      return expenseEvents
        .filter((item) => {
          if (section === "OPERATING") return item.pnlSection === "OPEX";
          if (section === "PAYROLL") return payrollEvents.some((row) => row.id === item.id);
          if (section === "PARTS") {
            const category = item.categoryId ? categoryById.get(item.categoryId) : null;
            return item.pnlSection === "COGS" && (
              Boolean(item.supplierId)
              || includesAny(category?.code, ["part", "inventory"])
              || includesAny(category?.name, ["детал", "запчаст"])
              || includesAny(item.description, ["детал", "запчаст"])
            );
          }
          return true;
        })
        .map((item) => ({
          id: item.id,
          date: item.recognizedAt,
          category: item.category?.name || item.pnlSection,
          description: item.description || "Фінансовий факт",
          context: item.workOrderId ? `ЗН ${item.workOrderId}` : item.sourceEntity || "SYSTEM",
          amount: item.amount,
          status: "POSTED",
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
    }

    return outflows
      .filter((item) => {
        const category = item.categoryId ? categoryById.get(item.categoryId) : null;
        if (section === "OPERATING") return category?.cashFlowSection === "OPERATING" && category?.code !== "INVENTORY_PURCHASE";
        if (section === "PAYROLL") return category?.code === "OPEX_PAYROLL" || includesAny(item.sourceEntity, ["payroll", "salary"]) || includesAny(item.description, ["заробіт", "зарплат"]);
        if (section === "PARTS") return category?.code === "INVENTORY_PURCHASE" || Boolean(item.supplierId) || includesAny(item.sourceEntity, ["supplier"]);
        return true;
      })
      .map((item) => ({
        id: item.id,
        date: item.occurredAt,
        category: item.categoryId ? categoryById.get(item.categoryId)?.name || "Рух коштів" : "Рух коштів",
        description: item.description || "Вихідний платіж",
        context: item.workOrderId ? `ЗН ${item.workOrderId}` : item.sourceEntity || item.flowSection,
        amount: item.amount,
        status: "PAID",
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [basis, categoryById, expenseEvents, outflows, payrollEvents, section]);

  async function v2Action(action: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/finance/v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося виконати дію.");
    return data;
  }

  async function loadAttachments(expenseId: string) {
    try {
      const response = await fetch(`/api/finance/expenses/${encodeURIComponent(expenseId)}/attachments`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити документи.");
      setAttachments((current) => ({ ...current, [expenseId]: data.attachments || [] }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося завантажити документи."); }
  }

  async function toggleExpanded(row: ExpenseRow) {
    const next = expandedId === row.id ? null : row.id;
    setExpandedId(next);
    if (next && !attachments[row.id]) await loadAttachments(row.id);
  }

  async function post(row: ExpenseRow) {
    try {
      setError(""); setMessage("");
      const response = await fetch(`/api/finance/expenses/${encodeURIComponent(row.id)}/post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentStatus: row.paymentStatus === "PARTIALLY_PAID" ? "UNPAID" : row.paymentStatus }) });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.code === "EXPENSE_APPROVAL_REQUIRED") {
          await v2Action("REQUEST_EXPENSE_APPROVAL", { expenseId: row.id });
          setMessage("Витрату передано на погодження згідно фінансового правила.");
          await load(); onChanged(); return;
        }
        throw new Error(data.error || "Не вдалося провести витрату.");
      }
      setMessage("Витрату проведено."); await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка проведення."); }
  }

  async function approve(row: ExpenseRow) {
    try { setError(""); await v2Action("APPROVE_EXPENSE", { expenseId: row.id }); setMessage(`${row.number}: погоджено.`); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося погодити."); }
  }
  async function reject(row: ExpenseRow) {
    const reason = window.prompt("Причина відхилення витрати:", "Потрібне уточнення"); if (reason === null) return;
    try { setError(""); await v2Action("REJECT_EXPENSE", { expenseId: row.id, reason }); setMessage(`${row.number}: відхилено.`); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося відхилити."); }
  }
  async function reverse(row: ExpenseRow) {
    const reason = window.prompt("Причина сторно. Проведений факт залишиться в аудиті:"); if (!reason) return;
    try { setError(""); await v2Action("REVERSE_EXPENSE", { expenseId: row.id, reason }); setMessage(`${row.number}: сторновано.`); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося сторнувати."); }
  }
  async function pay(row: ExpenseRow) {
    const amount = Number(payAmount.replace(",", "."));
    if (!(amount > 0) || amount > row.outstanding) { setError("Сума оплати повинна бути більшою за 0 та не перевищувати залишок."); return; }
    if (!payAccountId) { setError("Виберіть рахунок."); return; }
    try {
      setError("");
      const response = await fetch(`/api/finance/expenses/${encodeURIComponent(row.id)}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paidAmount: amount, moneyAccountId: payAccountId, paymentDate: new Date().toISOString().slice(0, 10), idempotencyKey: `expense-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }) });
      const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося провести оплату.");
      setPayingId(null); setPayAmount(""); setMessage(`${row.number}: оплату проведено.`); await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося провести оплату."); }
  }

  function addAttachment(row: ExpenseRow) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf,image/jpeg,image/png";
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      void (async () => {
        try {
          setUploadingId(row.id); setError("");
          const form = new FormData(); form.append("file", file);
          const response = await fetch(`/api/finance/expenses/${encodeURIComponent(row.id)}/attachments`, { method: "POST", body: form });
          const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося завантажити документ.");
          setMessage(`${row.number}: документ ${file.name} завантажено.`); await loadAttachments(row.id);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося завантажити документ."); }
        finally { setUploadingId(null); }
      })();
    };
    input.click();
  }

  const maxCategory = pnlCategoryRows[0]?.amount || 1;
  const relevantAlerts = finance.alerts.filter((item) => ["OPEX_GROWTH", "BUDGET_120", "BUDGET_80", "MISSING_PART_COST", "MISSING_LABOR_COMPENSATION", "MISSING_WALK_IN_LABOR", "MISSING_BASE_ACCRUAL", "OVERDUE_AP"].includes(item.code));

  return <div className={styles.expenseCenter}>
    <section className={styles.expenseHero}>
      <div>
        <span className={styles.eyebrow}>EXPENSE CONTROL CENTER</span>
        <h2>Витрати і собівартість</h2>
        <p>Одна сторінка для руху грошей, P&L, зарплат, закупівель, кредиторки й бюджету. Закупівля на склад не зменшує прибуток до моменту списання деталі в ремонт.</p>
      </div>
      <button type="button" className={styles.primaryButton} onClick={onCreate}>+ Додати витрату</button>
    </section>

    <section className={styles.expenseKpiGrid}>
      <div className={styles.expenseKpi}><span>Усі грошові витрати</span><strong>{money(finance.cashOutflow)}</strong><small>фактичні OUTFLOW за період</small></div>
      <div className={styles.expenseKpi}><span>Операційні витрати</span><strong>{money(finance.opex)}</strong><small>P&L · OPEX</small></div>
      <div className={styles.expenseKpi}><span>Зарплати</span><strong>{money(payroll)}</strong><small>нараховані у P&L</small></div>
      <div className={styles.expenseKpi}><span>Оплачено постачальникам</span><strong>{money(supplierPaid)}</strong><small>фактичні платежі закупівель</small></div>
      <div className={styles.expenseKpi}><span>Собівартість деталей</span><strong>{money(partsCogs)}</strong><small>використано/продано в ремонтах</small></div>
      <div className={styles.expenseKpi}><span>Надійшло на склад</span><strong>{inventoryLoading ? "…" : money(inventoryFacts?.period.receiptValue || 0)}</strong><small>{inventoryFacts ? `${inventoryFacts.period.receiptCount} складських приходів` : "дані складу недоступні"}</small></div>
      <div className={styles.expenseKpi}><span>Зобов'язання до оплати</span><strong>{money(payableTotal)}</strong><small>постачальники {money(supplierPayable)} · зарплати {money(salaryPayable)}</small></div>
      <div className={styles.expenseKpi}><span>Операційний результат</span><strong className={finance.operatingProfit < 0 ? styles.negative : styles.positive}>{money(finance.operatingProfit)}</strong><small>{finance.financeCompleteness.preliminaryNetProfit ? `попередній · повнота ${finance.financeCompleteness.score}%` : "управлінський результат"}</small></div>
    </section>

    <section className={styles.expenseGuide}>
      <div><strong>Закупили деталь</strong><span>Гроші пішли → Cash Flow</span></div>
      <b>→</b>
      <div><strong>Деталь на складі</strong><span>Запас / актив, не P&L-витрата</span></div>
      <b>→</b>
      <div><strong>Встановили клієнту</strong><span>Собівартість → COGS</span></div>
      <b>→</b>
      <div><strong>Продали</strong><span>Продаж − COGS = маржа деталей</span></div>
    </section>

    <nav className={styles.subTabs} aria-label="Розділи витрат">
      {(Object.keys(SECTION_LABEL) as ExpenseSection[]).map((item) => <button type="button" key={item} className={section === item ? styles.activeTab : ""} onClick={() => setSection(item)}>{SECTION_LABEL[item]}</button>)}
    </nav>

    {(section === "ALL" || section === "OPERATING" || section === "PAYROLL" || section === "PARTS") && <>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>UNIFIED LEDGER</span><h2>Єдиний журнал витрат</h2><p>{basis === "CASH" ? "Показує, куди реально пішли гроші." : "Показує витрати, що реально вплинули на фінансовий результат."}</p></div>
          <div className={styles.basisSwitch}><button type="button" className={basis === "CASH" ? styles.activeBasis : ""} onClick={() => setBasis("CASH")}>Рух грошей</button><button type="button" className={basis === "PNL" ? styles.activeBasis : ""} onClick={() => setBasis("PNL")}>Фінрезультат</button></div>
        </div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Категорія</th><th>Опис</th><th>Контекст</th><th>Статус</th><th className={styles.numberCell}>Сума</th></tr></thead><tbody>
          {!journalRows.length && <tr><td colSpan={6}>За вибраним режимом фактів немає.</td></tr>}
          {journalRows.slice(0, 250).map((row) => <tr key={row.id}><td>{dateText(row.date)}</td><td><strong>{row.category}</strong></td><td>{row.description}</td><td>{row.context}</td><td><span className={`${styles.badge} ${styles.good}`}>{row.status === "PAID" ? "Оплачено" : "Проведено"}</span></td><td className={styles.numberCell}><strong>{money(row.amount)}</strong></td></tr>)}
        </tbody></table></div>
      </section>

      {section === "PARTS" && <div className={styles.grid2}>
        <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PARTS CASH & STOCK</span><h2>Закупівлі та склад</h2><p>Гроші постачальникам і фактичні рухи товару розділені.</p></div></div>
          <div className={styles.summaryRow}><span>Оплачено постачальникам</span><strong>{money(supplierPaid)}</strong></div>
          <div className={styles.summaryRow}><span>Оприбутковано на склад</span><strong>{money(inventoryFacts?.period.receiptValue || 0)}</strong></div>
          <div className={styles.summaryRow}><span>Списано зі складу в ремонти</span><strong>{money(inventoryFacts?.period.issueValue || 0)}</strong></div>
          <div className={styles.summaryRow}><span>COGS деталей у фінрезультаті</span><strong>{money(partsCogs)}</strong></div>
          <div className={`${styles.summaryRow} ${styles.summaryTotal}`}><span>Гроші, заморожені в запасах</span><strong>{money(inventoryFacts?.inventory.stockValue || 0)}</strong></div>
          {inventoryFacts?.inventory.unknownCostLines ? <p className={styles.hint}>⚠ {inventoryFacts.inventory.unknownCostLines} складських позицій мають залишок без відомої фактичної ціни; оцінка запасу занижена.</p> : <p className={styles.hint}>Оцінка залишку: остання відома фактична закупівельна ціна по кожній складській позиції.</p>}
        </section>
        <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PARTS ECONOMICS</span><h2>Маржа деталей</h2><p>Продаж, собівартість і маржа використаних деталей.</p></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Деталь</th><th>Артикул</th><th className={styles.numberCell}>Продаж</th><th className={styles.numberCell}>Собівартість</th><th className={styles.numberCell}>Маржа</th></tr></thead><tbody>
            {!finance.profitabilityParts.length && <tr><td colSpan={5}>За період деталей у завершених роботах немає.</td></tr>}
            {finance.profitabilityParts.slice(0, 80).map((item, index) => <tr key={`${item.article || item.name}:${index}`}><td><strong>{item.name}</strong><small>{item.brand || "—"}</small></td><td>{item.article || "—"}</td><td className={styles.numberCell}>{money(item.revenue)}</td><td className={styles.numberCell}>{money(item.directCost)}</td><td className={`${styles.numberCell} ${item.profit < 0 ? styles.negative : styles.positive}`}>{money(item.profit)}</td></tr>)}
          </tbody></table></div>
        </section>
      </div>}

      {section === "PAYROLL" && <div className={styles.grid2}>
        <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PAYROLL</span><h2>Нарахування і виплати</h2><p>Нарахування впливає на P&L; виплата — на Cash Flow.</p></div></div>
          <div className={styles.summaryRow}><span>Нараховано у P&L</span><strong>{money(payroll)}</strong></div>
          <div className={styles.summaryRow}><span>До виплати</span><strong>{money(salaryPayable)}</strong></div>
          <div className={styles.summaryRow}><span>Не враховані нарахування робіт</span><strong className={finance.financeCompleteness.checks.missingLaborAccruals ? styles.negative : styles.positive}>{finance.financeCompleteness.checks.missingLaborAccruals}</strong></div>
          <div className={styles.summaryRow}><span>Працівники без базового нарахування</span><strong className={finance.financeCompleteness.checks.missingBaseAccrualEmployees ? styles.negative : styles.positive}>{finance.financeCompleteness.checks.missingBaseAccrualEmployees}</strong></div>
        </section>
        <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PAYROLL PAYABLES</span><h2>Що ще треба виплатити</h2></div></div>{payables.filter((item) => includesAny(item.sourceEntity, ["payroll"]) || includesAny(item.description, ["заробіт", "зарплат"])).length ? payables.filter((item) => includesAny(item.sourceEntity, ["payroll"]) || includesAny(item.description, ["заробіт", "зарплат"])).map((item) => <div className={styles.summaryRow} key={item.id}><span><strong>{item.counterpartyName || "Працівник"}</strong><small>{item.description || "Зарплата"} · {item.dueAt ? `до ${dateText(item.dueAt)}` : "без строку"}</small></span><strong>{money(item.outstanding)}</strong></div>) : <div className={styles.empty}>Відкритої зарплатної кредиторки немає.</div>}</section>
      </div>}

      {(section === "ALL" || section === "OPERATING") && <ManualExpenseRegister
        rows={rows}
        loading={loading}
        error={error}
        message={message}
        search={search}
        paymentFilter={paymentFilter}
        statusFilter={statusFilter}
        accounts={accounts}
        categoryNameById={categoryNameById}
        payAccountId={payAccountId}
        payingId={payingId}
        payAmount={payAmount}
        expandedId={expandedId}
        attachments={attachments}
        uploadingId={uploadingId}
        onSearch={setSearch}
        onPaymentFilter={setPaymentFilter}
        onStatusFilter={setStatusFilter}
        onReload={() => void load()}
        onToggleExpanded={(row) => void toggleExpanded(row)}
        onPost={(row) => void post(row)}
        onApprove={(row) => void approve(row)}
        onReject={(row) => void reject(row)}
        onReverse={(row) => void reverse(row)}
        onStartPay={(row) => { setPayingId(row.id); setPayAmount(String(row.outstanding)); }}
        onCancelPay={() => setPayingId(null)}
        onPay={(row) => void pay(row)}
        onPayAmount={setPayAmount}
        onPayAccountId={setPayAccountId}
        onAttachment={addAttachment}
      />}
    </>}

    {section === "OBLIGATIONS" && <>
      <section className={styles.expenseKpiGrid}>
        <div className={styles.expenseKpi}><span>Прострочено</span><strong className={dueBuckets.overdue ? styles.negative : ""}>{money(dueBuckets.overdue)}</strong><small>потрібна увага зараз</small></div>
        <div className={styles.expenseKpi}><span>До 3 днів</span><strong>{money(dueBuckets.days3)}</strong><small>майбутні платежі</small></div>
        <div className={styles.expenseKpi}><span>До 7 днів</span><strong>{money(dueBuckets.days7)}</strong><small>майбутні платежі</small></div>
        <div className={styles.expenseKpi}><span>До 30 днів</span><strong>{money(dueBuckets.days30)}</strong><small>майбутні платежі</small></div>
      </section>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PAYABLES</span><h2>Що маємо заплатити</h2><p>Постачальники, зарплати й інші відкриті зобов'язання.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Строк</th><th>Кому</th><th>Причина</th><th>ЗН</th><th>Статус</th><th className={styles.numberCell}>До оплати</th></tr></thead><tbody>
        {!payables.length && <tr><td colSpan={6}>Відкритих зобов'язань немає.</td></tr>}
        {payables.map((item) => <tr key={item.id}><td>{dateText(item.dueAt)}</td><td><strong>{item.counterpartyName || "Контрагент"}</strong></td><td>{item.description || item.sourceEntity || "—"}</td><td>{item.workOrderId || "—"}</td><td><span className={`${styles.badge} ${item.isOverdue ? styles.bad : item.status === "PARTIALLY_PAID" ? styles.warn : ""}`}>{item.isOverdue ? "Прострочено" : STATUS_LABEL[item.status] || item.status}</span></td><td className={styles.numberCell}><strong>{money(item.outstanding)}</strong></td></tr>)}
      </tbody></table></div></section>
    </>}

    {section === "BUDGET" && <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>PLAN / FACT</span><h2>Контроль бюджету витрат</h2><p>Перевитрата підсвічується автоматично; 80–119% — увага, 120%+ — критично.</p></div></div>
      {finance.budgets.length ? <div className={styles.expenseBudgetGrid}>{finance.budgets.map((item) => { const pct = item.completionPercent ?? 0; const expenseMetric = ["OPEX","COGS","CATEGORY"].includes(item.metric); return <div className={styles.expenseBudgetCard} key={item.id}><div><strong>{item.name}</strong><span className={`${styles.badge} ${expenseMetric && pct >= 120 ? styles.bad : expenseMetric && pct >= 80 ? styles.warn : styles.good}`}>{item.completionPercent == null ? "—" : `${item.completionPercent.toFixed(0)}%`}</span></div><small>{item.categoryName || item.metric}</small><div className={styles.summaryRow}><span>План</span><strong>{money(item.amount)}</strong></div><div className={styles.summaryRow}><span>Факт</span><strong>{money(item.actual)}</strong></div><div className={styles.summaryRow}><span>Відхилення</span><strong className={expenseMetric && item.variance > 0 ? styles.negative : ""}>{money(item.variance)}</strong></div><div className={styles.progress}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div></div>; })}</div> : <div className={styles.empty}>Бюджети ще не задані у «План / факт».</div>}
    </section>}

    {section === "ANALYTICS" && <div className={styles.grid2}>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>EXPENSE STRUCTURE</span><h2>Структура витрат у P&L</h2></div></div><div className={styles.expenseStructure}>{pnlCategoryRows.length ? pnlCategoryRows.slice(0, 14).map((item) => <div key={item.name}><div><span>{item.name}</span><strong>{money(item.amount)}</strong></div><div className={styles.structureBar}><span style={{ width: `${Math.max(2, item.amount / maxCategory * 100)}%` }} /></div><small>{item.count} проведень</small></div>) : <div className={styles.empty}>Немає визнаних витрат.</div>}</div></section>
      <section className={styles.panel}><div className={styles.panelHeader}><div><span className={styles.eyebrow}>CONTROL</span><h2>Потребує уваги</h2><p>Аномалії, пропущена собівартість і перевитрата.</p></div><span className={`${styles.completenessBadge} ${finance.financeCompleteness.status === "COMPLETE" ? styles.completenessGood : finance.financeCompleteness.status === "LOW" ? styles.completenessBad : styles.completenessWarn}`}>{finance.financeCompleteness.score}%</span></div>
        {relevantAlerts.length ? <div className={styles.alertStack}>{relevantAlerts.map((alert) => <div key={alert.code} className={`${styles.alert} ${alert.level === "CRITICAL" ? styles.alertCritical : alert.level === "WARNING" ? styles.alertWarning : styles.alertInfo}`}><span className={styles.alertDot}/><div><strong>{alert.title}</strong><div className={styles.hint}>{alert.message}</div></div>{alert.amount != null && <strong>{money(alert.amount)}</strong>}</div>)}</div> : <div className={styles.qualityComplete}>✓ За доступними правилами критичних відхилень немає.</div>}
        {inventoryFacts && (inventoryFacts.period.missingReceiptCostCount > 0 || inventoryFacts.period.missingIssueCostCount > 0) && <div className={styles.qualityIssues}><div className={styles.qualityWarning}><strong>Складські рухи без собівартості</strong><span>Приходи без ціни: {inventoryFacts.period.missingReceiptCostCount}. Списання без ціни: {inventoryFacts.period.missingIssueCostCount}.</span></div></div>}
      </section>
    </div>}
  </div>;
}

function ManualExpenseRegister(props: {
  rows: ExpenseRow[];
  loading: boolean;
  error: string;
  message: string;
  search: string;
  paymentFilter: string;
  statusFilter: string;
  accounts: Account[];
  categoryNameById: Map<string, string>;
  payAccountId: string;
  payingId: string | null;
  payAmount: string;
  expandedId: string | null;
  attachments: Record<string, Attachment[]>;
  uploadingId: string | null;
  onSearch: (value: string) => void;
  onPaymentFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onReload: () => void;
  onToggleExpanded: (row: ExpenseRow) => void;
  onPost: (row: ExpenseRow) => void;
  onApprove: (row: ExpenseRow) => void;
  onReject: (row: ExpenseRow) => void;
  onReverse: (row: ExpenseRow) => void;
  onStartPay: (row: ExpenseRow) => void;
  onCancelPay: () => void;
  onPay: (row: ExpenseRow) => void;
  onPayAmount: (value: string) => void;
  onPayAccountId: (value: string) => void;
  onAttachment: (row: ExpenseRow) => void;
}) {
  return <section className={styles.panel}>
    <div className={styles.panelHeader}><div><span className={styles.eyebrow}>MANUAL DOCUMENTS</span><h2>Первинні та ручні витрати</h2><p>Оренда, комунальні, реклама та інші витрати, які CRM не може сформувати автоматично.</p></div></div>
    <div className={styles.filterRow}><label>Пошук<input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Номер, контрагент, опис" /></label><label>Статус<select value={props.statusFilter} onChange={(event) => props.onStatusFilter(event.target.value)}><option value="">Усі</option><option value="DRAFT">Чернетка</option><option value="PENDING_APPROVAL">На погодженні</option><option value="APPROVED">Погоджено</option><option value="POSTED">Проведено</option><option value="REJECTED">Відхилено</option><option value="REVERSED">Сторновано</option></select></label><label>Оплата<select value={props.paymentFilter} onChange={(event) => props.onPaymentFilter(event.target.value)}><option value="">Усі</option><option value="UNPAID">Не оплачено</option><option value="PARTIALLY_PAID">Частково</option><option value="PAID">Оплачено</option><option value="OVERDUE">Прострочено</option></select></label><button type="button" className={styles.secondaryButton} onClick={props.onReload}>Оновити</button></div>
    {props.message && <div className={styles.success}>{props.message}</div>}{props.error && <div className={styles.errorBox}>{props.error}</div>}
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Документ</th><th>Категорія / контрагент</th><th className={styles.numberCell}>Сума</th><th>Оплата</th><th>Статус</th><th>Дії</th></tr></thead><tbody>
      {props.loading && <tr><td colSpan={7}>Завантаження…</td></tr>}{!props.loading && props.rows.length === 0 && <tr><td colSpan={7}>За вибраний період ручних витрат немає.</td></tr>}
      {props.rows.map((row) => <Fragment key={row.id}><tr><td>{dateText(row.expenseDate)}</td><td><button type="button" className={styles.linkButton} onClick={() => props.onToggleExpanded(row)}>{row.number}</button><small>{row.description || "—"}</small></td><td><strong>{row.category?.name || "Без категорії"}</strong><small>{row.counterpartyName || "—"}</small></td><td className={styles.numberCell}><strong>{money(row.amount)}</strong>{row.outstanding > 0 && <small>залишок {money(row.outstanding)}</small>}</td><td><span className={`${styles.badge} ${row.paymentStatus === "PAID" ? styles.good : row.paymentStatus === "OVERDUE" ? styles.bad : styles.warn}`}>{STATUS_LABEL[row.paymentStatus] || row.paymentStatus}</span>{row.dueAt && row.outstanding > 0 && <small>до {dateText(row.dueAt)}</small>}</td><td><span className={`${styles.badge} ${row.status === "POSTED" || row.status === "APPROVED" ? styles.good : row.status === "REVERSED" || row.status === "REJECTED" ? styles.bad : styles.warn}`}>{STATUS_LABEL[row.status] || row.status}</span></td><td><div className={styles.rowActions}>{(row.status === "DRAFT" || row.status === "APPROVED" || row.status === "REJECTED") && <button type="button" onClick={() => props.onPost(row)}>{row.status === "APPROVED" ? "Провести" : "До проведення"}</button>}{row.status === "PENDING_APPROVAL" && <><button type="button" onClick={() => props.onApprove(row)}>Погодити</button><button type="button" onClick={() => props.onReject(row)}>Відхилити</button></>}{row.status === "POSTED" && row.outstanding > 0 && <button type="button" onClick={() => props.onStartPay(row)}>Оплатити</button>}{row.status === "POSTED" && <button type="button" onClick={() => props.onReverse(row)}>Сторно</button>}<button type="button" disabled={props.uploadingId === row.id} onClick={() => props.onAttachment(row)}>{props.uploadingId === row.id ? "Завантажую…" : "+ Документ"}</button></div></td></tr>
        {props.payingId === row.id && <tr className={styles.inlineRow}><td colSpan={7}><div className={styles.inlineForm}><label>Сума<input value={props.payAmount} onChange={(event) => props.onPayAmount(event.target.value)} inputMode="decimal" /></label><label>Рахунок<select value={props.payAccountId} onChange={(event) => props.onPayAccountId(event.target.value)}>{props.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label><button type="button" className={styles.primaryButton} onClick={() => props.onPay(row)}>Провести оплату</button><button type="button" onClick={props.onCancelPay}>Скасувати</button></div></td></tr>}
        {props.expandedId === row.id && <tr className={styles.inlineRow}><td colSpan={7}><div className={styles.lineDetails}><strong>Розподіл документа</strong>{row.lines.length ? row.lines.map((line) => <div key={line.id}><span>{line.description}</span><span>{props.categoryNameById.get(line.categoryId || "") || row.category?.name || "Без категорії"}</span><strong>{money(line.amount)}</strong></div>) : <span>Окремих рядків немає.</span>}<strong>Первинні документи</strong>{props.attachments[row.id]?.length ? props.attachments[row.id].map((file) => <div key={file.id}><a href={file.url} target="_blank" rel="noreferrer">{file.fileName}</a><span>{file.mimeType} · {fileSize(file.sizeBytes)}</span><span>{dateText(file.createdAt)}</span></div>) : <span>Документів ще немає.</span>}</div></td></tr>}
      </Fragment>)}
    </tbody></table></div>
  </section>;
}
