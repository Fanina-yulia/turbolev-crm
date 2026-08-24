"use client";

import { useEffect, useState } from "react";
import { readCrmRoute } from "./crm-route";
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
  stock: Array<{ warehouse: string; quantity: string }>;
  available: boolean;
  sourceUrl: string | null;
};

type SupplierProvider = { id: string; ok: boolean; message?: string };
type DiagnosticPartsPayload = {
  ok?: boolean;
  inspections?: Array<{ sections?: Array<{ items?: Array<{ finding?: { suggestedPartName?: string | null } | null }> }> }>;
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
  const [vehicleRef, setVehicleRef] = useState("");
  const [resolvedPlate, setResolvedPlate] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [supplierProviders, setSupplierProviders] = useState<SupplierProvider[]>([]);
  const [configuredSuppliers, setConfiguredSuppliers] = useState<string[]>([]);
  const [recommendedParts, setRecommendedParts] = useState<string[]>([]);
  const [diagnosticCardContext, setDiagnosticCardContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Введіть VIN або держномер автомобіля, якщо він є, і назву або артикул потрібної деталі.");

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const route = readCrmRoute();
      const reference = route.plate || route.vin || "";
      if (reference) setVehicleRef(reference.toUpperCase());
      if (!route.diagnosticId) {
        setRecommendedParts([]);
        setDiagnosticCardContext(false);
        return;
      }
      setDiagnosticCardContext(true);
      try {
        const response = await fetch(`/api/diagnostics/${encodeURIComponent(route.diagnosticId)}/structured`, { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null) as DiagnosticPartsPayload | null;
        if (!response.ok || !payload?.ok) return;
        const names = Array.from(new Set((payload.inspections || []).flatMap((inspection) => (inspection.sections || []).flatMap((section) => (section.items || []).flatMap((item) => {
          const name = item.finding?.suggestedPartName?.trim();
          return name ? [name] : [];
        })))));
        if (cancelled) return;
        setRecommendedParts(names);
        setQ((current) => current.trim() ? current : names[0] || "");
        if (names.length) setMessage(`З Діагностичної карти передано рекомендовані деталі: ${names.length}. Оберіть деталь для підбору.`);
      } catch {
        if (!cancelled) setRecommendedParts([]);
      }
    };
    void sync();
    const onRoute = () => { void sync(); };
    window.addEventListener("popstate", onRoute);
    return () => { cancelled = true; window.removeEventListener("popstate", onRoute); };
  }, []);

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
      <div className={styles.head}><div><p>З ДІАГНОСТИЧНОЇ КАРТИ</p><h2>Рекомендовані деталі</h2></div><span className={styles.badge}>{recommendedParts.length}</span></div>
      <div className={supplierStyles.offerGrid}>{recommendedParts.map((name) => <button type="button" key={name} onClick={() => setQ(name)}>{name}</button>)}</div>
    </section>}

    <section className={styles.panel}>
      <div className={styles.contextGrid}>
        <label className={styles.field}><span>VIN або держномер</span><input value={vehicleRef} onChange={(e) => { setVehicleRef(e.target.value.toUpperCase()); setResolvedPlate(null); }} placeholder="VIN або номер авто" /><small>{referenceHint}</small></label>
        <label className={styles.field}><span>Що шукаємо</span><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Артикул або назва: 115 906, колодки…" /></label>
        <button className={styles.primary} type="button" onClick={search} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button>
      </div>
      <p className={styles.message}>{message}</p>
      {resolvedPlate ? <p className={styles.message}>Автомобіль: {resolvedPlate}</p> : null}
    </section>

    {vehicle ? <section className={styles.panel}>
      <div className={styles.vehicleSummary}><strong>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</strong><span>{vehicle.engine || (vehicle.engineVolumeL ? `${vehicle.engineVolumeL} л` : "Двигун не визначено")}{vehicle.fuelType ? ` · ${vehicle.fuelType}` : ""}</span>{vehicle.generation?.name ? <span>{vehicle.generation.name}</span> : null}</div>
    </section> : null}

    {providerErrors.length ? <section className={styles.panel}><p className={styles.message}>Частина постачальників недоступна: {providerErrors.map((provider) => provider.message || provider.id).join(" · ")}</p></section> : null}
    {configuredSuppliers.length ? <section className={styles.panel}><p className={styles.message}>Підключені постачальники: {configuredSuppliers.join(", ")}</p></section> : null}

    {offers.length ? <section className={styles.panel}>
      <div className={styles.head}><div><p>ПОСТАЧАЛЬНИКИ</p><h2>Пропозиції</h2></div><span className={styles.badge}>{offers.length}</span></div>
      <div className={supplierStyles.offerGrid}>{offers.map((offer) => <article className={supplierStyles.offerCard} key={`${offer.supplierId}:${offer.externalProductId || offer.article}`}>
        <div className={supplierStyles.offerHead}><strong>{offer.brand ? `${offer.brand} · ` : ""}{offer.name}</strong><span>{offer.supplierName}</span></div>
        <code>{offer.article}</code>
        <b>{formatMoney(offer.purchasePrice, offer.currency)}</b>
        <small>{offer.available ? "Є в наявності" : "Наявність уточнюється"}</small>
        {offer.stock.length ? <p>{offer.stock.map((row) => `${row.warehouse}: ${row.quantity}`).join(" · ")}</p> : null}
      </article>)}</div>
    </section> : null}

    <section className={styles.panel}>
      <div className={styles.head}><div><p>ДОВІДНИК</p><h2>Каталог деталей</h2></div><span className={styles.badge}>{parts.length}</span></div>
      {parts.length ? <div className={styles.results}>{parts.map((part, index) => <article key={`${part.slug || part.name || "part"}-${index}`}><strong>{part.name || part.slug || "Деталь"}</strong>{part.category ? <span>{part.category}</span> : null}{part.description ? <p>{part.description}</p> : null}{part.fitment ? <small>{part.fitment.confirmed ? "✓ Сумісність підтверджена" : part.fitment.status || "Сумісність уточнюється"}{typeof part.fitment.confidence === "number" ? ` · ${part.fitment.confidence}%` : ""}</small> : null}</article>)}</div> : <p className={styles.message}>Поки немає результатів довідника.</p>}
    </section>
  </div>;
}
