"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkOrderListItemContract } from "@/src/lib/contracts/crm-core";
import { parseWorkOrderListPayload, parseWorkOrderNumbersPayload } from "@/src/lib/contracts/work-order-payload.parsers";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import { normalizePhone } from "@/src/lib/phone";
import { normalizeVin } from "@/src/domain/vin";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import { VehicleRender } from "./vehicle-render";
import styles from "./parts-catalog.module.css";

type Part = { name?: string; slug?: string; category?: string; description?: string; fitment?: { confidence?: number; reason?: string } };
type VehicleContext = { id?: string; vin?: string; make?: string | null; model?: string | null; year?: number | null; engine?: string | null; engineVolumeL?: number | null; fuelType?: string | null; mileageKm?: number | null; plateNumber?: string | null; confidence?: number; source?: string | null; label?: string | null; generation?: { name?: string } | null };
type SupplierOffer = { supplierId: string; supplierName: string; externalProductId: string | null; article: string; brand: string | null; name: string; purchasePrice: number | null; currency: string | null; multiplicity: number | null; stock: Array<{ warehouse: string; quantity: string; warehouseId?: string | null }>; available: boolean; sourceUrl: string | null; markupPercent?: number | null; sellPrice?: number | null };
type SupplierProvider = { id: string; ok: boolean; message?: string };
type Recommendation = { findingId: string; name: string; position: string; quantity: number; action: string; urgency: string; note: string; mediaCount: number };
type SelectedLine = { findingId: string; partName: string; supplierName: string; article: string; brand: string | null; purchasePrice: number; sellPrice: number; markupPercent: number; currency: string; quantity: number };
type WorkOrderRow = WorkOrderListItemContract;
type DiagnosticPickerRow = { id: string; number: number | null; status: string; statusLabel: string; updatedAt: string; client: { name: string | null; phone: string }; vehicle: { id: string; brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null; mileageKm: number | null; turboLevClass: string | null }; diagnosticRequest: { id: string; status: string } };
type ContextSummary = { workOrderId: string | null; orderNumber: string; clientName: string; clientPhone: string; vehicleId: string | null; vehicleName: string; plateNumber: string | null; vin: string | null; mileageKm: number | null; statusCode: string; statusLabel: string; engine: string | null };

type DiagnosticPartsPayload = {
  ok?: boolean;
  diagnostic?: { workOrder?: { id?: string; status?: string } | null; client?: { name?: string | null; phone?: string | null } | null; vehicle?: { id?: string; brand?: string | null; model?: string | null; year?: number | null; label?: string | null; plateNumber?: string | null; vin?: string | null; mileageKm?: number | null } | null };
  inspections?: Array<{ sections?: Array<{ name?: string; items?: Array<{ name?: string; position?: string | null; finding?: { id?: string; action?: string; urgency?: string; findingText?: string | null; suggestedPartName?: string | null; media?: unknown[] } | null }> }> }>;
};

function normalizePlate(value: string) { return normalizeRegistrationPlate(value); }
function looksLikeVin(value: string) { const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, ""); return compact.length === 17 && normalizeVin(value).length === 17; }
function normalizeText(value: string) { return value.trim().toLocaleLowerCase("uk-UA").replace(/\s+/g, " "); }
function formatMoney(value: number | null | undefined, currency: string | null | undefined) { if (value == null || !Number.isFinite(value)) return "—"; const normalizedCurrency = currency === "ГРН" ? "UAH" : currency || "UAH"; try { return new Intl.NumberFormat("uk-UA", { style: "currency", currency: normalizedCurrency, maximumFractionDigits: 2 }).format(value); } catch { return `${value.toFixed(2)} ${currency ?? ""}`.trim(); } }
function formatMileage(value: number | null | undefined) { return value == null ? "—" : `${new Intl.NumberFormat("uk-UA").format(value)} км`; }
function orderLabel(row: WorkOrderRow) { return formatWorkOrderNumber(row.number); }
function vehicleLabel(row: WorkOrderRow) { return [row.vehicle.brand, row.vehicle.model, row.vehicle.year].filter(Boolean).join(" ") || "Автомобіль"; }
function contextFromRow(row: WorkOrderRow): ContextSummary { return { workOrderId: row.id, orderNumber: orderLabel(row), clientName: row.client.name || "Клієнт не вказаний", clientPhone: row.client.phone, vehicleId: row.vehicle.id, vehicleName: vehicleLabel(row), plateNumber: row.vehicle.plateNumber, vin: row.vehicle.vin, mileageKm: row.vehicle.mileageKm, statusCode: row.status, statusLabel: row.statusLabel, engine: row.vehicle.turboLevClass }; }
function statusTone(status: string) { if (["IN_REPAIR", "READY_FOR_REPAIR", "WAITING_PARTS"].includes(status)) return styles.statusGreen; if (["WAITING_APPROVAL", "PARTS_REVIEW", "PAUSED", "REWORK"].includes(status)) return styles.statusAmber; return styles.statusNeutral; }

export function PartsCatalog() {
  const [route, setRoute] = useState<CrmRouteParams>(() => readCrmRoute());
  const [q, setQ] = useState("");
  const [vehicleRef, setVehicleRef] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [vehicle, setVehicle] = useState<VehicleContext | null>(null);
  const [context, setContext] = useState<ContextSummary | null>(null);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [supplierProviders, setSupplierProviders] = useState<SupplierProvider[]>([]);
  const [configuredSuppliers, setConfiguredSuppliers] = useState<string[]>([]);
  const [recommendedParts, setRecommendedParts] = useState<Recommendation[]>([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLine[]>([]);
  const [workOrderOptions, setWorkOrderOptions] = useState<WorkOrderRow[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [activeFindingId, setActiveFindingId] = useState("");
  const [activeTab, setActiveTab] = useState<"originals" | "analogs">("originals");
  const [busy, setBusy] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectingOffer, setSelectingOffer] = useState("");
  const [resolvedPlate, setResolvedPlate] = useState<string | null>(null);
  const [message, setMessage] = useState("Оберіть ремонтне замовлення або відкрийте підбір із Діагностичної карти.");

  useEffect(() => { const onRoute = () => setRoute(readCrmRoute()); window.addEventListener("popstate", onRoute); return () => window.removeEventListener("popstate", onRoute); }, []);

  async function loadWorkOrders() {
    setOrdersLoading(true);
    try {
      const response = await fetch("/api/work-orders?limit=200", { cache: "no-store", credentials: "include" });
      const payload = parseWorkOrderListPayload(await response.json().catch(() => null));
      if (!response.ok || !payload) throw new Error("Не вдалося завантажити ремонтні замовлення.");
      let numberMap = new Map<string, number>();
      if (payload.workOrders.length) {
        const numberResponse = await fetch(`/api/work-orders/numbers?ids=${encodeURIComponent(payload.workOrders.map((row) => row.id).join(","))}`, { cache: "no-store", credentials: "include" });
        const numberPayload = parseWorkOrderNumbersPayload(await numberResponse.json().catch(() => null));
        if (numberResponse.ok && numberPayload) numberMap = new Map(numberPayload.rows.map((item) => [item.workOrderId, item.number]));
      }
      const active = payload.workOrders.filter((row) => Boolean(row.diagnosticRequest?.id)).map((row) => ({ ...row, number: numberMap.get(row.id) ?? row.number })).sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
      setWorkOrderOptions(active);
      setMessage(active.length ? "Оберіть запис із Діагностичною картою. Статус кожного запису відображається окремо." : "Замовлень-нарядів із Діагностичною картою не знайдено.");
    } catch (error) { setWorkOrderOptions([]); setMessage(error instanceof Error ? error.message : "Не вдалося завантажити ремонтні замовлення."); } finally { setOrdersLoading(false); }
  }

  async function resolveVinFromReference(referenceValue: string) {
    const reference = referenceValue.trim(); setResolvedPlate(null); if (!reference) return ""; if (looksLikeVin(reference)) return normalizeVin(reference);
    const plate = normalizePlate(reference); if (plate.length < 4) throw new Error("Введіть коректний VIN або держномер автомобіля.");
    const response = await fetch(`/api/vehicles?q=${encodeURIComponent(reference)}&limit=50`, { cache: "no-store", credentials: "include" });
    const data = await response.json().catch(() => null) as { vehicles?: Array<{ plateNumber?: string | null; vin?: string | null }>; error?: string } | null;
    if (!response.ok) throw new Error(data?.error || "Не вдалося перевірити держномер у базі CRM.");
    const exact = (data?.vehicles || []).find((item) => normalizePlate(item.plateNumber || "") === plate); if (!exact) throw new Error("Авто з таким держномером не знайдено в CRM."); if (!exact.vin) throw new Error("Авто знайдено, але VIN не заповнений. Додайте VIN у картку автомобіля для точного підбору.");
    const resolvedVin = normalizeVin(exact.vin); if (resolvedVin.length !== 17) throw new Error("VIN у картці автомобіля некоректний."); setResolvedPlate(exact.plateNumber || reference.toUpperCase()); return resolvedVin;
  }

  async function searchPart(queryValue = q, referenceValue = vehicleRef) {
    const query = queryValue.trim(); if (query.length < 2) { setMessage("Введіть щонайменше 2 символи назви або артикулу деталі."); return; }
    setBusy(true);
    try {
      const resolvedVin = await resolveVinFromReference(referenceValue); const params = new URLSearchParams({ q: query }); if (resolvedVin) params.set("vin", resolvedVin);
      const [referenceResult, supplierResult] = await Promise.allSettled([fetch(`/api/parts/search?${params.toString()}`, { cache: "no-store", credentials: "include" }), fetch(`/api/parts/suppliers?q=${encodeURIComponent(query)}`, { cache: "no-store", credentials: "include" })]);
      if (referenceResult.status === "fulfilled") { const data = await referenceResult.value.json().catch(() => null) as { parts?: Part[]; vehicle?: VehicleContext | null; fitmentPolicy?: { message?: string } } | null; setParts(Array.isArray(data?.parts) ? data.parts : []); if (data?.vehicle) setVehicle(data.vehicle); setMessage(data?.fitmentPolicy?.message || (resolvedVin ? "Пошук виконано за VIN. Підтвердіть сумісність постачальником." : "Пошук виконано без VIN. Потрібне ручне підтвердження сумісності.")); } else { setParts([]); setMessage("Довідковий каталог тимчасово недоступний."); }
      if (supplierResult.status === "fulfilled") { const data = await supplierResult.value.json().catch(() => null) as { offers?: SupplierOffer[]; providers?: SupplierProvider[]; configuredSuppliers?: string[] } | null; setOffers(Array.isArray(data?.offers) ? data.offers : []); setSupplierProviders(Array.isArray(data?.providers) ? data.providers : []); setConfiguredSuppliers(Array.isArray(data?.configuredSuppliers) ? data.configuredSuppliers : []); } else { setOffers([]); setSupplierProviders([]); setConfiguredSuppliers([]); }
    } catch (error) { setParts([]); setVehicle(null); setOffers([]); setSupplierProviders([]); setConfiguredSuppliers([]); setMessage(error instanceof Error ? error.message : "Каталог тимчасово недоступний."); } finally { setBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      if (!route.diagnosticId) { setContext(null); setVehicle(null); setRecommendedParts([]); setSelectedLines([]); setActiveFindingId(""); setOffers([]); setParts([]); void loadWorkOrders(); return; }
      setContextLoading(true); setContext(null); setRecommendedParts([]); setSelectedLines([]); setOffers([]);
      try {
        const response = await fetch(`/api/diagnostics/${encodeURIComponent(route.diagnosticId)}/structured`, { cache: "no-store", credentials: "include" }); const payload = await response.json().catch(() => null) as DiagnosticPartsPayload | null; if (!response.ok || !payload?.ok || cancelled) throw new Error("Не вдалося завантажити Діагностичну карту.");
        const diagnostic = payload.diagnostic; const diagnosticVehicle = diagnostic?.vehicle;
        const recommendationRows = (payload.inspections || []).flatMap((inspection) =>
          (inspection.sections || []).flatMap((section) =>
            (section.items || []).flatMap((item) => {
              const finding = item.finding;
              if (!finding?.id) return [];
              const partName = finding.suggestedPartName?.trim() || (finding.action === "REPLACE" ? item.name?.trim() : "");
              if (!partName) return [];
              const recommendation: Recommendation = {
                findingId: finding.id,
                name: partName,
                position: item.position?.trim() || section.name?.trim() || "—",
                quantity: 1,
                action: finding.action || "REPLACE",
                urgency: finding.urgency || "INFO",
                note: finding.findingText?.trim() || "Зафіксовано в Діагностичній карті",
                mediaCount: Array.isArray(finding.media) ? finding.media.length : 0,
              };
              return [recommendation];
            }),
          ),
        );
        const nextReference = route.plate || route.vin || diagnosticVehicle?.vin || "";
        const nextContext: ContextSummary = { workOrderId: diagnostic?.workOrder?.id || route.workOrderId || null, orderNumber: route.workOrderNumber || "ЗН-—", clientName: diagnostic?.client?.name || "Клієнт не вказаний", clientPhone: diagnostic?.client?.phone || "—", vehicleId: diagnosticVehicle?.id || route.vehicleId || null, vehicleName: diagnosticVehicle?.label || [diagnosticVehicle?.brand, diagnosticVehicle?.model, diagnosticVehicle?.year].filter(Boolean).join(" ") || "Автомобіль", plateNumber: diagnosticVehicle?.plateNumber || route.plate || null, vin: diagnosticVehicle?.vin || route.vin || null, mileageKm: diagnosticVehicle?.mileageKm ?? null, statusCode: diagnostic?.workOrder?.status || "PARTS_REVIEW", statusLabel: diagnostic?.workOrder?.status || "Підбір деталей", engine: null };
        setContext(nextContext); setVehicle({ ...diagnosticVehicle, id: diagnosticVehicle?.id || route.vehicleId, vin: diagnosticVehicle?.vin || route.vin, plateNumber: diagnosticVehicle?.plateNumber || route.plate }); setVehicleRef(nextReference.toUpperCase()); setRecommendedParts(recommendationRows); const first = recommendationRows.find((item) => item.findingId === route.findingId) || recommendationRows[0]; setActiveFindingId(first?.findingId || ""); setQ((current) => current.trim() || first?.name || ""); setMessage(recommendationRows.length ? `Із Діагностичної карти передано ${recommendationRows.length} позицій. Оберіть постачальника.` : "У Діагностичній карті немає деталей, позначених до заміни."); if (first?.name) void searchPart(first.name, nextReference);
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Не вдалося завантажити Діагностичну карту."); } finally { if (!cancelled) setContextLoading(false); }
    };
    void loadContext(); return () => { cancelled = true; };
    // The route query is the page context and intentionally drives this loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.diagnosticId, route.findingId, route.plate, route.vehicleId, route.vin, route.workOrderId]);

  const activeRecommendation = useMemo(() => recommendedParts.find((item) => item.findingId === activeFindingId) || recommendedParts.find((item) => normalizeText(item.name) === normalizeText(q)) || null, [recommendedParts, activeFindingId, q]);
  const filteredOrders = useMemo(() => {
    const query = normalizeText(orderSearch);
    if (!query) return workOrderOptions;
    const digitsQuery = orderSearch.replace(/\D/g, "");
    const phoneQuery = normalizePhone(orderSearch);
    const plateQuery = normalizeRegistrationPlate(orderSearch);
    const vinQuery = normalizeVin(orderSearch);
    return workOrderOptions.filter((row) => {
      const text = [orderLabel(row), row.id, row.client.name, vehicleLabel(row)].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA");
      const phone = normalizePhone(row.client.phone);
      const phoneDigits = row.client.phone.replace(/\D/g, "");
      const plate = normalizeRegistrationPlate(row.vehicle.plateNumber || "");
      const vin = normalizeVin(row.vehicle.vin || "");
      return text.includes(query)
        || (digitsQuery.length >= 3 && phoneDigits.includes(digitsQuery))
        || (phoneQuery.length >= 3 && phone.includes(phoneQuery))
        || (plateQuery.length >= 3 && plate.includes(plateQuery))
        || (vinQuery.length >= 3 && vin.includes(vinQuery));
    });
  }, [orderSearch, workOrderOptions]);
  const selectedPurchaseTotal = selectedLines.reduce((sum, line) => sum + line.purchasePrice * line.quantity, 0);
  const selectedSellTotal = selectedLines.reduce((sum, line) => sum + line.sellPrice * line.quantity, 0);
  const providerErrors = supplierProviders.filter((provider) => !provider.ok);

  function openOrder(row: WorkOrderRow) { if (!row.id) { navigateCrm("Діагностика", { diagnosticId: row.diagnosticRequest.id }); return; } navigateCrm("Підбір запчастин", { diagnosticId: row.diagnosticRequest.id, workOrderId: row.id, workOrderNumber: orderLabel(row), vehicleId: row.vehicle.id, plate: row.vehicle.plateNumber || "", vin: row.vehicle.vin || "" }); }

  async function selectOffer(offer: SupplierOffer) {
    if (!route.diagnosticId || !activeRecommendation) { setMessage("Спочатку оберіть позицію з Діагностичної карти."); return; }
    const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`; setSelectingOffer(key);
    try {
      const response = await fetch("/api/parts-selection/select", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diagnosticId: route.diagnosticId, findingId: activeRecommendation.findingId, supplierId: offer.supplierId, externalProductId: offer.externalProductId, article: offer.article }) });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string; selected?: { supplierName: string; article: string; brand: string | null; purchasePrice: number; markupPercent: number; sellPrice: number; currency: string } } | null;
      if (!response.ok || !data?.ok || !data.selected) throw new Error(data?.message || data?.error || "Не вдалося зберегти вибрану деталь.");
      const selected = data.selected; setSelectedLines((current) => [...current.filter((line) => line.findingId !== activeRecommendation.findingId), { findingId: activeRecommendation.findingId, partName: activeRecommendation.name, supplierName: selected.supplierName, article: selected.article, brand: selected.brand, purchasePrice: selected.purchasePrice, sellPrice: selected.sellPrice, markupPercent: selected.markupPercent, currency: selected.currency, quantity: activeRecommendation.quantity }]); setMessage(`Позицію збережено: ${selected.supplierName} · ${selected.article}.`); window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не вдалося зберегти вибрану деталь."); } finally { setSelectingOffer(""); }
  }

  const referenceHint = !vehicleRef.trim() ? "VIN не вказаний · потрібне ручне підтвердження" : looksLikeVin(vehicleRef) ? "VIN · 17 символів" : `Держномер · VIN ${resolvedPlate ? "знайдено" : "буде знайдено в CRM"}`;

  if (!route.diagnosticId) return <div className={styles.page}><div className={styles.menuHeader}><div><p>РОЗДІЛ ЗАПЧАСТИН</p><h1>Підбір запчастин</h1><span>Оберіть ремонтне замовлення, щоб відкрити робочу область підбору.</span></div><span className={styles.headerBadge}>ВХІД ІЗ ГОЛОВНОГО МЕНЮ</span></div><section className={styles.orderPicker}><div className={styles.pickerHeader}><div><b>Ремонтні замовлення</b><span>Показані всі записи з прив’язаною Діагностичною картою, незалежно від поточного статусу.</span></div><strong>{workOrderOptions.length}</strong></div><label className={styles.orderSearch}><span>⌕</span><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); void loadWorkOrders(); }} placeholder="Пошук за № замовлення, клієнтом, телефоном, держномером або VIN" aria-keyshortcuts="Enter"/><button type="button" onClick={() => setOrderSearch("")} disabled={!orderSearch} aria-label="Очистити пошук">×</button></label>{ordersLoading ? <div className={styles.pickerEmpty}>Завантажую ремонтні замовлення…</div> : filteredOrders.length ? <div className={styles.orderList}>{filteredOrders.map((row) => <button type="button" className={styles.orderRow} key={row.diagnosticRequest.id} onClick={() => openOrder(row)}><span className={styles.orderNumber}>{orderLabel(row)}</span><span className={styles.orderIdentity}><b>{vehicleLabel(row)}</b><small>{row.vehicle.plateNumber || "Номер не вказаний"} · {row.client.name || "Клієнт не вказаний"}</small></span><span className={styles.orderNeed}><b>{row.statusLabel}</b><small>{row.diagnosticRequest.status === "CONFIRMED" ? "Діагностика підтверджена" : "Діагностика в роботі"}</small></span><span className={styles.orderArrow}>→</span></button>)}</div> : <div className={styles.pickerEmpty}>{message}<button type="button" onClick={() => void loadWorkOrders()}>Оновити список</button></div>}</section></div>;

  if (contextLoading || !context) return <div className={styles.page}><div className={styles.loadingPanel}><span className={styles.loadingCircle}>2</span><div><b>Завантажую контекст ремонту…</b><small>Підтягую автомобіль, клієнта та деталі з Діагностичної карти.</small></div></div></div>;

  return <div className={styles.page}><header className={styles.contextHeader}><button type="button" className={styles.backButton} onClick={() => navigateCrm("Підбір запчастин", {})} aria-label="Повернутися до вибору замовлення">←</button><div className={styles.orderContext}><small>Ремонтне замовлення</small><b>{context.orderNumber}</b></div><div className={styles.contextItem}><small>Клієнт</small><b>{context.clientName}</b></div><div className={styles.contextItem}><small>Телефон</small><b>{context.clientPhone}</b></div><div className={styles.contextItem}><small>Автомобіль</small><b>{context.vehicleName}</b><span>{context.plateNumber || "Номер не вказаний"}</span></div><div className={styles.contextItem}><small>Пробіг</small><b>{formatMileage(context.mileageKm)}</b></div><div className={styles.contextStatus}><small>Статус ЗН</small><b className={statusTone(context.statusCode)}><i/> {context.statusLabel}</b></div></header><div className={styles.columns}>
    <section className={`${styles.column} ${styles.needsColumn}`}><div className={styles.columnTitle}><span className={styles.step}>1</span><div><b>Крок 1 · Потреби</b><small>Що потрібно замінити за результатом діагностики</small></div></div><div className={styles.vehicleBlock}><div className={styles.sectionEyebrow}>АВТОМОБІЛЬ</div><div className={styles.vehicleOverview}>{context.vehicleId ? <VehicleRender id={context.vehicleId} brand={vehicle?.make} model={vehicle?.model} year={vehicle?.year} size="mini" eager className={styles.vehicleImage}/> : <div className={styles.vehicleFallback}>🚗</div>}<div><b>{context.vehicleName}</b><span>VIN <strong>{context.vin || "не вказаний"}</strong></span><span>Держномер <strong>{context.plateNumber || "не вказаний"}</strong></span>{context.engine ? <span>Клас авто <strong>{context.engine}</strong></span> : null}<span>Пробіг <strong>{formatMileage(context.mileageKm)}</strong></span></div></div></div><div className={styles.needSection}><div className={styles.sectionLabel}>Діагностовані потреби <span>ⓘ</span></div><div className={styles.needTable}><div className={styles.needTableHead}><span>№</span><span>Деталь / Вузол</span><span>К-ть</span><span>Статус</span></div>{recommendedParts.length ? recommendedParts.map((item, index) => <button type="button" className={`${styles.needRow} ${item.findingId === activeFindingId ? styles.needRowActive : ""}`} key={item.findingId} onClick={() => { setActiveFindingId(item.findingId); setQ(item.name); setOffers([]); void searchPart(item.name, vehicleRef); }}><span>{index + 1}</span><span><b>{item.name}</b><small>{item.position}{item.mediaCount ? ` · фото ${item.mediaCount}` : ""}</small></span><span>{item.quantity} шт</span><span className={styles.needStatus}>Потрібно</span></button>) : <div className={styles.pickerEmpty}>Позицій до заміни немає.</div>}</div></div><div className={styles.contextNotice}><span>ⓘ</span><div><b>{vehicleRef.trim() ? "Пошук за VIN доступний" : "VIN відсутній"}</b><small>{vehicleRef.trim() ? "Система використовує VIN як головний ідентифікатор автомобіля." : "Пошук за назвою або артикулом дозволений, але кожну позицію потрібно підтвердити вручну."}</small></div></div><div className={styles.selectionOrder}><span>ПОРЯДОК ПІДБОРУ</span><div className={styles.stepLine}><b>1</b><i/><b>2</b><i/><b>3</b></div><div className={styles.stepCaptions}><span>Пошук за VIN</span><span>Номер деталі</span><span>Ручне підтвердження</span></div></div></section>

    <section className={`${styles.column} ${styles.searchColumn}`}><div className={styles.columnTitle}><span className={styles.step}>2</span><div><b>Крок 2 · Пошук</b><small>Оригінали та аналоги від підключених постачальників</small></div></div><div className={styles.searchFields}><label><span>Пошук за VIN-кодом</span><div className={styles.inputWithIcon}><input value={vehicleRef} onChange={(event) => { setVehicleRef(event.target.value.toUpperCase()); setResolvedPlate(null); }} placeholder="VIN або держномер"/><button type="button" onClick={() => setVehicleRef("")} disabled={!vehicleRef}>×</button></div><small>{referenceHint}</small></label><label><span>Пошук за номером деталі</span><div className={styles.inputWithIcon}><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPart(); }} placeholder="Артикул або назва деталі"/><button type="button" onClick={() => void searchPart()} aria-label="Знайти деталь">⌕</button></div><small>{activeRecommendation ? `Для потреби: ${activeRecommendation.name}` : "Оберіть позицію зліва"}</small></label></div><div className={styles.tabs}><button type="button" className={activeTab === "originals" ? styles.tabActive : ""} onClick={() => setActiveTab("originals")}>Оригінали <span>{activeTab === "originals" ? offers.length : ""}</span></button><button type="button" className={activeTab === "analogs" ? styles.tabActive : ""} onClick={() => setActiveTab("analogs")}>Аналоги <span>{activeTab === "analogs" ? offers.length : ""}</span></button></div><div className={styles.apiLine}><span>{configuredSuppliers.length} API підключено</span><small>{configuredSuppliers.length ? "Результати розділені за постачальниками" : "Додайте доступи в Налаштуваннях → Постачальники"}</small></div>{!configuredSuppliers.length ? <div className={styles.emptyState}><b>Постачальники ще не відповіли</b><span>Перевірте підключення BM Parts та Юнік Трейд у налаштуваннях CRM.</span></div> : null}{busy ? <div className={styles.emptyState}><b>Шукаю пропозиції…</b><span>Перевіряю VIN, артикул та доступні складські залишки.</span></div> : null}{!busy && configuredSuppliers.length > 0 && !offers.length ? <div className={styles.emptyState}><b>Пропозицій не знайдено</b><span>Змініть назву або артикул деталі та повторіть пошук.</span></div> : null}<div className={styles.offerList}>{offers.map((offer, index) => { const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`; return <article className={styles.offerCard} key={`${key}-${index}`}><div className={styles.offerMain}><div className={styles.offerTitle}><b>{offer.name}</b><small>Артикул {offer.article}</small></div><span className={styles.favorite}>☆</span></div><div className={styles.offerBody}><div className={styles.offerSupplier}><b>{offer.supplierName}</b><span>{offer.brand || "Каталог постачальника"}</span><em>{activeTab === "originals" ? "Оригінал / OEM" : "Аналог / крос"}</em></div><div className={styles.offerMetric}><small>Ціна постачальника</small><b>{formatMoney(offer.purchasePrice, offer.currency)}</b><small>Доставка</small><span>Уточнюється API</span></div><div className={styles.offerMetric}><small>В наявності</small><b className={offer.available ? styles.available : styles.unavailable}>{offer.available ? "Так" : "Уточнити"}</b><small>{offer.stock.length ? `Склад: ${offer.stock[0].warehouse}` : "Склад не вказаний"}</small></div><button type="button" className={styles.addButton} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key || !activeRecommendation} onClick={() => void selectOffer(offer)}>{selectingOffer === key ? "Зберігаю…" : "Додати"}</button></div></article>; })}</div><div className={styles.searchFooter}><span>Показано {offers.length} позицій</span><button type="button" onClick={() => setActiveTab(activeTab === "originals" ? "analogs" : "originals")} disabled={!offers.length}>Показати {activeTab === "originals" ? "аналоги" : "оригінали"} →</button></div>{providerErrors.length ? <div className={styles.warning}>Не всі API відповіли: {providerErrors.map((provider) => `${provider.id}${provider.message ? ` — ${provider.message}` : ""}`).join("; ")}</div> : null}<div className={styles.policyNote}>{message}</div></section>

    <section className={`${styles.column} ${styles.proposalColumn}`}><div className={styles.columnTitle}><span className={styles.step}>3</span><div><b>Крок 3 · Пропозиція</b><small>Позиції, які увійдуть до Комерційної пропозиції</small></div></div><div className={styles.approvalLine}><span>Погодження клієнта</span><b>Чернетка</b></div><div className={styles.proposalTable}><div className={styles.proposalHead}><span>№</span><span>Деталь</span><span>К-ть</span><span>Постачальник</span><span>Ціна для клієнта</span></div>{selectedLines.length ? selectedLines.map((line, index) => <div className={styles.proposalRow} key={line.findingId}><span>{index + 1}</span><span><b>{line.partName}</b><small>{line.brand ? `${line.brand} · ` : ""}{line.article}</small></span><span>{line.quantity} шт</span><span>{line.supplierName}</span><span className={styles.sellPrice}>{formatMoney(line.sellPrice * line.quantity, line.currency)}</span></div>) : <div className={styles.proposalEmpty}><span>+</span><b>Додайте підібрану деталь</b><small>Виберіть постачальника в другому кроці — позиція з’явиться тут.</small></div>}</div><div className={styles.totalBox}><span>Разом</span><div><small>Закупівельна ціна</small><b>{formatMoney(selectedPurchaseTotal, "UAH")}</b></div><div className={styles.totalSell}><small>Ціна для клієнта</small><b>{formatMoney(selectedSellTotal, "UAH")}</b></div></div><div className={styles.markupNotice}><span>ⓘ</span><div><b>Закупівельна ціна × 1,40</b><small>Націнка формується автоматично з налаштувань CRM і не вводиться вручну.</small></div></div><div className={styles.deliveryBox}><b>Доставка</b><span>Термін уточнюється після вибору постачальника та складу.</span></div><div className={styles.proposalActions}><button type="button" onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "estimate" })} disabled={!context.workOrderId || !selectedLines.length}>Підготувати до погодження</button><button type="button" className={styles.actionPrimary} onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "parts" })} disabled={!context.workOrderId || !selectedLines.length}>Відкрити в ЗН →</button></div></section>
  </div></div>;
}
