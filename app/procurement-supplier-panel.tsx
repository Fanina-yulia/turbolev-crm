"use client";

import { useEffect, useMemo, useState } from "react";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import styles from "./procurement-supplier-panel.module.css";

type Target = {
  card: {
    id: string;
    workOrderId: string;
    number: number | null;
    plate: string;
    vehicle: string;
    status: string;
    paymentRequired: boolean;
    paymentConfirmedAt: string | null;
  };
  item: {
    id: string;
    description: string;
    article: string | null;
    brand: string | null;
    quantity: number;
  };
};

type Stock = { warehouse: string; warehouseId?: string | null; quantity: string };
type Offer = {
  supplierId: string;
  supplierName: string;
  externalProductId: string | null;
  article: string;
  brand: string | null;
  name: string;
  purchasePrice: number | null;
  currency: string | null;
  stock: Stock[];
  available: boolean;
  markupPercent?: number;
  sellPrice?: number | null;
};
type Point = { id: string; label: string };
type Transporter = { id: string; label: string };
type Delivery = { id: string; label: string; time?: string | null };
type SupplierOrderItem = { partsRequestItemId?: string | null };
type SupplierOrder = {
  id: string;
  status: string;
  externalOrderId?: string | null;
  totalPurchase?: number | null;
  currency?: string | null;
  items?: SupplierOrderItem[] | null;
};

type Props = {
  target: Target;
  locationId: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};

function money(value: number | null | undefined, currency = "UAH") {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency: currency || "UAH", maximumFractionDigits: 2 }).format(value);
}

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function activeOrderForItem(order: SupplierOrder, itemId: string) {
  if (["CANCELLED", "ERROR"].includes(order.status)) return false;
  return Array.isArray(order.items) && order.items.some((item) => item?.partsRequestItemId === itemId);
}

export function ProcurementSupplierPanel({ target, locationId, onClose, onChanged }: Props) {
  const [query, setQuery] = useState(target.item.article || target.item.description);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [markupPercent, setMarkupPercent] = useState("40");
  const [deliveryDate, setDeliveryDate] = useState(localDate());
  const [points, setPoints] = useState<Point[]>([]);
  const [deliveryPointId, setDeliveryPointId] = useState("");
  const [transporters, setTransporters] = useState<Transporter[]>([]);
  const [transporterId, setTransporterId] = useState("");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveryId, setDeliveryId] = useState("");
  const [paymentType, setPaymentType] = useState<"" | "nal" | "beznal">("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<SupplierOrder | null>(null);
  const [submitted, setSubmitted] = useState<SupplierOrder | null>(null);

  const selectedOffer = useMemo(() => offers.find((offer) => `${offer.supplierId}:${offer.externalProductId}` === selectedKey) || null, [offers, selectedKey]);
  const selectedWarehouse = useMemo(() => selectedOffer?.stock.find((row) => row.warehouseId === warehouseId) || null, [selectedOffer, warehouseId]);
  const markup = Number(markupPercent);
  const sellPrice = selectedOffer?.purchasePrice == null || !Number.isFinite(markup)
    ? null
    : Math.round(selectedOffer.purchasePrice * (1 + Math.max(0, markup) / 100) * 100) / 100;
  const paymentReady = !target.card.paymentRequired || Boolean(target.card.paymentConfirmedAt);
  const readyForDraft = target.card.status === "ORDER_REQUIRED" && paymentReady;
  const readinessMessage = target.card.status !== "ORDER_REQUIRED"
    ? "Пошук і порівняння цін доступні зараз. Чернетку можна створити після переходу заявки у «До замовлення»."
    : !paymentReady
      ? "Спочатку підтвердіть передоплату клієнта. До цього CRM не дозволить створити або відправити supplier order."
      : "Чернетка доступна. Її створення не відправляє замовлення постачальнику.";

  async function searchOffers() {
    const q = query.trim();
    if (q.length < 2) return setMessage("Введіть артикул або назву деталі.");
    setBusy("search");
    setMessage("");
    try {
      const params = new URLSearchParams({ q });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/parts/suppliers?${params}`, { cache: "no-store" });
      const payload = await response.json() as { offers?: Offer[]; message?: string };
      if (!response.ok) throw new Error(payload.message || "Не вдалося виконати пошук у постачальників.");
      setOffers(payload.offers || []);
      setSelectedKey("");
      setWarehouseId("");
      if (!(payload.offers || []).length) setMessage("Постачальники не повернули доступних пропозицій.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося виконати пошук.");
    } finally {
      setBusy("");
    }
  }

  async function bootstrap() {
    setBusy("bootstrap");
    setMessage("");
    try {
      const suffix = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
      const response = await fetch(`/api/procurement/supplier-orders${suffix}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; orders?: SupplierOrder[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося перевірити замовлення постачальникам.");
      const existing = (payload.orders || []).find((order) => activeOrderForItem(order, target.item.id)) || null;
      if (existing) {
        setDraft(existing);
        if (existing.externalOrderId || existing.status !== "DRAFT") setSubmitted(existing);
        setMessage(existing.status === "DRAFT"
          ? "Для цієї позиції вже є чернетка CRM. Нову чернетку створювати не потрібно."
          : `Для цієї позиції вже є supplier order${existing.externalOrderId ? ` · № ${existing.externalOrderId}` : ""}.`);
        return;
      }
      await searchOffers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося відкрити supplier workflow.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => { void bootstrap(); }, []);

  async function chooseOffer(offer: Offer) {
    if (offer.supplierId !== "unique-trade" || !offer.externalProductId || !offer.available) return;
    setSelectedKey(`${offer.supplierId}:${offer.externalProductId}`);
    setWarehouseId(offer.stock.find((row) => row.warehouseId)?.warehouseId || "");
    setMarkupPercent(String(offer.markupPercent ?? 40));
    setMessage("");
    setDeliveryPointId("");
    setTransporterId("");
    setDeliveryId("");
    setTransporters([]);
    setDeliveries([]);
    setBusy("points");
    try {
      const params = new URLSearchParams({ supplier: "unique-trade", kind: "points" });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/procurement/supplier-orders/options?${params}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; points?: Point[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити точки доставки.");
      setPoints(payload.points || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити доставку.");
    } finally {
      setBusy("");
    }
  }

  async function loadTransporters(pointId = deliveryPointId, date = deliveryDate) {
    if (!pointId || !date) return;
    setBusy("transporters");
    setMessage("");
    setTransporterId("");
    setDeliveryId("");
    setTransporters([]);
    setDeliveries([]);
    try {
      const params = new URLSearchParams({ supplier: "unique-trade", kind: "transporters", date, deliveryPointId: pointId });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/procurement/supplier-orders/options?${params}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; transporters?: Transporter[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити перевізників.");
      setTransporters(payload.transporters || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити перевізників.");
    } finally {
      setBusy("");
    }
  }

  async function loadDeliveries(nextTransporterId: string) {
    if (!nextTransporterId || !deliveryPointId || !deliveryDate || !warehouseId) return;
    setBusy("deliveries");
    setMessage("");
    setDeliveryId("");
    setDeliveries([]);
    try {
      const params = new URLSearchParams({
        supplier: "unique-trade",
        kind: "deliveries",
        date: deliveryDate,
        deliveryPointId,
        transporterId: nextTransporterId,
        warehouseIds: warehouseId,
      });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/procurement/supplier-orders/options?${params}`, { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; deliveries?: Delivery[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Не вдалося завантажити варіанти доставки.");
      setDeliveries(payload.deliveries || []);
      if (!(payload.deliveries || []).length) setMessage("На обрану дату з цього складу немає доступної доставки.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити доставку.");
    } finally {
      setBusy("");
    }
  }

  async function createDraft() {
    if (!readyForDraft) return setMessage(readinessMessage);
    if (!selectedOffer?.externalProductId || !warehouseId || !deliveryPointId || !deliveryId || !paymentType) {
      return setMessage("Оберіть пропозицію, склад, точку, доставку та тип оплати.");
    }
    if (!Number.isFinite(markup) || markup < 0 || markup > 300) return setMessage("Націнка має бути від 0 до 300%.");
    setBusy("draft");
    setMessage("");
    try {
      const suffix = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
      const response = await fetch(`/api/procurement/supplier-orders${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_DRAFT",
          supplierId: "unique-trade",
          workOrderId: target.card.workOrderId,
          partsRequestId: target.card.id,
          items: [{
            partsRequestItemId: target.item.id,
            externalProductId: selectedOffer.externalProductId,
            warehouseId,
            quantity: target.item.quantity,
            markupPercent: markup,
          }],
          checkout: {
            comment: comment.trim() || `Turbo LEV · ${formatWorkOrderNumber(target.card.number)} · ${target.card.plate}`,
            deliveryId,
            deliveryDate,
            deliveryPointId,
            paymentType,
            withoutDocument: false,
          },
        }),
      });
      const payload = await response.json() as { ok?: boolean; order?: SupplierOrder; error?: string };
      if (!response.ok || !payload.ok || !payload.order) throw new Error(payload.error || "Не вдалося створити чернетку замовлення.");
      setDraft(payload.order);
      setMessage("Чернетку створено в CRM. У Юнік Трейд замовлення ще НЕ відправлено.");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося створити чернетку.");
    } finally {
      setBusy("");
    }
  }

  async function submitDraft() {
    if (!draft) return;
    if (!readyForDraft) return setMessage(readinessMessage);
    const accepted = window.confirm("Відправити це замовлення в Юнік Трейд? Після підтвердження CRM виконає реальний checkout у постачальника.");
    if (!accepted) return;
    setBusy("submit");
    setMessage("");
    try {
      const suffix = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
      const response = await fetch(`/api/procurement/supplier-orders${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT", orderId: draft.id, confirmation: "SUBMIT_SUPPLIER_ORDER" }),
      });
      const payload = await response.json() as { ok?: boolean; order?: SupplierOrder; error?: string };
      if (!response.ok || !payload.ok || !payload.order) throw new Error(payload.error || "Не вдалося відправити замовлення постачальнику.");
      setSubmitted(payload.order);
      setDraft(payload.order);
      setMessage(`Замовлення відправлено в Юнік Трейд${payload.order.externalOrderId ? ` · № ${payload.order.externalOrderId}` : ""}.`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося відправити замовлення.");
    } finally {
      setBusy("");
    }
  }

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.panel} role="dialog" aria-modal="true" aria-label="Замовлення запчастини у постачальника">
      <header className={styles.header}>
        <div><p>ЮНІК ТРЕЙД · LIVE API</p><h2>Замовлення запчастини</h2><span>{formatWorkOrderNumber(target.card.number)} · {target.card.plate} · {target.card.vehicle}</span></div>
        <button type="button" onClick={onClose} aria-label="Закрити">×</button>
      </header>

      <div className={styles.itemCard}><strong>{[target.item.brand, target.item.article].filter(Boolean).join(" · ") || target.item.description}</strong><span>{target.item.description}</span><small>Потрібно: {target.item.quantity}</small></div>
      {!draft && <div className={styles.message}>{readinessMessage}</div>}

      {!draft && <>
        <div className={styles.search}><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchOffers(); }} placeholder="Артикул або назва деталі"/><button type="button" onClick={() => void searchOffers()} disabled={Boolean(busy)}>{busy === "search" ? "Шукаю…" : "Знайти"}</button></div>

        <div className={styles.offers}>{offers.map((offer) => {
          const key = `${offer.supplierId}:${offer.externalProductId}`;
          const liveOrder = offer.supplierId === "unique-trade" && Boolean(offer.externalProductId) && offer.available;
          return <button type="button" key={`${key}:${offer.article}:${offer.purchasePrice}`} className={`${styles.offer} ${selectedKey === key ? styles.offerActive : ""}`} onClick={() => void chooseOffer(offer)} disabled={!liveOrder || Boolean(busy)}>
            <div><b>{offer.supplierName}</b><span>{[offer.brand, offer.article].filter(Boolean).join(" · ")}</span><strong>{offer.name}</strong></div>
            <div className={styles.prices}><span>закупка <b>{money(offer.purchasePrice, offer.currency || "UAH")}</b></span><span>продаж <b>{money(offer.sellPrice, offer.currency || "UAH")}</b></span><small>{liveOrder ? `${offer.stock.length} складів` : "live-order недоступний"}</small></div>
          </button>;
        })}</div>

        {selectedOffer && <div className={styles.form}>
          <label><span>Склад постачальника</span><select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setDeliveryId(""); setDeliveries([]); }}>{selectedOffer.stock.filter((row) => row.warehouseId).map((row) => <option key={row.warehouseId!} value={row.warehouseId!}>{row.warehouse} · залишок {row.quantity}</option>)}</select></label>
          <div className={styles.priceGrid}><label><span>Націнка, %</span><input type="number" min="0" max="300" step="0.1" value={markupPercent} onChange={(event) => setMarkupPercent(event.target.value)}/></label><div><span>Продажна ціна</span><b>{money(sellPrice, selectedOffer.currency || "UAH")}</b><small>закупка {money(selectedOffer.purchasePrice, selectedOffer.currency || "UAH")} · склад {selectedWarehouse?.quantity || "—"}</small></div></div>
          <label><span>Дата відправки</span><input type="date" value={deliveryDate} onChange={(event) => { setDeliveryDate(event.target.value); if (deliveryPointId) void loadTransporters(deliveryPointId, event.target.value); }}/></label>
          <label><span>Точка доставки</span><select value={deliveryPointId} onChange={(event) => { setDeliveryPointId(event.target.value); void loadTransporters(event.target.value, deliveryDate); }}><option value="">Оберіть точку</option>{points.map((point) => <option key={point.id} value={point.id}>{point.label}</option>)}</select></label>
          <label><span>Перевізник</span><select value={transporterId} onChange={(event) => { setTransporterId(event.target.value); void loadDeliveries(event.target.value); }} disabled={!deliveryPointId || busy === "transporters"}><option value="">{busy === "transporters" ? "Завантажую…" : "Оберіть перевізника"}</option>{transporters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span>Варіант доставки</span><select value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} disabled={!transporterId || busy === "deliveries"}><option value="">{busy === "deliveries" ? "Завантажую…" : "Оберіть доставку"}</option>{deliveries.map((item) => <option key={item.id} value={item.id}>{item.label}{item.time ? ` · ${item.time}` : ""}</option>)}</select></label>
          <label><span>Тип оплати</span><select value={paymentType} onChange={(event) => setPaymentType(event.target.value as "" | "nal" | "beznal")}><option value="">Оберіть</option><option value="beznal">Безготівка</option><option value="nal">Готівка</option></select></label>
          <label><span>Коментар постачальнику</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Необов’язково"/></label>
          <button type="button" className={styles.draftButton} onClick={() => void createDraft()} disabled={Boolean(busy) || !readyForDraft || !warehouseId || !deliveryId || !paymentType}>{busy === "draft" ? "Створюю…" : "Створити чернетку в CRM"}</button>
          <small className={styles.safety}>CRM ще раз перевірить live-ціну, залишок і склад перед збереженням. Реальна покупка виконується лише наступною окремою підтвердженою дією.</small>
        </div>}
      </>}

      {draft && <div className={styles.confirmCard}>
        <p>{submitted ? "ЗАМОВЛЕННЯ ВІДПРАВЛЕНО" : "ЧЕРНЕТКА CRM"}</p>
        <h3>{submitted ? "Юнік Трейд прийняв checkout" : "Перевірте перед реальною покупкою"}</h3>
        <div><span>Статус</span><b>{draft.status}</b></div>
        <div><span>Сума закупки</span><b>{money(draft.totalPurchase, draft.currency || "UAH")}</b></div>
        {draft.externalOrderId && <div><span>№ постачальника</span><b>{draft.externalOrderId}</b></div>}
        {!submitted && <button type="button" className={styles.submitButton} onClick={() => void submitDraft()} disabled={Boolean(busy) || !readyForDraft}>{busy === "submit" ? "Відправляю…" : "Підтвердити й замовити в Юнік Трейд"}</button>}
        {!submitted && <small>{readyForDraft ? "Наступна кнопка виконає реальне замовлення. Перед відправкою CRM покаже системне підтвердження." : readinessMessage}</small>}
      </div>}

      {message && <div className={styles.message}>{message}</div>}
    </section>
  </div>;
}
