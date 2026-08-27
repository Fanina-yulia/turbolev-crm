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

type PaymentSuccess = {
  method: "CASH" | "TERMINAL";
  amount: string;
};

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

export function MechanicWalkInSettlement({ diagnosticId, data, onRefresh, onBack }: {
  diagnosticId: string;
  data: WalkInSettlementPayload;
  onRefresh: () => Promise<void>;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(data.price?.amount ? String(Number(data.price.amount)) : "");
  const [success, setSuccess] = useState<PaymentSuccess | null>(null);

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

  async function pay(paymentMethod: "CASH" | "TERMINAL") {
    if (busy) return;
    const normalizedAmount = Number(amount.replace(",", "."));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setError("Введіть суму оплати більше 0 грн.");
      return;
    }

    setBusy(`PAY${paymentMethod}`);
    setError("");
    try {
      await postAction({ action: "PAY", paymentMethod, amount: normalizedAmount.toFixed(2) });
      await postAction({ action: "COMPLETE_VISIT" });
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      setSuccess({ method: paymentMethod, amount: normalizedAmount.toFixed(2) });
      window.setTimeout(onBack, 1200);
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
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завершити візит");
    } finally {
      setBusy("");
    }
  }

  if (success) {
    return <div className={styles.page}>
      <main className={styles.center}>
        <div className={styles.successIcon}>✓</div>
        <h1>Дякую!</h1>
        <p>Оплату {success.method === "CASH" ? "готівкою" : "терміналом"} прийнято. Діагностику завершено.</p>
        <div className={styles.paidLine}>Оплачено: <b>{money(success.amount, "UAH")}</b></div>
      </main>
    </div>;
  }

  if (data.completed) {
    return <div className={styles.page}>
      <header className={styles.top}><button type="button" onClick={onBack}>‹</button><strong>Позаплановий заїзд</strong><span /></header>
      <main className={styles.center}>
        <div className={styles.successIcon}>✓</div>
        <h1>Візит завершено</h1>
        <p>{vehicleLabel(data)} · {data.vehicle?.plateNumber || "без номера"}</p>
        <div className={styles.paidLine}>Оплачено: <b>{money(data.payment?.amount || data.price?.amount, data.price?.currency)}</b></div>
        <button type="button" className={styles.primary} onClick={onBack}>До кабінету механіка</button>
      </main>
    </div>;
  }

  if (data.sentToRepair) {
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
        <h1>{vehicleLabel(data)}</h1>
        <strong>{data.vehicle?.plateNumber || "—"}</strong>
        {data.client && <span>{data.client.name || "Клієнт"} · {data.client.phone}</span>}
      </section>

      {!data.paid ? <section className={styles.paymentCard}>
        <span>До сплати</span>
        <label className={styles.amountField}>
          <span>Сума діагностики, грн</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={data.price?.amount || "Введіть суму"}
            disabled={!data.canPay || Boolean(busy)}
          />
        </label>
        <small>{data.price?.label || "Механік вносить фактично прийняту суму."}</small>
        <div className={styles.methods}>
          <button type="button" disabled={!data.canPay || Boolean(busy)} onClick={() => void pay("CASH")}>
            <b>💵</b><strong>Готівка</strong><span>{busy === "PAYCASH" ? "Фіксую оплату…" : "Прийняти оплату"}</span>
          </button>
          <button type="button" disabled={!data.canPay || Boolean(busy)} onClick={() => void pay("TERMINAL")}>
            <b>💳</b><strong>Термінал</strong><span>{busy === "PAYTERMINAL" ? "Фіксую оплату…" : "Прийняти оплату"}</span>
          </button>
        </div>
      </section> : <section className={styles.paymentCard}>
        <div className={styles.paidBadge}>✓ ОПЛАЧЕНО</div>
        <strong>{money(data.payment?.amount || data.price?.amount, data.price?.currency)}</strong>
        <small>{data.payment?.account?.name || "Оплата проведена"}</small>
        <h2>Що робимо з автомобілем?</h2>
        <div className={styles.routes}>
          <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void completePaidVisit()}>
            На головний екран
            <span>{busy === "COMPLETE_VISIT" ? "Завершую візит…" : "Оплату вже зафіксовано"}</span>
          </button>
          <button type="button" className={styles.secondary} disabled={!data.canChooseRoute || Boolean(busy)} onClick={() => void postAction({ action: "SEND_TO_REPAIR_FLOW" }).then(onRefresh).catch((cause) => setError(cause instanceof Error ? cause.message : "Не вдалося передати автомобіль"))}>
            Передати на розрахунок ремонту →
            <span>Далі: ДК → роботи → деталі → погодження</span>
          </button>
        </div>
      </section>}

      {error && <div className={styles.error}>{error}</div>}
    </main>
  </div>;
}
