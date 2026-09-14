"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { navigateCrm } from "./crm-route";
import styles from "./analytics-dashboard-walk-in-bridge.module.css";

type AnalyticsTab = "overview" | "funnel" | "workshop" | "diagnostics" | "finance" | "parts";

type WalkInAction = {
  appointmentId: string;
  diagnosticId: string | null;
  customerName: string;
  vehicleLabel: string;
  plateNumber: string | null;
  plannedStartAt: string;
  date: string;
};

type WalkInData = {
  visits: number;
  diagnosticsReached: number;
  paid: number;
  diagnosticOnly: number;
  sentToRepair: number;
  completed: number;
  awaitingPayment: number;
  awaitingRoute: number;
  actionRequired: number;
  visitToDiagnosticsPct: number;
  diagnosticToPaidPct: number;
  diagnosticToRepairPct: number;
  visitToCompletedPct: number;
  diagnosticRevenue: number | null;
  averageDiagnosticCheck: number | null;
  currency: string | null;
  actions?: {
    awaitingPayment: WalkInAction[];
    awaitingRoute: WalkInAction[];
  };
};

type Payload = {
  ok?: boolean;
  error?: string;
  financial?: boolean;
  walkIn?: WalkInData | null;
};

const TAB_BY_LABEL: Record<string, AnalyticsTab> = {
  "Загальне": "overview",
  "Воронка": "funnel",
  "СТО / Виробництво": "workshop",
  "Діагностика": "diagnostics",
  "Фінанси": "finance",
  "Запчастини": "parts",
};

function analyticsRoot() {
  const heading = [...document.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "Аналітика");
  if (!heading) return null;
  let current = heading.parentElement;
  while (current && current !== document.body) {
    if (current.querySelectorAll('input[type="date"]').length >= 2 && current.querySelector('nav[aria-label="Розділи аналітики"]')) return current as HTMLElement;
    current = current.parentElement;
  }
  return null;
}

function activeTab(root: HTMLElement): AnalyticsTab {
  const nav = root.querySelector<HTMLElement>('nav[aria-label="Розділи аналітики"]');
  if (!nav) return "overview";
  const buttons = [...nav.querySelectorAll<HTMLButtonElement>("button")];
  const selected = buttons.find((button) => Boolean(button.className?.trim())) || buttons[0];
  return TAB_BY_LABEL[selected?.textContent?.trim() || ""] || "overview";
}

function filterSection(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("section")].find((section) => section.querySelectorAll('input[type="date"]').length >= 2) || null;
}

function ensureHost(root: HTMLElement) {
  const existing = root.querySelector<HTMLElement>('[data-walk-in-analytics-host="true"]');
  if (existing) return existing;
  const filters = filterSection(root);
  if (!filters?.parentElement) return null;
  const host = document.createElement("div");
  host.dataset.walkInAnalyticsHost = "true";
  filters.insertAdjacentElement("afterend", host);
  return host;
}

function paramsFrom(root: HTMLElement) {
  const dates = [...root.querySelectorAll<HTMLInputElement>('input[type="date"]')];
  const params = new URLSearchParams();
  if (dates[0]?.value) params.set("from", dates[0].value);
  if (dates[1]?.value) params.set("to", dates[1].value);
  const location = root.querySelector<HTMLSelectElement>("select");
  if (location?.value) params.set("locationId", location.value);
  return params.toString();
}

function money(value: number | null, currency: string | null) {
  if (value == null || !currency) return "Обмежено";
  if (currency === "UAH") return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} ₴`;
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

function percent(value: number) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

function activateAnalyticsTab(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('nav[aria-label="Розділи аналітики"] button')]
    .find((node) => node.textContent?.trim() === label);
  button?.click();
}

function openAppointment(row: WalkInAction) {
  navigateCrm("Планувальник", { appointmentId: row.appointmentId, date: row.date, scope: "day" });
}

function ActionList({ title, rows, tone }: { title: string; rows: WalkInAction[]; tone: "warn" | "danger" }) {
  if (!rows.length) return null;
  return <div className={`${styles.actionGroup} ${tone === "danger" ? styles.actionDanger : styles.actionWarn}`}>
    <div className={styles.actionHead}><strong>{title}</strong><span>{rows.length}</span></div>
    <div className={styles.actionList}>
      {rows.slice(0, 8).map((row) => <button type="button" key={`${title}:${row.appointmentId}`} onClick={() => openAppointment(row)}>
        <span><b>{row.plateNumber || "Без номера"}</b>{row.vehicleLabel ? ` · ${row.vehicleLabel}` : ""}</span>
        <small>{row.customerName || "Клієнт не вказаний"} · {row.date}</small>
      </button>)}
    </div>
    {rows.length > 8 && <small className={styles.more}>Ще {rows.length - 8} записів у цьому стані</small>}
  </div>;
}

export function AnalyticsDashboardWalkInBridge() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const [data, setData] = useState<WalkInData | null>(null);
  const [financial, setFinancial] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const resolve = () => {
      const nextRoot = analyticsRoot();
      setRoot((current) => current === nextRoot ? current : nextRoot);
      if (!nextRoot) {
        setHost(null);
        return;
      }
      const nextHost = ensureHost(nextRoot);
      setHost((current) => current === nextHost ? current : nextHost);
      setTab(activeTab(nextRoot));
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", resolve);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", resolve);
    };
  }, []);

  useEffect(() => {
    if (!root) return;
    const sync = () => setTab(activeTab(root));
    const onClick = () => window.setTimeout(sync, 0);
    const onChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "date") setRevision((value) => value + 1);
      if (target instanceof HTMLSelectElement) setRevision((value) => value + 1);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
    };
  }, [root]);

  const load = useCallback(async () => {
    if (!root || (tab !== "overview" && tab !== "funnel") || root.getClientRects().length === 0) return;
    setLoading(true);
    setError("");
    try {
      const query = paramsFrom(root);
      const response = await fetch(`/api/analytics/walk-in${query ? `?${query}` : ""}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => ({})) as Payload;
      if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося завантажити WALK-IN аналітику");
      setFinancial(body.financial !== false);
      setData(body.walkIn || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити WALK-IN аналітику");
    } finally {
      setLoading(false);
    }
  }, [root, tab]);

  useEffect(() => {
    if (!root || (tab !== "overview" && tab !== "funnel")) return;
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load, revision, root, tab]);

  if (!root || !host || (tab !== "overview" && tab !== "funnel")) return null;

  if (tab === "overview") {
    return createPortal(
      <section className={`${styles.panel} ${styles.summaryPanel}`} data-walk-in-analytics="true" data-walk-in-mode="overview-summary">
        <header className={styles.summaryHeader}>
          <div><span>ПОЗАПЛАНОВІ ЗАЇЗДИ</span><h2>WALK-IN</h2><p>Короткий управлінський сигнал. Деталі — у воронці.</p></div>
          <button type="button" onClick={() => activateAnalyticsTab(root, "Воронка")}>Детально у воронці →</button>
        </header>
        {error && <div className={styles.error}>{error}</div>}
        {!error && !data && <div className={styles.empty}>{loading ? "Завантажую фактичні показники…" : "За вибраний період позапланових заїздів немає."}</div>}
        {data && <div className={styles.summaryGrid}>
          <article><small>Заїздів</small><strong>{data.visits}</strong><span>реальні WALK-IN appointments</span></article>
          <article><small>Оплачено</small><strong>{data.paid}</strong><span>{percent(data.diagnosticToPaidPct)} від діагностик</span></article>
          <article><small>Виручка діагностики</small><strong>{money(data.diagnosticRevenue, data.currency)}</strong><span>{financial ? "POSTED оплати" : "немає фінансового доступу"}</span></article>
          <article className={data.actionRequired ? styles.warn : ""}><small>Потребують дії</small><strong>{data.actionRequired}</strong><span>{data.awaitingPayment} оплат · {data.awaitingRoute} маршрутів</span></article>
        </div>}
      </section>,
      host,
    );
  }

  const awaitingPaymentRows = data?.actions?.awaitingPayment || [];
  const awaitingRouteRows = data?.actions?.awaitingRoute || [];

  return createPortal(
    <section className={styles.panel} data-walk-in-analytics="true" data-walk-in-mode="funnel-detail">
      <header className={styles.header}>
        <div>
          <span>ПОЗАПЛАНОВІ ЗАЇЗДИ · ВОРОНКА</span>
          <h2>WALK-IN аналітика</h2>
          <p>Фактичний шлях позапланового заїзду: візит → діагностика → оплата → ремонт або завершення.</p>
        </div>
      </header>
      {error && <div className={styles.error}>{error}</div>}
      {!error && !data && <div className={styles.empty}>{loading ? "Завантажую фактичні показники…" : "За вибраний період позапланових заїздів немає."}</div>}
      {data && <>
        <div className={styles.grid}>
          <article><small>Позапланових заїздів</small><strong>{data.visits}</strong><span>за вибраний період</span></article>
          <article><small>Дійшли до діагностики</small><strong>{data.diagnosticsReached}</strong><span>{percent(data.visitToDiagnosticsPct)} від WALK-IN</span></article>
          <article><small>Оплачено діагностик</small><strong>{data.paid}</strong><span>{percent(data.diagnosticToPaidPct)} від діагностик</span></article>
          <article><small>Тільки діагностика</small><strong>{data.diagnosticOnly}</strong><span>візит завершено без ремонту</span></article>
          <article><small>Передано в ремонт</small><strong>{data.sentToRepair}</strong><span>{percent(data.diagnosticToRepairPct)} від діагностик</span></article>
          <article><small>Завершено візитів</small><strong>{data.completed}</strong><span>{percent(data.visitToCompletedPct)} від WALK-IN</span></article>
          <article className={data.awaitingPayment ? styles.warn : ""}><small>Очікують оплату</small><strong>{data.awaitingPayment}</strong><span>діагностику завершено, POSTED оплати немає</span></article>
          <article className={data.awaitingRoute ? styles.warn : ""}><small>Оплачено, без рішення</small><strong>{data.awaitingRoute}</strong><span>POSTED оплата є, потрібен наступний маршрут</span></article>
        </div>
        <div className={styles.finance}>
          <div><small>Виручка WALK-IN діагностики</small><strong>{money(data.diagnosticRevenue, data.currency)}</strong><span>{financial ? "фактичні POSTED оплати" : "немає фінансового доступу"}</span></div>
          <div><small>Середній чек діагностики</small><strong>{money(data.averageDiagnosticCheck, data.currency)}</strong><span>{financial ? "за фактичними оплатами" : "немає фінансового доступу"}</span></div>
        </div>
        {(awaitingPaymentRows.length > 0 || awaitingRouteRows.length > 0) && <section className={styles.actions}>
          <div className={styles.actionsTitle}><span>ПОТРЕБУЄ ДІЇ</span><h3>Конкретні завислі заїзди</h3><p>Натискання відкриває точний запис у Планувальнику.</p></div>
          <div className={styles.actionColumns}>
            <ActionList title="Очікують оплату" rows={awaitingPaymentRows} tone="danger" />
            <ActionList title="Оплачено, без рішення" rows={awaitingRouteRows} tone="warn" />
          </div>
        </section>}
      </>}
    </section>,
    host,
  );
}
