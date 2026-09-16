"use client";

import { useState } from "react";
import styles from "./mechanic-walk-in-settlement.module.css";

export type WalkInSettlementPayload = {
  ok?: boolean;
  walkIn?: boolean;
  diagnosticId?: string;
  appointmentId?: string;
  appointmentStatus?: string;
  submitted?: boolean;
  paid?: boolean;
  completed?: boolean;
  sentToRepair?: boolean;
  canPay?: boolean;
  canChooseRoute?: boolean;
  price?: { amount: string; currency: string; label: string; configured: boolean } | null;
  payment?: { id: string; amount: string; occurredAt: string; account: { id: string; name: string; type: string } | null } | null;
  vehicle?: { id: string; plateNumber: string | null; brand: string | null; model: string | null; year: number | null; mileageKm: number | null };
  client?: { id: string; name: string | null; phone: string };
  message?: string;
  error?: string;
};

type PaymentMethod = "CASH" | "TERMINAL" | "ONLINE";

function vehicleLabel(data: WalkInSettlementPayload) {
  const vehicle = data.vehicle;
  if (!vehicle) return "Автомобіль";
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function money(amount?: string | null, currency = "UAH") {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return `${amount || "—"} ${currency}`;
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function MechanicWalkInSettlement({ diagnosticId, data, onRefresh, onBack, onFinished }: {
  diagnosticId: string;
  data: WalkInSettlementPayload;
  onRefresh: () => Promise<void>;
  onBack: () => void;
  onFinished?: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(data.price?.amount ? String(Number(data.price.amount)) : "");
  const [localData, setLocalData] = useState<WalkInSettlementPayload | null>(null);
  const view = localData || data;

  async function postAction(body: Record<string, unknown>) {
    const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/walk-in`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const next = await response.json().catch(() => null) as WalkInSettlementPayload | null;
    if (!response.ok || !next?.ok) throw new Error(next?.message || next?.error || "Не вдалося виконати дію");
    return next;
  }

  function announce(reason: string) {
    window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
    window.dispatchEvent(new CustomEvent("turbolev:data-changed", {
      detail: { entity: "diagnostic", diagnosticId, reason },
    }));
  }

  async function pay(paymentMethod: PaymentMethod) {
    if (busy) return;
    const normalizedAmount = Number(amount.replace(",", "."));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setError("Введіть суму оплати більше 0 грн.");
      return;
    }

    setBusy(`PAY${paymentMethod}`);
    setError("");
    try {
      const next = await postAction({ action: "PAY", paymentMethod, amount: normalizedAmount.toFixed(2) });
      setLocalData(next);
      await onRefresh().catch(() => undefined);
      announce("walk-in-paid");
      // Важливо: після оплати не повертаємо механіка автоматично.
      // Він має обрати маршрут автомобіля нижче.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося виконати дію");
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy("");
    }
  }

  async function completePaidVisit() {
    if (busy) return;
    setBusy("COMPLETE_VISIT");
    setError("");
    try {
      await postAction({ action: "COMPLETE_VISIT" });
      announce("walk-in-completed");
      (onFinished || onBack)();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити візит");
    } finally { setBusy(""); }
  }

  async function sendToRepairFlow() {
    if (busy || !view.canChooseRoute) return;
    setBusy("SEND_TO_REPAIR_FLOW");
    setError("");
    try {
      await postAction({ action: "SEND_TO_REPAIR_FLOW" });
      announce("walk-in-sent-to-repair");
      (onFinished || onBack)();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося передати автомобіль");
    } finally { setBusy(""); }
  }

  if (view.completed) {
    return <div className={styles.page}>
      <header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Позаплановий заїзд</strong><span /></header>
      <main className={styles.center}>
        <div className={styles.successIcon}>✓</div>
        <h1>Візит завершено</h1>
        <p>{vehicleLabel(view)} · {view.vehicle?.plateNumber || "без номера"}</p>
        <div className={styles.paidLine}>Оплачено: <b>{money(view.payment?.amount || view.price?.amount, view.price?.currency)}</b></div>
        <button type="button" className={styles.primary} onClick={onBack}>До кабінету механіка</button>
      </main>
    </div>;
  }

  if (view.sentToRepair) {
    return <div className={styles.page}>
      <header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Позаплановий заїзд</strong><span /></header>
      <main className={styles.center}>
        <div className={styles.successIcon}>→</div>
        <h1>Передано на розрахунок</h1>
        <p>Діагностика оплачена. Сервіс-менеджер отримає автомобіль у стандартному ремонтному процесі після підтвердження діагностичної карти.</p>
        <button type="button" className={styles.primary} onClick={onBack}>До кабінету механіка</button>
      </main>
    </div>;
  }

  return <div className={styles.page}>
    <header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Позаплановий заїзд</strong><span /></header>
    <main className={styles.content}>
      <section className={styles.vehicle}>
        <small>ДІАГНОСТИКУ ЗАВЕРШЕНО</small>
        <h1>{vehicleLabel(view)}</h1>
        <strong>{view.vehicle?.plateNumber || "—"}</strong>
        {view.client && <span>{view.client.name || "Клієнт"} · {view.client.phone}</span>}
      </section>

      {!view.paid ? <section className={styles.paymentCard}>
        <span>До сплати</span>
        <label className={styles.amountField}>
          <span>Сума діагностики, грн</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={view.price?.amount || "Введіть суму"} disabled={!view.canPay || Boolean(busy)} />
        </label>
        <small>{view.price?.label || "Механік вносить фактично прийняту суму."}</small>
        <div className={styles.methods}>
          <button type="button" disabled={!view.canPay || Boolean(busy)} onClick={() => void pay("CASH")}><b>💵</b><strong>Готівка</strong><span>{busy === "PAYCASH" ? "Фіксую оплату…" : "Прийняти оплату"}</span></button>
          <button type="button" disabled={!view.canPay || Boolean(busy)} onClick={() => void pay("TERMINAL")}><b>💳</b><strong>POS-термінал</strong><span>{busy === "PAYTERMINAL" ? "Фіксую оплату…" : "Оплата карткою"}</span></button>
          <button type="button" disabled={!view.canPay || Boolean(busy)} onClick={() => void pay("ONLINE")}><b>📲</b><strong>Онлайн</strong><span>{busy === "PAYONLINE" ? "Фіксую оплату…" : "Онлайн / переказ"}</span></button>
        </div>
      </section> : <section className={styles.paymentCard}>
        <div className={styles.paidBadge}>✓ ОПЛАЧЕНО</div>
        <strong>{money(view.payment?.amount || view.price?.amount, view.price?.currency)}</strong>
        <small>{view.payment?.account?.name || "Оплата проведена"}</small>
        <h2>Що робимо з автомобілем?</h2>
        <p>Оплату зафіксовано. Оберіть наступну дію — тільки після цього візит буде переведено на правильний етап.</p>
        <div className={styles.routes}>
          <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void completePaidVisit()}>
            Завершити візит
            <span>{busy === "COMPLETE_VISIT" ? "Завершую візит…" : "Авто не переходить у ремонт"}</span>
          </button>
          <button type="button" className={styles.secondary} disabled={!view.canChooseRoute || Boolean(busy)} onClick={() => void sendToRepairFlow()}>
            Передати на розрахунок ремонту →
            <span>{busy === "SEND_TO_REPAIR_FLOW" ? "Передаю…" : "Далі: ДК → роботи → деталі → погодження"}</span>
          </button>
        </div>
      </section>}
      {error && <div className={styles.error}>{error}</div>}
    </main>
  </div>;
}
