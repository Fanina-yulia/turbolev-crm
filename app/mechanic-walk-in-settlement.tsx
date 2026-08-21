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

  async function act(action: "PAY" | "COMPLETE_VISIT" | "SEND_TO_REPAIR_FLOW", paymentMethod?: "CASH" | "ONLINE") {
    if (busy) return;
    if (action === "PAY") {
      const label = paymentMethod === "CASH" ? "готівкою" : "онлайн";
      if (!window.confirm(`Підтвердити оплату ${money(data.price?.amount, data.price?.currency)} ${label}?`)) return;
    }
    setBusy(action + (paymentMethod || ""));
    setError("");
    try {
      const response = await fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/walk-in`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, paymentMethod }),
      });
      const body = await response.json().catch(() => null) as WalkInSettlementPayload | null;
      if (!response.ok || !body?.ok) throw new Error(body?.message || body?.error || "Не вдалося виконати дію");
      await onRefresh();
      window.dispatchEvent(new CustomEvent("turbolev:mechanic-refresh"));
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося виконати дію");
    } finally {
      setBusy("");
    }
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
        <strong>{data.price ? money(data.price.amount, data.price.currency) : "Ціна не налаштована"}</strong>
        <small>{data.price?.label || "Вартість діагностики повинна бути задана у Прайсі робіт."}</small>
        {data.price && <div className={styles.methods}>
          <button type="button" disabled={!data.canPay || Boolean(busy)} onClick={() => void act("PAY", "CASH")}>
            <b>💵</b><strong>Готівка</strong><span>{busy === "PAYCASH" ? "Проводжу оплату…" : "Оплачено в касу"}</span>
          </button>
          <button type="button" disabled={!data.canPay || Boolean(busy)} onClick={() => void act("PAY", "ONLINE")}>
            <b>💳</b><strong>Онлайн-оплата</strong><span>{busy === "PAYONLINE" ? "Проводжу оплату…" : "Картка / еквайринг / банк"}</span>
          </button>
        </div>}
        {!data.price && <div className={styles.warning}>Вартість діагностики не налаштована. Додайте активну позицію типу «Діагностика» у Прайсі робіт.</div>}
      </section> : <section className={styles.paymentCard}>
        <div className={styles.paidBadge}>✓ ОПЛАЧЕНО</div>
        <strong>{money(data.payment?.amount || data.price?.amount, data.price?.currency)}</strong>
        <small>{data.payment?.account?.name || "Оплата проведена"}</small>
        <h2>Що робимо з автомобілем?</h2>
        <div className={styles.routes}>
          <button type="button" className={styles.secondary} disabled={!data.canChooseRoute || Boolean(busy)} onClick={() => void act("COMPLETE_VISIT")}>
            Завершити візит
            <span>Клієнт забирає авто після діагностики</span>
          </button>
          <button type="button" className={styles.primary} disabled={!data.canChooseRoute || Boolean(busy)} onClick={() => void act("SEND_TO_REPAIR_FLOW")}>
            Передати на розрахунок ремонту →
            <span>Далі: ДК → роботи → деталі → погодження</span>
          </button>
        </div>
      </section>}

      {error && <div className={styles.error}>{error}</div>}
    </main>
  </div>;
}
