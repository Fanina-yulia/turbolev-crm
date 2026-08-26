"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./payments-queue.module.css";

type Account = { id: string; name: string; type: "CASH" | "BANK" | "CARD" | "ACQUIRING" | "OTHER"; currency: string; locationId: string | null };
type PaymentRow = {
  obligationId: string;
  workOrderId: string;
  workOrderNumber: number | null;
  workOrderLabel: string;
  workOrderStatus: string;
  workOrderStatusLabel: string;
  currency: string;
  total: number;
  paid: number;
  outstanding: number;
  issuedAt: string;
  dueAt: string | null;
  overdue: boolean;
  todayPaid: number;
  lastPaymentAt: string | null;
  lastPaymentAmount: number;
  lastPaymentAccountId: string | null;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null };
  flags: { due: boolean; partial: boolean; debt: boolean; paidToday: boolean };
};
type QueueResponse = {
  ok: boolean;
  timezone?: string;
  accounts?: Account[];
  rows?: PaymentRow[];
  counts?: { due: number; partial: number; paidToday: number; debt: number };
  error?: string;
};
type PaymentPostResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  workOrder?: { id?: string; status?: string } | null;
  transitionWarning?: { code?: string; message?: string } | null;
};
type TabId = "due" | "partial" | "paidToday" | "debt";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "due", label: "До сплати" },
  { id: "partial", label: "Частково" },
  { id: "paidToday", label: "Оплачено сьогодні" },
  { id: "debt", label: "Борги" },
];
const TAB_IDS = new Set<TabId>(TABS.map((item) => item.id));

const ACCOUNT_LABELS: Record<Account["type"], string> = {
  CASH: "Готівка",
  BANK: "Банк",
  CARD: "Картка",
  ACQUIRING: "Еквайринг",
  OTHER: "Інше",
};

function money(value: number, currency = "UAH") {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
}

function dateText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function dateTimeText(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function carTitle(row: PaymentRow) {
  return [row.vehicle.brand, row.vehicle.model, row.vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function newPaymentKey(workOrderId: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 18) : Math.random().toString(36).slice(2, 16);
  return `cash-${Date.now().toString(36)}-${workOrderId.slice(-8)}-${suffix}`.slice(0, 64);
}

export function PaymentsQueue() {
  const [tab, setTab] = useState<TabId>("due");
  const [query, setQuery] = useState("");
  const [routeWorkOrderId, setRouteWorkOrderId] = useState("");
  const [routeLocationId, setRouteLocationId] = useState("");
  const [data, setData] = useState<QueueResponse>({ ok: true, rows: [], accounts: [], counts: { due: 0, partial: 0, paidToday: 0, debt: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [paymentRow, setPaymentRow] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const syncRoute = () => {
      const route = readCrmRoute();
      if (route.scope && TAB_IDS.has(route.scope as TabId)) setTab(route.scope as TabId);
      setRouteWorkOrderId(route.workOrderId || "");
      setRouteLocationId(route.locationId || "");
    };
    syncRoute();
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (routeWorkOrderId) params.set("workOrderId", routeWorkOrderId);
        if (routeLocationId) params.set("locationId", routeLocationId);
        const response = await fetch(`/api/payments${params.size ? `?${params}` : ""}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as QueueResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити касу");
        setData(payload);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка каси");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 220 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, refreshKey, routeWorkOrderId, routeLocationId]);

  const rows = data.rows || [];
  const accounts = data.accounts || [];
  const counts = data.counts || { due: 0, partial: 0, paidToday: 0, debt: 0 };
  const visible = useMemo(
    () => routeWorkOrderId ? rows.filter((row) => row.workOrderId === routeWorkOrderId) : rows.filter((row) => row.flags[tab]),
    [rows, routeWorkOrderId, tab],
  );
  const outstandingTotal = useMemo(() => rows.filter((row) => row.outstanding > 0).reduce((sum, row) => sum + row.outstanding, 0), [rows]);
  const paidTodayTotal = useMemo(() => rows.reduce((sum, row) => sum + row.todayPaid, 0), [rows]);
  const debtTotal = useMemo(() => rows.filter((row) => row.flags.debt).reduce((sum, row) => sum + row.outstanding, 0), [rows]);

  function selectTab(next: TabId) {
    setTab(next);
    setRouteWorkOrderId("");
    navigateCrm("Оплати", { scope: next, ...(routeLocationId ? { locationId: routeLocationId } : {}) });
  }

  function openPayment(row: PaymentRow) {
    const defaultAccount = accounts.find((account) => !account.locationId) || accounts[0];
    setPaymentRow(row);
    setAmount(row.outstanding.toFixed(2));
    setAccountId(defaultAccount?.id || "");
    setIdempotencyKey(newPaymentKey(row.workOrderId));
    setPaymentError("");
  }

  function closePayment() {
    if (submitting) return;
    setPaymentRow(null);
    setPaymentError("");
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!paymentRow) return;
    const numericAmount = Number(amount.replace(",", "."));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setPaymentError("Вкажіть суму більше нуля.");
      return;
    }
    if (numericAmount > paymentRow.outstanding + 0.001) {
      setPaymentError("Сума не може перевищувати залишок до сплати.");
      return;
    }
    if (!accountId) {
      setPaymentError("Оберіть рахунок, куди прийнято оплату.");
      return;
    }

    setSubmitting(true);
    setPaymentError("");
    setNotice("");
    try {
      const paidInFull = numericAmount >= paymentRow.outstanding - 0.001;
      const response = await fetch(`/api/work-orders/${encodeURIComponent(paymentRow.workOrderId)}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: numericAmount,
          moneyAccountId: accountId,
          idempotencyKey,
          actorName: "CRM / Каса",
        }),
      });
      const payload = await response.json() as PaymentPostResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || payload.code || "Не вдалося провести оплату");
      setPaymentRow(null);
      setNotice(payload.transitionWarning?.message || (paidInFull ? "Оплату проведено. Замовлення-наряд переведено у «Готовий до видачі»." : "Часткову оплату проведено. Залишок оновлено."));
      setRefreshKey((value) => value + 1);
      if (!routeWorkOrderId) setTab(paidInFull ? "paidToday" : "partial");
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Не вдалося провести оплату");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · КАСА</p>
        <h1>Оплати</h1>
        <span>{routeWorkOrderId ? "Відкрито конкретний замовлення-наряд" : "Що потрібно отримати від клієнтів і що вже надійшло сьогодні"}</span>
      </div>
      <button className={styles.refresh} type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>↻ Оновити</button>
    </header>

    <section className={styles.kpis}>
      <article><small>До отримання</small><strong>{money(outstandingTotal)}</strong><span>{rows.filter((row) => row.outstanding > 0).length} ЗН</span></article>
      <article><small>Оплачено сьогодні</small><strong>{money(paidTodayTotal)}</strong><span>{counts.paidToday} ЗН</span></article>
      <article className={debtTotal > 0 ? styles.dangerKpi : ""}><small>Прострочений борг</small><strong>{money(debtTotal)}</strong><span>{counts.debt} ЗН</span></article>
    </section>

    <div className={styles.toolbar}>
      <label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ПІБ, телефон, номер авто, VIN або ЗН..." />{query && <button type="button" onClick={() => setQuery("")}>×</button>}</label>
    </div>

    <nav className={styles.tabs} aria-label="Черги оплат">
      {TABS.map((item) => <button type="button" key={item.id} className={!routeWorkOrderId && tab === item.id ? styles.activeTab : ""} onClick={() => selectTab(item.id)}><span>{item.label}</span><b>{counts[item.id]}</b></button>)}
    </nav>

    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.state}>{notice}</div>}
    {loading ? <div className={styles.state}>Завантажую касову чергу…</div> : !visible.length ? <div className={styles.state}>{routeWorkOrderId ? "Для цього ЗН немає доступного фінансового зобов’язання." : "У цій черзі зараз немає замовлень."}</div> : <section className={styles.list}>
      {visible.map((row) => <article className={`${styles.card} ${row.overdue ? styles.overdueCard : ""}`} key={row.obligationId}>
        <div className={styles.cardHead}>
          <button className={styles.woLink} type="button" onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: row.workOrderId, workOrderTab: "payment" })}>{row.workOrderLabel}</button>
          <span className={styles.status}>{row.workOrderStatusLabel}</span>
          {row.overdue && <span className={styles.overdue}>Прострочено</span>}
        </div>
        <div className={styles.mainRow}>
          <div className={styles.identity}>
            <strong>{row.vehicle.plateNumber || carTitle(row)}</strong>
            <span>{carTitle(row)}</span>
            <small>{row.client.name || "Клієнт без імені"} · {row.client.phone}</small>
          </div>
          <div className={styles.amounts}>
            <span><small>Сума</small><b>{money(row.total, row.currency)}</b></span>
            <span><small>Сплачено</small><b>{money(row.paid, row.currency)}</b></span>
            <span className={row.outstanding > 0 ? styles.balance : ""}><small>Залишок</small><strong>{money(row.outstanding, row.currency)}</strong></span>
          </div>
        </div>
        <div className={styles.meta}>
          <span>До сплати: <b>{dateText(row.dueAt)}</b></span>
          {row.todayPaid > 0 && <span>Сьогодні: <b>+{money(row.todayPaid, row.currency)}</b></span>}
          {row.lastPaymentAt && <span>Остання оплата: <b>{dateTimeText(row.lastPaymentAt)}</b></span>}
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => navigateCrm("Замовлення-наряди", { workOrderId: row.workOrderId, workOrderTab: "payment" })}>Відкрити ЗН</button>
          {row.outstanding > 0 && <button type="button" className={styles.pay} onClick={() => openPayment(row)}>Прийняти оплату</button>}
        </div>
      </article>)}
    </section>}

    {paymentRow && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closePayment(); }}>
      <form className={styles.modal} onSubmit={submitPayment}>
        <header><div><small>ПРИЙНЯТИ ОПЛАТУ</small><h2>{paymentRow.workOrderLabel} · {paymentRow.vehicle.plateNumber || carTitle(paymentRow)}</h2></div><button type="button" onClick={closePayment} disabled={submitting}>×</button></header>
        <div className={styles.modalBody}>
          <div className={styles.paymentSummary}><span>До сплати</span><strong>{money(paymentRow.outstanding, paymentRow.currency)}</strong></div>
          <label><span>Сума оплати</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></label>
          <label><span>Куди прийнято кошти</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Оберіть рахунок</option>{accounts.map((account) => <option key={account.id} value={account.id}>{ACCOUNT_LABELS[account.type]} · {account.name}</option>)}</select></label>
          {!accounts.length && <div className={styles.warning}>У фінансових налаштуваннях немає активного UAH-рахунку. Спочатку додайте касу/банк/еквайринг.</div>}
          {paymentError && <div className={styles.error}>{paymentError}</div>}
        </div>
        <footer><button type="button" onClick={closePayment} disabled={submitting}>Скасувати</button><button type="submit" className={styles.pay} disabled={submitting || !accounts.length}>{submitting ? "Проводжу…" : "Підтвердити оплату"}</button></footer>
      </form>
    </div>}
  </div>;
}