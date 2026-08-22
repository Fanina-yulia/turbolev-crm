"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { navigateCrm, readCrmRoute } from "./crm-route";
import { ProcurementSupplierPanel } from "./procurement-supplier-panel";
import styles from "./procurement-queue.module.css";

type Category = "SELECTING" | "APPROVED" | "ORDERED" | "PARTIAL" | "RECEIVED";
type Item = {
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
type Card = {
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
  items: Item[];
  updatedAt: string;
};
type Response = {
  ok: boolean;
  error?: string;
  location: { id: string; name: string; timezone: string } | null;
  locations: Array<{ id: string; name: string; timezone: string }>;
  cards: Card[];
  canWrite: boolean;
};

const LANES: Array<[Category, string, string]> = [
  ["SELECTING", "Підібрати", "Нові заявки та підбір деталей"],
  ["APPROVED", "До замовлення", "Підібрано, погоджено або чекає замовлення"],
  ["ORDERED", "Замовлено / в дорозі", "Очікуємо постачання"],
  ["PARTIAL", "Частково отримано", "Частина позицій уже на складі"],
  ["RECEIVED", "Отримано / видано", "Деталі прийняті або вже встановлені"],
];

function fmt(value: string | null, timeZone = "Europe/Kyiv") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function actionFor(status: string) {
  if (status === "NEW") return ["START_SELECTION", "Почати підбір"] as const;
  if (status === "SELECTING") return ["SELECTION_DONE", "Підбір завершено"] as const;
  if (status === "SELECTED" || status === "WAITING_APPROVAL") return ["APPROVE", "Погодити"] as const;
  if (status === "APPROVED") return ["REQUIRE_ORDER", "До замовлення"] as const;
  if (status === "ORDER_REQUIRED") return ["MARK_ORDERED", "Позначити замовленим"] as const;
  return null;
}

function categoryTone(category: Category) {
  return category === "SELECTING" ? styles.blue : category === "APPROVED" ? styles.amber : category === "ORDERED" ? styles.violet : category === "PARTIAL" ? styles.orange : styles.green;
}

export function ProcurementQueue() {
  const route = readCrmRoute();
  const initialFocus = route.scope === "selecting" ? "SELECTING" : route.scope === "approved" ? "APPROVED" : route.scope === "ordered" ? "ORDERED" : route.scope === "partial" ? "PARTIAL" : route.scope === "received" ? "RECEIVED" : null;
  const [data, setData] = useState<Response | null>(null);
  const [locationId, setLocationId] = useState("");
  const [focus, setFocus] = useState<Category | null>(initialFocus);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [receivedDraft, setReceivedDraft] = useState<Record<string, string>>({});
  const [supplierTarget, setSupplierTarget] = useState<{ card: Card; item: Item } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextLocationId?: string) => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      const selected = nextLocationId ?? locationId;
      if (selected) params.set("locationId", selected);
      const response = await fetch(`/api/procurement${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as Response;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити закупівлі.");
      setData(payload);
      setLocationId(payload.location?.id || "");
      setReceivedDraft((current) => {
        const next = { ...current };
        for (const card of payload.cards || []) for (const item of card.items) if (next[item.id] == null) next[item.id] = String(item.receivedQuantity || item.quantity);
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити закупівлі.");
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const sync = () => {
      const next = readCrmRoute();
      setFocus(next.scope === "selecting" ? "SELECTING" : next.scope === "approved" ? "APPROVED" : next.scope === "ordered" ? "ORDERED" : next.scope === "partial" ? "PARTIAL" : next.scope === "received" ? "RECEIVED" : null);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const visibleCards = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("uk-UA");
    return (data?.cards || []).filter((card) => !focus || card.category === focus).filter((card) => {
      if (!q) return true;
      return [
        formatWorkOrderNumber(card.number), card.plate, card.vin, card.vehicle, card.post?.name, card.mechanic?.name,
        ...card.items.flatMap((item) => [item.article, item.brand, item.description, item.supplier?.name]),
      ].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA").includes(q);
    });
  }, [data?.cards, focus, search]);

  const counts = useMemo(() => Object.fromEntries(LANES.map(([category]) => [category, (data?.cards || []).filter((card) => card.category === category).length])) as Record<Category, number>, [data?.cards]);

  async function act(card: Card, action: string, extra: Record<string, unknown> = {}) {
    if (!data?.canWrite || busy) return;
    const key = `${card.id}:${action}:${String(extra.itemId || "")}`;
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch("/api/procurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partsRequestId: card.id, action, ...extra }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Дію не виконано.");
      setMessage(`${formatWorkOrderNumber(card.number)} · дані закупівлі оновлено.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Дію не виконано.");
    } finally {
      setBusy("");
    }
  }

  function openParts(card: Card) {
    navigateCrm("Підбір запчастин", card.vin ? { vin: card.vin } : {});
  }

  function openWorkOrder(card: Card) {
    navigateCrm("Замовлення-наряди", { workOrderId: card.workOrderId, workOrderTab: "parts" });
  }

  if (loading && !data) return <div className={styles.state}>Завантажую закупівлі та склад…</div>;
  if (!data?.location) return <div className={styles.state}>{message || "Для Вашого профілю не визначена станція закупівель."}</div>;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p>TURBO LEV · ЗАПЧАСТИНИ</p><h1>Закупівлі та склад</h1><span>{data.location.name} · одна черга від підбору до видачі деталей у ремонт</span></div>
      <div className={styles.headerActions}>
        {data.locations.length > 1 && <select value={locationId} onChange={(event) => void load(event.target.value)}>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>}
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? "Оновлюю…" : "Оновити"}</button>
      </div>
    </header>

    <section className={styles.kpis}>{LANES.map(([category, label]) => <button type="button" key={category} className={focus === category ? styles.kpiActive : ""} onClick={() => setFocus((current) => current === category ? null : category)}><span>{label}</span><strong>{counts[category]}</strong></button>)}</section>
    <label className={styles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ЗН, авто, VIN, артикул, деталь або постачальник…"/>{search && <button type="button" onClick={() => setSearch("")}>×</button>}</label>
    {message && <div className={styles.notice}>{message}</div>}

    <div className={styles.board}>
      {LANES.map(([category, title, subtitle]) => {
        if (focus && focus !== category) return null;
        const cards = visibleCards.filter((card) => card.category === category);
        return <section className={styles.lane} key={category}>
          <header><div><h2>{title}</h2><span>{subtitle}</span></div><b>{cards.length}</b></header>
          <div className={styles.cards}>{cards.length ? cards.map((card) => {
            const next = actionFor(card.status);
            const paymentBlocked = card.paymentRequired && !card.paymentConfirmedAt;
            return <article className={styles.card} key={card.id}>
              <div className={styles.cardTop}><div><span className={styles.wo}>{formatWorkOrderNumber(card.number)}</span><strong>{card.plate}</strong></div><span className={`${styles.status} ${categoryTone(card.category)}`}>{card.status}</span></div>
              <h3>{card.vehicle}</h3>
              <div className={styles.meta}><span><b>{card.post?.name || "Без поста"}</b><small>пост</small></span><span><b>{card.mechanic?.name || "Без механіка"}</b><small>механік</small></span><span><b>{card.fullyReceived}/{card.totalItems}</b><small>отримано</small></span></div>
              <div className={`${styles.payment} ${paymentBlocked ? styles.paymentBlocked : styles.paymentOk}`}><span>{card.paymentRequired ? (card.paymentConfirmedAt ? "✓ Передоплату підтверджено" : "! Потрібна передоплата") : "Передоплата не потрібна"}</span>{card.paymentConfirmedAt && <small>{fmt(card.paymentConfirmedAt, data.location?.timezone)}</small>}</div>
              <div className={styles.items}>{card.items.map((item) => {
                const receivedDone = item.receivedQuantity >= item.quantity;
                const installedDone = item.installedQuantity >= item.quantity;
                const canSource = ["NEW", "SELECTING", "SELECTED", "WAITING_APPROVAL", "APPROVED", "ORDER_REQUIRED"].includes(card.status) && !receivedDone;
                return <div className={styles.item} key={item.id}>
                  <div className={styles.itemHead}><div><b>{[item.brand, item.article].filter(Boolean).join(" · ") || item.description}</b><span>{item.description}</span></div>{item.requiredForRepair && <em>обов’язкова</em>}</div>
                  <div className={styles.itemMeta}><span>{item.supplier?.name || "Постачальник не вибраний"}</span><span>Потрібно {item.quantity} · отримано {item.receivedQuantity} · видано {item.installedQuantity}</span>{item.etaAt && <span>ETA {fmt(item.etaAt, data.location?.timezone)}</span>}</div>
                  {data.canWrite && canSource && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => setSupplierTarget({ card, item })}>{item.supplier ? "Перевірити / змінити постачальника" : "Знайти у постачальника"}</button>}
                  {data.canWrite && ["ORDERED", "PARTIALLY_RECEIVED"].includes(card.status) && !receivedDone && <div className={styles.receive}><input type="number" min={item.receivedQuantity} max={item.quantity} step="0.01" value={receivedDraft[item.id] ?? String(item.quantity)} onChange={(event) => setReceivedDraft((current) => ({ ...current, [item.id]: event.target.value }))}/><button type="button" disabled={Boolean(busy)} onClick={() => void act(card, "RECEIVE_ITEM", { itemId: item.id, quantity: receivedDraft[item.id] ?? String(item.quantity) })}>Прийняти</button></div>}
                  {data.canWrite && ["RECEIVED", "PARTIALLY_RECEIVED", "INSTALLED"].includes(card.status) && receivedDone && !installedDone && <button type="button" className={styles.install} disabled={Boolean(busy)} onClick={() => void act(card, "INSTALL_ITEM", { itemId: item.id, receivedQuantity: item.receivedQuantity, quantity: item.quantity })}>Видати / встановити всю кількість</button>}
                  {installedDone && <div className={styles.done}>✓ Видано / встановлено</div>}
                </div>;
              })}</div>
              <footer>
                <button type="button" className={styles.secondary} onClick={() => openWorkOrder(card)}>Відкрити ЗН</button>
                {card.category === "SELECTING" && <button type="button" className={styles.secondary} onClick={() => openParts(card)}>Підібрати деталі</button>}
                {data.canWrite && card.paymentRequired && !card.paymentConfirmedAt && <button type="button" className={styles.pay} disabled={Boolean(busy)} onClick={() => void act(card, "CONFIRM_PAYMENT")}>Підтвердити передоплату</button>}
                {data.canWrite && !card.paymentRequired && ["SELECTED", "APPROVED", "ORDER_REQUIRED"].includes(card.status) && <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void act(card, "SET_PAYMENT_REQUIRED", { paymentRequired: true })}>Потрібна передоплата</button>}
                {data.canWrite && next && <button type="button" className={styles.primary} disabled={Boolean(busy) || (next[0] === "MARK_ORDERED" && paymentBlocked)} onClick={() => void act(card, next[0])}>{busy.startsWith(`${card.id}:${next[0]}`) ? "…" : next[1]}</button>}
              </footer>
            </article>;
          }) : <div className={styles.empty}>Черга порожня.</div>}</div>
        </section>;
      })}
    </div>

    {supplierTarget && <ProcurementSupplierPanel
      target={supplierTarget}
      locationId={locationId}
      onClose={() => setSupplierTarget(null)}
      onChanged={async () => { await load(); }}
    />}
  </div>;
}
