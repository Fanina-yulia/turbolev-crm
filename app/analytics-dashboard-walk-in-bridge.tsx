"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./analytics-dashboard-walk-in-bridge.module.css";

type WalkInData = {
  visits: number;
  diagnosticsReached: number;
  paid: number;
  diagnosticOnly: number;
  sentToRepair: number;
  completed: number;
  awaitingPayment: number;
  awaitingRoute: number;
  visitToDiagnosticsPct: number;
  diagnosticToPaidPct: number;
  diagnosticToRepairPct: number;
  visitToCompletedPct: number;
  diagnosticRevenue: number;
  averageDiagnosticCheck: number;
  currency: string;
};

type Payload = { ok?: boolean; error?: string; walkIn?: WalkInData | null };

function analyticsRoot() {
  const heading = [...document.querySelectorAll("h1")].find((node) => node.textContent?.trim() === "Аналітика");
  if (!heading) return null;
  let current = heading.parentElement;
  while (current && current !== document.body) {
    if (current.querySelectorAll('input[type="date"]').length >= 2 && current.querySelector("nav")) return current as HTMLElement;
    current = current.parentElement;
  }
  return null;
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

function money(value: number, currency: string) {
  if (currency === "UAH") return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} ₴`;
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

function percent(value: number) {
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function AnalyticsDashboardWalkInBridge() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<WalkInData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const resolve = () => setRoot((current) => {
      const next = analyticsRoot();
      return current === next ? current : next;
    });
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
    const onChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "date") setRevision((value) => value + 1);
      if (target instanceof HTMLSelectElement) setRevision((value) => value + 1);
    };
    root.addEventListener("change", onChange);
    return () => root.removeEventListener("change", onChange);
  }, [root]);

  const load = useCallback(async () => {
    if (!root || root.getClientRects().length === 0) return;
    setLoading(true);
    setError("");
    try {
      const query = paramsFrom(root);
      const response = await fetch(`/api/analytics/walk-in${query ? `?${query}` : ""}`, { cache: "no-store", credentials: "include" });
      const body = await response.json().catch(() => ({})) as Payload;
      if (!response.ok || !body.ok) throw new Error(body.error || "Не вдалося завантажити WALK-IN аналітику");
      setData(body.walkIn || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити WALK-IN аналітику");
    } finally {
      setLoading(false);
    }
  }, [root]);

  useEffect(() => {
    if (!root) return;
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load, revision, root]);

  if (!root) return null;

  return createPortal(
    <section className={styles.panel} data-walk-in-analytics="true">
      <header className={styles.header}>
        <div>
          <span>ПОЗАПЛАНОВІ ЗАЇЗДИ</span>
          <h2>WALK-IN аналітика</h2>
          <p>Від сканування номера до оплати, завершення візиту або переходу в ремонт.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "↻ Оновити"}</button>
      </header>
      {error && <div className={styles.error}>{error}</div>}
      {!error && !data && <div className={styles.empty}>{loading ? "Завантажую показники…" : "За вибраний період позапланових заїздів немає."}</div>}
      {data && <>
        <div className={styles.grid}>
          <article><small>Позапланових заїздів</small><strong>{data.visits}</strong><span>за вибраний період</span></article>
          <article><small>Дійшли до діагностики</small><strong>{data.diagnosticsReached}</strong><span>{percent(data.visitToDiagnosticsPct)} від WALK-IN</span></article>
          <article><small>Оплачено діагностик</small><strong>{data.paid}</strong><span>{percent(data.diagnosticToPaidPct)} від діагностик</span></article>
          <article><small>Тільки діагностика</small><strong>{data.diagnosticOnly}</strong><span>візит завершено без ремонту</span></article>
          <article><small>Передано в ремонт</small><strong>{data.sentToRepair}</strong><span>{percent(data.diagnosticToRepairPct)} від діагностик</span></article>
          <article><small>Завершено візитів</small><strong>{data.completed}</strong><span>{percent(data.visitToCompletedPct)} від WALK-IN</span></article>
          <article className={data.awaitingPayment ? styles.warn : ""}><small>Очікують оплату</small><strong>{data.awaitingPayment}</strong><span>діагностику вже завершено</span></article>
          <article className={data.awaitingRoute ? styles.warn : ""}><small>Оплачено, без рішення</small><strong>{data.awaitingRoute}</strong><span>потрібен наступний маршрут</span></article>
        </div>
        <div className={styles.finance}>
          <div><small>Виручка WALK-IN діагностики</small><strong>{money(data.diagnosticRevenue, data.currency)}</strong></div>
          <div><small>Середній чек діагностики</small><strong>{money(data.averageDiagnosticCheck, data.currency)}</strong></div>
        </div>
      </>}
    </section>,
    root,
  );
}