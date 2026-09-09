"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./financial-center-v2.module.css";

type Account = { id: string; name: string; type: string; locationId: string | null; balance: number };
type ApprovalRule = {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number | null;
  locationId: string | null;
  requiredPermission: string | null;
  requiredRole: string | null;
  isActive: boolean;
  sortOrder: number;
};
type Advance = {
  id: string;
  clientId: string;
  workOrderId: string | null;
  amount: number;
  appliedAmount: number;
  remainingAmount: number;
  currency: string;
  receivedAt: string;
  moneyAccountId: string;
  locationId: string | null;
  status: string;
  description: string | null;
};
type ClientHit = {
  id: string;
  name: string | null;
  phone?: string | null;
  workOrders?: Array<{ id: string; status?: string | null }>;
};

function money(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}
function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося виконати фінансову дію.");
  return payload;
}

export function FinancialGovernancePanel({ locationId, accounts, onChanged }: { locationId: string; accounts: Account[]; onChanged: () => void }) {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const querySuffix = useMemo(() => locationId ? `&locationId=${encodeURIComponent(locationId)}` : "", [locationId]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rulesPayload, advancesPayload] = await Promise.all([
        apiJson(`/api/finance/v2?view=approval-rules${querySuffix}`),
        apiJson(`/api/finance/v2?view=customer-advances${querySuffix}`),
      ]);
      setRules(Array.isArray(rulesPayload.rules) ? rulesPayload.rules : []);
      setAdvances(Array.isArray(advancesPayload.advances) ? advancesPayload.advances : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінансові правила.");
    } finally {
      setLoading(false);
    }
  }, [querySuffix]);

  useEffect(() => { void load(); }, [load]);

  async function action(actionName: string, payload: Record<string, unknown>) {
    const result = await apiJson("/api/finance/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName, ...payload, ...(locationId ? { locationId } : {}) }),
    });
    await load();
    onChanged();
    return result;
  }

  return <div className={styles.grid2}>
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>APPROVAL CONTROL</span><h2>Погодження витрат</h2><p>Пороги визначають, які витрати можна провести одразу, а які потребують погодження.</p></div></div>
      {error && <div className={styles.errorBox}>{error}</div>}
      {message && <div className={styles.success}>{message}</div>}
      <ApprovalRuleForm locationId={locationId} onSave={async (payload) => {
        try { await action("SAVE_APPROVAL_RULE", payload); setMessage("Правило погодження збережено."); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти правило."); }
      }} />
      <div className={styles.tableWrap} style={{ marginTop: 14 }}><table className={styles.table}><thead><tr><th>Правило</th><th>Діапазон</th><th>Погоджувач</th><th>Статус</th></tr></thead><tbody>
        {rules.map((rule) => <tr key={rule.id}><td><strong>{rule.name}</strong><small>{rule.locationId ? "Локальне правило" : "Для всієї мережі"}</small></td><td>{money(rule.minAmount)} — {rule.maxAmount == null ? "∞" : money(rule.maxAmount)}</td><td>{rule.requiredRole || rule.requiredPermission || "За базовими правами FINANCE.WRITE"}</td><td><button type="button" className={styles.secondaryButton} onClick={async () => { try { await action("SET_APPROVAL_RULE_ACTIVE", { ruleId: rule.id, isActive: !rule.isActive }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося змінити правило."); } }}>{rule.isActive ? "Увімкнено" : "Вимкнено"}</button></td></tr>)}
        {!rules.length && !loading && <tr><td colSpan={4}>Правил ще немає. Без окремого правила діє базова перевірка прав.</td></tr>}
      </tbody></table></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>CUSTOMER ADVANCES</span><h2>Аванси клієнтів</h2><p>Аванс збільшує Cash, але не виручку. Виручка виникає лише після фіналізації робіт.</p></div></div>
      <AdvanceCreateForm locationId={locationId} accounts={accounts} onCreate={async (payload) => {
        try { await action("CREATE_CUSTOMER_ADVANCE", payload); setMessage("Аванс клієнта зафіксовано."); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося створити аванс."); }
      }} />
      <div className={styles.tableWrap} style={{ marginTop: 14 }}><table className={styles.table}><thead><tr><th>Клієнт / ЗН</th><th>Дата</th><th>Статус</th><th className={styles.numberCell}>Отримано</th><th className={styles.numberCell}>Залишок</th><th>Дії</th></tr></thead><tbody>
        {advances.map((row) => <AdvanceRow key={row.id} row={row} onAction={action} onError={setError} />)}
        {!advances.length && !loading && <tr><td colSpan={6}>Авансів за вибраним контуром немає.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}

function ApprovalRuleForm({ locationId, onSave }: { locationId: string; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState("Погодження великих витрат");
  const [minAmount, setMinAmount] = useState("30000");
  const [maxAmount, setMaxAmount] = useState("");
  const [requiredRole, setRequiredRole] = useState("OWNER");
  const [saving, setSaving] = useState(false);
  return <div className={styles.modalGrid}>
    <label>Назва<input value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>Від, грн<input inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} /></label>
    <label>До, грн<input inputMode="decimal" value={maxAmount} placeholder="без верхньої межі" onChange={(e) => setMaxAmount(e.target.value)} /></label>
    <label>Роль погоджувача<select value={requiredRole} onChange={(e) => setRequiredRole(e.target.value)}><option value="OWNER">Власник</option><option value="STATION_MANAGER">Керуючий СТО</option><option value="">За FINANCE.WRITE</option></select></label>
    <div className={styles.modalActions}><button type="button" className={styles.primaryButton} disabled={saving || !name.trim() || !minAmount.trim()} onClick={async () => { setSaving(true); try { await onSave({ name, minAmount: Number(minAmount.replace(",", ".")), maxAmount: maxAmount.trim() ? Number(maxAmount.replace(",", ".")) : null, requiredRole: requiredRole || null, locationId: locationId || null }); } finally { setSaving(false); } }}>{saving ? "Зберігаю…" : "+ Додати правило"}</button></div>
  </div>;
}

function AdvanceCreateForm({ locationId, accounts, onCreate }: { locationId: string; accounts: Account[]; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [client, setClient] = useState<ClientHit | null>(null);
  const [workOrderId, setWorkOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [receivedAt, setReceivedAt] = useState(isoToday());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client || search.trim().length < 2) { setHits([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/clients?q=${encodeURIComponent(search.trim())}&limit=8`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.ok && Array.isArray(payload.clients)) setHits(payload.clients);
      } catch { /* aborted search is expected */ }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search, client]);

  const clientOrders = Array.isArray(client?.workOrders) ? client!.workOrders! : [];
  const usableAccounts = accounts.filter((row) => !locationId || !row.locationId || row.locationId === locationId);
  return <div>
    <div className={styles.modalGrid}>
      <label>Клієнт<input value={client ? `${client.name || "Клієнт"}${client.phone ? ` · ${client.phone}` : ""}` : search} onChange={(e) => { setClient(null); setSearch(e.target.value); setWorkOrderId(""); }} placeholder="Ім'я, телефон, номер авто" /></label>
      <label>Замовлення-наряд<select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}><option value="">Без прив'язки</option>{clientOrders.map((row) => <option key={row.id} value={row.id}>{row.id}{row.status ? ` · ${row.status}` : ""}</option>)}</select></label>
      <label>Сума, грн<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>Куди надійшли гроші<select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Оберіть рахунок</option>{usableAccounts.map((row) => <option value={row.id} key={row.id}>{row.name} · {money(row.balance)}</option>)}</select></label>
      <label>Дата<input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></label>
      <label>Коментар<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    </div>
    {!client && hits.length > 0 && <div className={styles.metricList}>{hits.map((hit) => <button type="button" className={styles.metricItem} key={hit.id} onClick={() => { setClient(hit); setSearch(hit.name || hit.phone || hit.id); const orders = Array.isArray(hit.workOrders) ? hit.workOrders : []; if (orders.length === 1) setWorkOrderId(orders[0].id); }}><span><strong>{hit.name || "Клієнт"}</strong><small>{hit.phone || hit.id}</small></span><span>{hit.workOrders?.length || 0} ЗН</span></button>)}</div>}
    <div className={styles.modalActions}><button type="button" className={styles.primaryButton} disabled={saving || !client?.id || !accountId || Number(amount.replace(",", ".")) <= 0} onClick={async () => { setSaving(true); try { await onCreate({ clientId: client!.id, workOrderId: workOrderId || null, amount: Number(amount.replace(",", ".")), moneyAccountId: accountId, receivedAt, description: description || null, locationId: locationId || null }); setAmount(""); setDescription(""); } finally { setSaving(false); } }}>{saving ? "Фіксую…" : "+ Зафіксувати аванс"}</button></div>
  </div>;
}

function AdvanceRow({ row, onAction, onError }: { row: Advance; onAction: (action: string, payload: Record<string, unknown>) => Promise<unknown>; onError: (value: string) => void }) {
  const [workOrderId, setWorkOrderId] = useState(row.workOrderId || "");
  const [applyAmount, setApplyAmount] = useState(String(row.remainingAmount || ""));
  const [busy, setBusy] = useState(false);
  const open = row.remainingAmount > 0 && !["REFUNDED", "APPLIED"].includes(row.status);
  return <tr><td><strong>{row.clientId}</strong><small>{row.workOrderId ? `ЗН ${row.workOrderId}` : row.description || "Без прив'язки до ЗН"}</small></td><td>{dateText(row.receivedAt)}</td><td>{row.status}</td><td className={styles.numberCell}>{money(row.amount, row.currency)}</td><td className={styles.numberCell}>{money(row.remainingAmount, row.currency)}</td><td>{open ? <div className={styles.quickActions}><input style={{ width: 130 }} value={workOrderId} placeholder="ID ЗН" onChange={(e) => setWorkOrderId(e.target.value)} /><input style={{ width: 95 }} inputMode="decimal" value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)} /><button type="button" className={styles.secondaryButton} disabled={busy || !workOrderId.trim()} onClick={async () => { setBusy(true); try { await onAction("APPLY_CUSTOMER_ADVANCE", { advanceId: row.id, workOrderId: workOrderId.trim(), amount: Number(applyAmount.replace(",", ".")) }); } catch (cause) { onError(cause instanceof Error ? cause.message : "Не вдалося зарахувати аванс."); } finally { setBusy(false); } }}>Зарахувати</button>{row.appliedAmount === 0 && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={async () => { if (!window.confirm("Повернути невикористаний аванс клієнту?")) return; setBusy(true); try { await onAction("REFUND_CUSTOMER_ADVANCE", { advanceId: row.id }); } catch (cause) { onError(cause instanceof Error ? cause.message : "Не вдалося повернути аванс."); } finally { setBusy(false); } }}>Повернути</button>}</div> : "—"}</td></tr>;
}
