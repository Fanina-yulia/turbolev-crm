"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./financial-center-v2.module.css";

type Category = { id: string; name: string; code: string; pnlSection: string | null; cashFlowSection?: string | null; parentId: string | null };
type Account = { id: string; name: string; type: string; balance: number };
type CostCenter = { id: string; name: string; locationId: string | null };
type OperationType = "EXPENSE" | "INCOME" | "TRANSFER";
type SplitLine = { key: string; description: string; categoryId: string; amount: string };

type Props = {
  open: boolean;
  initialType?: OperationType;
  locationId: string;
  categories: Category[];
  accounts: Account[];
  costCenters: CostCenter[];
  onClose: () => void;
  onChanged: () => void;
};

function today() { return new Date().toISOString().slice(0, 10); }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function FinanceOperationDrawer({ open, initialType = "EXPENSE", locationId, categories, accounts, costCenters, onClose, onChanged }: Props) {
  const [type, setType] = useState<OperationType>(initialType);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [date, setDate] = useState(today());
  const [dueAt, setDueAt] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [description, setDescription] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"UNPAID" | "PARTIALLY_PAID" | "PAID">("PAID");
  const [paidAmount, setPaidAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [recognizeRevenue, setRecognizeRevenue] = useState(false);
  const [split, setSplit] = useState(false);
  const [lines, setLines] = useState<SplitLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const expenseCategories = useMemo(() => categories.filter((item) => item.pnlSection !== "REVENUE"), [categories]);
  const incomeCategories = useMemo(() => categories.filter((item) => item.pnlSection === "REVENUE" || item.pnlSection === "OTHER_INCOME" || item.pnlSection == null), [categories]);
  const filteredCostCenters = useMemo(() => costCenters.filter((item) => !locationId || !item.locationId || item.locationId === locationId), [costCenters, locationId]);

  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setError("");
    setAmount(""); setCategoryId(""); setDescription(""); setCounterparty(""); setDocumentNumber(""); setDueAt(""); setPaidAmount("");
    setPaymentStatus("PAID"); setDate(today()); setRecognizeRevenue(false); setSplit(false); setLines([]);
    setAccountId(accounts[0]?.id || ""); setFromAccountId(accounts[0]?.id || ""); setToAccountId(accounts[1]?.id || accounts[0]?.id || "");
    setCostCenterId(filteredCostCenters[0]?.id || "");
  }, [open, initialType, accounts, filteredCostCenters]);

  if (!open) return null;

  function addLine() {
    setSplit(true);
    setLines((current) => [...current, { key: uid(), description: "", categoryId: categoryId || expenseCategories[0]?.id || "", amount: "" }]);
  }
  function updateLine(key: string, patch: Partial<SplitLine>) { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); }
  function removeLine(key: string) { setLines((current) => current.filter((line) => line.key !== key)); }
  const splitTotal = lines.reduce((sum, line) => sum + (Number(line.amount.replace(",", ".")) || 0), 0);

  async function jsonPost(url: string, body: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Не вдалося провести фінансову операцію.");
    return data;
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const numericAmount = Number(amount.replace(",", "."));
      if (!(numericAmount > 0)) throw new Error("Вкажіть додатну суму.");

      if (type === "TRANSFER") {
        if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) throw new Error("Виберіть два різні рахунки.");
        await jsonPost("/api/finance/v2", { action: "TRANSFER", amount: numericAmount, fromAccountId, toAccountId, occurredAt: date, description, idempotencyKey: `transfer-ui-${uid()}` });
      } else if (type === "INCOME") {
        if (!accountId) throw new Error("Виберіть рахунок зарахування.");
        await jsonPost("/api/finance/v2", { action: "CREATE_INCOME", amount: numericAmount, moneyAccountId: accountId, occurredAt: date, categoryId: categoryId || null, costCenterId: costCenterId || null, locationId: locationId || null, description, recognizeRevenue, idempotencyKey: `income-ui-${uid()}` });
      } else {
        if (!categoryId && !lines.length) throw new Error("Виберіть категорію витрати.");
        if (split) {
          if (!lines.length) throw new Error("Додайте хоча б один рядок витрати.");
          if (Math.abs(splitTotal - numericAmount) > 0.005) throw new Error(`Сума рядків ${splitTotal.toFixed(2)} грн не дорівнює сумі документа ${numericAmount.toFixed(2)} грн.`);
          if (lines.some((line) => !line.description.trim() || !line.categoryId || !(Number(line.amount.replace(",", ".")) > 0))) throw new Error("Заповніть опис, категорію та суму кожного рядка.");
        }
        if (paymentStatus !== "UNPAID" && !accountId) throw new Error("Для оплаченої витрати виберіть рахунок.");
        if (paymentStatus === "UNPAID" && !counterparty.trim()) throw new Error("Для неоплаченої витрати вкажіть контрагента.");
        const partial = paymentStatus === "PARTIALLY_PAID" ? Number(paidAmount.replace(",", ".")) : paymentStatus === "PAID" ? numericAmount : 0;
        if (paymentStatus === "PARTIALLY_PAID" && (!(partial > 0) || partial >= numericAmount)) throw new Error("Часткова оплата має бути більшою за 0 і меншою за загальну суму.");
        const draft = await jsonPost("/api/finance/expenses", {
          amount: numericAmount, categoryId: categoryId || lines[0]?.categoryId, expenseDate: date, dueAt: dueAt || null, locationId: locationId || null,
          costCenterId: costCenterId || null, counterpartyName: counterparty || null, moneyAccountId: accountId || null, documentNumber: documentNumber || null,
          description: description || null,
          lines: split ? lines.map((line) => ({ description: line.description, categoryId: line.categoryId, costCenterId: costCenterId || null, amount: Number(line.amount.replace(",", ".")) })) : undefined,
        });
        const expenseId = draft.expense.id;
        const postResponse = await fetch(`/api/finance/expenses/${encodeURIComponent(expenseId)}/post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentStatus, paidAmount: partial, moneyAccountId: accountId || null, paymentDate: date, dueAt: dueAt || null }) });
        const posted = await postResponse.json();
        if (!postResponse.ok || !posted.ok) {
          if (posted.code === "EXPENSE_APPROVAL_REQUIRED") {
            await jsonPost("/api/finance/v2", { action: "REQUEST_EXPENSE_APPROVAL", expenseId });
          } else throw new Error(posted.error || "Чернетку створено, але провести витрату не вдалося.");
        }
      }
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      onChanged(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка операції."); }
    finally { setSaving(false); }
  }

  const categoriesForType = type === "INCOME" ? incomeCategories : expenseCategories;
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Нова фінансова операція">
      <div className={styles.modalHeader}><div><span className={styles.eyebrow}>FINANCIAL OPERATION</span><h2>Додати операцію</h2></div><button className={styles.iconButton} type="button" onClick={onClose}>✕</button></div>
      <div className={styles.operationType}><button className={type === "EXPENSE" ? styles.selected : ""} onClick={() => setType("EXPENSE")}>Витрата</button><button className={type === "INCOME" ? styles.selected : ""} onClick={() => setType("INCOME")}>Надходження</button><button className={type === "TRANSFER" ? styles.selected : ""} onClick={() => setType("TRANSFER")}>Переказ</button></div>
      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.modalGrid}>
        <label>Сума, грн<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" /></label>
        <label>Дата<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {type !== "TRANSFER" && <label>Категорія<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Оберіть категорію</option>{categoriesForType.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
        {type !== "TRANSFER" && <label>Центр витрат<select value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}><option value="">Не вказано</option>{filteredCostCenters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {type === "EXPENSE" && <label>Статус оплати<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as typeof paymentStatus)}><option value="PAID">Оплачено</option><option value="PARTIALLY_PAID">Частково оплачено</option><option value="UNPAID">Не оплачено</option></select></label>}
        {type === "EXPENSE" && paymentStatus === "PARTIALLY_PAID" && <label>Сплачено зараз<input value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} inputMode="decimal" /></label>}
        {type === "EXPENSE" && <label>Строк оплати<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>}
        {type === "EXPENSE" && <label>Контрагент<input value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="Постачальник / орендодавець / інше" /></label>}
        {type === "EXPENSE" && <label>№ документа<input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} placeholder="Рахунок / накладна" /></label>}
        {(type === "EXPENSE" || type === "INCOME") && <label>{type === "EXPENSE" ? "Рахунок оплати" : "Рахунок зарахування"}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Оберіть рахунок</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {Math.round(item.balance).toLocaleString("uk-UA")} грн</option>)}</select></label>}
        {type === "TRANSFER" && <><label>З рахунку<select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>На рахунок<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
      </div>

      {type === "INCOME" && <label className={styles.drawerNote}><span><input type="checkbox" checked={recognizeRevenue} onChange={(event) => setRecognizeRevenue(event.target.checked)} /> Визнати це надходження доходом у P&L</span><small>Залиште вимкненим для авансу, повернення позики чи іншого руху грошей, який не є виручкою.</small></label>}
      {type === "EXPENSE" && <div className={styles.sectionTitle}><h3>Розподіл документа</h3><button className={styles.secondaryButton} type="button" onClick={addLine}>+ Додати рядок</button></div>}
      {type === "EXPENSE" && split && <div className={styles.splitLines}>{lines.map((line) => <div className={styles.splitLine} key={line.key}><label>Опис<input value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} /></label><label>Категорія<select value={line.categoryId} onChange={(event) => updateLine(line.key, { categoryId: event.target.value })}><option value="">Оберіть</option>{expenseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Сума<input value={line.amount} onChange={(event) => updateLine(line.key, { amount: event.target.value })} inputMode="decimal" /></label><button type="button" className={styles.iconButton} onClick={() => removeLine(line.key)}>✕</button></div>)}<div className={styles.hint}>Рядки: {splitTotal.toLocaleString("uk-UA")} грн · документ: {(Number(amount.replace(",", ".")) || 0).toLocaleString("uk-UA")} грн</div></div>}
      <label>Опис<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Коментар до операції" /></label>
      <div className={styles.modalActions}><button type="button" className={styles.primaryButton} onClick={() => void save()} disabled={saving}>{saving ? "Проводжу…" : type === "TRANSFER" ? "Провести переказ" : type === "INCOME" ? "Провести надходження" : "Зберегти і провести"}</button><button type="button" className={styles.secondaryButton} onClick={onClose}>Скасувати</button></div>
    </section>
  </div>;
}
