"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkOrderListItemContract } from "@/src/lib/contracts/crm-core";
import { parseWorkOrderListPayload, parseWorkOrderNumbersPayload } from "@/src/lib/contracts/work-order-payload.parsers";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import { normalizePhone } from "@/src/lib/phone";
import { normalizeVin } from "@/src/domain/vin";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import styles from "./parts-catalog.module.css";
import { TruncatedTextTooltip } from "./truncated-text-tooltip";

type ProviderVehicleSummary = { provider?: string; brand?: string | null; model?: string | null; variant?: string | null; exact?: boolean; source?: string | null; vehicleKey?: string | null };
type FitmentSummary = { status?: string; confirmed?: boolean; exact?: boolean; confidence?: number; reason?: string; source?: string | null; providerVehicle?: ProviderVehicleSummary | null };
type Part = { name?: string; slug?: string; category?: string; description?: string; fitment?: FitmentSummary };
type FitmentPayload = FitmentSummary & { vehicle?: { id?: string | null; vin?: string | null; brand?: string | null; model?: string | null; year?: number | null } | null; catalog?: { source?: string | null; fitmentKey?: string | null; exact?: boolean } | null; genericArticle?: { id?: string | null } | null; normalization?: { displayName?: string; normalizedQuery?: string; canonicalName?: string | null; canonicalSlug?: string | null; confidence?: number; source?: string; axis?: string | null; side?: string | null } | null };
type VehicleContext = { id?: string; vin?: string; make?: string | null; model?: string | null; year?: number | null; engine?: string | null; engineVolumeL?: number | null; fuelType?: string | null; mileageKm?: number | null; plateNumber?: string | null; confidence?: number; source?: string | null; label?: string | null; generation?: { name?: string } | null };
type SupplierOffer = { supplierId: string; supplierName: string; externalProductId: string | null; article: string; brand: string | null; name: string; purchasePrice: number | null; currency: string | null; multiplicity: number | null; stock: Array<{ warehouse: string; quantity: string; warehouseId?: string | null }>; available: boolean; sourceUrl: string | null; imageUrl?: string | null; oeNumbers?: string[]; vehicleMatch?: string | null; analogOfArticle?: string | null; markupPercent?: number | null; sellPrice?: number | null; offerClass?: "OEM" | "ANALOG" | "UNKNOWN"; fitmentStatus?: string; fitmentConfidence?: number | null; fitmentExact?: boolean | null; fitmentSource?: string | null; fitmentReason?: string | null; catalogProductId?: string | null; offerReason?: string | null; sourceKind?: "DIRECT" | "OEM" | "ANALOG" | "NAME"; stockTotal?: number | null; quantityMode?: string; fetchedAt?: string | null };
type SupplierProvider = { id: string; ok: boolean; message?: string };
type Recommendation = { findingId: string | null; manualPartId: string | null; genericArticleId?: string | null; catalogCode?: string | null; name: string; article: string | null; position: string; quantity: number; action: string; urgency: string; note: string; mediaCount: number; canonicalCode?: string | null; canonicalName?: string | null; axis?: string | null; side?: string | null; subPosition?: string | null };
type SelectedLine = { findingId: string; partName: string; supplierName: string; article: string; brand: string | null; warehouse: string | null; purchasePrice: number; sellPrice: number; markupPercent: number; currency: string; quantity: number; externalProductId?: string | null; offerClass?: "OEM" | "ANALOG" | "UNKNOWN"; fitmentReason?: string | null };
type ManualPartPayload = { id: string; findingId: string | null; genericArticleId?: string | null; catalogCode?: string | null; name: string; article: string | null; brand: string | null; position: string | null; quantity: string | number; note: string | null };
type WorkOrderRow = WorkOrderListItemContract;
type DiagnosticPickerRow = { id: string; number: number | null; status: string; statusLabel: string; updatedAt: string; client: { name: string | null; phone: string }; vehicle: { id: string; brand: string | null; model: string | null; year: number | null; plateNumber: string | null; vin: string | null; mileageKm: number | null; turboLevClass: string | null }; diagnosticRequest: { id: string; status: string } };
type ContextSummary = { workOrderId: string | null; orderNumber: string; clientName: string; clientPhone: string; vehicleId: string | null; vehicleName: string; plateNumber: string | null; vin: string | null; mileageKm: number | null; statusCode: string; statusLabel: string; engine: string | null };

type DiagnosticPartsPayload = {
  ok?: boolean;
  diagnostic?: { workOrder?: { id?: string; status?: string } | null; client?: { name?: string | null; phone?: string | null } | null; vehicle?: { id?: string; brand?: string | null; model?: string | null; year?: number | null; label?: string | null; plateNumber?: string | null; vin?: string | null; mileageKm?: number | null } | null };
  inspections?: Array<{ sections?: Array<{ name?: string; items?: Array<{ code?: string; name?: string; position?: string | null; part?: { code?: string; canonicalName?: string; displayName?: string; axis?: string | null; side?: string | null; subPosition?: string | null; position?: string | null } | null; finding?: { id?: string; action?: string; urgency?: string; findingText?: string | null; suggestedPartName?: string | null; media?: unknown[] } | null }> }> }>;
  manualParts?: ManualPartPayload[];
};

type CommercialHandoffPayload = {
  ok?: boolean;
  suggestions?: Array<{
    kind?: "LABOR" | "PART";
    findingId?: string;
    manualPartId?: string | null;
    genericArticleId?: string | null;
    catalogCode?: string | null;
    lineId?: string | null;
    selected?: { supplierId?: string | null; supplierName?: string; article?: string; brand?: string | null; warehouse?: string | null; purchasePrice?: number; sellPrice?: number; markupPercent?: number | null; currency?: string };
  }>;
};

function normalizePlate(value: string) { return normalizeRegistrationPlate(value); }
function looksLikeVin(value: string) { const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, ""); return compact.length === 17 && normalizeVin(value).length === 17; }
function normalizeText(value: string) { return value.trim().toLocaleLowerCase("uk-UA").replace(/\s+/g, " "); }
function recommendationKey(item: Recommendation) { return item.manualPartId || item.findingId || ""; }
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
  const [fitment, setFitment] = useState<FitmentPayload | null>(null);
  const [manualConfirmation, setManualConfirmation] = useState(false);
  const [supplierProviders, setSupplierProviders] = useState<SupplierProvider[]>([]);
  const [configuredSuppliers, setConfiguredSuppliers] = useState<string[]>([]);
  const [supplierSearchBlocked, setSupplierSearchBlocked] = useState(false);
  const [supplierSearchMode, setSupplierSearchMode] = useState<string | null>(null);
  const [recommendedParts, setRecommendedParts] = useState<Recommendation[]>([]);
  const [selectedLines, setSelectedLines] = useState<SelectedLine[]>([]);
  const [workOrderOptions, setWorkOrderOptions] = useState<WorkOrderRow[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [activeFindingId, setActiveFindingId] = useState("");
  const [partFilter, setPartFilter] = useState("");
  const [cartSearchQuery, setCartSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "originals" | "analogs" | "review" | "manual">("all");
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [searchSlow, setSearchSlow] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectingOffer, setSelectingOffer] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolvedPlate, setResolvedPlate] = useState<string | null>(null);
  const [resolvedVin, setResolvedVin] = useState("");
  const [message, setMessage] = useState("Оберіть ремонтне замовлення або відкрийте підбір із Діагностичної карти.");
  const searchRequestRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { const onRoute = () => setRoute(readCrmRoute()); window.addEventListener("popstate", onRoute); return () => window.removeEventListener("popstate", onRoute); }, []);
  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pickerOpen]);

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
      if (active.length) {
        setWorkOrderOptions(active);
        setMessage("Оберіть запис із Діагностичною картою. Статус кожного запису відображається окремо.");
      } else {
        const diagnosticResponse = await fetch("/api/diagnostics?limit=200", { cache: "no-store", credentials: "include" });
        const diagnosticPayload = await diagnosticResponse.json().catch(() => null) as { diagnostics?: Array<{ id: string; status: string; workflowState?: string; reviewState?: string; updatedAt?: string; client?: { name?: string | null; phone?: string | null }; vehicle?: { id?: string; brand?: string | null; model?: string | null; year?: number | null; plateNumber?: string | null; vin?: string | null; mileageKm?: number | null }; diagnosticCard?: { number?: string | null } | null }> } | null;
        const diagnosticRows = Array.isArray(diagnosticPayload?.diagnostics) ? diagnosticPayload.diagnostics.map((row) => ({
          id: "",
          number: row.diagnosticCard?.number ? Number(row.diagnosticCard.number.replace(/\D/g, "")) || null : null,
          status: row.status,
          statusLabel: row.reviewState === "SUBMITTED" ? "На перевірці" : row.reviewState === "CONFIRMED" ? "Погоджено" : row.workflowState || row.status,
          updatedAt: row.updatedAt || new Date(0).toISOString(),
          client: { name: row.client?.name || null, phone: row.client?.phone || "" },
          vehicle: { id: row.vehicle?.id || "", brand: row.vehicle?.brand || null, model: row.vehicle?.model || null, year: row.vehicle?.year || null, plateNumber: row.vehicle?.plateNumber || null, vin: row.vehicle?.vin || null, mileageKm: row.vehicle?.mileageKm || null, turboLevClass: null },
          diagnosticRequest: { id: row.id, status: row.status },
        })) as unknown as WorkOrderRow[] : [];
        setWorkOrderOptions(diagnosticRows);
        setMessage(diagnosticRows.length ? "Знайдено Діагностичні карти без замовлення-наряду. Статус кожної карти відображається окремо." : "Діагностичних карт і замовлень-нарядів не знайдено.");
      }
    } catch (error) { setWorkOrderOptions([]); setMessage(error instanceof Error ? error.message : "Не вдалося завантажити ремонтні замовлення."); } finally { setOrdersLoading(false); }
  }

  async function resolveVinFromReference(referenceValue: string) {
    const reference = referenceValue.trim(); setResolvedPlate(null); setResolvedVin(""); if (!reference) return ""; if (looksLikeVin(reference)) { const vin = normalizeVin(reference); setResolvedVin(vin); return vin; }
    const plate = normalizePlate(reference); if (plate.length < 4) throw new Error("Введіть коректний VIN або держномер автомобіля.");
    const response = await fetch(`/api/vehicles?q=${encodeURIComponent(reference)}&limit=50`, { cache: "no-store", credentials: "include" });
    const data = await response.json().catch(() => null) as { vehicles?: Array<{ plateNumber?: string | null; vin?: string | null }>; error?: string } | null;
    if (!response.ok) throw new Error(data?.error || "Не вдалося перевірити держномер у базі CRM.");
    const exact = (data?.vehicles || []).find((item) => normalizePlate(item.plateNumber || "") === plate); if (!exact) throw new Error("Авто з таким держномером не знайдено в CRM.");
    const resolvedVin = normalizeVin(exact.vin || "");
    setResolvedPlate(exact.plateNumber || reference.toUpperCase());
    if (resolvedVin.length === 17) {
      setResolvedVin(resolvedVin);
      return resolvedVin;
    }
    setResolvedVin("");
    return "";
  }

  async function searchPart(queryValue = q, referenceValue = vehicleRef, recommendationOverride?: Recommendation | null) {
    const requestId = ++searchRequestRef.current;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const query = queryValue.trim();
    const contextVehicleId = context?.vehicleId || route.vehicleId || "";
    const contextVin = context?.vin || route.vin || "";
    const activeReference = referenceValue.trim() || contextVin || context?.plateNumber || route.plate || "";
    if (query.length < 2) {
      setMessage("Введіть щонайменше 2 символи назви або артикулу деталі.");
      if (searchAbortRef.current === controller) searchAbortRef.current = null;
      return;
    }

    setBusy(true);
    setSearchSlow(false);
    setSupplierSearchBlocked(false);
    setSupplierSearchMode(null);
    setOffers([]);
    setSupplierProviders([]);
    setSupplierFilter("ALL");
    setActiveTab("all");
    setManualConfirmation(false);
    let slowTimer: number | undefined;
    slowTimer = window.setTimeout(() => {
      if (requestId === searchRequestRef.current) {
        setSearchSlow(true);
        setMessage("Пошук триває довше очікуваного. Один із постачальників може відповідати повільно — результати з’являться після завершення запиту.");
      }
    }, 8000);
    try {
      const recommendation = recommendationOverride
        || recommendedParts.find((item) => recommendationKey(item) === activeFindingId)
        || recommendedParts.find((item) => normalizeText(item.name) === normalizeText(query))
        || null;
      const knownVin = normalizeVin(contextVin);
      const resolvedVin = knownVin.length === 17
        ? knownVin
        : contextVehicleId
          ? ""
          : await resolveVinFromReference(activeReference);
      if (knownVin.length === 17) setResolvedVin(knownVin);
      if (requestId !== searchRequestRef.current) return;
      const plateReference = activeReference && !looksLikeVin(activeReference) ? activeReference : "";
      const params = new URLSearchParams({ q: query });
      if (resolvedVin) params.set("vin", resolvedVin);
      if (contextVehicleId) params.set("vehicleId", contextVehicleId);
      if (plateReference) params.set("plate", plateReference);
      params.set("includeSuppliers", "1");
      if (recommendation?.findingId) params.set("findingId", recommendation.findingId);
      if (recommendation?.manualPartId) params.set("manualPartId", recommendation.manualPartId);
      if (recommendation?.name) params.set("partName", recommendation.name);
      if (recommendation?.canonicalCode) params.set("canonicalCode", recommendation.canonicalCode);
      if (recommendation?.axis) params.set("axis", recommendation.axis);
      if (recommendation?.side) params.set("side", recommendation.side);
      if (recommendation?.subPosition) params.set("subPosition", recommendation.subPosition);
      if (recommendation?.position) params.set("position", recommendation.position);
      if (recommendation?.genericArticleId) params.set("genericArticleId", recommendation.genericArticleId);

      const referenceResponse = await fetch("/api/parts/search?" + params.toString(), { cache: "no-store", credentials: "include", signal: controller.signal });
      const referenceData = await referenceResponse.json().catch(() => null) as {
        parts?: Part[];
        vehicle?: VehicleContext | null;
        fitment?: FitmentPayload | null;
        oeNumbers?: string[];
        offers?: SupplierOffer[];
        providers?: SupplierProvider[];
        supplierProviders?: SupplierProvider[];
        configuredSuppliers?: string[];
        supplierSearchMode?: string | null;
        supplierSearchBlocked?: boolean;
        supplierSearchBlockReason?: string | null;
        error?: string;
        fitmentPolicy?: { message?: string };
      } | null;
      if (requestId !== searchRequestRef.current) return;
      if (!referenceResponse.ok) throw new Error(referenceData?.error || "Довідковий каталог тимчасово недоступний.");
      setParts(Array.isArray(referenceData?.parts) ? referenceData.parts : []);
      const resolvedFitment = referenceData?.fitment || null;
      setFitment(resolvedFitment);
      if (referenceData?.vehicle) setVehicle(referenceData.vehicle);
      setSearchSlow(false);
      const supplierBlocked = Boolean(referenceData?.supplierSearchBlocked);
      setOffers(supplierBlocked ? [] : Array.isArray(referenceData?.offers) ? referenceData.offers : []);
      setSupplierProviders(supplierBlocked ? [] : Array.isArray(referenceData?.supplierProviders)
        ? referenceData.supplierProviders
        : Array.isArray(referenceData?.providers) ? referenceData.providers : []);
      setConfiguredSuppliers(supplierBlocked ? [] : Array.isArray(referenceData?.configuredSuppliers) ? referenceData.configuredSuppliers : []);
      setSupplierSearchMode(referenceData?.supplierSearchMode || null);
      setFitment(referenceData?.fitment || null);
      setSupplierSearchBlocked(supplierBlocked);
      setManualConfirmation(false);
      setMessage(referenceData?.fitment?.reason || referenceData?.fitmentPolicy?.message || (resolvedFitment?.status !== "VERIFIED"
        ? "Пошук у постачальників виконано без підтвердженого OE-зв’язку. Перед додаванням потрібно вручну перевірити сумісність."
        : resolvedVin
          ? "VIN і позицію передано в каталог. Перевірте статус сумісності кожної пропозиції."
          : "Пошук виконано без VIN. Перед додаванням потрібне ручне підтвердження сумісності."));
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      setParts([]);
      setVehicle(null);
      setOffers([]);
      setFitment(null);
      setSupplierProviders([]);
      setConfiguredSuppliers([]);
      setSupplierSearchMode(null);
      // The request was sent and may have failed at one or more providers;
      // do not report that it was never sent. Provider errors are rendered
      // separately below so the operator can distinguish an API failure from
      // a missing supplier configuration.
      setSupplierSearchBlocked(false);
      setManualConfirmation(false);
      setMessage(error instanceof Error ? error.message : "Каталог тимчасово недоступний.");
    } finally {
      if (slowTimer !== undefined) window.clearTimeout(slowTimer);
      if (requestId === searchRequestRef.current) {
        setBusy(false);
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
      }
    }
  }
  useEffect(() => {
    let cancelled = false;
    const loadContext = async () => {
      if (!route.diagnosticId) { setContext(null); setVehicle(null); setRecommendedParts([]); setSelectedLines([]); setActiveFindingId(""); setOffers([]); setFitment(null); setManualConfirmation(false); setParts([]); void loadWorkOrders(); return; }
      setContextLoading(true); setContext(null); setRecommendedParts([]); setSelectedLines([]); setOffers([]); setFitment(null); setManualConfirmation(false);
      try {
        const [response, manualResponse, handoffResponse] = await Promise.all([
          fetch(`/api/diagnostics/${encodeURIComponent(route.diagnosticId)}/structured`, { cache: "no-store", credentials: "include" }),
          fetch(`/api/diagnostics/${encodeURIComponent(route.diagnosticId)}/manual-parts`, { cache: "no-store", credentials: "include" }),
          fetch(`/api/diagnostics/${encodeURIComponent(route.diagnosticId)}/commercial-handoff`, { cache: "no-store", credentials: "include" }),
        ]);
        const payload = await response.json().catch(() => null) as DiagnosticPartsPayload | null;
        const manualPayload = manualResponse.ok ? await manualResponse.json().catch(() => null) as { ok?: boolean; parts?: ManualPartPayload[] } | null : null;
        const handoffPayload = handoffResponse.ok ? await handoffResponse.json().catch(() => null) as CommercialHandoffPayload | null : null;
        if (!response.ok || !payload?.ok || cancelled) throw new Error("Не вдалося завантажити Діагностичну карту.");
        const diagnostic = payload.diagnostic; const diagnosticVehicle = diagnostic?.vehicle;
        const recommendationRows = (payload.inspections || []).flatMap((inspection) =>
          (inspection.sections || []).flatMap((section) =>
            (section.items || []).flatMap((item) => {
              const finding = item.finding;
              if (!finding?.id) return [];
              const part = item.part;
              const partName = part?.displayName?.trim() || finding.suggestedPartName?.trim() || (finding.action === "REPLACE" ? item.name?.trim() : "");
              if (!partName) return [];
              const recommendation: Recommendation = {
                findingId: finding.id,
                manualPartId: null,
                genericArticleId: null,
                catalogCode: part?.code || null,
                name: partName,
                article: null,
                position: part?.position?.trim() || item.position?.trim() || section.name?.trim() || "—",
                quantity: 1,
                action: finding.action || "REPLACE",
                urgency: finding.urgency || "INFO",
                note: finding.findingText?.trim() || "Зафіксовано в Діагностичній карті",
                mediaCount: Array.isArray(finding.media) ? finding.media.length : 0,
                canonicalCode: part?.code || null,
                canonicalName: part?.canonicalName || null,
                axis: part?.axis || null,
                side: part?.side || null,
                subPosition: part?.subPosition || null,
              };
              return [recommendation];
            }),
          ),
        );
        const manualRecommendationRows: Recommendation[] = (manualPayload?.ok && Array.isArray(manualPayload.parts) ? manualPayload.parts : []).map((part) => ({
          findingId: part.findingId,
          manualPartId: part.id,
          genericArticleId: part.genericArticleId || null,
          catalogCode: part.catalogCode || null,
          name: part.name,
          article: part.article,
          position: part.position?.trim() || "Ручна рекомендація",
          quantity: Number(part.quantity) > 0 ? Number(part.quantity) : 1,
          action: "REPLACE",
          urgency: "INFO",
          note: part.note?.trim() || "Додано вручну в Діагностичній карті",
          mediaCount: 0,
          canonicalCode: null,
          canonicalName: null,
          axis: null,
          side: null,
          subPosition: null,
        }));
        const allRecommendationRows = [...recommendationRows, ...manualRecommendationRows];
        const hydratedSelectedLines: SelectedLine[] = (handoffPayload?.suggestions || []).flatMap((suggestion) => {
          if (suggestion.kind !== "PART" || !suggestion.lineId || !suggestion.selected?.article) return [];
          const recommendation = allRecommendationRows.find((item) => recommendationKey(item) === (suggestion.manualPartId || suggestion.findingId));
          const selected = suggestion.selected;
          if (!recommendation || !(Number(selected.purchasePrice) > 0) || !(Number(selected.sellPrice) > 0)) return [];
          const markupPercent = selected.markupPercent == null
            ? Math.round(((Number(selected.sellPrice) / Number(selected.purchasePrice)) - 1) * 10000) / 100
            : Number(selected.markupPercent);
          return [{
            findingId: recommendationKey(recommendation),
            partName: recommendation.name,
            supplierName: selected.supplierName || "Постачальник",
            article: selected.article || "—",
            brand: selected.brand || null,
            warehouse: selected.warehouse || null,
            purchasePrice: Number(selected.purchasePrice),
            sellPrice: Number(selected.sellPrice),
            markupPercent,
            currency: selected.currency || "UAH",
            quantity: recommendation.quantity,
            externalProductId: null,
          }];
        });
        const nextReference = route.plate || route.vin || diagnosticVehicle?.vin || "";
        const nextContext: ContextSummary = { workOrderId: diagnostic?.workOrder?.id || route.workOrderId || null, orderNumber: route.workOrderNumber || "ЗН-—", clientName: diagnostic?.client?.name || "Клієнт не вказаний", clientPhone: diagnostic?.client?.phone || "—", vehicleId: diagnosticVehicle?.id || route.vehicleId || null, vehicleName: diagnosticVehicle?.label || [diagnosticVehicle?.brand, diagnosticVehicle?.model, diagnosticVehicle?.year].filter(Boolean).join(" ") || "Автомобіль", plateNumber: diagnosticVehicle?.plateNumber || route.plate || null, vin: diagnosticVehicle?.vin || route.vin || null, mileageKm: diagnosticVehicle?.mileageKm ?? null, statusCode: diagnostic?.workOrder?.status || "PARTS_REVIEW", statusLabel: diagnostic?.workOrder?.status || "Підбір деталей", engine: null };
        setContext(nextContext); setVehicle({ ...diagnosticVehicle, id: diagnosticVehicle?.id || route.vehicleId, vin: diagnosticVehicle?.vin || route.vin, plateNumber: diagnosticVehicle?.plateNumber || route.plate }); setVehicleRef(nextReference.toUpperCase()); setResolvedVin(diagnosticVehicle?.vin || route.vin || ""); setRecommendedParts(allRecommendationRows); setSelectedLines(hydratedSelectedLines); const requestedRecommendation = route.manualPartId || route.findingId; const first = allRecommendationRows.find((item) => recommendationKey(item) === requestedRecommendation) || allRecommendationRows[0]; setActiveFindingId(first ? recommendationKey(first) : ""); setQ((current) => current.trim() || first?.article || first?.name || ""); setOffers([]); setPickerOpen(false); setMessage(allRecommendationRows.length ? `Із Діагностичної карти передано ${allRecommendationRows.length} позицій. Натисніть на деталь, щоб відкрити підбір.` : "У Діагностичній карті немає деталей, позначених до заміни.");
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Не вдалося завантажити Діагностичну карту."); } finally { if (!cancelled) setContextLoading(false); }
    };
    void loadContext(); return () => { cancelled = true; };
    // The route query is the page context and intentionally drives this loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.diagnosticId, route.findingId, route.manualPartId, route.plate, route.vehicleId, route.vin, route.workOrderId]);

  const activeRecommendation = useMemo(() => recommendedParts.find((item) => recommendationKey(item) === activeFindingId) || recommendedParts.find((item) => normalizeText(item.name) === normalizeText(q)) || null, [recommendedParts, activeFindingId, q]);
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
  const selectedProfitTotal = selectedLines.reduce((sum, line) => sum + (line.sellPrice - line.purchasePrice) * line.quantity, 0);
  const selectedMarkupValues = [...new Set(selectedLines.map((line) => line.markupPercent))];
  const selectedMarkupLabel = selectedMarkupValues.length === 1 ? `${selectedMarkupValues[0]}%` : selectedMarkupValues.length > 1 ? "різна" : "—";
  const displayedMarkupLabel = selectedMarkupLabel === "—" ? "з налаштувань" : selectedMarkupLabel;
  const providerErrors = supplierProviders.filter((provider) => !provider.ok);
  const respondingSuppliers = supplierProviders.filter((provider) => provider.ok).length;
  const supplierStatusLabel = busy
    ? "Перевіряю BM Parts та Юнік Трейд…"
      : supplierSearchBlocked
      ? "Запит до API не відправлено"
      : supplierSearchMode === "VIN_OE"
        ? configuredSuppliers.length ? `${respondingSuppliers}/${configuredSuppliers.length} · VIN/OE пошук` : "VIN/OE план сформовано · API не налаштовані"
        : supplierSearchMode === "CANONICAL_NAME"
          ? configuredSuppliers.length ? `${respondingSuppliers}/${configuredSuppliers.length} · канонічна деталь` : "Канонічну деталь визначено · API не налаштовані"
          : configuredSuppliers.length
            ? `${respondingSuppliers}/${configuredSuppliers.length} API відповіли`
            : "Запит відправлено · API не налаштовані";
  const visibleRecommendedParts = useMemo(() => {
    const query = normalizeText(partFilter);
    if (!query) return recommendedParts;
    return recommendedParts.filter((item) => normalizeText([item.name, item.article, item.position].filter(Boolean).join(" ")).includes(query));
  }, [partFilter, recommendedParts]);
  const originalOffers = offers.filter((offer) => offer.offerClass === "OEM");
  const analogOffers = offers.filter((offer) => offer.offerClass === "ANALOG");
  const manualOffers = offers.filter((offer) => offer.offerClass !== "OEM" && offer.offerClass !== "ANALOG");
  const categoryOffers = activeTab === "originals"
    ? originalOffers
    : activeTab === "analogs"
      ? analogOffers
      : activeTab === "review" || activeTab === "manual"
        ? manualOffers
        : offers;
  const pickerOffers = supplierSearchBlocked
    ? []
    : categoryOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter);
  const supplierOptions = [...new Map(offers.map((offer) => [offer.supplierId, offer.supplierName])).entries()];
  const compactPickerOffers = supplierSearchBlocked ? [] : offers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter);
  function renderCompactOffer(offer: SupplierOffer, index: number) {
    const key = offer.supplierId + ":" + (offer.externalProductId || offer.article);
    const stockRows = offer.stock.length
      ? offer.stock
      : [{ warehouse: "Склад не вказаний", quantity: "—" }];
    return <button type="button" className={styles.compactOfferRow} key={key + "-" + index} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key} onClick={() => void selectOffer(offer, true)}>
      <span className={styles.compactOfferImage}>{offer.imageUrl ? <img src={offer.imageUrl} alt="" /> : <span aria-hidden="true">⚙</span>}</span>
      <span className={styles.compactOfferName}><b>{offer.name}</b></span>
      <span className={styles.compactAvailability}><b>Наявність <span className={styles.compactInfo} aria-label={`Інформація про склади ${offer.supplierName}`} role="img" tabIndex={0}>ⓘ</span></b><span>{offer.available ? "В наявності" : "Уточнити"}</span><span className={styles.compactStockTooltip} role="tooltip" aria-label="Складські залишки">{stockRows.map((stock, stockIndex) => <span key={`${stock.warehouse}-${stockIndex}`}><b>{stock.warehouse}</b> — {stock.quantity}</span>)}</span></span>
      <span className={styles.compactSupplier}>{offer.supplierName || "—"}</span>
      <span className={styles.compactBrand}><small>{offer.brand || "Бренд не вказаний"}</small><b>{offer.article}</b></span>
      <span className={styles.compactPrice}>{formatMoney(offer.purchasePrice, offer.currency)}</span>
    </button>;
  }

  function openOrder(row: WorkOrderRow) { if (!row.id) { navigateCrm("Діагностика", { diagnosticId: row.diagnosticRequest.id }); return; } navigateCrm("Підбір запчастин", { diagnosticId: row.diagnosticRequest.id, workOrderId: row.id, workOrderNumber: orderLabel(row), vehicleId: row.vehicle.id, plate: row.vehicle.plateNumber || "", vin: row.vehicle.vin || "" }); }

  function openPickerFor(item: Recommendation) {
    const query = item.article || item.name;
    setActiveFindingId(recommendationKey(item));
    setQ(query);
    setOffers([]);
    setFitment(null);
    setSupplierSearchBlocked(false);
    setManualConfirmation(false);
    setActiveTab("originals");
    setPickerOpen(true);
    void searchPart(query, vehicleRef, item);
  }

  function openNextPicker() {
    const next = recommendedParts.find((item) => !selectedLines.some((line) => line.findingId === recommendationKey(item)));
    if (next) return openPickerFor(next);
    setMessage("Усі деталі з Діагностичної карти вже підібрані.");
  }

  function startCartSearch(queryOverride?: string) {
    const query = (queryOverride ?? cartSearchQuery).trim();
    if (query.length < 2) {
      setMessage("Введіть щонайменше 2 символи номера або назви деталі.");
      setPickerOpen(true);
      return;
    }

    const next = recommendedParts.find((item) => !selectedLines.some((line) => line.findingId === recommendationKey(item)))
      || recommendedParts[0]
      || null;

    setActiveFindingId(next ? recommendationKey(next) : "");
    setQ(query);
    setOffers([]);
    setFitment(null);
    setSupplierSearchBlocked(false);
    setManualConfirmation(false);
    setActiveTab("all");
    setPickerOpen(true);
    void searchPart(query, vehicleRef, next);
  }

  function selectedLineFor(item: Recommendation) {
    return selectedLines.find((line) => line.findingId === recommendationKey(item)) || null;
  }

  async function selectOffer(offer: SupplierOffer, allowManualConfirmation = false) {
    const selectionRecommendation = activeRecommendation
      || recommendedParts.find((item) => recommendationKey(item) === activeFindingId)
      || recommendedParts.find((item) => !selectedLines.some((line) => line.findingId === recommendationKey(item)))
      || null;
    if (!route.diagnosticId || !selectionRecommendation) { setMessage("Спочатку оберіть позицію з Діагностичної карти."); return; }
    const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`; setSelectingOffer(key);
    try {
      const selectionVin = looksLikeVin(vehicleRef)
        ? normalizeVin(vehicleRef)
        : resolvedPlate && normalizePlate(vehicleRef) === normalizePlate(resolvedPlate) ? resolvedVin : "";
      const catalogVerified = offer.fitmentStatus === "VERIFIED"
        && offer.fitmentExact !== false
        && fitment?.exact !== false;
      if (!catalogVerified && !manualConfirmation && !allowManualConfirmation) {
        setMessage("Поставте позначку ручної перевірки сумісності перед додаванням пропозиції.");
        setSelectingOffer("");
        return;
      }
      const vinSearch = selectionVin.length === 17 && catalogVerified;
      const response = await fetch("/api/parts-selection/select", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ diagnosticId: route.diagnosticId, findingId: selectionRecommendation.findingId, manualPartId: selectionRecommendation.manualPartId, quantity: selectionRecommendation.quantity, supplierId: offer.supplierId, externalProductId: offer.externalProductId, article: offer.article, searchMode: vinSearch ? "VIN" : "PART_NUMBER", vehicleVin: selectionVin || null, vehicleId: context?.vehicleId || null, partName: selectionRecommendation.name, genericArticleId: selectionRecommendation.genericArticleId || null, canonicalCode: selectionRecommendation.canonicalCode || selectionRecommendation.catalogCode || null, axis: selectionRecommendation.axis, side: selectionRecommendation.side, subPosition: selectionRecommendation.subPosition, position: selectionRecommendation.position, fitmentStatus: offer.fitmentStatus || fitment?.status || null, fitmentExact: offer.fitmentExact ?? fitment?.exact ?? null, fitmentProductId: offer.catalogProductId || null, fitmentSource: offer.fitmentSource || fitment?.source || null, manualConfirmation: !vinSearch }) });
      const data = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string; selected?: { supplierId?: string; supplierName: string; article: string; brand: string | null; purchasePrice: number; markupPercent: number; sellPrice: number; currency: string; externalProductId?: string | null } } | null;
      if (!response.ok || !data?.ok || !data.selected) throw new Error(data?.message || data?.error || "Не вдалося зберегти вибрану деталь.");
      const selected = data.selected; const selectedKey = recommendationKey(selectionRecommendation); const warehouse = offer.stock.find((row) => row.warehouseId && Number(row.quantity.replace(/[^0-9.,-]/g, "").replace(",", ".")) > 0)?.warehouse || offer.stock[0]?.warehouse || null; setSelectedLines((current) => [...current.filter((line) => line.findingId !== selectedKey), { findingId: selectedKey, partName: selectionRecommendation.name, supplierName: selected.supplierName, article: selected.article, brand: selected.brand, warehouse, purchasePrice: selected.purchasePrice, sellPrice: selected.sellPrice, markupPercent: selected.markupPercent, currency: selected.currency, quantity: selectionRecommendation.quantity, externalProductId: selected.externalProductId || offer.externalProductId, offerClass: offer.offerClass, fitmentReason: offer.fitmentReason || offer.offerReason }]); setPickerOpen(false); setMessage(`Позицію збережено: ${selected.supplierName} · ${selected.article}.`); window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не вдалося зберегти вибрану деталь."); } finally { setSelectingOffer(""); }
  }

  if (!route.diagnosticId) return <div className={styles.page}><div className={styles.menuHeader}><div><p>КОМЕРЦІЙНА ПРОПОЗИЦІЯ</p><h1>Комерційна пропозиція</h1><span>Оберіть ремонтне замовлення, щоб відкрити робочу область підбору.</span></div><span className={styles.headerBadge}>ВХІД ІЗ ГОЛОВНОГО МЕНЮ</span></div><section className={styles.orderPicker}><div className={styles.pickerHeader}><div><b>Ремонтні замовлення</b><span>Показані всі записи з прив’язаною Діагностичною картою, незалежно від поточного статусу.</span></div><strong>{workOrderOptions.length}</strong></div><label className={styles.orderSearch}><span>⌕</span><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); void loadWorkOrders(); }} placeholder="Пошук за № замовлення, клієнтом, телефоном, держномером або VIN" aria-keyshortcuts="Enter"/><button type="button" onClick={() => setOrderSearch("")} disabled={!orderSearch} aria-label="Очистити пошук">×</button></label>{ordersLoading ? <div className={styles.pickerEmpty}>Завантажую ремонтні замовлення…</div> : filteredOrders.length ? <div className={styles.orderList}>{filteredOrders.map((row) => <button type="button" className={styles.orderRow} key={row.diagnosticRequest.id} onClick={() => openOrder(row)}><span className={styles.orderNumber}>{orderLabel(row)}</span><span className={styles.orderIdentity}><b>{vehicleLabel(row)}</b><small>{row.vehicle.plateNumber || "Номер не вказаний"} · {row.client.name || "Клієнт не вказаний"}</small></span><span className={styles.orderNeed}><b>{row.statusLabel}</b><small>{row.diagnosticRequest.status === "CONFIRMED" ? "Діагностика підтверджена" : "Діагностика в роботі"}</small></span><span className={styles.orderArrow}>→</span></button>)}</div> : <div className={styles.pickerEmpty}>{message}<button type="button" onClick={() => void loadWorkOrders()}>Оновити список</button></div>}</section></div>;

  if (contextLoading || !context) return <div className={styles.page}><div className={styles.loadingPanel}><span className={styles.loadingCircle}>2</span><div><b>Завантажую контекст ремонту…</b><small>Підтягую автомобіль, клієнта та деталі з Діагностичної карти.</small></div></div></div>;

  return <div className={styles.page}>
    <header className={styles.contextHeader}>
      <button type="button" className={styles.backButton} onClick={() => navigateCrm("Підбір запчастин", {})} aria-label="Повернутися до вибору замовлення">←</button>
      <div className={styles.orderContext}><small>Замовлення-наряд</small><b>{context.orderNumber}</b></div>
      <div className={styles.contextItem}><small>Клієнт</small><b>{context.clientName}</b><span>{context.clientPhone}</span></div>
      <div className={styles.contextItem} title={context.vin || "VIN не вказаний"}><small>VIN-код</small><b className={styles.contextVin}>{context.vin || "VIN не вказаний"}</b></div>
      <div className={styles.contextItem}><small>Автомобіль</small><b>{context.vehicleName}</b><span>{context.plateNumber || "Номер не вказаний"}</span></div>
      <div className={styles.contextItem}><small>Пробіг</small><b>{formatMileage(context.mileageKm)}</b></div>
      <div className={styles.contextStatus}><small>Етап</small><b className={statusTone(context.statusCode)}><i/> {context.statusLabel}</b></div>
    </header>

    <section className={styles.proposalHeader} aria-labelledby="parts-proposal-title">
      <div className={styles.proposalHeaderCopy}>
        <p>КОМЕРЦІЙНА ПРОПОЗИЦІЯ</p>
        <h1 id="parts-proposal-title">Комерційна пропозиція <span>· чернетка</span></h1>
        <small>Виберіть деталі з Діагностичної карти та додайте найкращу пропозицію постачальника.</small>
      </div>
      <div className={styles.proposalHeaderMeta} aria-label="Статистика підбору">
        <strong>{recommendedParts.length} {recommendedParts.length === 1 ? "деталь" : "деталі"}</strong>
        <span>{selectedLines.length} вибрано · націнка {displayedMarkupLabel}</span>
      </div>
    </section>

    <div className={styles.columns}>
      <section className={`${styles.column} ${styles.needsColumn}`} aria-labelledby="parts-needs-title">
        <div className={styles.columnTitle}>
          <div><p>ЗАМІНА · {recommendedParts.length}</p><b id="parts-needs-title">Деталі до заміни</b><small>Позиції з Діагностичної карти</small></div>
          <span className={styles.columnBadge}>{selectedLines.length}/{recommendedParts.length}</span>
        </div>
        <div className={styles.needsToolbar}>
          <label className={styles.partSearch}><span aria-hidden="true">⌕</span><input value={partFilter} onChange={(event) => setPartFilter(event.target.value)} placeholder="Знайти деталь…" aria-label="Пошук деталей до заміни"/>{partFilter && <button type="button" onClick={() => setPartFilter("")} aria-label="Очистити пошук">×</button>}</label>
          <span className={styles.needsCount}>{visibleRecommendedParts.length}/{recommendedParts.length}</span>
        </div>
        <div className={styles.needSection}>
          <div className={styles.needTable}>
            <div className={styles.needTableHead}><span>№</span><span>Деталь / вузол</span><span>К-ть</span><span>Стан</span></div>
            {visibleRecommendedParts.length ? visibleRecommendedParts.map((item, index) => {
              const itemKey = recommendationKey(item);
              const selectedLine = selectedLineFor(item);
              const active = itemKey === activeFindingId;
              const positionText = `${item.position}${item.manualPartId ? " · додано вручну" : item.mediaCount ? ` · фото ${item.mediaCount}` : ""}`;
              return <button type="button" aria-pressed={Boolean(selectedLine)} className={`${styles.needRow} ${active ? styles.needRowActive : ""} ${selectedLine ? styles.needRowSelected : ""}`} key={itemKey} onClick={() => openPickerFor(item)}>
                <span className={styles.needIndex}>{index + 1}</span>
                <span className={styles.needCopy}><TruncatedTextTooltip text={item.name} focusable={false} className={styles.truncatedValue}><b>{item.name}</b></TruncatedTextTooltip><TruncatedTextTooltip text={positionText} focusable={false} className={styles.truncatedValue}><small>{positionText}</small></TruncatedTextTooltip></span>
                <span className={styles.needQuantity}>{item.quantity} шт</span>
                <span className={selectedLine ? styles.needStatusSelected : styles.needStatus}>{selectedLine ? "✓ вибрано" : "+ очікує"}</span>
              </button>;
            }) : <div className={styles.pickerEmpty}>За цим пошуком деталей не знайдено.</div>}
          </div>
        </div>
        <div className={styles.needsHint}><span aria-hidden="true">ⓘ</span><div><b>Виберіть деталь</b><small>Відкриється popup з оригіналами та аналогами з підключених API постачальників.</small></div></div>
        <div className={styles.needsFooter}><span>Залишилось підібрати: <b>{Math.max(recommendedParts.length - selectedLines.length, 0)}</b></span><button type="button" className={styles.secondaryAction} onClick={openNextPicker} disabled={!recommendedParts.some((item) => !selectedLineFor(item))}>Наступна →</button></div>
      </section>

      <section className={`${styles.column} ${styles.selectedColumn}`} aria-labelledby="selected-parts-title">
        <div className={styles.columnTitle}>
          <div><p>КОШИК · {selectedLines.length}</p><b id="selected-parts-title">Вибрані деталі</b><small>Позиції, які увійдуть до Комерційної пропозиції</small></div>
          <form className={styles.cartPartSearch} onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("cart-part-search"); startCartSearch(input instanceof HTMLInputElement ? input.value : undefined); }}>
            <label className={styles.srOnly} htmlFor="cart-part-search">Пошук деталі за номером або OEM-кодом</label>
            <span aria-hidden="true">⌕</span>
            <input id="cart-part-search" value={cartSearchQuery} onChange={(event) => setCartSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); startCartSearch(event.currentTarget.value); } }} onKeyUp={(event) => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Пошук за номером деталі / OEM"/>
            <button type="button" aria-label="Знайти деталь" onMouseDown={(event) => { event.preventDefault(); }} onClick={() => startCartSearch()}>↵</button>
          </form>
        </div>
        <div className={styles.selectedTableArea}>
          <div className={styles.selectedTableScroll}>
            <table className={styles.selectedTable}>
              <caption className={styles.srOnly}>Вибрані деталі та ціни</caption>
              <thead><tr><th>№</th><th>К-сть, шт.</th><th>Артикул</th><th>Бренд</th><th>Номенклатура</th><th>Постачальник</th><th>Склад</th><th>Ціна закупки, грн</th><th>Сума закупки, грн</th><th>Ціна продажу, грн</th><th>Сума продажу, грн</th><th>Прибуток, грн</th><th>%</th><th>Дія</th></tr></thead>
              <tbody>{selectedLines.length ? selectedLines.map((line, index) => {
                const recommendation = recommendedParts.find((item) => recommendationKey(item) === line.findingId);
                const purchaseTotal = line.purchasePrice * line.quantity;
                const sellTotal = line.sellPrice * line.quantity;
                const profit = (line.sellPrice - line.purchasePrice) * line.quantity;
                return <tr key={line.findingId}><td>{index + 1}</td><td>{line.quantity}</td><td>{line.article || "—"}</td><td>{line.brand || "—"}</td><td className={styles.nomenclatureCell}><TruncatedTextTooltip text={line.partName}>{line.partName}</TruncatedTextTooltip></td><td><TruncatedTextTooltip text={line.supplierName}>{line.supplierName}</TruncatedTextTooltip></td><td><TruncatedTextTooltip text={line.warehouse || "—"}>{line.warehouse || "—"}</TruncatedTextTooltip></td><td>{formatMoney(line.purchasePrice, line.currency)}</td><td>{formatMoney(purchaseTotal, line.currency)}</td><td>{formatMoney(line.sellPrice, line.currency)}</td><td className={styles.sellPrice}>{formatMoney(sellTotal, line.currency)}</td><td className={styles.profit}>{formatMoney(profit, line.currency)}</td><td>{line.markupPercent}%</td><td>{recommendation ? <button type="button" className={styles.tableAction} onClick={() => openPickerFor(recommendation)}>Змінити</button> : null}</td></tr>;
              }) : <tr><td colSpan={14}><div className={styles.selectedEmpty}><span>+</span><b>Вибраних деталей ще немає</b><small>Натисніть на деталь зліва — popup відкриється автоматично.</small><button type="button" className={styles.secondaryAction} onClick={openNextPicker} disabled={!recommendedParts.length}>Додати першу деталь</button></div></td></tr>}</tbody>
            </table>
          </div>
        </div>
        <div className={styles.selectedTableFooter}><span>{selectedLines.length} із {recommendedParts.length} позицій вибрано</span><span>Ціни в гривнях · горизонтальна прокрутка таблиці</span></div>

<div className={styles.cartSummary} aria-label="Підсумок кошика">
          <div className={styles.cartSummaryHeader}>
            <div><p>ПІДСУМОК КОШИКА</p><b>Деталі та маржа</b></div>
            <span>{selectedLines.length} із {recommendedParts.length} позицій вибрано</span>
          </div>
          <div className={styles.cartTotals}>
            <div><span>Закупівля</span><b>{formatMoney(selectedPurchaseTotal, "UAH")}</b></div>
            <div><span>Продаж деталей</span><b className={styles.summarySell}>{formatMoney(selectedSellTotal, "UAH")}</b></div>
            <div><span>Прибуток</span><b className={styles.summaryProfit}>{formatMoney(selectedProfitTotal, "UAH")}</b></div>
            <div><span>Націнка</span><b>{displayedMarkupLabel}</b></div>
          </div>
          <div className={styles.cartTotalLine}><span>Разом за деталі</span><strong>{formatMoney(selectedSellTotal, "UAH")}</strong></div>
        </div>
      </section>

      <section className={styles.servicesPanel} aria-labelledby="parts-services-title">
        <div className={styles.servicesHeader}>
          <div><p>ПОСЛУГИ</p><b id="parts-services-title">Роботи по автомобілю</b></div>
          <div className={styles.serviceMode}><span>Оберіть спосіб розрахунку цін робіт</span><label><input type="radio" name="parts-service-mode" defaultChecked/> Фіксований прайс</label><label><input type="radio" name="parts-service-mode"/> Нормогодини</label></div>
        </div>
        <div className={styles.servicesTable}>
          <div className={styles.servicesHead}><span>Послуга</span><span>Назва послуги</span><span>Кількість</span><span>Вартість послуги</span><span>Сума</span></div>
          <div className={styles.servicesEmpty}><span>✓</span><b>Послуги ще не додані</b><small>Додайте роботи після узгодження переліку ремонту.</small></div>
        </div>
      </section>

      <div className={styles.proposalBottomBar}>
        <button type="button" className={styles.secondaryAction} onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "estimate" })} disabled={!context.workOrderId || !selectedLines.length}>Підготувати до погодження</button>
        <div><span>Загальна сума КП</span><strong>{formatMoney(selectedSellTotal, "UAH")}</strong></div>
        <button type="button" className={styles.secondaryAction} onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "parts" })} disabled={!context.workOrderId || !selectedLines.length}>Відкрити в ЗН →</button>
      </div>

    </div>

    {pickerOpen && <div className={styles.pickerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}>
      <section className={styles.pickerModal} role="dialog" aria-modal="true" aria-labelledby="parts-picker-title">
        <div className={styles.compactToolbar}>
          <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} aria-label="Постачальник"><option value="ALL">Усі постачальники</option>{supplierOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
          <span>К-ть знайдених запчастин: <b>{compactPickerOffers.length}</b></span>
          <button type="button" className={styles.compactSort} onClick={() => setActiveTab("all")}>Бренд ↕</button>
          <button type="button" className={styles.compactSort} onClick={() => setActiveTab("all")}>Ціна ↕</button>
          <button type="button" className={styles.compactClose} onClick={() => setPickerOpen(false)} aria-label="Закрити підбір">×</button>
        </div>
        <div className={styles.compactHeaderRow} aria-hidden="true">
          <span />
          <span>Деталь / назва</span>
          <span>Наявність</span>
          <span>Постачальник</span>
          <span>Бренд · артикул</span>
          <span>Ціна</span>
        </div>
        {busy ? <div className={styles.pickerEmptyState} role="status" aria-live="polite"><div className={styles.searchAnimation} aria-hidden="true"><div className={styles.searchAnimationVisual}><span className={styles.searchAnimationOrbit} /><span className={styles.searchAnimationPulse} /><span className={styles.searchAnimationCore}><i /></span></div><div className={styles.searchAnimationCopy}><b>{searchSlow ? "Пошук триває довше…" : "Підбираю сумісні варіанти"}</b><span>VIN · OE-каталог · постачальники</span><span className={styles.searchAnimationSteps}><i /><i /><i /></span></div></div></div>
          : !compactPickerOffers.length ? <div className={styles.pickerEmptyState}><b>Пропозицій не знайдено</b><span>{supplierSearchBlocked ? "Запит до постачальників тимчасово заблокований." : "Змініть пошуковий запит або перевірте відповідь постачальників."}</span></div>
          : <div className={styles.compactResults}>
            {originalOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter).length ? <section><h3>Оригінали:</h3>{originalOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter).map(renderCompactOffer)}</section> : null}
            {analogOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter).length ? <section><h3>Аналоги:</h3>{analogOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter).map(renderCompactOffer)}</section> : null}
            {manualOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter).length ? <section><h3>Перевірка:</h3>{manualOffers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter).map(renderCompactOffer)}</section> : null}
          </div>}
        {providerErrors.length ? <div className={styles.warning}>Не всі API відповіли: {providerErrors.map((provider) => `${provider.id}${provider.message ? ` — ${provider.message}` : ""}`).join("; ")}</div> : null}
      </section>
    </div>}
  </div>;
  /*

  return <div className={styles.page}><header className={styles.contextHeader}><button type="button" className={styles.backButton} onClick={() => navigateCrm("Підбір запчастин", {})} aria-label="Повернутися до вибору замовлення">←</button><div className={styles.orderContext}><small>Ремонтне замовлення</small><b>{context.orderNumber}</b></div><div className={styles.contextItem}><small>Клієнт</small><b>{context.clientName}</b></div><div className={styles.contextItem}><small>Телефон</small><b>{context.clientPhone}</b></div><div className={styles.contextItem}><small>Автомобіль</small><b>{context.vehicleName}</b><span>{context.plateNumber || "Номер не вказаний"}</span></div><div className={styles.contextItem}><small>Пробіг</small><b>{formatMileage(context.mileageKm)}</b></div><div className={styles.contextStatus}><small>Статус ЗН</small><b className={statusTone(context.statusCode)}><i/> {context.statusLabel}</b></div></header><PartsCatalogDiagram vehicleLabel={context.vehicleName} vin={context.vin} recommendations={diagramRecommendations} activeFindingId={activeFindingId} onSelect={selectDiagramItem}/><div className={styles.columns}>
    <section className={`${styles.column} ${styles.needsColumn}`}><div className={styles.columnTitle}><span className={styles.step}>1</span><div><b>Крок 1 · Потреби</b><small>Що потрібно замінити за результатом діагностики</small></div></div><div className={styles.vehicleBlock}><div className={styles.sectionEyebrow}>АВТОМОБІЛЬ</div><div className={styles.vehicleOverview}>{context.vehicleId ? <VehicleRender id={context.vehicleId} brand={vehicle?.make} model={vehicle?.model} year={vehicle?.year} size="mini" eager className={styles.vehicleImage}/> : <div className={styles.vehicleFallback}>🚗</div>}<div><b>{context.vehicleName}</b><span>VIN <strong>{context.vin || "не вказаний"}</strong></span><span>Держномер <strong>{context.plateNumber || "не вказаний"}</strong></span>{context.engine ? <span>Клас авто <strong>{context.engine}</strong></span> : null}<span>Пробіг <strong>{formatMileage(context.mileageKm)}</strong></span></div></div></div><div className={styles.needSection}><div className={styles.sectionLabel}>Діагностовані потреби <span>ⓘ</span></div><div className={styles.needTable}><div className={styles.needTableHead}><span>№</span><span>Деталь / Вузол</span><span>К-ть</span><span>Статус</span></div>{recommendedParts.length ? recommendedParts.map((item, index) => { const itemKey = recommendationKey(item); const searchValue = item.article || item.name; return <button type="button" className={`${styles.needRow} ${itemKey === activeFindingId ? styles.needRowActive : ""}`} key={itemKey} onClick={() => { setActiveFindingId(itemKey); setQ(searchValue); setOffers([]); void searchPart(searchValue, vehicleRef); }}><span>{index + 1}</span><span><b>{item.name}</b><small>{item.position}{item.manualPartId ? " · додано вручну" : item.mediaCount ? ` · фото ${item.mediaCount}` : ""}</small></span><span>{item.quantity} шт</span><span className={styles.needStatus}>Потрібно</span></button>; }) : <div className={styles.pickerEmpty}>Позицій до заміни немає.</div>}</div></div><div className={styles.contextNotice}><span>ⓘ</span><div><b>{vehicleRef.trim() ? "Пошук за VIN доступний" : "VIN відсутній"}</b><small>{vehicleRef.trim() ? "Система використовує VIN як головний ідентифікатор автомобіля." : "Пошук за назвою або артикулом дозволений, але кожну позицію потрібно підтвердити вручну."}</small></div></div><div className={styles.selectionOrder}><span>ПОРЯДОК ПІДБОРУ</span><div className={styles.stepLine}><b>1</b><i/><b>2</b><i/><b>3</b></div><div className={styles.stepCaptions}><span>Пошук за VIN</span><span>Номер деталі</span><span>Ручне підтвердження</span></div></div></section>

    <section className={`${styles.column} ${styles.searchColumn}`}><div className={styles.columnTitle}><span className={styles.step}>2</span><div><b>Крок 2 · Пошук</b><small>Оригінали та аналоги від підключених постачальників</small></div></div><div className={styles.searchFields}><label><span>Пошук за VIN-кодом</span><div className={styles.inputWithIcon}><input value={vehicleRef} onChange={(event) => { setVehicleRef(event.target.value.toUpperCase()); setResolvedPlate(null); }} placeholder="VIN або держномер"/><button type="button" onClick={() => setVehicleRef("")} disabled={!vehicleRef}>×</button></div><small>{referenceHint}</small></label><label><span>Пошук за номером деталі</span><div className={styles.inputWithIcon}><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPart(); }} placeholder="Артикул або назва деталі"/><button type="button" onClick={() => void searchPart()} aria-label="Знайти деталь">⌕</button></div><TruncatedTextTooltip text={activeRecommendation ? `Для потреби: ${activeRecommendation.name}` : "Оберіть позицію зліва"}><small>{activeRecommendation ? `Для потреби: ${activeRecommendation.name}` : "Оберіть позицію зліва"}</small></TruncatedTextTooltip></label></div><div className={styles.tabs}><button type="button" className={activeTab === "originals" ? styles.tabActive : ""} onClick={() => setActiveTab("originals")}>Оригінали <span>{originalOffers.length}</span></button><button type="button" className={activeTab === "analogs" ? styles.tabActive : ""} onClick={() => setActiveTab("analogs")}>Аналоги <span>{analogOffers.length}</span></button></div><div className={styles.apiLine}><span>{configuredSuppliers.length} API підключено</span><small>{configuredSuppliers.length ? "Результати розділені за постачальниками" : "Додайте доступи в Налаштуваннях → Постачальники"}</small></div>{!configuredSuppliers.length ? <div className={styles.emptyState}><b>Постачальники ще не відповіли</b><span>Перевірте підключення BM Parts та Юнік Трейд у налаштуваннях CRM.</span></div> : null}{busy ? <div className={styles.emptyState}><b>Шукаю пропозиції…</b><span>Перевіряю VIN, артикул та доступні складські залишки.</span></div> : null}{!busy && configuredSuppliers.length > 0 && !offers.length ? <div className={styles.emptyState}><b>Пропозицій не знайдено</b><span>Змініть назву або артикул деталі та повторіть пошук.</span></div> : null}<div className={styles.offerList}>{categoryOffers.map((offer, index) => { const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`; return <article className={styles.offerCard} key={`${key}-${index}`}><div className={styles.offerMain}><div className={styles.offerTitle}><TruncatedTextTooltip text={offer.name}><b>{offer.name}</b></TruncatedTextTooltip><TruncatedTextTooltip text={`Артикул ${offer.article}`}><small>Артикул {offer.article}</small></TruncatedTextTooltip></div><span className={styles.favorite}>☆</span></div><div className={styles.offerBody}><div className={styles.offerSupplier}><TruncatedTextTooltip text={offer.supplierName}><b>{offer.supplierName}</b></TruncatedTextTooltip><TruncatedTextTooltip text={offer.brand || "Каталог постачальника"}><span>{offer.brand || "Каталог постачальника"}</span></TruncatedTextTooltip><em>{offer.offerClass === "OEM" ? "Оригінал / OEM" : offer.offerClass === "ANALOG" ? "Аналог / крос" : "Ручна перевірка"}</em></div><div className={styles.offerMetric}><small>Ціна постачальника</small><b>{formatMoney(offer.purchasePrice, offer.currency)}</b><small>Доставка</small><span>Уточнюється API</span></div><div className={styles.offerMetric}><small>В наявності</small><b className={offer.available ? styles.available : styles.unavailable}>{offer.available ? "Так" : "Уточнити"}</b><TruncatedTextTooltip text={offer.stock.length ? `Склад: ${offer.stock[0].warehouse}` : "Склад не вказаний"}><small>{offer.stock.length ? `Склад: ${offer.stock[0].warehouse}` : "Склад не вказаний"}</small></TruncatedTextTooltip></div><button type="button" className={styles.addButton} disabled={!offer.available || offer.purchasePrice == null || selectingOffer === key || !activeRecommendation} onClick={() => void selectOffer(offer)}>{selectingOffer === key ? "Зберігаю…" : "Додати"}</button></div></article>; })}</div><div className={styles.searchFooter}><span>Показано {offers.length} позицій</span><button type="button" onClick={() => setActiveTab(activeTab === "originals" ? "analogs" : "originals")} disabled={!offers.length}>Показати {activeTab === "originals" ? "аналоги" : "оригінали"} →</button></div>{providerErrors.length ? <div className={styles.warning}>Не всі API відповіли: {providerErrors.map((provider) => `${provider.id}${provider.message ? ` — ${provider.message}` : ""}`).join("; ")}</div> : null}<div className={styles.policyNote}>{message}</div></section>

    <section className={`${styles.column} ${styles.proposalColumn}`}><div className={styles.columnTitle}><span className={styles.step}>3</span><div><b>Крок 3 · Пропозиція</b><small>Позиції, які увійдуть до Комерційної пропозиції</small></div></div><div className={styles.approvalLine}><span>Погодження клієнта</span><b>Чернетка</b></div><div className={styles.proposalTable}><div className={styles.proposalHead}><span>№</span><span>Деталь</span><span>К-ть</span><span>Постачальник</span><span>Ціна для клієнта</span></div>{selectedLines.length ? selectedLines.map((line, index) => <div className={styles.proposalRow} key={line.findingId}><span>{index + 1}</span><span><b>{line.partName}</b><small>{line.brand ? `${line.brand} · ` : ""}{line.article}</small></span><span>{line.quantity} шт</span><span>{line.supplierName}</span><span className={styles.sellPrice}>{formatMoney(line.sellPrice * line.quantity, line.currency)}</span></div>) : <div className={styles.proposalEmpty}><span>+</span><b>Додайте підібрану деталь</b><small>Виберіть постачальника в другому кроці — позиція з’явиться тут.</small></div>}</div><div className={styles.totalBox}><span>Разом</span><div><small>Закупівельна ціна</small><b>{formatMoney(selectedPurchaseTotal, "UAH")}</b></div><div className={styles.totalSell}><small>Ціна для клієнта</small><b>{formatMoney(selectedSellTotal, "UAH")}</b></div></div><div className={styles.markupNotice}><span>ⓘ</span><div><b>Закупівельна ціна × 1,40</b><small>Націнка формується автоматично з налаштувань CRM і не вводиться вручну.</small></div></div><div className={styles.deliveryBox}><b>Доставка</b><span>Термін уточнюється після вибору постачальника та складу.</span></div><div className={styles.proposalActions}><button type="button" onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "estimate" })} disabled={!context.workOrderId || !selectedLines.length}>Підготувати до погодження</button><button type="button" className={styles.actionPrimary} onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "parts" })} disabled={!context.workOrderId || !selectedLines.length}>Відкрити в ЗН →</button></div></section>
  </div></div>;
  */
}
