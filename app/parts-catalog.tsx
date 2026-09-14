"use client";

import { useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import { PartsCatalog as LegacyPartsCatalog } from "./parts-catalog-legacy";
import styles from "./parts-work-center.module.css";

type PartsView = "overview" | "catalog" | "analytics";

type PartsStatusRow = { status: string; label: string; count: number };
type PartsSupplierRow = {
  supplierId: string;
  name: string;
  requests: number;
  items: number;
  requestedQty: number;
  receivedQty: number;
  fulfillmentPct: number;
  purchaseValue: number | null;
};
type PartsItemRow = {
  name: string;
  article: string | null;
  brand: string | null;
  requestedQty: number;
  receivedQty: number;
  installedQty: number;
  revenue: number | null;
  profit: number | null;
};
type PartsAnalytics = {
  requests: number;
  items: number;
  requestedQty: number;
  receivedQty: number;
  installedQty: number;
  pendingRequiredQty: number;
  overdueEtaItems: number;
  averageSupplyHours: number;
  purchaseValue: number | null;
  installedRevenue: number | null;
  installedProfit: number | null;
  installedMarginPct: number | null;
  statusBreakdown: PartsStatusRow[];
  topItems: PartsItemRow[];
  suppliers: PartsSupplierRow[];
  stockLedgerAvailable: boolean;
};
type AnalyticsPayload = {
  ok?: boolean;
  permitted?: boolean;
  financial?: boolean;
  emptyScope?: boolean;
  error?: string;
  range?: { from: string; to: string; timezone: string };
  parts?: PartsAnalytics | null;
};
type ProcurementCard = {
  id: string;
  workOrderId: string;
  number: number | null;
  status: string;
  category: "SELECTING" | "APPROVED" | "ORDERED" | "PARTIAL" | "RECEIVED" | string;
  paymentRequired: boolean;
  paymentConfirmedAt: string | null;
  plate: string;
  vin: string | null;
  vehicle: string;
  workOrderStatus: string;
  totalItems: number;
  fullyReceived: number;
  fullyInstalled: number;
  items: Array<{
    id: string;
    description: string;
    article: string | null;
    brand: string | null;
    quantity: number;
    receivedQuantity: number;
    installedQuantity: number;
    requiredForRepair: boolean;
    etaAt: string | null;
    supplier: { id: string; name: string; code: string } | null;
  }>;
  updatedAt: string;
};
type ProcurementPayload = {
  ok?: boolean;
  error?: string;
  location?: { id: string; name: string; timezone: string } | null;
  cards?: ProcurementCard[];
  canWrite?: boolean;
};

const ACTIVE_STATUS_LABELS: Record<string, string> = {
  NEW: "Нові",
  SELECTING: "Підбір",
  SELECTED: "Підібрано",
  WAITING_APPROVAL: "Очікує погодження",
  APPROVED: "Погоджено",
  ORDER_REQUIRED: "Треба замовити",
  ORDERED: "Замовлено / в дорозі",
  PARTIALLY_RECEIVED: "Отримано частково",
  RECEIVED: "Отримано",
  INSTALLED: "Встановлено",
};

function viewFromRoute(route: CrmRouteParams): PartsView {
  if (route.scope === "catalog") return "catalog";
  if (route.scope === "analytics") return "analytics";
  return "overview";
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}

function qty(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value);
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

function hours(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)} год`;
}

function orderNumber(value: number | null) {
  return value == null ? "ЗН-—" : formatWorkOrderNumber(value);
}

function cardStatus(card: ProcurementCard) {
  return ACTIVE_STATUS_LABELS[card.status] || card.status;
}

function overdueItems(card: ProcurementCard) {
  const now = Date.now();
  return card.items.filter((item) => item.etaAt && new Date(item.etaAt).getTime() < now && item.receivedQuantity < item.quantity).length;
}

function missingRequiredItems(card: ProcurementCard) {
  return card.items.filter((item) => item.requiredForRepair && item.receivedQuantity < item.quantity).length;
}

export function PartsCatalog() {
  const [route, setRoute] = useState<CrmRouteParams>(() => readCrmRoute());
  const [view, setView] = useState<PartsView>(() => viewFromRoute(readCrmRoute()));
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [procurement, setProcurement] = useState<ProcurementPayload | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [procurementError, setProcurementError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });

  useEffect(() => {
    const sync = () => {
      const next = readCrmRoute();
      setRoute(next);
      if (!next.diagnosticId) setView(viewFromRoute(next));
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  async function loadBusinessData(from = "", to = "") {
    setLoading(true);
    setAnalyticsError("");
    setProcurementError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const analyticsUrl = `/api/analytics/parts${params.size ? `?${params.toString()}` : ""}`;
      const [analyticsResponse, procurementResponse] = await Promise.all([
        fetch(analyticsUrl, { cache: "no-store", credentials: "include" }),
        fetch("/api/procurement", { cache: "no-store", credentials: "include" }),
      ]);
      const analyticsPayload = await analyticsResponse.json().catch(() => null) as AnalyticsPayload | null;
      const procurementPayload = await procurementResponse.json().catch(() => null) as ProcurementPayload | null;

      if (analyticsResponse.ok && analyticsPayload?.ok) {
        setAnalytics(analyticsPayload);
        if (analyticsPayload.range) setRange({ from: analyticsPayload.range.from, to: analyticsPayload.range.to });
      } else {
        setAnalytics(null);
        setAnalyticsError(analyticsPayload?.error || "Не вдалося завантажити аналітику запчастин.");
      }

      if (procurementResponse.ok && procurementPayload?.ok) {
        setProcurement(procurementPayload);
      } else {
        setProcurement(null);
        setProcurementError(procurementPayload?.error || (procurementResponse.status === 403 ? "Немає доступу до операційної черги закупівель." : "Не вдалося завантажити операційну чергу."));
      }
      setLastLoadedAt(Date.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не вдалося завантажити дані запчастин.";
      setAnalyticsError(message);
      setProcurementError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (route.diagnosticId) return;
    void loadBusinessData();
    // Reload only when entering/leaving a concrete Diagnostic Card context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.diagnosticId]);

  function changeView(next: PartsView) {
    if (next === view) return;
    setView(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("scope");
    else url.searchParams.set("scope", next);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  const parts = analytics?.parts || null;
  const cards = procurement?.cards || [];
  const financial = analytics?.financial === true;
  const queue = useMemo(() => {
    const selecting = cards.filter((card) => card.category === "SELECTING").length;
    const decision = cards.filter((card) => card.category === "APPROVED").length;
    const transit = cards.filter((card) => card.category === "ORDERED" || card.category === "PARTIAL").length;
    const blocked = cards.filter((card) => missingRequiredItems(card) > 0).length;
    const overdue = cards.reduce((sum, card) => sum + overdueItems(card), 0);
    return { selecting, decision, transit, blocked, overdue };
  }, [cards]);

  const maxStatus = Math.max(1, ...(parts?.statusBreakdown || []).map((row) => row.count));
  const lastUpdated = lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }) : "—";

  if (route.diagnosticId) {
    return <div className={styles.focusPage}>
      <div className={styles.focusHeading}>
        <button type="button" className={styles.backToCenter} onClick={() => navigateCrm("Підбір запчастин", {})}>← Центр запчастин</button>
        <div className={styles.focusHeadingCopy}>
          <span>ПІДБІР ЗАПЧАСТИН</span>
          <b>VIN → OE/OEM → аналоги → постачальник → вибір</b>
        </div>
        <span className={styles.focusBadge}>Дані з Діагностичної карти</span>
      </div>
      <div className={styles.legacyFocus}><LegacyPartsCatalog/></div>
    </div>;
  }

  return <div className={styles.page}>
    <header className={styles.workCenterHeader}>
      <div className={styles.headerTop}>
        <div className={styles.headerTitle}>
          <p className={styles.eyebrow}>СЕРВІС · ЗАПЧАСТИНИ</p>
          <h1>Підбір запчастин</h1>
          <span>Робочий центр: ДК → OE/OEM → аналоги → постачальник → погодження → закупівля → встановлення.</span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadBusinessData(range.from, range.to)} disabled={loading}>↻ Оновити</button>
          <button type="button" className={styles.primaryButton} onClick={() => navigateCrm("Закупівлі та склад", {})}>Закупівлі та склад →</button>
        </div>
      </div>
      <div className={styles.sourceRow}>
        <span className={styles.sourceChip}>Живі дані CRM</span>
        {procurement?.location?.name ? <span className={styles.sourceChip}>Станція: {procurement.location.name}</span> : null}
        {analytics?.range ? <span className={styles.sourceChip}>Період: {analytics.range.from} — {analytics.range.to}</span> : null}
        <span className={styles.sourceChip}>Оновлено: {lastUpdated}</span>
      </div>
    </header>

    <nav className={styles.tabs} aria-label="Режими центру запчастин">
      <button type="button" className={view === "overview" ? styles.tabActive : styles.tab} onClick={() => changeView("overview")}><b>Огляд</b><span>операційна картина</span></button>
      <button type="button" className={view === "catalog" ? styles.tabActive : styles.tab} onClick={() => changeView("catalog")}><b>Каталог</b><span>VIN / OE / аналоги</span></button>
      <button type="button" className={view === "analytics" ? styles.tabActive : styles.tab} onClick={() => changeView("analytics")}><b>Аналітика</b><span>KPI і постачальники</span></button>
    </nav>

    {loading ? <div className={styles.loadingBanner}>Оновлюю фактичні дані із CRM…</div> : null}
    {analyticsError && view !== "catalog" ? <div className={styles.errorBanner}>{analyticsError}</div> : null}

    {view === "catalog" ? <section className={styles.catalogMode}>
      <div className={styles.modeIntro}>
        <div><b>Робочий підбір із Діагностичної карти</b><span>Оберіть замовлення. Система передасть авто/VIN, позиції до заміни та відкриє живі пропозиції постачальників.</span></div>
        <span>Базова націнка 40% · фактичний % береться з налаштувань постачальника</span>
      </div>
      <div className={styles.legacyCatalog}><LegacyPartsCatalog/></div>
    </section> : null}

    {view === "overview" ? <div className={styles.content}>
      <section className={styles.kpiGrid} aria-label="Операційні KPI запчастин">
        <article className={styles.kpiCard}><span>Активна черга</span><strong>{cards.length}</strong><small>поточні PartsRequest у закупівлях</small></article>
        <article className={styles.kpiCard}><span>Потрібно підібрати</span><strong>{queue.selecting}</strong><small>NEW / SELECTING</small></article>
        <article className={styles.kpiCard}><span>До рішення / замовлення</span><strong>{queue.decision}</strong><small>selected / approval / order required</small></article>
        <article className={styles.kpiCard}><span>В дорозі / частково</span><strong>{queue.transit}</strong><small>ORDERED / PARTIALLY_RECEIVED</small></article>
        <article className={`${styles.kpiCard} ${queue.overdue ? styles.kpiAlert : ""}`}><span>Прострочені ETA</span><strong>{queue.overdue}</strong><small>активні позиції з минулим ETA</small></article>
        <article className={`${styles.kpiCard} ${queue.blocked ? styles.kpiAlert : ""}`}><span>Блокують ремонт</span><strong>{queue.blocked}</strong><small>заявки з requiredForRepair без повного отримання</small></article>
      </section>

      {parts ? <section className={styles.periodMetrics}>
        <div><span>Запитано за період</span><b>{qty(parts.requestedQty)} шт</b></div>
        <div><span>Отримано</span><b>{qty(parts.receivedQty)} шт</b></div>
        <div><span>Встановлено</span><b>{qty(parts.installedQty)} шт</b></div>
        <div><span>Потрібно для ремонту</span><b>{qty(parts.pendingRequiredQty)} шт</b></div>
        <div><span>Середній строк поставки</span><b>{hours(parts.averageSupplyHours)}</b></div>
      </section> : null}

      <div className={styles.sectionGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p>ПОТРЕБУЄ ДІЇ</p><h2>Операційна черга</h2></div><button type="button" onClick={() => navigateCrm("Закупівлі та склад", {})}>Вся черга →</button></div>
          {procurementError ? <div className={styles.empty}>{procurementError}</div> : cards.length ? <div className={styles.queueList}>{cards.slice(0, 8).map((card) => {
            const overdue = overdueItems(card);
            const missing = missingRequiredItems(card);
            return <button type="button" className={styles.queueRow} key={card.id} onClick={() => navigateCrm("Закупівлі та склад", { partsRequestId: card.id })}>
              <div className={styles.queueMain}><b>{orderNumber(card.number)} · {card.vehicle}</b><span>{card.plate} · {card.totalItems} поз. · оновлено {new Date(card.updatedAt).toLocaleDateString("uk-UA")}</span></div>
              <div className={styles.queueProgress}><span>отримано {card.fullyReceived}/{card.totalItems}</span><i><em style={{ width: `${card.totalItems ? Math.min(100, (card.fullyReceived / card.totalItems) * 100) : 0}%` }}/></i></div>
              <div className={styles.queueMeta}>{missing ? <span className={styles.dangerTag}>блокує: {missing}</span> : null}{overdue ? <span className={styles.dangerTag}>ETA: {overdue}</span> : null}<span className={styles.statusTag}>{cardStatus(card)}</span></div>
              <span className={styles.rowArrow}>→</span>
            </button>;
          })}</div> : <div className={styles.empty}>Активних заявок на запчастини зараз немає.</div>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p>ЗА ПЕРІОД</p><h2>Статуси процесу</h2></div><button type="button" onClick={() => changeView("analytics")}>Детально →</button></div>
          {parts?.statusBreakdown?.length ? <div className={styles.statusList}>{parts.statusBreakdown.slice(0, 8).map((row) => <div className={styles.statusRow} key={row.status}><div><b>{row.label}</b><span>{row.count}</span></div><i><em style={{ width: `${Math.max(3, (row.count / maxStatus) * 100)}%` }}/></i></div>)}</div> : <div className={styles.empty}>За вибраний період руху заявок не зафіксовано.</div>}
        </section>
      </div>

      <div className={styles.sectionGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p>ПОСТАЧАЛЬНИКИ</p><h2>Фактичне виконання</h2></div></div>
          {parts?.suppliers?.length ? <div className={styles.supplierList}>{parts.suppliers.slice(0, 6).map((row) => <div className={styles.supplierRow} key={row.supplierId}><div><b>{row.name}</b><span>{row.requests} заявок · {row.items} позицій</span></div><strong>{pct(row.fulfillmentPct)}</strong></div>)}</div> : <div className={styles.empty}>Немає отриманих даних по постачальниках за період.</div>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p>ЕКОНОМІКА</p><h2>Запчастини у грошах</h2></div></div>
          {financial && parts ? <div className={styles.financeGrid}><div><span>Закупівля отриманого</span><b>{money(parts.purchaseValue)}</b></div><div><span>Продаж встановленого</span><b>{money(parts.installedRevenue)}</b></div><div><span>Валовий прибуток</span><b>{money(parts.installedProfit)}</b></div><div><span>Маржа встановленого</span><b>{pct(parts.installedMarginPct)}</b></div></div> : <div className={styles.empty}>Фінансові KPI приховані правами доступу. CRM не підставляє умовні цифри.</div>}
        </section>
      </div>

      {parts && !parts.stockLedgerAvailable ? <div className={styles.ledgerNotice}><b>Складські KPI навмисно не показані.</b><span>Canonical stock ledger ще не є джерелом цієї сторінки, тому вартість залишків, оборотність і неліквіди не підміняються розрахунковими або демо-даними.</span></div> : null}
    </div> : null}

    {view === "analytics" ? <div className={styles.content}>
      <section className={styles.analyticsControls}>
        <label><span>З</span><input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}/></label>
        <label><span>По</span><input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}/></label>
        <button type="button" className={styles.primaryButton} onClick={() => void loadBusinessData(range.from, range.to)} disabled={loading || !range.from || !range.to}>Застосувати період</button>
        <span>Timezone: {analytics?.range?.timezone || "Europe/Kyiv"}</span>
      </section>

      {parts ? <>
        <section className={styles.analyticsGrid}>
          <article><span>Заявки</span><b>{parts.requests}</b></article><article><span>Позиції</span><b>{parts.items}</b></article><article><span>Запитано</span><b>{qty(parts.requestedQty)}</b></article><article><span>Отримано</span><b>{qty(parts.receivedQty)}</b></article><article><span>Встановлено</span><b>{qty(parts.installedQty)}</b></article><article><span>Pending required</span><b>{qty(parts.pendingRequiredQty)}</b></article><article><span>Прострочені ETA</span><b>{parts.overdueEtaItems}</b></article><article><span>Середня поставка</span><b>{hours(parts.averageSupplyHours)}</b></article>
        </section>

        {financial ? <section className={styles.analyticsGrid}>
          <article><span>Закупівля отриманого</span><b>{money(parts.purchaseValue)}</b></article><article><span>Продаж встановленого</span><b>{money(parts.installedRevenue)}</b></article><article><span>Валовий прибуток</span><b>{money(parts.installedProfit)}</b></article><article><span>Маржа</span><b>{pct(parts.installedMarginPct)}</b></article>
        </section> : <div className={styles.ledgerNotice}><b>Фінансові показники недоступні цій ролі.</b><span>Замість нульових або умовних значень показуємо статус доступу.</span></div>}

        <div className={styles.sectionGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><p>СТАТУСИ</p><h2>PartsRequest</h2></div></div>
            {parts.statusBreakdown.length ? <div className={styles.statusList}>{parts.statusBreakdown.map((row) => <div className={styles.statusRow} key={row.status}><div><b>{row.label}</b><span>{row.count}</span></div><i><em style={{ width: `${Math.max(3, (row.count / maxStatus) * 100)}%` }}/></i></div>)}</div> : <div className={styles.empty}>Немає даних за період.</div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><p>ДЖЕРЕЛО</p><h2>Як рахуються цифри</h2></div></div>
            <div className={styles.formulaList}><span><b>Запитано</b> = Σ PartsRequestItem.quantity</span><span><b>Отримано</b> = Σ receivedQuantity</span><span><b>Встановлено</b> = Σ installedQuantity</span><span><b>Закупівля</b> = purchasePrice × receivedQuantity</span><span><b>Продаж</b> = sellPrice × installedQuantity</span><span><b>Прибуток</b> = (sellPrice − purchasePrice) × installedQuantity</span></div>
          </section>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p>ПОСТАЧАЛЬНИКИ</p><h2>Виконання та закупівлі</h2></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Постачальник</th><th>Заявки</th><th>Позиції</th><th>Запитано</th><th>Отримано</th><th>Виконання</th>{financial ? <th>Закупівля</th> : null}</tr></thead><tbody>{parts.suppliers.length ? parts.suppliers.map((row) => <tr key={row.supplierId}><td>{row.name}</td><td>{row.requests}</td><td>{row.items}</td><td>{qty(row.requestedQty)}</td><td>{qty(row.receivedQty)}</td><td>{pct(row.fulfillmentPct)}</td>{financial ? <td>{money(row.purchaseValue)}</td> : null}</tr>) : <tr><td colSpan={financial ? 7 : 6}>Немає даних по постачальниках.</td></tr>}</tbody></table></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><p>НОМЕНКЛАТУРА</p><h2>Найчастіше встановлені позиції</h2></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Деталь</th><th>Артикул</th><th>Запитано</th><th>Отримано</th><th>Встановлено</th>{financial ? <><th>Продаж</th><th>Прибуток</th></> : null}</tr></thead><tbody>{parts.topItems.length ? parts.topItems.map((row, index) => <tr key={`${row.article || row.name}-${index}`}><td>{row.name}</td><td>{row.article || "—"}</td><td>{qty(row.requestedQty)}</td><td>{qty(row.receivedQty)}</td><td>{qty(row.installedQty)}</td>{financial ? <><td>{money(row.revenue)}</td><td>{money(row.profit)}</td></> : null}</tr>) : <tr><td colSpan={financial ? 7 : 5}>Немає встановлених позицій за період.</td></tr>}</tbody></table></div>
        </section>

        {!parts.stockLedgerAvailable ? <div className={styles.ledgerNotice}><b>Немає canonical stock ledger для цих KPI.</b><span>Вартість складу, оборотність, неліквіди та списання не виводяться, доки CRM не має надійного ledger-джерела.</span></div> : null}
      </> : <div className={styles.empty}>Аналітичні дані за вибраний період відсутні або недоступні.</div>}
    </div> : null}
  </div>;
}
