"use client";

import { useState } from "react";
import styles from "./parts-catalog.module.css";
import supplierStyles from "./parts-suppliers.module.css";

type Part = {
  name?: string;
  slug?: string;
  category?: string;
  description?: string;
  fitment?: { status?: string; confidence?: number; confirmed?: boolean; reason?: string };
};

type VehicleContext = {
  vin?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  engine?: string | null;
  engineVolumeL?: number | null;
  fuelType?: string | null;
  confidence?: number;
  source?: string | null;
  generation?: { name?: string; yearFrom?: number; yearTo?: number | null } | null;
};

type SupplierOffer = {
  supplierId: string;
  supplierName: string;
  externalProductId: string | null;
  article: string;
  brand: string | null;
  name: string;
  purchasePrice: number | null;
  currency: string | null;
  multiplicity: number | null;
  stock: Array<{ warehouse: string; quantity: string }>;
  available: boolean;
  sourceUrl: string | null;
};

type SupplierProvider = { id: string; ok: boolean; message?: string };

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

function formatMoney(value: number | null, currency: string | null) {
  if (value == null) return "—";
  const normalizedCurrency = currency === "ГРН" ? "UAH" : currency || "UAH";
  try {
    return new Intl.NumberFormat("uk-UA", { style: "currency", currency: normalizedCurrency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function PartsCatalog() {
  const [q, setQ] = useState("");
  const [vin, setVin] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [supplierProviders, setSupplierProviders] = useState<SupplierProvider[]>([]);
  const [configuredSuppliers, setConfiguredSuppliers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Введіть VIN, якщо він є, і назву або артикул потрібної деталі.");

  async function search() {
    const query = q.trim();
    if (query.length < 2) return setMessage("Введіть щонайменше 2 символи назви або артикулу деталі.");
    if (vin && normalizeVin(vin).length !== 17) return setMessage("VIN має містити 17 символів або залиште поле порожнім.");

    setBusy(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (vin) params.set("vin", normalizeVin(vin));

      const [referenceResult, supplierResult] = await Promise.allSettled([
        fetch(`/api/parts/search?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/parts/suppliers?q=${encodeURIComponent(query)}`, { cache: "no-store" }),
      ]);

      if (referenceResult.status === "fulfilled") {
        const data = await referenceResult.value.json();
        setParts(Array.isArray(data.parts) ? data.parts : []);
        setVehicle(data.vehicle ?? null);
        setMessage(data.fitmentPolicy?.message ?? "Готово.");
      } else {
        setParts([]);
        setVehicle(null);
        setMessage("Довідковий каталог тимчасово недоступний.");
      }

      if (supplierResult.status === "fulfilled") {
        const supplierData = await supplierResult.value.json();
        setOffers(Array.isArray(supplierData.offers) ? supplierData.offers : []);
        setSupplierProviders(Array.isArray(supplierData.providers) ? supplierData.providers : []);
        setConfiguredSuppliers(Array.isArray(supplierData.configuredSuppliers) ? supplierData.configuredSuppliers : []);
      } else {
        setOffers([]);
        setSupplierProviders([]);
        setConfiguredSuppliers([]);
      }
    } catch {
      setParts([]);
      setVehicle(null);
      setOffers([]);
      setSupplierProviders([]);
      setConfiguredSuppliers([]);
      setMessage("Каталог тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  const providerErrors = supplierProviders.filter((provider) => !provider.ok);

  return <div className={styles.page}>
    <div className={styles.head}>
      <div><p>TURBO LEV · PARTS INTELLIGENCE</p><h1>Підбір запчастин</h1></div>
      <span className={styles.badge}>VIN + SUPPLIER API</span>
    </div>

    <section className={styles.panel}>
      <div className={styles.contextGrid}>
        <label className={styles.field}><span>VIN автомобіля</span><input value={vin} onChange={(e) => setVin(normalizeVin(e.target.value))} placeholder="17 символів" /><small>{vin ? `${vin.length}/17` : "Необов’язково, але сильно підвищує якість контексту"}</small></label>
        <label className={styles.field}><span>Що шукаємо</span><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Артикул або назва: 115 906, колодки…" /></label>
        <button className={styles.primary} type="button" onClick={search} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button>
      </div>

      {vehicle && <div className={styles.vehicleCard}>
        <div><small>АВТО ПО VIN</small><strong>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.vin}</strong><span>{vehicle.vin}</span></div>
        <div className={styles.vehicleMeta}>{vehicle.engineVolumeL && <span>{vehicle.engineVolumeL} л</span>}{vehicle.engine && <span>{vehicle.engine}</span>}{vehicle.fuelType && <span>{vehicle.fuelType}</span>}{vehicle.generation?.name && <span>{vehicle.generation.name}</span>}</div>
        <div className={styles.confidence}><small>Довіра до авто</small><b>{vehicle.confidence ?? 0}%</b><span>{vehicle.source ?? "VIN decoder"}</span></div>
      </div>}

      <div className={styles.note}>{message}</div>
      <div className={styles.guard}><b>Hard Gate сумісності:</b> ціна та наявність у постачальника не означають, що деталь підходить до конкретного VIN. Замовлення розблоковується тільки після OEM/API підтвердження застосовності.</div>

      <section className={supplierStyles.supplierBlock}>
        <div className={supplierStyles.supplierHead}>
          <div><strong>Пропозиції постачальників</strong><span>Живі закупівельні ціни та складські залишки через серверні API</span></div>
          <span className={supplierStyles.providerCount}>{configuredSuppliers.length} API налаштовано</span>
        </div>

        {!configuredSuppliers.length ? <div className={supplierStyles.supplierEmpty}>API-доступи ще не додані на сервер CRM. Відкрийте <b>Налаштування → Постачальники</b>: там видно, який доступ потрібен для BM Parts, Юнік Трейд та Автонова-Д.</div> : null}

        {configuredSuppliers.length > 0 && !offers.length && !busy ? <div className={supplierStyles.supplierEmpty}>У підключених постачальників за цим запитом пропозицій не знайдено.</div> : null}

        {offers.length ? <div className={supplierStyles.tableWrap}><table className={supplierStyles.offerTable}>
          <thead><tr><th>Постачальник</th><th>Деталь</th><th>Закупівля</th><th>Залишок</th></tr></thead>
          <tbody>{offers.map((offer, index) => <tr key={`${offer.supplierId}-${offer.externalProductId ?? offer.article}-${index}`}>
            <td><div className={supplierStyles.offerSupplier}><strong>{offer.supplierName}</strong><span>{offer.available ? "в наявності" : "уточнити"}</span></div></td>
            <td><div className={supplierStyles.offerName}><strong>{offer.brand ? `${offer.brand} · ${offer.article}` : offer.article}</strong><span>{offer.name}</span></div></td>
            <td className={supplierStyles.offerPrice}>{formatMoney(offer.purchasePrice, offer.currency)}</td>
            <td>{offer.stock.length ? <div className={supplierStyles.stockList}>{offer.stock.slice(0, 3).map((stock, stockIndex) => <span key={`${stock.warehouse}-${stockIndex}`}>{stock.warehouse}: <b>{stock.quantity}</b></span>)}</div> : <span className={supplierStyles.stockEmpty}>немає даних</span>}</td>
          </tr>)}</tbody>
        </table></div> : null}

        {providerErrors.length ? <div className={supplierStyles.supplierWarning}>Не всі API відповіли: {providerErrors.map((provider) => `${provider.id}${provider.message ? ` — ${provider.message}` : ""}`).join("; ")}</div> : null}
      </section>

      {parts.length ? <div className={styles.grid}>{parts.map((part, index) => <article className={styles.card} key={`${part.slug ?? part.name}-${index}`}>
        <div className={styles.cardTop}><b>{part.name ?? "Деталь"}</b><span className={styles.unverified}>НЕ ПІДТВЕРДЖЕНО</span></div>
        {part.category && <span>{part.category}</span>}
        {part.slug && <small>{part.slug}</small>}
        {part.description && <small>{part.description}</small>}
        {part.fitment && <div className={styles.fitment}><span>Контекст {part.fitment.confidence ?? 0}%</span><small>{part.fitment.reason}</small></div>}
      </article>)}</div> : <div className={styles.empty}>Довідкові результати з’являться тут.</div>}
    </section>
  </div>;
}
