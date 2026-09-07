"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./financial-center.module.css";

type Location = { id: string; name: string };
type Category = { id: string; code: string; name: string; pnlSection: string | null; cashFlowSection: string | null };
type Account = { id: string; name: string; type: string; currency: string; isActive: boolean };
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
  category: Category | null;
  supplier: { id: string; name: string } | null;
};

type Props = {
  from: string;
  to: string;
  selectedLocationId: string;
  locations: Location[];
  openSignal: number;
  onDataChanged: () => void;
};

type FormState = {
  amount: string;
  categoryId: string;
  expenseDate: string;
  paymentDate: string;
  dueAt: string;
  locationId: string;
  counterpartyName: string;
  documentNumber: string;
  description: string;
  notes: string;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  paidAmount: string;
  moneyAccountId: string;
};

const PAYMENT_LABELS: Record<FormState["paymentStatus"], string> = {
  UNPAID: "Не оплачено",
  PARTIALLY_PAID: "Частково оплачено",
  PAID: "Оплачено повністю",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  PENDING_APPROVAL: "На погодженні",
  APPROVED: "Погоджено",
  POSTED: "Проведено",
  REJECTED: "Відхилено",
  REVERSED: "Сторновано",
  UNPAID: "Не оплачено",
  PARTIALLY_PAID: "Частково оплачено",
  PAID: "Оплачено",
  OVERDUE: "Прострочено",
};

function today() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 2 }).format(value);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function statusClass(value: string) {
  return value === "PAID" || value === "POSTED" ? styles.statusGood : value === "OVERDUE" || value === "REVERSED" ? styles.statusBad : styles.statusWarn;
}

function newForm(locationId = ""): FormState {
  return {
    amount: "",
    categoryId: "",
    expenseDate: today(),
    paymentDate: today(),
    dueAt: "",
    locationId,
    counterpartyName: "",
    documentNumber: "",
    description: "",
    notes: "",
    paymentStatus: "PAID",
    paidAmount: "",
    moneyAccountId: "",
  };
}

export function FinanceExpenseRegister({ from, to, selectedLocationId, locations, openSignal, onDataChanged }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [form, setForm] = useState<FormState>(() => newForm(selectedLocationId || locations[0]?.id || ""));
  const [payAmount, setPayAmount] = useState("");
  const [payAccountId, setPayAccountId] = useState("");

  const manualCategories = useMemo(
    () => categories.filter((category) => category.pnlSection !== "REVENUE" && category.pnlSection !== "COGS"),
    [categories],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ from, to, pageSize: "100" });
      if (selectedLocationId) query.set("locationId", selectedLocationId);
      if (search.trim()) query.set("search", search.trim());
      if (paymentFilter) query.set("paymentStatus", paymentFilter);
      const [expensesResponse, categoriesResponse, accountsResponse] = await Promise.all([
        fetch("/api/finance/expenses?" + query.toString(), { cache: "no-store" }),
        fetch("/api/finance/categories", { cache: "no-store" }),
        fetch("/api/finance/accounts", { cache: "no-store" }),
      ]);
      const [expenses, categoryData, accountData] = await Promise.all([expensesResponse.json(), categoriesResponse.json(), accountsResponse.json()]);
      if (!expensesResponse.ok || !expenses.ok) throw new Error(expenses.error || "Не вдалося завантажити витрати.");
      if (!categoriesResponse.ok || !categoryData.ok) throw new Error(categoryData.error || "Не вдалося завантажити категорії.");
      if (!accountsResponse.ok || !accountData.ok) throw new Error(accountData.error || "Не вдалося завантажити рахунки.");
      setRows(expenses.rows || []);
      setCategories(categoryData.categories || []);
      setAccounts((accountData.accounts || []).filter((account: Account) => account.isActive && account.currency === "UAH"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити витрати.");
    } finally {
      setLoading(false);
    }
  }, [from, to, selectedLocationId, search, paymentFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (openSignal > 0) setDrawerOpen(true);
  }, [openSignal]);

  useEffect(() => {
    setForm((current) => ({ ...current, locationId: current.locationId || selectedLocationId || locations[0]?.id || "" }));
  }, [selectedLocationId, locations]);

  useEffect(() => {
    setForm((current) => ({ ...current, moneyAccountId: current.moneyAccountId || accounts[0]?.id || "" }));
    setPayAccountId((current) => current || accounts[0]?.id || "");
  }, [accounts]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setError("");
    setMessage("");
    setForm(newForm(selectedLocationId || locations[0]?.id || ""));
    setDrawerOpen(true);
  }

  async function createAndPost() {
    setSaving(true);
    setError("");
    setMessage("");
    const amount = Number(form.amount.replace(",", "."));
    const paidAmount = form.paymentStatus === "PAID" ? amount : Number(form.paidAmount.replace(",", "."));
    if (!(amount > 0)) {
      setError("Вкажіть додатну суму.");
      setSaving(false);
      return;
    }
    if (!form.categoryId) {
      setError("Оберіть категорію.");
      setSaving(false);
      return;
    }
    if (form.paymentStatus !== "UNPAID" && !form.moneyAccountId) {
      setError("Оберіть рахунок для оплати.");
      setSaving(false);
      return;
    }
    if (form.paymentStatus === "PARTIALLY_PAID" && !(paidAmount > 0 && paidAmount < amount)) {
      setError("Часткова оплата має бути більшою за 0 та меншою за загальну суму.");
      setSaving(false);
      return;
    }
    if (form.paymentStatus === "UNPAID" && !form.counterpartyName.trim()) {
      setError("Для неоплаченої витрати вкажіть постачальника або контрагента.");
      setSaving(false);
      return;
    }
    try {
      const draftResponse = await fetch("/api/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          categoryId: form.categoryId,
          expenseDate: form.expenseDate,
          locationId: form.locationId || null,
          counterpartyName: form.counterpartyName || null,
          moneyAccountId: form.moneyAccountId || null,
          documentNumber: form.documentNumber || null,
          description: form.description || null,
          notes: form.notes || null,
          dueAt: form.dueAt || null,
        }),
      });
      const draft = await draftResponse.json();
      if (!draftResponse.ok || !draft.ok) throw new Error(draft.error || "Не вдалося створити витрату.");
      const postResponse = await fetch("/api/finance/expenses/" + encodeURIComponent(draft.expense.id) + "/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentStatus: form.paymentStatus,
          paidAmount,
          moneyAccountId: form.moneyAccountId || null,
          paymentDate: form.paymentDate || null,
          dueAt: form.dueAt || null,
        }),
      });
      const posted = await postResponse.json();
      if (!postResponse.ok || !posted.ok) throw new Error(posted.error || "Чернетку створено, але не вдалося провести витрату.");
      setDrawerOpen(false);
      setMessage("Витрату проведено та додано до фінансового центру.");
      await load();
      onDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося провести витрату.");
    } finally {
      setSaving(false);
    }
  }

  async function pay(row: ExpenseRow) {
    const amount = Number(payAmount.replace(",", "."));
    if (!(amount > 0) || amount > row.outstanding) {
      setError("Сума оплати повинна бути більшою за 0 та не перевищувати залишок.");
      return;
    }
    if (!payAccountId) {
      setError("Оберіть рахунок.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      const response = await fetch("/api/finance/expenses/" + encodeURIComponent(row.id) + "/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidAmount: amount, moneyAccountId: payAccountId, paymentDate: today(), idempotencyKey: "ui-" + Date.now() + "-" + Math.random().toString(36).slice(2) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Не вдалося оплатити витрату.");
      setPaying(null);
      setPayAmount("");
      setMessage("Оплату проведено.");
      await load();
      onDataChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося оплатити витрату.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.expenseRegister}>
    <div className={styles.registerHead}>
      <div><p className="eyebrow">EXPENSE REGISTER</p><h2>Витрати</h2><span>Кожен документ зберігається окремим рядком і потрапляє у відповідний фінансовий розділ.</span></div>
      <button type="button" className={styles.primaryButton} onClick={openCreate}>+ Додати витрату</button>
    </div>
    <div className={styles.expenseFilters}>
      <label>Пошук<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, опис, контрагент" /></label>
      <label>Оплата<select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}><option value="">Усі</option><option value="UNPAID">Не оплачено</option><option value="PARTIALLY_PAID">Частково оплачено</option><option value="PAID">Оплачено</option><option value="OVERDUE">Прострочено</option></select></label>
      <span className={styles.registerCount}>{loading ? "Завантаження…" : rows.length + " документів"}</span>
    </div>
    {message && <div className={styles.successMessage}>{message}</div>}
    {error && <div className="alert"><strong>Операція з витратою не виконана</strong><span>{error}</span><button type="button" onClick={() => setError("")}>Закрити</button></div>}
    {rows.length === 0 && !loading ? <div className={styles.registerEmpty}><strong>Витрат за вибраний період немає</strong><span>Додайте першу операційну витрату, щоб вона потрапила до P&L та Cash Flow.</span><button type="button" onClick={openCreate}>+ Додати витрату</button></div> : <div className={styles.expenseTable}>
      <div className={styles.expenseTableHead}><span>Дата</span><span>Документ / категорія</span><span>Опис / контрагент</span><span>Сума</span><span>Оплата</span><span>Дія</span></div>
      {rows.map((row) => <div className={styles.expenseRow} key={row.id}>
        <span>{dateText(row.expenseDate)}</span>
        <span><strong>{row.number}</strong><small>{row.category?.name || "Без категорії"}</small></span>
        <span><strong>{row.description || "—"}</strong><small>{row.counterpartyName || row.supplier?.name || "Без контрагента"}</small></span>
        <strong>{money(row.amount)}<small>{row.outstanding > 0 ? "Залишок " + money(row.outstanding) : ""}</small></strong>
        <span className={statusClass(row.paymentStatus)}>{STATUS_LABELS[row.paymentStatus] || row.paymentStatus}</span>
        <span>{row.paymentStatus !== "PAID" && row.status === "POSTED" ? <button type="button" className={styles.tableAction} onClick={() => { setPaying(row.id); setPayAmount(String(row.outstanding)); setPayAccountId(accounts[0]?.id || ""); }}>Оплатити</button> : <span className={statusClass(row.status)}>{STATUS_LABELS[row.status] || row.status}</span>}</span>
        {paying === row.id && <div className={styles.inlinePayment}><label>Сума<input value={payAmount} onChange={(event) => setPayAmount(event.target.value)} /></label><label>Рахунок<select value={payAccountId} onChange={(event) => setPayAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><button type="button" disabled={saving} onClick={() => void pay(row)}>Провести оплату</button><button type="button" className={styles.secondaryButton} onClick={() => setPaying(null)}>Скасувати</button></div>}
      </div>)}
    </div>}
    {drawerOpen && <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}><aside className={styles.expenseDrawer} role="dialog" aria-modal="true" aria-label="Нова витрата">
      <div className={styles.drawerHead}><div><p className="eyebrow">NEW EXPENSE</p><h2>Нова витрата</h2></div><button type="button" className={styles.closeButton} onClick={() => setDrawerOpen(false)} aria-label="Закрити">×</button></div>
      <div className={styles.formGrid}>
        <label>Категорія<select value={form.categoryId} onChange={(event) => updateForm("categoryId", event.target.value)}><option value="">Оберіть категорію</option>{manualCategories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.pnlSection ? " · " + category.pnlSection : " · без P&L"}</option>)}</select></label>
        <label>Сума, грн<input inputMode="decimal" value={form.amount} onChange={(event) => updateForm("amount", event.target.value)} placeholder="0,00" /></label>
        <label>Дата витрати<input type="date" value={form.expenseDate} onChange={(event) => updateForm("expenseDate", event.target.value)} /></label>
        <label>Станція<select value={form.locationId} onChange={(event) => updateForm("locationId", event.target.value)}><option value="">Без прив’язки</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Контрагент / постачальник<input value={form.counterpartyName} onChange={(event) => updateForm("counterpartyName", event.target.value)} placeholder="Назва" /></label>
        <label>№ первинного документа<input value={form.documentNumber} onChange={(event) => updateForm("documentNumber", event.target.value)} placeholder="Рахунок, чек, акт" /></label>
        <label className={styles.formWide}>Опис<input value={form.description} onChange={(event) => updateForm("description", event.target.value)} placeholder="На що витрачено" /></label>
        <label className={styles.formWide}>Примітка<textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} rows={3} /></label>
        <label>Статус оплати<select value={form.paymentStatus} onChange={(event) => updateForm("paymentStatus", event.target.value as FormState["paymentStatus"])}>{Object.entries(PAYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.paymentStatus !== "UNPAID" && <label>Рахунок / каса<select value={form.moneyAccountId} onChange={(event) => updateForm("moneyAccountId", event.target.value)}><option value="">Оберіть рахунок</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type}</option>)}</select></label>}
        {form.paymentStatus !== "UNPAID" && <label>Дата оплати<input type="date" value={form.paymentDate} onChange={(event) => updateForm("paymentDate", event.target.value)} /></label>}
        {form.paymentStatus === "PARTIALLY_PAID" && <label>Оплачено зараз, грн<input inputMode="decimal" value={form.paidAmount} onChange={(event) => updateForm("paidAmount", event.target.value)} /></label>}
        {form.paymentStatus === "UNPAID" && <label>Строк оплати<input type="date" value={form.dueAt} onChange={(event) => updateForm("dueAt", event.target.value)} /></label>}
      </div>
      {form.categoryId && !manualCategories.find((category) => category.id === form.categoryId)?.pnlSection && <div className={styles.infoMessage}>Ця категорія відображатиметься у Cash Flow, але не зменшить чистий прибуток у P&L.</div>}
      <div className={styles.drawerActions}><button type="button" className={styles.secondaryButton} onClick={() => setDrawerOpen(false)}>Скасувати</button><button type="button" className={styles.primaryButton} disabled={saving} onClick={() => void createAndPost()}>{saving ? "Проводжу…" : "Зберегти та провести"}</button></div>
    </aside></div>}
  </section>;
}
