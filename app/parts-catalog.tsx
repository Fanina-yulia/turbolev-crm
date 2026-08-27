"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
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

type VehicleDirectoryItem = {
  id?: string;
  plateNumber?: string | null;
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
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
  stock: Array<{ warehouse: string; quantity: string; warehouseId?: string | null }>;
  available: boolean;
  sourceUrl: string | null;
  markupPercent?: number | null;
  sellPrice?: number | null;
};

type SupplierProvider = { id: string; ok: boolean; message?: string };
type DiagnosticRecommendation = { findingId: string; name: string };
type DiagnosticPartsPayload = {
  ok?: boolean;
  diagnostic?: { workOrder?: { id: string } | null };
  inspections?: Array<{ sections?: Array<{ items?: Array<{ finding?: { id?: string; suggestedPartName?: string | null } | null }> }> }>;
};
type SelectionResult = {
  workOrderId: string;
  partsRequestId: string;
  findingId: string;
  selected: { supplierName: string; article: string; brand: string | null; purchasePrice: number; markupPercent: number; sellPrice: number; currency: string };
};

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9]/g, "");
}

function looksLikeVin(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 17 && normalizeVin(value).length === 17;
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return "—";
  const normalizedCurrency = currency === "ГРН" ? "UAH" : currency || "UAH";
  try {
    return new Intl.NumberFormat("uk-UA", { style: "currency", currency: normalizedCurrency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase("uk-UA").replace(/\s+/g, " ");
}

export function PartsCatalog() {
  const [q, setQ] = useState("");
  const [vehicleRef, setVehicleRef] = useState("");
  const [resolvedPlate, setResolvedPlate] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [supplierProviders, setSupplierProviders] = useState<SupplierProvider[]>([]);
  const [configuredSuppliers, setConfiguredSuppliers] = useState<string[]>([]);
  const [recommendedParts, setRecommendedParts] = useState<DiagnosticRecommendation[]>([]);
  const [activeFindingId, setActiveFindingId] = useState("");
  const [diagnosticCardContext, setDiagnosticCardContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectingOffer, setSelectingOffer] = useState("");
  const [selectionResult, setSelectionResult] = useState<SelectionResult | null>(null);
  const [message, setMessage] = useState("Введіть VIN або держномер автомобіля, якщо він є, і назву або артикул потрібної деталі.");

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const route = readCrmRoute();
      const reference = route.plate || route.vin || "";
      if (reference) setVehicleRef(reference.toUpperCase());
      setSelectionResult(null);
      if (!route.diagnosticId) {
        if (!cancelled) {
          setRecommendedParts([]);
          setActiveFindingId("");
          setDiagnosticCardContext(false);
        }
        return;
      }
      setDiagnosticCardContext(true);
      try {
        const response = await fetch(`/api/diagnostics/${encodeURIComponent(route.diagnosticId)}/structured`, { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null) as DiagnosticPartsPayload | null;
        if (!response.ok || !payload?.ok) return;
        const recommendations = (payload.inspections || []).flatMap((inspection) => (inspection.sections || []).flatMap((section) => (section.items || []).flatMap((item) => {
          const name = item.finding?.suggestedPartName?.trim();
          const findingId = item.finding?.id?.trim();
          return name && findingId ? [{ findingId, name }] : [];
        })));
        const unique = Array.from(new Map(recommendations.map((item) => [`${item.findingId}:${item.name}`, item])).values());
        if (cancelled) return;
        setRecommendedParts(unique);
        setQ((current) => current.trim() ? current : unique[0]?.name || "");
        setActiveFindingId((current) => current && unique.some((item) => item.findingId === current) ? current : unique[0]?.findingId || "");
        if (unique.length) setMessage(`З Діагностичної карти передано рекомендовані деталі: ${unique.length}. Оберіть позицію та постачальника.`);
      } catch {
        if (!cancelled) {
          setRecommendedParts([]);
          setActiveFindingId("");
        }
      }
    };
    void sync();
    const onRoute = () => { void sync(); };
    window.addEventListener("popstate", onRoute);
    return () => { cancelled = true; window.removeEventListener("popstate", onRoute); };
  }, []);

  const activeRecommendation = useMemo(() => {
    const exact = recommendedParts.find((item) => item.findingId === activeFindingId);
    if (exact) return exact;
    const byName = recommendedParts.find((item) => normalizeText(item.name) === normalizeText(q));
    return byName || null;
  }, [recommendedParts, activeFindingId, q]);

  async function resolveVinFromReference() {
    const reference = vehicleRef.trim();
    setResolvedPlate(null);
    if (!reference) return "";

    if (looksLikeVin(reference)) return normalizeVin(reference);

    const plate = normalizePlate(reference);
    if (plate.length < 4) throw new Error("Введіть коректний VIN або держномер автомобіля.");

    const response = await fetch(`/api/vehicles?q=${encodeURIComponent(reference)}&limit=50`, { cache: "no-store" });
    const data = await response.json().catch(() => null) as { vehicles?: VehicleDirectoryItem[]; error?: string } | null;
    if (!response.ok) throw new Error(data?.error || "Не вдалося перевірити держномер у базі CRM.");

    const candidates = Array.isArray(data?.vehicles) ? data.vehicles : [];
    const exact = candidates.find((item) => normalizePlate(item.plateNumber || "") === plate);
    if (!exact) throw new Error("Авто з таким держномером не знайдено в CRM.");
    if (!exact.vin) throw new Error("Авто знайдено, але VIN не заповнений. Додайте VIN у картку автомобіля для точного підбору.");

    const resolvedVin = normalizeVin(exact.vin);
    if (resolvedVin.length !== 17) throw new Error("Авто знайдено, але VIN у картці некоректний. Перевірте VIN автомобіля.");

    setResolvedPlate(exact.plateNumber || reference.toUpperCase());
    return resolvedVin;
  }

  async function search() {
    const query = q.trim();
    if (query.length < 2) return setMessage("Введіть щонайменше 2 символи назви або артикулу деталі.");

    setBusy(true);
    setSelectionResult(null);
    try {
      const resolvedVin = await resolveVinFromReference();
      const params = new URLSearchParams({ q: query });
      if (resolvedVin) params.set("vin", resolvedVin);

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
    } catch (error) {
      setParts([]);
      setVehicle(null);
      setOffers([]);
      setSupplierProviders([]);
      setConfiguredSuppliers([]);
      setMessage(error instanceof Error ? error.message : "Каталог тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  async function selectOffer(offer: SupplierOffer) {
    const route = readCrmRoute();
    const finding = activeRecommendation;
    if (!route.diagnosticId || !finding) {
      setMessage("Оберіть рекомендовану деталь із Діагностичної карти перед збереженням пропозиції.");
      return;
    }
    const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`;
    setSelectingOffer(key);
    setMessage("");
    try {
      const response = await fetch("/api/parts-selection/select", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnosticId: route.diagnosticId,
          findingId: finding.findingId,
          supplierId: offer.supplierId,
          externalProductId: offer.externalProductId,
          article: offer.article,
        }),
      });
      const body = await response.json().catch(() => null) as ({ ok?: boolean; error?: string; message?: string } & Partial<SelectionResult>) | null;
      if (!response.ok || !body?.ok || !body.workOrderId || !body.partsRequestId || !body.selected) {
        throw new Error(body?.message || body?.error || "Не вдалося зберегти вибрану деталь.");
      }
      const result = body as unknown as SelectionResult;
      setSelectionResult(result);
      setMessage(`Обрано ${result.selected.supplierName}: ${result.selected.article}. Ціну та постачальника збережено у чернетці КП.`);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося зберегти вибрану деталь.");
    } finally {
      setSelectingOffer("");
    }
  }

  const providerErrors = supplierProviders.filter((provider) => !provider.ok);
  const referenceHint = !vehicleRef.trim()
    ? "Необов’язково. За держномером CRM автоматично підтягне VIN з картки авто"
    : looksLikeVin(vehicleRef)
      ? "VIN · 17/17"
      : "Держномер · VIN буде знайдено в CRM";

  return <div className={styles.page}>
    <div className={styles.head}>
      <div><p>TURBO LEV · PARTS INTELLIGENCE</p><h1>Підбір запчастин</h1></div>
      <span className={styles.badge}>VIN / ДЕРЖНОМЕР + SUPPLIER API</span>
    </div>

    {diagnosticCardContext && recommendedParts.length > 0 && <section className={styles.panel}>
      <div className={styles.head}><div><p>З ДІАГНОСТИЧНОЇ КАРТИ</p><h2>Потрібно по цьому авто</h2></div><span className={styles.badge}>{recommendedParts.length}</span></div>
      <div className={styles.grid}>{recommendedParts.map((item) => <button type="button" className={styles.card} key={`${item.findingId}:${item.name}`} onClick={() => { setActiveFindingId(item.findingId); setQ(item.name); setOffers([]); setSelectionResult(null); }}><div className={styles.cardTop}><b>{item.name}</b><span>{item.findingId === activeFindingId ? "ОБРАНО" : "ПІДІБРАТИ"}</span></div><small>Рекомендація з підтвердженої діагностики</small></button>)}</div>
    </section>}

    {selectionResult && <section className={styles.panel}>
      <div className={styles.head}><div><p>ЗБЕРЕЖЕНО В КОМЕРЦІЙНОМУ ПРОЦЕСІ</p><h2>{selectionResult.selected.brand ? `${selectionResult.selected.brand} · ${selectionResult.selected.article}` : selectionResult.selected.article}</h2></div><span className={styles.badge}>ГОТОВО</span></div>
      <div className={styles.vehicleMeta}><span>Постачальник: {selectionResult.selected.supplierName}</span><span>Закупка: {formatMoney(selectionResult.selected.purchasePrice, selectionResult.selected.currency)}</span><span>Націнка: {selectionResult.selected.markupPercent}%</span><span>Продаж: {formatMoney(selectionResult.selected.sellPrice, selectionResult.selected.currency)}</span></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button className={styles.primary} type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: selectionResult.workOrderId, workOrderTab: "estimate" })}>Відкрити КП</button><button type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: selectionResult.workOrderId, workOrderTab: "parts" })}>Відкрити запчастини ЗН</button></div>
    </section>}

    <section className={styles.panel}>
      <div className={styles.contextGrid}>
        <label className={styles.field}><span>VIN або держномер</span><input value={vehicleRef} onChange={(e) => { setVehicleRef(e.target.value.toUpperCase()); setResolvedPlate(null); }} placeholder="VIN або номер авто" /><small>{referenceHint}</small></label>
        <label className={styles.field}><span>Що шукаємо</span><input value={q} onChange={(e) => { setQ(e.target.value); setSelectionResult(null); }} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Артикул або назва: 115 906, колодки…" /></label>
        <button className={styles.primary} type="button" onClick={search} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button>
      </div>

      {vehicle && <div className={styles.vehicleCard}>
        <div><small>{resolvedPlate ? `АВТО ПО ДЕРЖНОМЕРУ · ${resolvedPlate}` : "АВТО ПО VIN"}</small><strong>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.vin}</strong><span>{vehicle.vin}</span></div>
        <div className={styles.vehicleMeta}>{vehicle.engineVolumeL && <span>{vehicle.engineVolumeL} л</span>}{vehicle.engine && <span>{vehicle.engine}</span>}{vehicle.fuelType && <span>{vehicle.fuelType}</span>}{vehicle.generation?.name && <span>{vehicle.generation.name}</span>}</div>
        <div className={styles.confidence}><small>Довіра до авто</small><b>{vehicle.confidence ?? 0}%</b><span>{vehicle.source ?? "VIN decoder"}</span></div>
      </div>}

      <div className={styles.note}>{message}</div>
      <div className={styles.guard}><b>Hard Gate сумісності:</b> ціна та наявність у постачальника не означають, що деталь підходить до конкретного VIN. Замовлення розблоковується тільки після OEM/API підтвердження застосовності.</div>

      <section className={supplierStyles.supplierBlock}>
        <div className={supplierStyles.supplierHead}>
          <div><strong>Пропозиції постачальників</strong><span>Живі закупівельні ціни, націнка, продаж і складські залишки</span></div>
          <span className={supplierStyles.providerCount}>{configuredSuppliers.length} API налаштовано</span>
        </div>

        {!configuredSuppliers.length ? <div className={supplierStyles.supplierEmpty}>API-доступи ще не додані на сервер CRM. Відкрийте <b>Налаштування → Постачальники</b>: там видно, який доступ потрібен для BM Parts, Юнік Трейд та Автонова-Д.</div> : null}
        {configuredSuppliers.length > 0 && !offers.length && !busy ? <div className={supplierStyles.supplierEmpty}>У підключених постачальників за цим запитом пропозицій не знайдено.</div> : null}

        {offers.length ? <div className={supplierStyles.tableWrap}><table className={supplierStyles.offerTable}>
          <thead><tr><th>Постачальник</th><th>Деталь</th><th>Закупівля</th><th>Націнка</th><th>Продаж</th><th>Залишок</th>{diagnosticCardContext ? <th>Дія</th> : null}</tr></thead>
          <tbody>{offers.map((offer, index) => {
            const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`;
            return <tr key={`${offer.supplierId}-${offer.externalProductId ?? offer.article}-${index}`}>
              <td><div className={supplierStyles.offerSupplier}><strong>{offer.supplierName}</strong><span>{offer.available ? "в наявності" : "уточнити"}</span></div></td>
              <td><div className={supplierStyles.offerName}><strong>{offer.brand ? `${offer.brand} · ${offer.article}` : offer.article}</strong><span>{offer.name}</span></div></td>
              <td className={supplierStyles.offerPrice}>{formatMoney(offer.purchasePrice, offer.currency)}</td>
              <td>{offer.markupPercent != null ? `${offer.markupPercent}%` : "—"}</td>
              <td className={supplierStyles.offerPrice}>{formatMoney(offer.sellPrice, offer.currency)}</td>
              <td>{offer.stock.length ? <div className={supplierStyles.stockList}>{offer.stock.slice(0, 3).map((stock, stockIndex) => <span key={`${stock.warehouse}-${stockIndex}`}>{stock.warehouse}: <b>{stock.quantity}</b></span>)}</div> : <span className={supplierStyles.stockEmpty}>немає даних</span>}</td>
              {diagnosticCardContext ? <td><button type="button" className={styles.primary} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key || !activeRecommendation} onClick={() => void selectOffer(offer)}>{selectingOffer === key ? "Зберігаю…" : "Обрати"}</button></td> : null}
            </tr>;
          })}</tbody>
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
