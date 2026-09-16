"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./vehicle-current-finance-card.module.css";

type PaymentMethod = "CASH" | "TERMINAL" | "ONLINE" | "OTHER" | null;
type PaymentStatus = "NOT_FORMED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";
type State = {
  appointmentId: string;
  isCurrentVisit: boolean;
  operationalLabel: string;
  status: PaymentStatus;
  amount: number | null;
  paid: number;
  outstanding: number | null;
  actual: boolean;
  lastPayment: { amount: number; occurredAt: string; method: PaymentMethod } | null;
};

type Payload = { ok?: boolean; state?: State | null; error?: string };

function money(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 0 }).format(value);
}

function statusLabel(status: PaymentStatus) {
  if (status === "PAID") return "Оплачено";
  if (status === "PARTIAL") return "Частково оплачено";
  if (status === "OVERDUE") return "Прострочено";
  if (status === "UNPAID") return "Очікує оплату";
  return "Не сформовано";
}

function statusClass(status: PaymentStatus) {
  if (status === "PAID") return styles.paid;
  if (status === "PARTIAL") return styles.partial;
  if (status === "UNPAID") return styles.unpaid;
  if (status === "OVERDUE") return styles.overdue;
  if (status === "CANCELLED") return styles.cancelled;
  return styles.not_formed;
}

function methodLabel(method: PaymentMethod) {
  if (method === "CASH") return "готівка";
  if (method === "TERMINAL") return "термінал";
  if (method === "ONLINE") return "онлайн";
  if (method === "OTHER") return "інший спосіб";
  return "";
}

export function VehicleCurrentFinanceCard({ vehicleId }: { vehicleId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/vehicles/visit-financial-state?vehicleId=${encodeURIComponent(vehicleId)}`, {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      const payload = await response.json().catch(() => null) as Payload | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити фінанси візиту");
      setState(payload.state || null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінанси візиту");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => void load();
    window.addEventListener("turbolev:data-changed", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("turbolev:data-changed", refresh);
    };
  }, [load]);

  return <section className={styles.card} aria-label="Фінанси поточного візиту">
    <div className={styles.heading}>
      <div><span>{state?.isCurrentVisit === false ? "ОСТАННІЙ ВІЗИТ" : "ПОТОЧНИЙ ВІЗИТ"}</span><h3>Фінанси візиту</h3></div>
      {state && <b className={statusClass(state.status)}>{statusLabel(state.status)}</b>}
    </div>
    {loading && <div className={styles.muted}>Оновлюю стан розрахунків…</div>}
    {error && <div className={styles.error}>{error}</div>}
    {!loading && !error && !state && <div className={styles.muted}>Для цього автомобіля ще немає візитів.</div>}
    {!loading && !error && state && <>
      <div className={styles.operation}>{state.operationalLabel}</div>
      <div className={styles.moneyGrid}>
        <span><small>Нараховано</small><strong>{money(state.amount)}</strong></span>
        <span><small>Оплачено</small><strong>{money(state.paid)}</strong></span>
        <span><small>Залишок</small><strong>{money(state.outstanding)}</strong></span>
      </div>
      {state.lastPayment && <div className={styles.lastPayment}>Остання оплата: <b>{money(state.lastPayment.amount)}</b>{state.lastPayment.method ? ` · ${methodLabel(state.lastPayment.method)}` : ""} · {new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(state.lastPayment.occurredAt))}</div>}
      {!state.actual && state.amount != null && <div className={styles.note}>Поки що показана планова сума. Фактичний розрахунок з’явиться після формування фінансового документа.</div>}
    </>}
  </section>;
}
