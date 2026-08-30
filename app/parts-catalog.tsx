"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm, readCrmRoute } from "./crm-route";
import styles from "./parts-catalog.module.css";

type SearchMode = "VIN" | "PART_NUMBER" | "TEXT";

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
  pricing?: { vehicleTypeLabel?: string; coefficient?: number; source?: string } | null;
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
type SupplierStatus = { id: string; name: string; configured: boolean; state: string; setupHint?: string };
type DiagnosticRecommendation = {
  findingId: string;
  name: string;
  position: string | null;
  section: string;
  checkName: string;
  action: string;
  urgency: string;
  workName: string | null;
};
type DiagnosticPartsPayload = {
  ok?: boolean;
  inspections?: Array<{ templateName?: string; sections?: Array<{ name?: string; items?: Array<{ name?: string; position?: string | null; finding?: { id?: string; action?: string; urgency?: string; suggestedWorkName?: string | null; suggestedPartName?: string | null } | null }> }> }>;
};
type SelectionResult = {
  workOrderId: string;
  workOrderLineId: string;
  partsRequestId: string;
  findingId: string;
  searchMode: SearchMode;
  manualConfirmationRequired?: boolean;
  selected: { supplierName: string; article: string; brand: string | null; purchasePrice: number; markupPercent: number; sellPrice: number; currency: string; quantity?: number };
  labor?: { status?: string; message?: string; service?: string; pricing?: { basePrice?: number; total?: number; coefficient?: number; coefficientApplied?: boolean; pricingVehicleTypeLabel?: string; customerPartsLaborPercent?: number } };
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

function looksLikePartNumber(value: string) {
  const compact = value.trim().replace(/\s+/g, "");
  return compact.length >= 3 && /\d/.test(compact) && /^[A-ZА-ЯІЇЄҐ0-9._/-]+$/i.test(compact);
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

function searchModeLabel(mode: SearchMode) {
  if (mode === "VIN") return "ПІДБІР ЗА VIN";
  if (mode === "PART_NUMBER") return "ПОШУК ЗА НОМЕРОМ ДЕТАЛІ";
  return "ПОШУК ЗА НАЗВОЮ";
}

function supplierStateLabel(state: string) {
  if (state === "CONNECTED") return "з’єднання перевірено";
  if (state === "CONFIGURED") return "доступ збережено";
  if (state === "MANUAL_SETUP") return "потрібне API-підключення";
  if (state === "ERROR") return "помилка з’єднання";
  return "не налаштовано";
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
  const [supplierStatuses, setSupplierStatuses] = useState<SupplierStatus[]>([]);
  const [recommendedParts, setRecommendedParts] = useState<DiagnosticRecommendation[]>([]);
  const [activeFindingId, setActiveFindingId] = useState("");
  const [partQuantity, setPartQuantity] = useState("1");
  const [searchMode, setSearchMode] = useState<SearchMode>("TEXT");
  const [manualConfirmation, setManualConfirmation] = useState(false);
  const [markupPercent, setMarkupPercent] = useState<number | null>(null);
  const [diagnosticCardContext, setDiagnosticCardContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectingOffer, setSelectingOffer] = useState("");
  const [selectionResult, setSelectionResult] = useState<SelectionResult | null>(null);
  const [message, setMessage] = useState("Введіть VIN або держномер, потім назву чи номер деталі.");

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
          const finding = item.finding;
          const name = finding?.suggestedPartName?.trim();
          const findingId = finding?.id?.trim();
          return name && findingId ? [{
            findingId,
            name,
            position: item.position?.trim() || null,
            section: section.name?.trim() || inspection.templateName?.trim() || "Діагностика",
            checkName: item.name?.trim() || "Пункт перевірки",
            action: finding?.action || "NONE",
            urgency: finding?.urgency || "INFO",
            workName: finding?.suggestedWorkName?.trim() || null,
          }] : [];
        })));
        if (cancelled) return;
        setRecommendedParts(recommendations);
        setQ((current) => current.trim() ? current : recommendations[0]?.name || "");
        setActiveFindingId((current) => current && recommendations.some((item) => item.findingId === current) ? current : recommendations[0]?.findingId || "");
        if (recommendations.length) setMessage(`Із Діагностичної карти передано ${recommendations.length} окремих позицій. Одна позиція відповідає одному виявленню.`);
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
    setVehicle((current) => current || { vin: resolvedVin, make: exact.brand, model: exact.model, year: exact.year, confidence: 100, source: "CRM" });
    return resolvedVin;
  }

  async function search() {
    const query = q.trim();
    if (query.length < 2) {
      setMessage("Введіть щонайменше 2 символи назви або номера деталі.");
      return;
    }
    setBusy(true);
    setSelectionResult(null);
    setManualConfirmation(false);
    try {
      const resolvedVin = await resolveVinFromReference();
      const mode: SearchMode = resolvedVin ? "VIN" : looksLikePartNumber(query) ? "PART_NUMBER" : "TEXT";
      setSearchMode(mode);
      const params = new URLSearchParams({ q: query, searchMode: mode });
      if (resolvedVin) params.set("vin", resolvedVin);

      const [referenceResult, supplierResult] = await Promise.allSettled([
        fetch(`/api/parts/search?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/parts/suppliers?${params.toString()}`, { cache: "no-store" }),
      ]);

      if (referenceResult.status === "fulfilled") {
        const data = await referenceResult.value.json();
        setParts(Array.isArray(data.parts) ? data.parts : []);
        setVehicle((current) => data.vehicle ? { ...data.vehicle, pricing: data.pricing || null } : current);
        setMessage(data.fitmentPolicy?.message ?? "Пошук завершено.");
      } else {
        setParts([]);
        setMessage("Довідковий каталог тимчасово недоступний.");
      }

      if (supplierResult.status === "fulfilled") {
        const supplierData = await supplierResult.value.json();
        setOffers(Array.isArray(supplierData.offers) ? supplierData.offers : []);
        setSupplierProviders(Array.isArray(supplierData.providers) ? supplierData.providers : []);
        setConfiguredSuppliers(Array.isArray(supplierData.configuredSuppliers) ? supplierData.configuredSuppliers : []);
        setSupplierStatuses(Array.isArray(supplierData.supplierStatuses || supplierData.suppliers) ? (supplierData.supplierStatuses || supplierData.suppliers) : []);
        const nextMarkup = Number(supplierData.pricing?.defaultMarkupPercent);
        setMarkupPercent(Number.isFinite(nextMarkup) ? nextMarkup : null);
      } else {
        setOffers([]);
        setSupplierProviders([]);
        setConfiguredSuppliers([]);
        setSupplierStatuses([]);
      }
    } catch (error) {
      setParts([]);
      setVehicle(null);
      setOffers([]);
      setConfiguredSuppliers([]);
      setSupplierProviders([]);
      setSupplierStatuses([]);
      setMessage(error instanceof Error ? error.message : "Каталог тимчасово недоступний.");
    } finally {
      setBusy(false);
    }
  }

  async function selectOffer(offer: SupplierOffer) {
    const route = readCrmRoute();
    const finding = activeRecommendation;
    if (!route.diagnosticId || !finding) {
      setMessage("Оберіть конкретну рекомендовану деталь із Діагностичної карти перед збереженням.");
      return;
    }
    if (searchMode !== "VIN" && !manualConfirmation) {
      setMessage("Поставте ручне підтвердження: пошук виконано без підтвердженого VIN.");
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
          quantity: Math.max(1, Math.min(100, Number(partQuantity) || 1)),
          searchMode,
          vehicleVin: vehicle?.vin || (searchMode === "VIN" ? normalizeVin(vehicleRef) : null),
          manualConfirmation: searchMode === "VIN" || manualConfirmation,
        }),
      });
      const body = await response.json().catch(() => null) as ({ ok?: boolean; error?: string; message?: string } & Partial<SelectionResult>) | null;
      if (!response.ok || !body?.ok || !body.workOrderId || !body.partsRequestId || !body.selected) {
        throw new Error(body?.message || body?.error || "Не вдалося зберегти вибрану деталь.");
      }
      const result = body as unknown as SelectionResult;
      setSelectionResult(result);
      setMessage(`Збережено окрему позицію ${result.selected.supplierName}: ${result.selected.article}. Роботу заміни перевірено та додано з прайс-листа.`);
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося зберегти вибрану деталь.");
    } finally {
      setSelectingOffer("");
    }
  }

  const providerErrors = supplierProviders.filter((provider) => !provider.ok);
  const referenceHint = !vehicleRef.trim()
    ? "Без VIN кожен вибір потребує ручного підтвердження"
    : looksLikeVin(vehicleRef)
      ? "VIN · 17 символів · пріоритетний пошук"
      : "Держномер · CRM спочатку знайде VIN у картці авто";
  const actionBlocked = searchMode !== "VIN" && !manualConfirmation;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TURBO LEV · PARTS WORKSPACE</p>
        <h1>Підбір деталей</h1>
        <span className={styles.subtitle}>Одна рекомендація — одна окрема позиція з власним постачальником, місцем і ціною.</span>
      </div>
      <div className={styles.headerMeta}><span className={styles.badge}>1 · АВТО</span><span className={styles.badge}>2 · ДЕТАЛЬ</span><span className={styles.badge}>3 · ПОСТАЧАЛЬНИК</span><span className={styles.badge}>4 · КП</span></div>
    </header>

    {diagnosticCardContext && <section className={`${styles.panel} ${styles.diagnosticPanel}`}>
      <div className={styles.sectionHead}><div><p className={styles.eyebrow}>КОНТЕКСТ ДІАГНОСТИЧНОЇ КАРТИ</p><h2>Потрібні деталі по виявленнях</h2></div><span className={styles.countBadge}>{recommendedParts.length}</span></div>
      {!recommendedParts.length ? <div className={styles.empty}>У підтвердженій Діагностичній карті ще немає рекомендованих деталей.</div> : <div className={styles.recommendationList}>{recommendedParts.map((item, index) => <button type="button" className={`${styles.recommendation} ${item.findingId === activeFindingId ? styles.recommendationActive : ""}`} key={`${item.findingId}-${index}`} onClick={() => { setActiveFindingId(item.findingId); setQ(item.name); setOffers([]); setSelectionResult(null); setManualConfirmation(false); }}><div className={styles.recommendationTop}><span className={styles.step}>{String(index + 1).padStart(2, "0")}</span><strong>{item.name}</strong><span className={styles.recommendationAction}>{item.findingId === activeFindingId ? "ОБРАНО" : "ПІДІБРАТИ"}</span></div><span className={styles.location}>Місце: {item.position || item.section || "не вказано"} · {item.checkName}</span><span className={styles.recommendationMeta}>Дія: {item.action} · Терміновість: {item.urgency}{item.workName ? ` · Робота: ${item.workName}` : " · Робота заміни не прив’язана"}</span></button>)}</div>}
      {activeRecommendation && <div className={styles.selectionToolbar}><label className={styles.field}><span>Кількість</span><input type="number" min="1" max="100" step="1" value={partQuantity} onChange={(event) => setPartQuantity(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))} /></label><span className={styles.toolbarHint}>Вибирайте постачальника окремо для цієї позиції. Однакові деталі між постачальниками не об’єднуються.</span></div>}
    </section>}

    {selectionResult && <section className={`${styles.panel} ${styles.successPanel}`}>
      <div className={styles.sectionHead}><div><p className={styles.eyebrow}>ЗБЕРЕЖЕНО В КОМЕРЦІЙНОМУ ПРОЦЕСІ</p><h2>{selectionResult.selected.brand ? `${selectionResult.selected.brand} · ${selectionResult.selected.article}` : selectionResult.selected.article}</h2></div><span className={styles.successBadge}>ГОТОВО</span></div>
      <div className={styles.dataGrid}><span><small>Постачальник</small><b>{selectionResult.selected.supplierName}</b></span><span><small>Закупівля</small><b>{formatMoney(selectionResult.selected.purchasePrice, selectionResult.selected.currency)}</b></span><span><small>Націнка CRM</small><b>{selectionResult.selected.markupPercent}%</b></span><span><small>Продаж</small><b>{formatMoney(selectionResult.selected.sellPrice, selectionResult.selected.currency)}</b></span></div>
      {selectionResult.labor && <div className={selectionResult.labor.status === "ADDED" ? styles.laborResult : styles.laborWarning}><strong>{selectionResult.labor.status === "ADDED" ? "Роботу заміни додано автоматично" : "Роботу заміни потрібно перевірити"}</strong><span>{selectionResult.labor.service || selectionResult.labor.message}</span>{selectionResult.labor.pricing && <small>{selectionResult.labor.pricing.basePrice} грн база · коефіцієнт {selectionResult.labor.pricing.coefficient} · {selectionResult.labor.pricing.total} грн у КП</small>}</div>}
      <div className={styles.actions}><button className={styles.primary} type="button" onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: selectionResult.workOrderId, workOrderTab: "estimate" })}>Відкрити КП</button><button type="button" className={styles.secondary} onClick={() => navigateCrm("Комерційна пропозиція", { workOrderId: selectionResult.workOrderId, workOrderTab: "parts" })}>Відкрити деталі КП</button></div>
    </section>}

    <div className={styles.workspace}>
      <main className={styles.mainColumn}>
        <section className={`${styles.panel} ${styles.searchPanel}`}>
          <div className={styles.sectionHead}><div><p className={styles.eyebrow}>КРОК 1 · ІДЕНТИФІКАЦІЯ</p><h2>Знайти деталь для конкретного авто</h2></div><span className={styles.modeBadge}>{searchModeLabel(searchMode)}</span></div>
          <div className={styles.searchGrid}>
            <label className={styles.field}><span>VIN або держномер</span><input value={vehicleRef} onChange={(event) => { setVehicleRef(event.target.value.toUpperCase()); setResolvedPlate(null); setVehicle(null); setSearchMode("TEXT"); setManualConfirmation(false); }} placeholder="VIN або номер авто" /><small>{referenceHint}</small></label>
            <label className={styles.field}><span>Номер або назва деталі</span><input value={q} onChange={(event) => { setQ(event.target.value); setSelectionResult(null); }} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="115 906 · колодки · опора КПП" /><small>Пошук: VIN → номер деталі → назва</small></label>
            <button className={styles.primary} type="button" onClick={() => void search()} disabled={busy}>{busy ? "Шукаю…" : "Знайти"}</button>
          </div>

          {vehicle && <div className={styles.vehicleCard}>
            <div className={styles.vehicleIdentity}><span className={styles.cardEyebrow}>{resolvedPlate ? `АВТО ЗА ДЕРЖНОМЕРОМ · ${resolvedPlate}` : "АВТО ЗА VIN"}</span><strong>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль"}</strong><span className={styles.vin}>{vehicle.vin || "VIN не повернуто"}</span></div>
            <div className={styles.vehicleTags}>{vehicle.engineVolumeL && <span>{vehicle.engineVolumeL} л</span>}{vehicle.engine && <span>{vehicle.engine}</span>}{vehicle.fuelType && <span>{vehicle.fuelType}</span>}{vehicle.generation?.name && <span>{vehicle.generation.name}</span>}</div>
            <div className={styles.vehicleClass}><small>Клас авто CRM</small><b>{vehicle.pricing?.vehicleTypeLabel || "визначається CRM"}</b><span>Коефіцієнт: {vehicle.pricing?.coefficient ?? "—"}</span></div>
          </div>}

          <div className={styles.note}>{message}</div>
          <div className={styles.guard}><b>Контроль сумісності:</b> ціна або залишок постачальника не є доказом застосовності. До КП зберігається конкретна пропозиція; замовлення дозволяється лише після підтвердження сумісності OEM/API.</div>
        </section>

        <section className={`${styles.panel} ${styles.offersPanel}`}>
          <div className={styles.sectionHead}><div><p className={styles.eyebrow}>КРОК 2 · ПОРІВНЯННЯ</p><h2>Пропозиції постачальників</h2></div><span className={styles.countBadge}>{offers.length}</span></div>
          <p className={styles.sectionDescription}>Кожна картка — окрема пропозиція. Назва деталі, місце встановлення та постачальник зберігаються окремо.</p>

          <div className={styles.providerStrip}>{supplierStatuses.map((supplier) => <span key={supplier.id} className={supplier.configured ? styles.providerConfigured : styles.providerNotConfigured}><b>{supplier.name}</b><small>{supplierStateLabel(supplier.state)}</small></span>)}</div>
          {!configuredSuppliers.length && <div className={styles.emptyState}><strong>0 API налаштовано</strong><span>Доданий постачальник у довіднику ще не означає підключений API. Перевірте BM Parts та Юнітрейд у Налаштування → Інтеграції → Постачальники.</span></div>}
          {configuredSuppliers.length > 0 && !offers.length && !busy && <div className={styles.emptyState}><strong>За запитом пропозицій не знайдено</strong><span>Змініть номер/назву деталі або перевірте доступи постачальників. Немає фіктивних пропозицій — CRM показує лише відповідь інтеграції.</span></div>}

          {offers.length > 0 && <div className={styles.offerList}>{offers.map((offer, index) => {
            const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`;
            const stock = (offer.stock || []).slice(0, 3);
            return <article className={styles.offerCard} key={`${key}-${index}`}>
              <div className={styles.offerHeader}><div><span className={styles.cardEyebrow}>ПОСТАЧАЛЬНИК</span><strong>{offer.supplierName}</strong><small className={offer.available ? styles.available : styles.unavailable}>{offer.available ? "В наявності / можна перевірити" : "Наявність потребує уточнення"}</small></div><span className={styles.offerNumber}>#{String(index + 1).padStart(2, "0")}</span></div>
              <div className={styles.offerIdentity}><strong>{offer.brand ? `${offer.brand} · ` : ""}{offer.article}</strong><span>{offer.name}</span><small>Деталь: {activeRecommendation?.name || q} · Місце: {activeRecommendation?.position || activeRecommendation?.section || "не вказано"}</small></div>
              <div className={styles.offerData}><span><small>Закупівля</small><b>{formatMoney(offer.purchasePrice, offer.currency)}</b></span><span><small>Націнка CRM</small><b>{offer.markupPercent != null ? `${offer.markupPercent}%` : "—"}</b></span><span><small>Продаж</small><b>{formatMoney(offer.sellPrice, offer.currency)}</b></span></div>
              <div className={styles.offerFooter}><div className={styles.stockList}>{stock.length ? stock.map((row, stockIndex) => <span key={`${row.warehouse}-${stockIndex}`}>{row.warehouse}: <b>{row.quantity}</b></span>) : <span>Складські залишки не передані</span>}</div>{diagnosticCardContext ? <button type="button" className={styles.primarySmall} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key || !activeRecommendation || actionBlocked} onClick={() => void selectOffer(offer)}>{selectingOffer === key ? "Зберігаю…" : actionBlocked ? "Потрібне підтвердження" : "Додати окремо"}</button> : <span className={styles.mutedAction}>Відкрийте з Діагностичної карти</span>}</div>
            </article>;
          })}</div>}
          {providerErrors.length > 0 && <div className={styles.warning}>Не всі API відповіли: {providerErrors.map((provider) => `${provider.id}${provider.message ? ` — ${provider.message}` : ""}`).join("; ")}</div>}
        </section>

        {parts.length > 0 && <section className={`${styles.panel} ${styles.referencePanel}`}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>ДОВІДКОВИЙ РЕЗУЛЬТАТ</p><h2>Каталог без комерційного підтвердження</h2></div><span className={styles.modeBadge}>НЕ СУМІСНІСТЬ</span></div><div className={styles.referenceList}>{parts.map((part, index) => <div className={styles.referenceRow} key={`${part.slug ?? part.name}-${index}`}><strong>{part.name ?? "Деталь"}</strong><span>{part.category || part.slug || "Довідник"}</span><small>{part.fitment?.reason || "Потрібне підтвердження OEM/API."}</small></div>)}</div></section>}
      </main>

      <aside className={styles.sidebar}>
        <section className={`${styles.panel} ${styles.summaryPanel}`}><p className={styles.eyebrow}>КРОК 3 · ПІДТВЕРДЖЕННЯ</p><h2>Поточна позиція</h2>{activeRecommendation ? <><strong className={styles.summaryPart}>{activeRecommendation.name}</strong><span className={styles.summaryLocation}>Місце: {activeRecommendation.position || activeRecommendation.section || "не вказано"}</span><span className={styles.summaryLocation}>Виявлення: {activeRecommendation.checkName}</span><span className={styles.summaryLocation}>Робота: {activeRecommendation.workName || "не прив’язана"}</span></> : <div className={styles.empty}>Оберіть позицію з Діагностичної карти.</div>}<div className={styles.divider}/><div className={styles.rule}><span>Режим пошуку</span><b>{searchModeLabel(searchMode)}</b></div><div className={styles.rule}><span>Націнка деталей</span><b>{markupPercent == null ? "з налаштувань CRM" : `${markupPercent}%`}</b></div><div className={styles.rule}><span>Авто-клас</span><b>{vehicle?.pricing?.vehicleTypeLabel || "визначає CRM"}</b></div></section>

        {searchMode !== "VIN" && <section className={`${styles.panel} ${styles.confirmPanel}`}><p className={styles.eyebrow}>ОБОВ’ЯЗКОВА ДІЯ</p><h2>Ручне підтвердження</h2><label className={styles.confirmRow}><input type="checkbox" checked={manualConfirmation} onChange={(event) => setManualConfirmation(event.target.checked)} /><span>Підтверджую, що обрана пропозиція відповідає цьому автомобілю та виявленню.</span></label><small>VIN не підтверджено, тому кнопка додавання заблокована до ручного підтвердження.</small></section>}

        <section className={`${styles.panel} ${styles.logicPanel}`}><p className={styles.eyebrow}>ЛОГІКА ЦІНИ</p><h2>Що потрапляє в КП</h2><div className={styles.logicRow}><span>Деталь</span><b>закупівля × (1 + націнка CRM)</b></div><div className={styles.logicRow}><span>Робота</span><b>прайс × коефіцієнт, якщо прапорець увімкнений</b></div><div className={styles.logicRow}><span>Фіксована робота</span><b>без коефіцієнта</b></div><div className={styles.logicRow}><span>Деталь клієнта</span><b>+ націнка лише до роботи заміни</b></div></section>

        <section className={`${styles.panel} ${styles.providerPanel}`}><p className={styles.eyebrow}>ПІДКЛЮЧЕННЯ</p><h2>Постачальники</h2><span className={styles.providerTotal}>{configuredSuppliers.length} налаштовано</span><span className={styles.summaryLocation}>Архітектура підтримує додавання нових інтеграцій без зміни сторінки.</span><button type="button" className={styles.secondary} onClick={() => navigateCrm("Налаштування", { settingsTab: "integrations" })}>Відкрити інтеграції</button></section>
      </aside>
    </div>
  </div>;
}
