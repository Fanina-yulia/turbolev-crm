"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm } from "./crm-route";
import styles from "./parts-role-cabinet-home.module.css";

type RoleCode = "PARTS_SPECIALIST" | "WAREHOUSE_KEEPER";
type Category = "SELECTING" | "APPROVED" | "ORDERED" | "PARTIAL" | "RECEIVED";

type PartItem = {
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
};

type ProcurementCard = {
  id: string;
  workOrderId: string;
  number: number | null;
  status: string;
  category: Category;
  paymentRequired: boolean;
  paymentConfirmedAt: string | null;
  plate: string;
  vin: string | null;
  vehicle: string;
  workOrderStatus: string;
  post: { id: string; name: string } | null;
  mechanic: { id: string; name: string } | null;
  totalItems: number;
  fullyReceived: number;
  fullyInstalled: number;
  items: PartItem[];
  updatedAt: string;
};

type ProcurementResponse = {
  ok: boolean;
  error?: string;
  location: { id: string; name: string; timezone: string } | null;
  locations: Array<{ id: string; name: string; timezone: string }>;
  cards: ProcurementCard[];
  canWrite: boolean;
};

const CATEGORY_SCOPE: Record<Category, string> = {
  SELECTING: "selecting",
  APPROVED: "approved",
  ORDERED: "ordered",
  PARTIAL: "partial",
  RECEIVED: "received",
};

function isPending(item: PartItem) {
  return item.receivedQuantity < item.quantity;
}

function isIssuePending(item: PartItem) {
  return item.receivedQuantity >= item.quantity && item.installedQuantity < item.quantity;
}

function etaOverdue(item: PartItem, now: number) {
  if (!item.etaAt || !isPending(item)) return false;
  const value = new Date(item.etaAt).getTime();
  return Number.isFinite(value) && value < now;
}

function ageLabel(updatedAt: string) {
  const value = new Date(updatedAt).getTime();
  if (!Number.isFinite(value)) return "оновлено нещодавно";
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  if (minutes < 60) return `оновлено ${Math.max(minutes, 1)} хв тому`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `оновлено ${hours} год тому`;
  return `оновлено ${Math.floor(hours / 24)} дн тому`;
}

function actionLabel(role: RoleCode, card: ProcurementCard) {
  if (role === "PARTS_SPECIALIST") {
    if (card.category === "SELECTING") return "Підібрати деталі";
    if (card.category === "APPROVED") return "Оформити замовлення";
    if (card.category === "ORDERED") return "Контролювати ETA";
    if (card.category === "PARTIAL") return "Закрити недопоставку";
    return "Перевірити видачу";
  }
  if (card.category === "ORDERED") return "Прийняти поставку";
  if (card.category === "PARTIAL") return "Прийняти залишок";
  if (card.category === "RECEIVED") return "Видати в ремонт";
  if (card.category === "APPROVED") return "Перевірити замовлення";
  return "Перевірити заявку";
}

function roleTitle(role: RoleCode) {
  return role === "PARTS_SPECIALIST" ? "Кабінет менеджера з запчастин" : "Кабінет комірника";
}

function roleSubtitle(role: RoleCode) {
  return role === "PARTS_SPECIALIST"
    ? "Від потреби автомобіля до підтвердженого замовлення постачальнику"
    : "Від поставки на станцію до фактичної видачі деталей у ремонт";
}

function roleQueueTitle(role: RoleCode) {
  return role === "PARTS_SPECIALIST" ? "Що треба розблокувати зараз" : "Що треба прийняти або видати зараз";
}

export function PartsRoleCabinetHome({ role, userName }: { role: RoleCode; userName?: string | null }) {
  const [data, setData] = useState<ProcurementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/procurement", { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => null) as ProcurementResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Не вдалося завантажити чергу запчастин.");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити чергу запчастин.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const handler = () => void load();
    window.addEventListener("turbolev:data-changed", handler);
    return () => window.removeEventListener("turbolev:data-changed", handler);
  }, [load]);

  const summary = useMemo(() => {
    const cards = data?.cards || [];
    const now = Date.now();
    const counts: Record<Category, number> = { SELECTING: 0, APPROVED: 0, ORDERED: 0, PARTIAL: 0, RECEIVED: 0 };
    let repairBlockers = 0;
    let overdueEta = 0;
    let noSupplier = 0;
    let paymentBlocked = 0;
    let readyToIssue = 0;

    for (const card of cards) {
      counts[card.category] += 1;
      if (card.paymentRequired && !card.paymentConfirmedAt) paymentBlocked += 1;
      const pendingRequired = card.items.some((item) => item.requiredForRepair && isPending(item));
      if (pendingRequired) repairBlockers += 1;
      if (card.items.some((item) => etaOverdue(item, now))) overdueEta += 1;
      if (card.items.some((item) => isPending(item) && !item.supplier)) noSupplier += 1;
      if (card.items.some(isIssuePending)) readyToIssue += 1;
    }

    const priority: Record<Category, number> = role === "PARTS_SPECIALIST"
      ? { SELECTING: 0, APPROVED: 1, ORDERED: 2, PARTIAL: 3, RECEIVED: 4 }
      : { ORDERED: 0, PARTIAL: 1, RECEIVED: 2, APPROVED: 3, SELECTING: 4 };

    const actionCards = cards
      .filter((card) => role === "PARTS_SPECIALIST"
        ? card.category === "SELECTING" || card.category === "APPROVED" || card.items.some((item) => etaOverdue(item, now)) || card.items.some((item) => isPending(item) && !item.supplier)
        : card.category === "ORDERED" || card.category === "PARTIAL" || card.items.some(isIssuePending))
      .sort((a, b) => priority[a.category] - priority[b.category] || new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      .slice(0, 10);

    return { counts, repairBlockers, overdueEta, noSupplier, paymentBlocked, readyToIssue, actionCards };
  }, [data?.cards, role]);

  const openProcurement = (category?: Category, plate?: string) => {
    navigateCrm("Закупівлі та склад", {
      ...(category ? { scope: CATEGORY_SCOPE[category] } : {}),
      ...(plate ? { plate } : {}),
    });
  };

  if (loading && !data) return <div className={styles.state}><strong>Завантажую робочий кабінет…</strong><span>Формую чергу з реальних заявок на запчастини Вашої станції.</span></div>;
  if (error && !data) return <div className={styles.state}><strong>Не вдалося відкрити кабінет</strong><span>{error}</span><button type="button" onClick={() => void load()}>Повторити</button></div>;
  if (!data?.location) return <div className={styles.state}><strong>Станцію ще не визначено</strong><span>Призначте працівнику станцію в «Персонал». Після цього тут буде тільки її операційна черга.</span></div>;

  const cards = data.cards || [];
  const station = data.location.name;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className="eyebrow">TURBO LEV · {role === "PARTS_SPECIALIST" ? "ЗАПЧАСТИНИ" : "СКЛАД"}</p>
        <h1>{roleTitle(role)}</h1>
        <span>{userName || (role === "PARTS_SPECIALIST" ? "Менеджер з запчастин" : "Комірник")} · {station} · {roleSubtitle(role)}</span>
      </div>
      <button className={styles.primary} type="button" onClick={() => openProcurement()}>Відкрити всю чергу →</button>
    </header>

    <section className={styles.kpis} aria-label="Стан черги запчастин">
      <button type="button" onClick={() => openProcurement("SELECTING")}><span>Підібрати</span><strong>{summary.counts.SELECTING}</strong><small>нові заявки та активний підбір</small></button>
      <button type="button" onClick={() => openProcurement("APPROVED")}><span>До замовлення</span><strong>{summary.counts.APPROVED}</strong><small>погоджені або готові до закупівлі</small></button>
      <button type="button" onClick={() => openProcurement("ORDERED")}><span>В дорозі</span><strong>{summary.counts.ORDERED}</strong><small>замовлені поставки</small></button>
      <button type="button" onClick={() => role === "PARTS_SPECIALIST" ? openProcurement() : openProcurement("RECEIVED")} className={(role === "PARTS_SPECIALIST" ? summary.repairBlockers : summary.readyToIssue) ? styles.kpiAlert : ""}><span>{role === "PARTS_SPECIALIST" ? "Блокують ремонт" : "Готові до видачі"}</span><strong>{role === "PARTS_SPECIALIST" ? summary.repairBlockers : summary.readyToIssue}</strong><small>{role === "PARTS_SPECIALIST" ? "авто чекають обов’язкові деталі" : "поставки можна видати в ремонт"}</small></button>
    </section>

    <section className={styles.alerts} aria-label="Ризики запчастин">
      <button type="button" className={summary.overdueEta ? styles.critical : ""} onClick={() => openProcurement("ORDERED")}><span>ETA протерміновано</span><strong>{summary.overdueEta}</strong><small>поставка мала вже прибути</small></button>
      <button type="button" className={summary.noSupplier ? styles.warning : ""} onClick={() => openProcurement("SELECTING")}><span>Без постачальника</span><strong>{summary.noSupplier}</strong><small>є незакриті позиції</small></button>
      <button type="button" className={summary.paymentBlocked ? styles.warning : ""} onClick={() => openProcurement("APPROVED")}><span>Блокує передоплата</span><strong>{summary.paymentBlocked}</strong><small>замовлення чекають підтвердження</small></button>
      <button type="button" className={summary.repairBlockers ? styles.warning : ""} onClick={() => navigateCrm("Комерційна пропозиція", { status: "WAITING_PARTS" })}><span>Авто чекають деталі</span><strong>{summary.repairBlockers}</strong><small>операційний блокер ремонту</small></button>
    </section>

    <div className={styles.columns}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><p className="eyebrow">ПОТРЕБУЄ ДІЇ</p><h2>{roleQueueTitle(role)}</h2></div>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
        </div>
        {summary.actionCards.length ? <div className={styles.queue}>{summary.actionCards.map((card) => {
          const missingSupplier = card.items.some((item) => isPending(item) && !item.supplier);
          const overdue = card.items.some((item) => etaOverdue(item, Date.now()));
          const pendingRequired = card.items.filter((item) => item.requiredForRepair && isPending(item)).length;
          const issuePending = card.items.filter(isIssuePending).length;
          return <button type="button" key={card.id} className={`${styles.queueItem} ${overdue ? styles.queueCritical : ""}`} onClick={() => openProcurement(card.category, card.plate)}>
            <div className={styles.identity}><b>{card.plate}</b><span>{formatWorkOrderNumber(card.number)}</span></div>
            <div className={styles.queueMain}><strong>{actionLabel(role, card)}</strong><span>{card.vehicle}</span><small>{card.totalItems} поз. · отримано {card.fullyReceived}/{card.totalItems}{pendingRequired ? ` · ${pendingRequired} блокують ремонт` : ""}{issuePending ? ` · ${issuePending} готові до видачі` : ""}</small><em>{missingSupplier ? "Без постачальника · " : ""}{ageLabel(card.updatedAt)}</em></div>
            <div className={styles.queueMeta}><span>{card.post?.name || "Без поста"}</span><small>{card.mechanic?.name || "Без механіка"}</small><b>{overdue ? "ETA прострочено" : card.category}</b></div>
          </button>;
        })}</div> : <div className={styles.empty}>{cards.length ? "У Вашій пріоритетній черзі зараз немає дій. Решта заявок доступна у повній черзі закупівель." : "Активних заявок на запчастини зараз немає."}</div>}
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHead}><div><p className="eyebrow">ШВИДКІ ДІЇ</p><h2>Робочі переходи</h2></div></div>
        <div className={styles.quick}>
          <button type="button" onClick={() => navigateCrm("Підбір запчастин")}>Підбір запчастин<span>VIN / номер авто + постачальники →</span></button>
          <button type="button" onClick={() => openProcurement("SELECTING")}>Нові заявки<span>почати або завершити підбір →</span></button>
          <button type="button" onClick={() => openProcurement("ORDERED")}>Поставки в дорозі<span>ETA та приймання →</span></button>
          <button type="button" onClick={() => openProcurement("PARTIAL")}>Часткові поставки<span>закрити недопоставки →</span></button>
          <button type="button" onClick={() => openProcurement("RECEIVED")}>Отримано<span>видати / встановити в ремонт →</span></button>
          <button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { status: "WAITING_PARTS" })}>Авто, що чекають деталі<span>бачити вплив на ремонт →</span></button>
        </div>
        <div className={styles.truthNote}><strong>Один операційний контур</strong><span>Цей кабінет не створює нових статусів. Він читає ту саму чергу `Підбір → До замовлення → В дорозі → Частково отримано → Отримано`, яку вже використовує CRM.</span></div>
      </aside>
    </div>
  </div>;
}
