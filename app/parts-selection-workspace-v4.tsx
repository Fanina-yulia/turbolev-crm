"use client";

import { useEffect, useMemo, useState } from "react";
import { navigateCrm, readCrmRoute, type CrmRouteParams } from "./crm-route";
import styles from "./parts-selection-workspace-v4.module.css";

type SupplierOffer = {
  supplierId: string;
  supplierName: string;
  externalProductId: string | null;
  article: string;
  brand: string | null;
  name: string;
  purchasePrice: number | null;
  sellPrice?: number | null;
  markupPercent?: number | null;
  currency: string | null;
  stock: Array<{ warehouse: string; quantity: string; warehouseId?: string | null }>;
  stockTotal?: number | null;
  available: boolean;
  imageUrl?: string | null;
  resultType?: "ORIGINAL" | "OEM_REPLACEMENT" | "ANALOG" | "ASSEMBLY" | "UNKNOWN";
  compatibilityTier?: "CONFIRMED" | "PARTIAL" | "REVIEW_REQUIRED" | "UNCONFIRMED";
  fitmentStatus?: string;
  fitmentExact?: boolean | null;
  fitmentReason?: string | null;
  fitmentSource?: string | null;
  catalogProductId?: string | null;
  offerReason?: string | null;
  matchReasons?: string[];
  sourceKind?: "DIRECT" | "OEM" | "ANALOG" | "NAME" | "ASSEMBLY";
  requiresManualConfirmation?: boolean;
  deliveryEstimate?: string | null;
  oeNumbers?: string[];
  analogOfArticle?: string | null;
};

type SupplierProvider = { id: string; ok: boolean; message?: string };
type FitmentPayload = {
  status?: string;
  exact?: boolean;
  reason?: string;
  source?: string | null;
  normalization?: { canonicalName?: string | null; confidence?: number } | null;
};

type Recommendation = {
  key: string;
  findingId: string;
  manualPartId: string | null;
  lineId: string | null;
  description: string;
  genericArticleId: string | null;
  catalogCode: string | null;
  article: string | null;
  position: string | null;
  quantity: number;
  canonicalCode: string | null;
  axis: string | null;
  side: string | null;
  subPosition: string | null;
};

type Context = {
  workOrderId: string | null;
  orderNumber: string;
  clientName: string;
  clientPhone: string;
  vehicleId: string | null;
  vehicleName: string;
  plateNumber: string | null;
  vin: string | null;
  mileageKm: number | null;
  workOrderStatus: string;
};

type CartLine = {
  lineId: string;
  findingKey: string;
  findingId: string | null;
  manualPartId: string | null;
  partName: string;
  supplierId: string | null;
  supplierName: string;
  article: string;
  brand: string | null;
  warehouse: string | null;
  purchasePrice: number;
  sellPrice: number;
  markupPercent: number;
  currency: string;
  quantity: number;
  externalProductId: string | null;
  manualFields: string[];
  priceOverrideReason: string | null;
  editable: boolean;
  lockReason: string | null;
};

type EditDraft = {
  quantity: string;
  article: string;
  brand: string;
  partName: string;
  supplierName: string;
  warehouse: string;
  purchasePrice: string;
  sellPrice: string;
  markupPercent: string;
  priceOverrideReason: string;
  sellPriceTouched: boolean;
  markupTouched: boolean;
};

type HandoffSuggestion = {
  findingId?: string;
  manualPartId?: string | null;
  kind?: "LABOR" | "PART";
  description?: string;
  genericArticleId?: string | null;
  catalogCode?: string | null;
  article?: string | null;
  position?: string | null;
  quantity?: number;
  lineId?: string | null;
};

type StructuredPayload = {
  ok?: boolean;
  diagnostic?: {
    workOrder?: { id?: string; status?: string } | null;
    client?: { name?: string | null; phone?: string | null } | null;
    vehicle?: { id?: string; brand?: string | null; model?: string | null; year?: number | null; label?: string | null; plateNumber?: string | null; vin?: string | null; mileageKm?: number | null } | null;
  };
  inspections?: Array<{ sections?: Array<{ items?: Array<{ part?: { code?: string | null; axis?: string | null; side?: string | null; subPosition?: string | null; position?: string | null } | null; finding?: { id?: string | null } | null }> }> }>;
};

type SortKey = "price" | "brand" | "availability" | "delivery";
type SortDirection = "asc" | "desc";

const SUPPLIER_CODES: Record<string, string> = {
  "unique-trade": "UTR",
  "bm-parts": "BM",
  "autonova-d": "AD",
  atl: "ATL",
};

function money(value: number | null | undefined, currency: string | null | undefined = "UAH") {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("uk-UA", { style: "currency", currency: currency || "UAH", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ""}`.trim();
  }
}

function numberValue(value: string, fallback = 0) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function supplierCode(offer: SupplierOffer) {
  return SUPPLIER_CODES[offer.supplierId] || offer.supplierId.slice(0, 4).toUpperCase();
}

function recommendationKey(item: { manualPartId?: string | null; findingId?: string | null }) {
  return item.manualPartId || item.findingId || "";
}

function isReviewOffer(offer: SupplierOffer) {
  return offer.requiresManualConfirmation === true
    || offer.fitmentStatus !== "VERIFIED"
    || offer.fitmentExact === false
    || offer.compatibilityTier === "REVIEW_REQUIRED"
    || offer.compatibilityTier === "UNCONFIRMED";
}

function compatibilityLabel(offer: SupplierOffer) {
  if (offer.resultType === "ASSEMBLY") return "Комплект · перевірити";
  if (offer.compatibilityTier === "CONFIRMED" && offer.fitmentStatus === "VERIFIED" && offer.fitmentExact !== false) return "✓ підтверджено VIN";
  if (offer.compatibilityTier === "PARTIAL" || offer.fitmentExact === false) return "◐ підтримано OE/крос · перевірити";
  return "! сумісність не підтверджена";
}

function availabilityRank(offer: SupplierOffer) {
  if (!offer.available) return 3;
  if ((offer.stockTotal || 0) > 0 || offer.stock.some((row) => Number(row.quantity.replace(/[^0-9.,-]/g, "").replace(",", ".")) > 0)) return 0;
  return 1;
}

function deliveryRank(value: string | null | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER - 1;
}

function manualMarker(line: CartLine, field: string) {
  return line.manualFields.includes(field) ? <small className={styles.manualMarker}>ручн.</small> : null;
}

export function PartsSelectionWorkspaceV4() {
  const [route, setRoute] = useState<CrmRouteParams>(() => readCrmRoute());
  const [context, setContext] = useState<Context | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [q, setQ] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [fitment, setFitment] = useState<FitmentPayload | null>(null);
  const [providers, setProviders] = useState<SupplierProvider[]>([]);
  const [configuredSuppliers, setConfiguredSuppliers] = useState<string[]>([]);
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  const [manualConfirmation, setManualConfirmation] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectingKey, setSelectingKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [editingLineId, setEditingLineId] = useState("");
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const sync = () => setRoute(readCrmRoute());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const diagnosticId = route.diagnosticId || "";

  async function loadCart(id = diagnosticId) {
    if (!id) return;
    const response = await fetch(`/api/parts-selection/line?diagnosticId=${encodeURIComponent(id)}`, { cache: "no-store", credentials: "include" });
    const payload = await response.json().catch(() => null) as { ok?: boolean; rows?: CartLine[]; error?: string; message?: string } | null;
    if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error || "Не вдалося завантажити кошик запчастин.");
    setCart(Array.isArray(payload.rows) ? payload.rows : []);
  }

  async function loadWorkspace() {
    if (!diagnosticId) return;
    setLoading(true);
    setMessage("");
    try {
      const [structuredResponse, handoffResponse] = await Promise.all([
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/structured`, { cache: "no-store", credentials: "include" }),
        fetch(`/api/diagnostics/${encodeURIComponent(diagnosticId)}/commercial-handoff`, { cache: "no-store", credentials: "include" }),
      ]);
      const structured = await structuredResponse.json().catch(() => null) as StructuredPayload | null;
      const handoff = await handoffResponse.json().catch(() => null) as { ok?: boolean; suggestions?: HandoffSuggestion[]; error?: string; message?: string } | null;
      if (!structuredResponse.ok || !structured?.ok) throw new Error("Не вдалося завантажити контекст Діагностичної карти.");
      if (!handoffResponse.ok || !handoff?.ok) throw new Error(handoff?.message || handoff?.error || "Не вдалося завантажити рекомендації запчастин.");

      const vehicle = structured.diagnostic?.vehicle;
      const workOrder = structured.diagnostic?.workOrder;
      setContext({
        workOrderId: workOrder?.id || route.workOrderId || null,
        orderNumber: route.workOrderNumber || "ЗН-—",
        clientName: structured.diagnostic?.client?.name || "Клієнт не вказаний",
        clientPhone: structured.diagnostic?.client?.phone || "—",
        vehicleId: vehicle?.id || route.vehicleId || null,
        vehicleName: vehicle?.label || [vehicle?.brand, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "Автомобіль",
        plateNumber: vehicle?.plateNumber || route.plate || null,
        vin: vehicle?.vin || route.vin || null,
        mileageKm: vehicle?.mileageKm ?? null,
        workOrderStatus: workOrder?.status || "PARTS_REVIEW",
      });

      const metaByFinding = new Map<string, { canonicalCode: string | null; axis: string | null; side: string | null; subPosition: string | null; position: string | null }>();
      for (const inspection of structured.inspections || []) {
        for (const section of inspection.sections || []) {
          for (const item of section.items || []) {
            const findingId = item.finding?.id || "";
            if (!findingId) continue;
            metaByFinding.set(findingId, {
              canonicalCode: item.part?.code || null,
              axis: item.part?.axis || null,
              side: item.part?.side || null,
              subPosition: item.part?.subPosition || null,
              position: item.part?.position || null,
            });
          }
        }
      }

      const nextRecommendations = (handoff.suggestions || []).filter((item) => item.kind === "PART").map((item) => {
        const findingId = item.findingId || "";
        const manualPartId = item.manualPartId || null;
        const meta = metaByFinding.get(findingId);
        return {
          key: recommendationKey({ findingId, manualPartId }),
          findingId,
          manualPartId,
          lineId: item.lineId || null,
          description: item.description || "Деталь",
          genericArticleId: item.genericArticleId || null,
          catalogCode: item.catalogCode || null,
          article: item.article || null,
          position: item.position || meta?.position || null,
          quantity: Number(item.quantity || 1),
          canonicalCode: meta?.canonicalCode || item.catalogCode || null,
          axis: meta?.axis || null,
          side: meta?.side || null,
          subPosition: meta?.subPosition || null,
        } satisfies Recommendation;
      }).filter((item) => Boolean(item.key));
      setRecommendations(nextRecommendations);
      const requestedKey = route.manualPartId || route.findingId || nextRecommendations[0]?.key || "";
      setActiveKey(requestedKey);
      const first = nextRecommendations.find((item) => item.key === requestedKey) || nextRecommendations[0];
      if (first) setQ(first.article || first.description);
      await loadCart(diagnosticId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося завантажити підбір запчастин.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticId]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const activeRecommendation = useMemo(() => recommendations.find((item) => item.key === activeKey) || null, [recommendations, activeKey]);
  const selectedLine = useMemo(() => cart.find((line) => line.findingKey === activeKey) || null, [cart, activeKey]);
  const supplierOptions = useMemo(() => [...new Map(offers.map((offer) => [offer.supplierId, offer.supplierName])).entries()], [offers]);

  const filteredOffers = useMemo(() => {
    const filtered = offers.filter((offer) => supplierFilter === "ALL" || offer.supplierId === supplierFilter);
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (sortKey === "price") return direction * ((left.purchasePrice ?? Number.MAX_SAFE_INTEGER) - (right.purchasePrice ?? Number.MAX_SAFE_INTEGER));
      if (sortKey === "brand") return direction * (left.brand || "").localeCompare(right.brand || "", "uk");
      if (sortKey === "availability") return direction * (availabilityRank(left) - availabilityRank(right));
      return direction * (deliveryRank(left.deliveryEstimate) - deliveryRank(right.deliveryEstimate));
    });
  }, [offers, supplierFilter, sortDirection, sortKey]);

  const groupedOffers = useMemo(() => {
    const originals: SupplierOffer[] = [];
    const analogs: SupplierOffer[] = [];
    const review: SupplierOffer[] = [];
    const assemblies: SupplierOffer[] = [];
    for (const offer of filteredOffers) {
      if (offer.resultType === "ASSEMBLY" || offer.sourceKind === "ASSEMBLY") assemblies.push(offer);
      else if (offer.resultType === "ORIGINAL" || offer.resultType === "OEM_REPLACEMENT") originals.push(offer);
      else if (offer.resultType === "ANALOG" || offer.sourceKind === "ANALOG") analogs.push(offer);
      else review.push(offer);
    }
    return [
      { key: "originals", title: "Оригінали", rows: originals },
      { key: "analogs", title: "Аналоги", rows: analogs },
      { key: "review", title: "Потребує перевірки", rows: review },
      { key: "assemblies", title: "Комплектні альтернативи", rows: assemblies },
    ];
  }, [filteredOffers]);

  const needsManualConfirmation = offers.some(isReviewOffer) || offers.some((offer) => offer.resultType === "ASSEMBLY");
  const providerErrors = providers.filter((provider) => !provider.ok);
  const totals = useMemo(() => cart.reduce((acc, line) => {
    acc.purchase += line.purchasePrice * line.quantity;
    acc.sell += line.sellPrice * line.quantity;
    acc.profit += (line.sellPrice - line.purchasePrice) * line.quantity;
    return acc;
  }, { purchase: 0, sell: 0, profit: 0 }), [cart]);

  function toggleSort(next: SortKey) {
    if (sortKey === next) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection("asc");
    }
  }

  async function searchPart(recommendation = activeRecommendation) {
    if (!recommendation) return;
    const query = q.trim() || recommendation.article || recommendation.description;
    if (query.length < 2) {
      setMessage("Введіть щонайменше 2 символи назви або артикулу.");
      return;
    }
    setSearching(true);
    setOffers([]);
    setProviders([]);
    setConfiguredSuppliers([]);
    setSupplierFilter("ALL");
    setManualConfirmation(false);
    setMessage("");
    try {
      const params = new URLSearchParams({ q: query });
      const vin = context?.vin || route.vin || "";
      const vehicleId = context?.vehicleId || route.vehicleId || "";
      const plate = context?.plateNumber || route.plate || "";
      if (vin) params.set("vin", vin);
      if (vehicleId) params.set("vehicleId", vehicleId);
      if (plate) params.set("plate", plate);
      if (recommendation.findingId) params.set("findingId", recommendation.findingId);
      if (recommendation.manualPartId) params.set("manualPartId", recommendation.manualPartId);
      params.set("partName", recommendation.description);
      if (recommendation.canonicalCode) params.set("canonicalCode", recommendation.canonicalCode);
      if (recommendation.axis) params.set("axis", recommendation.axis);
      if (recommendation.side) params.set("side", recommendation.side);
      if (recommendation.subPosition) params.set("subPosition", recommendation.subPosition);
      if (recommendation.position) params.set("position", recommendation.position);
      if (recommendation.genericArticleId) params.set("genericArticleId", recommendation.genericArticleId);

      const referenceResponse = await fetch(`/api/parts/search?${params.toString()}`, { cache: "no-store", credentials: "include" });
      const reference = await referenceResponse.json().catch(() => null) as { fitment?: FitmentPayload | null; oeNumbers?: string[]; error?: string } | null;
      if (!referenceResponse.ok) throw new Error(reference?.error || "Довідковий каталог тимчасово недоступний.");

      const supplierParams = new URLSearchParams(params);
      if (Array.isArray(reference?.oeNumbers) && reference.oeNumbers.length) supplierParams.set("oeNumbers", reference.oeNumbers.join(","));
      const supplierResponse = await fetch(`/api/parts/suppliers?${supplierParams.toString()}`, { cache: "no-store", credentials: "include" });
      const supplier = await supplierResponse.json().catch(() => null) as { offers?: SupplierOffer[]; providers?: SupplierProvider[]; configuredSuppliers?: string[]; fitment?: FitmentPayload | null; error?: string } | null;
      if (!supplierResponse.ok) throw new Error(supplier?.error || "Постачальники тимчасово недоступні.");
      setOffers(Array.isArray(supplier?.offers) ? supplier.offers : []);
      setProviders(Array.isArray(supplier?.providers) ? supplier.providers : []);
      setConfiguredSuppliers(Array.isArray(supplier?.configuredSuppliers) ? supplier.configuredSuppliers : []);
      setFitment(supplier?.fitment || reference?.fitment || null);
      setMessage(Array.isArray(supplier?.offers) && supplier.offers.length ? "Пропозиції отримано. Оберіть рядок або скористайтеся сортуванням." : "Постачальники відповіли, але пропозицій за цим запитом не знайдено.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося виконати пошук.");
    } finally {
      setSearching(false);
    }
  }

  function openPicker(item: Recommendation) {
    setActiveKey(item.key);
    setQ(item.article || item.description);
    setPickerOpen(true);
    setOffers([]);
    setFitment(null);
    setMessage("");
    void searchPart(item);
  }

  async function selectOffer(offer: SupplierOffer) {
    if (!activeRecommendation || !diagnosticId) return;
    const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`;
    const review = isReviewOffer(offer) || offer.resultType === "ASSEMBLY";
    if (review && !manualConfirmation) {
      setMessage("Перед додаванням непідтвердженої пропозиції підтвердьте ручну перевірку сумісності.");
      return;
    }
    setSelectingKey(key);
    try {
      const response = await fetch("/api/parts-selection/select", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnosticId,
          findingId: activeRecommendation.findingId || null,
          manualPartId: activeRecommendation.manualPartId,
          quantity: activeRecommendation.quantity,
          supplierId: offer.supplierId,
          externalProductId: offer.externalProductId,
          article: offer.article,
          searchMode: offer.fitmentStatus === "VERIFIED" && offer.fitmentExact !== false && context?.vin?.length === 17 && !review ? "VIN" : "PART_NUMBER",
          vehicleVin: context?.vin || null,
          vehicleId: context?.vehicleId || null,
          partName: activeRecommendation.description,
          genericArticleId: activeRecommendation.genericArticleId,
          canonicalCode: activeRecommendation.canonicalCode || activeRecommendation.catalogCode,
          axis: activeRecommendation.axis,
          side: activeRecommendation.side,
          subPosition: activeRecommendation.subPosition,
          position: activeRecommendation.position,
          fitmentStatus: offer.fitmentStatus || fitment?.status || null,
          fitmentExact: offer.fitmentExact ?? fitment?.exact ?? null,
          fitmentProductId: offer.catalogProductId || null,
          fitmentSource: offer.fitmentSource || fitment?.source || null,
          manualConfirmation: review ? manualConfirmation : false,
          resultType: offer.resultType || null,
          compatibilityTier: offer.compatibilityTier || null,
          sourceKind: offer.sourceKind || null,
          offerReason: offer.offerReason || offer.fitmentReason || null,
          matchReasons: offer.matchReasons || [],
          requiresManualConfirmation: review,
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || payload?.error || "Не вдалося зберегти деталь.");
      await loadCart();
      setPickerOpen(false);
      setMessage(`Деталь ${offer.brand || ""} ${offer.article}`.trim() + " додана до кошика.");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося зберегти вибрану деталь.");
    } finally {
      setSelectingKey("");
    }
  }

  function beginEdit(line: CartLine) {
    setEditingLineId(line.lineId);
    setDraft({
      quantity: String(line.quantity),
      article: line.article || "",
      brand: line.brand || "",
      partName: line.partName || "",
      supplierName: line.supplierName || "",
      warehouse: line.warehouse || "",
      purchasePrice: String(line.purchasePrice),
      sellPrice: String(line.sellPrice),
      markupPercent: String(line.markupPercent),
      priceOverrideReason: line.priceOverrideReason || "",
      sellPriceTouched: false,
      markupTouched: false,
    });
  }

  function updateDraft(field: keyof EditDraft, value: string | boolean) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value } as EditDraft;
      if (field === "sellPrice") next.sellPriceTouched = true;
      if (field === "markupPercent") next.markupTouched = true;
      if ((field === "purchasePrice" || field === "markupPercent") && !next.sellPriceTouched) {
        const purchase = numberValue(next.purchasePrice);
        const markup = numberValue(next.markupPercent);
        next.sellPrice = String(round2(purchase * (1 + markup / 100)));
      }
      return next;
    });
  }

  async function saveEdit(line: CartLine) {
    if (!draft || !diagnosticId) return;
    setSavingEdit(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = {
        diagnosticId,
        lineId: line.lineId,
        quantity: numberValue(draft.quantity),
        article: draft.article,
        brand: draft.brand,
        partName: draft.partName,
        supplierName: draft.supplierName,
        warehouse: draft.warehouse,
        purchasePrice: numberValue(draft.purchasePrice),
      };
      if (draft.sellPriceTouched) {
        body.sellPrice = numberValue(draft.sellPrice);
        body.priceOverrideReason = draft.priceOverrideReason;
        if (draft.markupTouched) body.markupPercent = numberValue(draft.markupPercent);
      } else {
        body.markupPercent = numberValue(draft.markupPercent);
      }
      const response = await fetch("/api/parts-selection/line", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as { ok?: boolean; row?: CartLine; error?: string; message?: string } | null;
      if (!response.ok || !payload?.ok || !payload.row) throw new Error(payload?.message || payload?.error || "Не вдалося зберегти зміни.");
      setCart((current) => current.map((item) => item.lineId === line.lineId ? payload.row! : item));
      setEditingLineId("");
      setDraft(null);
      setMessage("Зміни кошика збережено та синхронізовано із замовленням-нарядом і заявкою на запчастини.");
      window.dispatchEvent(new CustomEvent("turbolev:data-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не вдалося зберегти зміни кошика.");
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) return <div className={styles.loading}>Завантажую Діагностичну карту, кошик та постачальників…</div>;
  if (!context) return <div className={styles.loading}>{message || "Контекст підбору недоступний."}</div>;

  return <div className={styles.page}>
    <section className={styles.contextBar}>
      <div><small>ЗН</small><b>{context.orderNumber}</b></div>
      <div><small>Автомобіль</small><b>{context.vehicleName}</b><span>{context.plateNumber || "номер не вказаний"}</span></div>
      <div><small>VIN</small><b>{context.vin || "не вказаний"}</b></div>
      <div><small>Клієнт</small><b>{context.clientName}</b><span>{context.clientPhone}</span></div>
      <button type="button" onClick={() => navigateCrm("Підбір запчастин", {})}>← До центру</button>
    </section>

    <div className={styles.workspace}>
      <section className={styles.needsPanel}>
        <header><div><p>ПОТРЕБИ · {recommendations.length}</p><h2>Деталі до заміни</h2></div><span>{cart.length}/{recommendations.length}</span></header>
        <div className={styles.needsList}>{recommendations.length ? recommendations.map((item, index) => {
          const line = cart.find((row) => row.findingKey === item.key);
          return <button type="button" key={item.key} className={`${styles.needRow} ${item.key === activeKey ? styles.needRowActive : ""}`} onClick={() => openPicker(item)}>
            <span>{index + 1}</span><div><b>{item.description}</b><small>{item.position || "Позиція не вказана"}</small></div><em>{item.quantity} шт</em><strong>{line ? "✓ вибрано" : "+ підібрати"}</strong>
          </button>;
        }) : <div className={styles.empty}>У Діагностичній карті немає позицій до заміни.</div>}</div>
      </section>

      <section className={styles.cartPanel}>
        <header className={styles.cartHeader}><div><p>КОШИК · {cart.length}</p><h2>Вибрані деталі</h2><span>API-дані заповнюються автоматично. Будь-яке ручне редагування фіксується в аудиті.</span></div><div><b>{money(totals.sell)}</b><small>продаж · прибуток {money(totals.profit)}</small></div></header>
        <div className={styles.tableScroll}>
          <table className={styles.cartTable}>
            <thead><tr><th>№</th><th>К-сть, шт.</th><th>Артикул</th><th>Бренд</th><th>Номенклатура</th><th>Постачальник</th><th>Склад</th><th>Ціна закупки, грн</th><th>Сума закупки, грн</th><th>Ціна продажу, грн</th><th>Сума продажу, грн</th><th>Прибуток, грн</th><th>%</th><th>Дія</th></tr></thead>
            <tbody>{cart.length ? cart.map((line, index) => {
              const editing = editingLineId === line.lineId && draft;
              const recommendation = recommendations.find((item) => item.key === line.findingKey);
              const purchaseTotal = line.purchasePrice * line.quantity;
              const sellTotal = line.sellPrice * line.quantity;
              const profit = (line.sellPrice - line.purchasePrice) * line.quantity;
              if (editing && draft) {
                const editQuantity = numberValue(draft.quantity);
                const editPurchase = numberValue(draft.purchasePrice);
                const editSell = numberValue(draft.sellPrice);
                const editPurchaseTotal = editQuantity * editPurchase;
                const editSellTotal = editQuantity * editSell;
                return <tr key={line.lineId} className={styles.editRow}>
                  <td>{index + 1}</td>
                  <td><input value={draft.quantity} onChange={(event) => updateDraft("quantity", event.target.value)} inputMode="decimal"/></td>
                  <td><input value={draft.article} onChange={(event) => updateDraft("article", event.target.value)}/></td>
                  <td><input value={draft.brand} onChange={(event) => updateDraft("brand", event.target.value)}/></td>
                  <td><input value={draft.partName} onChange={(event) => updateDraft("partName", event.target.value)}/></td>
                  <td><input value={draft.supplierName} onChange={(event) => updateDraft("supplierName", event.target.value)}/></td>
                  <td><input value={draft.warehouse} onChange={(event) => updateDraft("warehouse", event.target.value)}/></td>
                  <td><input value={draft.purchasePrice} onChange={(event) => updateDraft("purchasePrice", event.target.value)} inputMode="decimal"/></td>
                  <td className={styles.derived}>{money(editPurchaseTotal)}</td>
                  <td><input value={draft.sellPrice} onChange={(event) => updateDraft("sellPrice", event.target.value)} inputMode="decimal"/></td>
                  <td className={styles.derived}>{money(editSellTotal)}</td>
                  <td className={styles.profit}>{money(editSellTotal - editPurchaseTotal)}</td>
                  <td><input value={draft.markupPercent} onChange={(event) => updateDraft("markupPercent", event.target.value)} inputMode="decimal"/></td>
                  <td><div className={styles.rowActions}><button type="button" disabled={savingEdit || !line.editable} onClick={() => void saveEdit(line)}>{savingEdit ? "…" : "Зберегти"}</button><button type="button" onClick={() => { setEditingLineId(""); setDraft(null); }}>Скасувати</button></div>{draft.sellPriceTouched ? <input className={styles.reasonInput} value={draft.priceOverrideReason} onChange={(event) => updateDraft("priceOverrideReason", event.target.value)} placeholder="Причина зміни ціни, якщо % не збігається"/> : null}</td>
                </tr>;
              }
              return <tr key={line.lineId}>
                <td>{index + 1}</td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.quantity}{manualMarker(line, "quantity")}</button></td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.article || "— ✎"}{manualMarker(line, "article")}</button></td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.brand || "— ✎"}{manualMarker(line, "brand")}</button></td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.partName || "— ✎"}{manualMarker(line, "partName")}</button></td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.supplierName || "— ✎"}{manualMarker(line, "supplierName")}</button></td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.warehouse || "— ✎"}{manualMarker(line, "warehouse")}</button></td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{money(line.purchasePrice, line.currency)}{manualMarker(line, "purchasePrice")}</button></td>
                <td>{money(purchaseTotal, line.currency)}</td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{money(line.sellPrice, line.currency)}{manualMarker(line, "sellPrice")}</button></td>
                <td className={styles.sell}>{money(sellTotal, line.currency)}</td>
                <td className={styles.profit}>{money(profit, line.currency)}</td>
                <td><button className={styles.editableValue} type="button" onClick={() => beginEdit(line)}>{line.markupPercent}%{manualMarker(line, "markupPercent")}</button></td>
                <td><div className={styles.rowActions}><button type="button" disabled={!line.editable} onClick={() => beginEdit(line)}>Редагувати</button><button type="button" disabled={!recommendation} onClick={() => recommendation && openPicker(recommendation)}>Змінити</button></div>{!line.editable && line.lockReason ? <small className={styles.lockReason}>{line.lockReason}</small> : null}</td>
              </tr>;
            }) : <tr><td colSpan={14}><div className={styles.empty}>Кошик порожній. Натисніть «підібрати» біля потрібної деталі.</div></td></tr>}</tbody>
          </table>
        </div>
        <footer className={styles.cartFooter}><span>Закупка: <b>{money(totals.purchase)}</b></span><span>Продаж: <b>{money(totals.sell)}</b></span><span>Прибуток: <b>{money(totals.profit)}</b></span><button type="button" disabled={!context.workOrderId || !cart.length} onClick={() => context.workOrderId && navigateCrm("Замовлення-наряди", { workOrderId: context.workOrderId, workOrderTab: "estimate" })}>До комерційної пропозиції →</button></footer>
      </section>
    </div>

    {message ? <div className={styles.message} aria-live="polite">{message}</div> : null}

    {pickerOpen && activeRecommendation ? <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}>
      <section className={styles.picker} role="dialog" aria-modal="true" aria-labelledby="picker-v4-title">
        <header className={styles.pickerHeader}><div><p>ПІДБІР ДЕТАЛІ</p><h2 id="picker-v4-title">{activeRecommendation.description}</h2><span>{activeRecommendation.position || "Позиція з ДК"} · {activeRecommendation.quantity} шт</span></div><button type="button" onClick={() => setPickerOpen(false)} aria-label="Закрити">×</button></header>
        <div className={styles.searchBar}><label><span>OEM / артикул / назва</span><div><input value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchPart(); }}/><button type="button" onClick={() => void searchPart()} disabled={searching}>⌕</button></div></label><label><span>Автомобіль</span><b>{context.plateNumber || context.vin || "контекст авто"}</b></label></div>

        <div className={styles.resultToolbar}>
          <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}><option value="ALL">Усі постачальники</option>{supplierOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
          <strong>К-ть знайдених запчастин: {filteredOffers.length}</strong>
          <button type="button" className={sortKey === "brand" ? styles.sortActive : ""} onClick={() => toggleSort("brand")}>Бренд {sortKey === "brand" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button>
          <button type="button" className={sortKey === "price" ? styles.sortActive : ""} onClick={() => toggleSort("price")}>Ціна {sortKey === "price" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button>
          <button type="button" className={sortKey === "availability" ? styles.sortActive : ""} onClick={() => toggleSort("availability")}>Наявність {sortKey === "availability" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button>
          <button type="button" className={sortKey === "delivery" ? styles.sortActive : ""} onClick={() => toggleSort("delivery")}>Термін {sortKey === "delivery" ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</button>
        </div>

        <div className={styles.fitmentLine}><span>{fitment?.status === "VERIFIED" && fitment.exact !== false ? "✓ VIN-каталог підтверджено" : "! Точна сумісність не підтверджена"}</span><span>{configuredSuppliers.length} API підключено</span>{fitment?.normalization?.canonicalName ? <span>Розпізнано: {fitment.normalization.canonicalName} · {fitment.normalization.confidence || 0}%</span> : null}</div>

        {needsManualConfirmation ? <label className={styles.manualConfirm}><input type="checkbox" checked={manualConfirmation} onChange={(event) => setManualConfirmation(event.target.checked)}/> Я вручну перевірив сумісність непідтверджених позицій для цього автомобіля</label> : null}

        <div className={styles.offerArea}>{searching ? <div className={styles.empty}>Шукаю BM Parts, UniTrade та інші підключені API…</div> : filteredOffers.length ? groupedOffers.map((group) => group.rows.length ? <section className={styles.offerGroup} key={group.key}><h3>{group.title}: <span>{group.rows.length}</span></h3><div className={styles.offerRows}>{group.rows.map((offer, index) => {
          const key = `${offer.supplierId}:${offer.externalProductId || offer.article}`;
          const selected = selectedLine && selectedLine.article === offer.article && (selectedLine.supplierId === offer.supplierId || selectedLine.supplierName === offer.supplierName);
          const review = isReviewOffer(offer) || offer.resultType === "ASSEMBLY";
          const canAdd = offer.available && offer.purchasePrice != null && (!review || manualConfirmation) && selectingKey !== key;
          return <div className={`${styles.offerRow} ${selected ? styles.offerSelected : ""}`} key={`${key}-${index}`}>
            <div className={styles.offerIdentity}>{offer.imageUrl ? <img src={offer.imageUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }}/> : <span className={styles.noImage}>⚙</span>}<div><b>{offer.name}</b><small>{offer.offerReason || offer.fitmentReason || "Пропозиція постачальника"}</small></div></div>
            <details className={styles.stockDetails}><summary>{offer.available ? "Наявність ⓘ" : "Уточнити ⓘ"}</summary><div>{offer.stock.length ? offer.stock.map((stock, stockIndex) => <span key={`${stock.warehouse}-${stockIndex}`}><b>{stock.warehouse}</b> · {stock.quantity}</span>) : <span>Постачальник не передав складські залишки.</span>}</div></details>
            <div className={styles.providerCell}><b>{supplierCode(offer)}</b><small>{offer.supplierName}</small></div>
            <div className={styles.brandCell}><span>{offer.brand || "Бренд —"}</span><b>{offer.article}</b>{offer.analogOfArticle ? <small>крос від {offer.analogOfArticle}</small> : offer.oeNumbers?.length ? <small>OE {offer.oeNumbers[0]}</small> : null}</div>
            <div className={review ? styles.compatWarn : styles.compatOk}>{compatibilityLabel(offer)}</div>
            <div className={styles.priceCell}><b>{money(offer.purchasePrice, offer.currency)}</b>{offer.sellPrice != null ? <small>продаж {money(offer.sellPrice, offer.currency)}</small> : null}</div>
            <button type="button" className={styles.addOffer} disabled={!canAdd} onClick={() => void selectOffer(offer)}>{selectingKey === key ? "Зберігаю…" : selected ? "Вибрано" : review && !manualConfirmation ? "Перевірити" : "Додати"}</button>
          </div>;
        })}</div></section> : null) : <div className={styles.empty}>Пропозицій не знайдено. Спробуйте інший артикул або назву.</div>}</div>

        {providerErrors.length ? <div className={styles.providerErrors}>Не всі API відповіли: {providerErrors.map((provider) => `${provider.id}${provider.message ? ` — ${provider.message}` : ""}`).join("; ")}</div> : null}
        <footer className={styles.pickerFooter}><span>{message}</span><button type="button" onClick={() => setPickerOpen(false)}>Закрити</button></footer>
      </section>
    </div> : null}
  </div>;
}
