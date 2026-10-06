"use client";

import { CrmPageHeader } from "./crm-page-header";
import { FinanceInfoTooltip } from "./finance-info-tooltip";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { VehiclePlate } from "./vehicle-plate";
import styles from "./payments-queue.module.css";

type Account = { id: string; name: string; type: "CASH" | "BANK" | "CARD" | "ACQUIRING" | "OTHER"; currency: string; locationId: string | null };
type Location = { id: string; name: string };
type PaymentHistory = {
  id: string;
  amount: number;
  occurredAt: string;
  accountId: string | null;
  accountName: string | null;
  accountType: string | null;
  description: string | null;
};
type PaymentRow = {
  obligationId: string;
  workOrderId: string;
  workOrderNumber: number | null;
  workOrderLabel: string;
  workOrderStatus: string;
  workOrderStatusLabel: string;
  paymentStatus: "PAID" | "PARTIAL" | "DUE";
  currency: string;
  total: number;
  paid: number;
  outstanding: number;
  issuedAt: string;
  dueAt: string | null;
  settledAt: string | null;
  locationId: string | null;
  overdue: boolean;
  lastPaymentAt: string | null;
  lastPaymentAmount: number;
  client: { id: string; name: string | null; phone: string };
  vehicle: { id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null };
  history: PaymentHistory[];
};
type QueueResponse = {
  ok: boolean;
  timezone?: string;
  range?: { from: string; to: string };
  accounts?: Account[];
  locations?: Location[];
  rows?: PaymentRow[];
  counts?: { all: number; paid: number; partial: number; due: number; overdue: number };
  kpis?: {
    toReceive: number;
    paidToday: number;
    partialCount: number;
    partialOutstanding: number;
    dueCount: number;
    dueOutstanding: number;
    overdueCount: number;
    overdueOutstanding: number;
  };
  error?: string;
};
type PaymentPostResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  transitionWarning?: { code?: string; message?: string } | null;
};

type TabId = "all" | "paid" | "partial" | "due" | "overdue";
type Preset = "today" | "7d" | "30d" | "month" | "custom";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "all", label: "Усі" },
  { id: "paid", label: "Оплачено повністю" },
  { id: "partial", label: "Є передплата" },
  { id: "due", label: "Очікує оплату" },
  { id: "overdue", label: "Прострочено" },
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

function dayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function shiftDay(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function presetRange(preset: Preset) {
  const today = dayKey();
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: shiftDay(today, -6), to: today };
  if (preset === "30d") return { from: shiftDay(today, -29), to: today };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: shiftDay(today, -29), to: today };
}

function newPaymentKey(workOrderId: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 18) : Math.random().toString(36).slice(2, 16);
  return `cash-${Date.now().toString(36)}-${workOrderId.slice(-8)}-${suffix}`.slice(0, 64);
}

function localDateTimeValue() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return parts.replace(" ", "T");
}

function statusLabel(row: PaymentRow) {
  if (row.paymentStatus === "PAID") return "Оплачено повністю";
  if (row.paymentStatus === "PARTIAL") return "Є передплата";
  return "Очікує оплату";
}

export function PaymentsQueue() {
  const initialRange = presetRange("30d");
  const [tab, setTab] = useState<TabId>("all");
  const [preset, setPreset] = useState<Preset>("30d");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("");
  const [routeWorkOrderId, setRouteWorkOrderId] = useState("");
  const [data, setData] = useState<QueueResponse>({
    ok: true,
    rows: [],
    accounts: [],
    locations: [],
    counts: { all: 0, paid: 0, partial: 0, due: 0, overdue: 0 },
    kpis: { toReceive: 0, paidToday: 0, partialCount: 0, partialOutstanding: 0, dueCount: 0, dueOutstanding: 0, overdueCount: 0, overdueOutstanding: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedRow, setSelectedRow] = useState<PaymentRow | null>(null);
  const [paymentRow, setPaymentRow] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue());
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const syncRoute = () => {
      const route = readCrmRoute();
      if (route.scope && TAB_IDS.has(route.scope as TabId)) setTab(route.scope as TabId);
      setRouteWorkOrderId(route.workOrderId || "");
      if (route.locationId) setLocationId(route.locationId);
      if (route.from && route.to) {
        setPreset("custom");
        setFrom(route.from);
        setTo(route.to);
      }
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
        const params = new URLSearchParams({ from, to });
        if (query.trim()) params.set("q", query.trim());
        if (routeWorkOrderId) params.set("workOrderId", routeWorkOrderId);
        if (locationId) params.set("locationId", locationId);
        const response = await fetch(`/api/payments?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as QueueResponse;
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити реєстр оплат");
        setData(payload);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Помилка реєстру оплат");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.trim() ? 220 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, refreshKey, routeWorkOrderId, locationId, from, to]);

  const rows = data.rows || [];
  const accounts = data.accounts || [];
  const locations = data.locations || [];
  const counts = data.counts || { all: 0, paid: 0, partial: 0, due: 0, overdue: 0 };
  const kpis = data.kpis || { toReceive: 0, paidToday: 0, partialCount: 0, partialOutstanding: 0, dueCount: 0, dueOutstanding: 0, overdueCount: 0, overdueOutstanding: 0 };

  const filteredCounts = useMemo(() => ({
    all: rows.length,
    paid: rows.filter((row) => row.paymentStatus === "PAID").length,
    partial: rows.filter((row) => row.paymentStatus === "PARTIAL").length,
    due: rows.filter((row) => row.paymentStatus === "DUE").length,
    overdue: rows.filter((row) => row.overdue).length,
  }), [rows]);

  const visible = useMemo(() => {
    if (routeWorkOrderId) return rows.filter((row) => row.workOrderId === routeWorkOrderId);
    if (tab === "paid") return rows.filter((row) => row.paymentStatus === "PAID");
    if (tab === "partial") return rows.filter((row) => row.paymentStatus === "PARTIAL");
    if (tab === "due") return rows.filter((row) => row.paymentStatus === "DUE");
    if (tab === "overdue") return rows.filter((row) => row.overdue);
    return rows;
  }, [rows, routeWorkOrderId, tab]);

  function applyPreset(next: Preset) {
    setPreset(next);
    if (next === "custom") return;
    const range = presetRange(next);
    setFrom(range.from);
    setTo(range.to);
  }

  function selectTab(next: TabId) {
    setTab(next);
    setRouteWorkOrderId("");
    navigateCrm("Оплати", {
      scope: next,
      ...(locationId ? { locationId } : {}),
      from,
      to,
    });
  }

  function openPayment(row: PaymentRow) {
    const defaultAccount = accounts.find((account) => account.locationId === row.locationId)
      || accounts.find((account) => !account.locationId)
      || accounts[0];
    setPaymentRow(row);
    setAmount(row.outstanding.toFixed(2));
    setAccountId(defaultAccount?.id || "");
    setOccurredAt(localDateTimeValue());
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
      setPaymentError("Сума більша за залишок. Переплату потрібно оформити окремим авансом клієнта.");
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
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          idempotencyKey,
        }),
      });
      const payload = await response.json() as PaymentPostResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || payload.code || "Не вдалося провести оплату");
      setPaymentRow(null);
      setSelectedRow(null);
      setNotice(payload.transitionWarning?.message || (paidInFull ? "Оплату проведено повністю." : "Передплату проведено. Залишок оновлено."));
      setRefreshKey((value) => value + 1);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed", { detail: { source: "payments" } }));
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Не вдалося провести оплату");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className={styles.page}>
    <CrmPageHeader
      eyebrow="TURBO LEV · КАСА"
      title="Оплати"
      description="Усі оплати по автомобілях і КП/ЗН: хто розрахувався, де є передплата і хто ще має заплатити."
      actions={<button className={styles.refresh} type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>↻ Оновити</button>}
    />

    <section className={styles.kpis}>
      <article>
        <small><FinanceInfoTooltip term="duePayments" label="До отримання" compact /></small>
        <strong>{money(kpis.toReceive)}</strong>
        <span>{counts.partial + counts.due} КП із залишком</span>
      </article>
      <article>
        <small><FinanceInfoTooltip term="paidToday" label="Оплачено сьогодні" compact /></small>
        <strong>{money(kpis.paidToday)}</strong>
        <span>фактичні POSTED платежі</span>
      </article>
      <article className={styles.partialKpi}>
        <small>Є передплата</small>
        <strong>{kpis.partialCount}</strong>
        <span>залишок {money(kpis.partialOutstanding)}</span>
      </article>
      <article className={styles.dueKpi}>
        <small>Очікують оплату</small>
        <strong>{kpis.dueCount}</strong>
        <span>{money(kpis.dueOutstanding)}</span>
      </article>
    </section>

    <section className={styles.toolbar}>
      <label className={styles.search}>
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Авто, ПІБ, телефон, VIN, КП або ЗН..." />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистити пошук">×</button>}
      </label>
      <div className={styles.presets} aria-label="Період">
        {([
          ["today", "Сьогодні"],
          ["7d", "7 днів"],
          ["30d", "30 днів"],
          ["month", "Місяць"],
          ["custom", "Період"],
        ] as Array<[Preset, string]>).map(([id, label]) => <button key={id} type="button" className={preset === id ? styles.activePreset : ""} onClick={() => applyPreset(id)}>{label}</button>)}
      </div>
      <label className={styles.dateField}><span>Від</span><input type="date" value={from} max={to} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); }} /></label>
      <label className={styles.dateField}><span>До</span><input type="date" value={to} min={from} onChange={(event) => { setPreset("custom"); setTo(event.target.value); }} /></label>
      {locations.length > 0 && <label className={styles.locationField}><span>СТО</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Уся доступна мережа</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
    </section>

    <nav className={styles.tabs} aria-label="Статуси оплат">
      {TABS.map((item) => {
        const count = query ? filteredCounts[item.id] : counts[item.id];
        return <button type="button" key={item.id} className={tab === item.id && !routeWorkOrderId ? styles.activeTab : ""} onClick={() => selectTab(item.id)}>
          <span className={item.id === "paid" ? styles.greenDot : item.id === "partial" ? styles.yellowDot : item.id === "due" || item.id === "overdue" ? styles.redDot : ""} />
          {item.label}<b>{count}</b>
        </button>;
      })}
    </nav>

    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}

    <section className={styles.register}>
      <div className={styles.tableHead}>
        <span>Авто</span><span>Клієнт</span><span>КП / ЗН</span><span>Сума</span><span>Сплачено</span><span>Залишок</span><span>Статус</span><span>Остання оплата</span><span>Дія</span>
      </div>
      <div className={styles.tableBody}>
        {loading ? <div className={styles.state}>Завантажую реєстр оплат…</div> : !visible.length ? <div className={styles.state}>{query ? "За цим пошуком записів не знайдено." : "У вибраному статусі записів немає."}</div> : visible.map((row) => {
          const tone = row.paymentStatus === "PAID" ? styles.paidRow : row.paymentStatus === "PARTIAL" ? styles.partialRow : styles.dueRow;
          return <article className={`${styles.tableRow} ${tone}`} key={row.obligationId} onClick={() => setSelectedRow(row)}>
            <div className={styles.vehicleCell}>
              {row.vehicle.plateNumber ? <VehiclePlate value={row.vehicle.plateNumber} size="sm" /> : <strong>{carTitle(row)}</strong>}
              <small>{carTitle(row)}</small>
            </div>
            <div className={styles.clientCell}><strong>{row.client.name || "Клієнт без імені"}</strong><a href={`tel:${row.client.phone}`} onClick={(event) => event.stopPropagation()}>{row.client.phone}</a></div>
            <div><button type="button" className={styles.linkButton} onClick={(event) => { event.stopPropagation(); navigateCrm("Комерційна пропозиція", { workOrderId: row.workOrderId, workOrderTab: "payment" }); }}>{row.workOrderLabel}</button><small>{row.workOrderStatusLabel}</small></div>
            <div className={styles.moneyCell}><strong>{money(row.total, row.currency)}</strong></div>
            <div className={styles.moneyCell}><strong>{money(row.paid, row.currency)}</strong></div>
            <div className={styles.moneyCell}><strong>{money(row.outstanding, row.currency)}</strong></div>
            <div><span className={`${styles.statusBadge} ${row.paymentStatus === "PAID" ? styles.statusPaid : row.paymentStatus === "PARTIAL" ? styles.statusPartial : styles.statusDue}`}>{statusLabel(row)}</span>{row.overdue && <span className={styles.overdueBadge}>Прострочено</span>}</div>
            <div><strong>{dateTimeText(row.lastPaymentAt)}</strong>{row.lastPaymentAt && <small>{money(row.lastPaymentAmount, row.currency)}</small>}</div>
            <div className={styles.rowAction}>
              {row.outstanding > 0 ? <button type="button" className={row.paymentStatus === "PARTIAL" ? styles.payPartial : styles.payDue} onClick={(event) => { event.stopPropagation(); openPayment(row); }}>{row.paymentStatus === "PARTIAL" ? "Доплатити" : "Прийняти оплату"}</button> : <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedRow(row); }}>Відкрити</button>}
            </div>
          </article>;
        })}
      </div>
      {!loading && visible.length > 0 && <footer className={styles.registerFooter}><span>Показано: <b>{visible.length}</b></span><span>До отримання: <b>{money(kpis.toReceive)}</b></span><span>Прострочено: <b>{kpis.overdueCount}</b> · {money(kpis.overdueOutstanding)}</span></footer>}
    </section>

    {selectedRow && <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRow(null); }}>
      <aside className={styles.drawer}>
        <header><div><small>ФІНАНСОВИЙ СТАН</small><h2>{selectedRow.vehicle.plateNumber || carTitle(selectedRow)}</h2><p>{carTitle(selectedRow)} · {selectedRow.client.name || "Клієнт без імені"}</p></div><button type="button" onClick={() => setSelectedRow(null)}>×</button></header>
        <div className={styles.drawerBody}>
          <section className={styles.drawerStatus}><span className={`${styles.statusBadge} ${selectedRow.paymentStatus === "PAID" ? styles.statusPaid : selectedRow.paymentStatus === "PARTIAL" ? styles.statusPartial : styles.statusDue}`}>{statusLabel(selectedRow)}</span>{selectedRow.overdue && <span className={styles.overdueBadge}>Прострочено</span>}</section>
          <section className={styles.drawerSummary}>
            <div><small>Сума</small><strong>{money(selectedRow.total, selectedRow.currency)}</strong></div>
            <div><small>Сплачено</small><strong>{money(selectedRow.paid, selectedRow.currency)}</strong></div>
            <div><small>Залишок</small><strong>{money(selectedRow.outstanding, selectedRow.currency)}</strong></div>
          </section>
          <section className={styles.drawerInfo}>
            <div><span>Клієнт</span><b>{selectedRow.client.name || "Клієнт без імені"}</b></div>
            <div><span>Телефон</span><b>{selectedRow.client.phone}</b></div>
            <div><span>КП / ЗН</span><b>{selectedRow.workOrderLabel}</b></div>
            <div><span>До сплати</span><b>{dateText(selectedRow.dueAt)}</b></div>
          </section>
          <section className={styles.history}>
            <div className={styles.sectionTitle}><span>Історія оплат</span><b>{selectedRow.history.length}</b></div>
            {!selectedRow.history.length ? <div className={styles.state}>Оплат ще не було.</div> : selectedRow.history.map((payment) => <div className={styles.historyRow} key={payment.id}><div><strong>+{money(payment.amount, selectedRow.currency)}</strong><span>{dateTimeText(payment.occurredAt)}</span></div><div><b>{payment.accountName || "Рахунок"}</b><small>{payment.accountType ? ACCOUNT_LABELS[payment.accountType as Account["type"]] || payment.accountType : "—"}</small></div></div>)}
          </section>
        </div>
        <footer><button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: selectedRow.workOrderId, workOrderTab: "payment" })}>Відкрити КП / ЗН</button>{selectedRow.outstanding > 0 && <button type="button" className={selectedRow.paymentStatus === "PARTIAL" ? styles.payPartial : styles.payDue} onClick={() => openPayment(selectedRow)}>{selectedRow.paymentStatus === "PARTIAL" ? "Доплатити" : "Прийняти оплату"}</button>}</footer>
      </aside>
    </div>}

    {paymentRow && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closePayment(); }}>
      <form className={styles.modal} onSubmit={submitPayment}>
        <header><div><small>ПРИЙНЯТИ ОПЛАТУ</small><h2>{paymentRow.workOrderLabel} · {paymentRow.vehicle.plateNumber || carTitle(paymentRow)}</h2></div><button type="button" onClick={closePayment} disabled={submitting}>×</button></header>
        <div className={styles.modalBody}>
          <div className={styles.paymentSummary}><span>Залишок до сплати</span><strong>{money(paymentRow.outstanding, paymentRow.currency)}</strong></div>
          <label><span>Сума оплати</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></label>
          <label><span>Дата і час</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
          <label><span>Куди прийнято кошти</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Оберіть рахунок</option>{accounts.map((account) => <option key={account.id} value={account.id}>{ACCOUNT_LABELS[account.type]} · {account.name}</option>)}</select></label>
          {!accounts.length && <div className={styles.warning}>У фінансових налаштуваннях немає активного UAH-рахунку. Спочатку додайте касу/банк/еквайринг.</div>}
          {paymentError && <div className={styles.error}>{paymentError}</div>}
        </div>
        <footer><button type="button" onClick={closePayment} disabled={submitting}>Скасувати</button><button type="submit" className={styles.payDue} disabled={submitting || !accounts.length}>{submitting ? "Проводжу…" : "Провести оплату"}</button></footer>
      </form>
    </div>}
  </div>;
}
