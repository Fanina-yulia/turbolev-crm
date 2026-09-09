"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./financial-center-v2.module.css";

type Category = { id: string; name: string; code: string; pnlSection: string | null; parentId: string | null };
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

type Props = {
  from: string;
  to: string;
  locationId: string;
  categories: Category[];
  accounts: Account[];
  onCreate: () => void;
  onChanged: () => void;
};

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
};

function money(value: number) {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value || 0);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function FinanceExpensesV2({ from, to, locationId, categories, accounts, onCreate, onChanged }: Props) {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payAccountId, setPayAccountId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);

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
    } finally {
      setLoading(false);
    }
  }, [from, to, locationId, search, paymentFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPayAccountId((current) => current || accounts[0]?.id || ""); }, [accounts]);

  async function v2Action(action: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/finance/v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося виконати дію.");
    return data;
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
      setMessage("Витрату проведено.");
      await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка проведення."); }
  }

  async function approve(row: ExpenseRow) {
    try { setError(""); await v2Action("APPROVE_EXPENSE", { expenseId: row.id }); setMessage(`${row.number}: погоджено.`); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося погодити."); }
  }

  async function reject(row: ExpenseRow) {
    const reason = window.prompt("Причина відхилення витрати:", "Потрібне уточнення");
    if (reason === null) return;
    try { setError(""); await v2Action("REJECT_EXPENSE", { expenseId: row.id, reason }); setMessage(`${row.number}: відхилено.`); await load(); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося відхилити."); }
  }

  async function reverse(row: ExpenseRow) {
    const reason = window.prompt("Причина сторно. Проведений факт не буде видалено з аудиту:");
    if (!reason) return;
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
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося провести оплату.");
      setPayingId(null); setPayAmount(""); setMessage(`${row.number}: оплату проведено.`); await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося провести оплату."); }
  }

  async function addAttachment(row: ExpenseRow) {
    const url = window.prompt("Посилання на PDF/JPG/PNG документа:");
    if (!url) return;
    const fileName = window.prompt("Назва документа:", `${row.number}-document.pdf`) || `${row.number}-document`;
    try {
      await v2Action("ADD_ATTACHMENT", { expenseDocumentId: row.id, fileName, mimeType: fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/*", url });
      setMessage(`${row.number}: документ додано.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося додати документ."); }
  }

  return <section className={styles.panel}>
    <div className={styles.panelHeader}>
      <div><span className={styles.eyebrow}>EXPENSE CONTROL</span><h2>Витрати</h2><p>Первинні документи, погодження, часткові оплати, розподіл по категоріях і сторно.</p></div>
      <button type="button" className={styles.primaryButton} onClick={onCreate}>+ Додати витрату</button>
    </div>

    <div className={styles.filterRow}>
      <label>Пошук<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, контрагент, опис" /></label>
      <label>Статус<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Усі</option><option value="DRAFT">Чернетка</option><option value="PENDING_APPROVAL">На погодженні</option><option value="APPROVED">Погоджено</option><option value="POSTED">Проведено</option><option value="REJECTED">Відхилено</option><option value="REVERSED">Сторновано</option></select></label>
      <label>Оплата<select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="">Усі</option><option value="UNPAID">Не оплачено</option><option value="PARTIALLY_PAID">Частково</option><option value="PAID">Оплачено</option><option value="OVERDUE">Прострочено</option></select></label>
      <button type="button" className={styles.secondaryButton} onClick={() => void load()}>Оновити</button>
    </div>

    {message && <div className={styles.success}>{message}</div>}
    {error && <div className={styles.errorBox}>{error}</div>}

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Дата</th><th>Документ</th><th>Категорія / контрагент</th><th className={styles.numberCell}>Сума</th><th>Оплата</th><th>Статус</th><th>Дії</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={7}>Завантаження…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={7}>За вибраний період витрат немає.</td></tr>}
          {rows.map((row) => <>
            <tr key={row.id}>
              <td>{dateText(row.expenseDate)}</td>
              <td><button type="button" className={styles.linkButton} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>{row.number}</button><small>{row.description || "—"}</small></td>
              <td><strong>{row.category?.name || "Без категорії"}</strong><small>{row.counterpartyName || "—"}</small></td>
              <td className={styles.numberCell}><strong>{money(row.amount)}</strong>{row.outstanding > 0 && <small>залишок {money(row.outstanding)}</small>}</td>
              <td><span className={`${styles.badge} ${row.paymentStatus === "PAID" ? styles.good : row.paymentStatus === "OVERDUE" ? styles.bad : styles.warn}`}>{STATUS_LABEL[row.paymentStatus] || row.paymentStatus}</span>{row.dueAt && row.outstanding > 0 && <small>до {dateText(row.dueAt)}</small>}</td>
              <td><span className={`${styles.badge} ${row.status === "POSTED" || row.status === "APPROVED" ? styles.good : row.status === "REVERSED" || row.status === "REJECTED" ? styles.bad : styles.warn}`}>{STATUS_LABEL[row.status] || row.status}</span></td>
              <td><div className={styles.rowActions}>
                {(row.status === "DRAFT" || row.status === "APPROVED" || row.status === "REJECTED") && <button type="button" onClick={() => void post(row)}>{row.status === "APPROVED" ? "Провести" : "До проведення"}</button>}
                {row.status === "PENDING_APPROVAL" && <><button type="button" onClick={() => void approve(row)}>Погодити</button><button type="button" onClick={() => void reject(row)}>Відхилити</button></>}
                {row.status === "POSTED" && row.outstanding > 0 && <button type="button" onClick={() => { setPayingId(row.id); setPayAmount(String(row.outstanding)); }}>Оплатити</button>}
                {row.status === "POSTED" && <button type="button" onClick={() => void reverse(row)}>Сторно</button>}
                <button type="button" onClick={() => void addAttachment(row)}>Документ</button>
              </div></td>
            </tr>
            {payingId === row.id && <tr key={`${row.id}:pay`} className={styles.inlineRow}><td colSpan={7}><div className={styles.inlineForm}><label>Сума<input value={payAmount} onChange={(event) => setPayAmount(event.target.value)} inputMode="decimal" /></label><label>Рахунок<select value={payAccountId} onChange={(event) => setPayAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label><button type="button" className={styles.primaryButton} onClick={() => void pay(row)}>Провести оплату</button><button type="button" onClick={() => setPayingId(null)}>Скасувати</button></div></td></tr>}
            {expandedId === row.id && <tr key={`${row.id}:lines`} className={styles.inlineRow}><td colSpan={7}><div className={styles.lineDetails}><strong>Розподіл документа</strong>{row.lines.length ? row.lines.map((line) => <div key={line.id}><span>{line.description}</span><span>{categoryById.get(line.categoryId || "") || row.category?.name || "Без категорії"}</span><strong>{money(line.amount)}</strong></div>) : <span>Окремих рядків немає.</span>}</div></td></tr>}
          </>)}
        </tbody>
      </table>
    </div>
  </section>;
}
