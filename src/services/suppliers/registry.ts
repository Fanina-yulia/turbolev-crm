import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { bmPartsAdapter } from "./bm-parts.adapter";
import { uniqueTradeAdapter } from "./unique-trade.adapter";
import type { PartFitmentStatus } from "@/src/services/parts-fitment.service";
import { normalizeCatalogNumber } from "@/src/services/parts-fitment.service";
import { buildKnowledgeProviderPartQueryCandidates } from "@/src/services/parts-knowledge.service";
import type {
  SupplierAdapter,
  SupplierConnectionCheck,
  SupplierId,
  SupplierOffer,
  SupplierStatus,
  SupplierVehicleContext,
} from "./types";

const autoNovaAdapter: SupplierAdapter = {
  id: "autonova-d",
  name: "Автонова-Д",
  website: "https://autonovad.ua/",
  apiBaseUrl: null,
  authType: "Окремий API-доступ через менеджера",
  capabilities: ["SEARCH", "PRICE", "STOCK", "WAREHOUSES", "VIN"],
  setupHint: "API credentials додаються в CRM після отримання офіційної документації Автонова-Д.",
  async isConfigured() {
    const config = await getIntegrationCredential("AUTONOVA_D");
    return Boolean(config?.baseUrl && config?.login && config?.password);
  },
  async testConnection(): Promise<SupplierConnectionCheck> {
    const configured = await this.isConfigured();
    return {
      ok: false,
      state: configured ? "MANUAL_SETUP" : "NOT_CONFIGURED",
      message: configured
        ? "Доступи збережені. Очікуємо офіційну API-документацію Автонова-Д для live-перевірки."
        : "Потрібно отримати API credentials Автонова-Д.",
      checkedAt: new Date().toISOString(),
    };
  },
  async search(): Promise<SupplierOffer[]> {
    return [];
  },
};

const atlAdapter: SupplierAdapter = {
  id: "atl",
  name: "ATL",
  website: "https://atl.ua/",
  apiBaseUrl: null,
  authType: "B2B / API доступ після підтвердження ATL",
  capabilities: ["SEARCH", "PRICE", "STOCK", "WAREHOUSES", "VIN"],
  setupHint: "Збережіть B2B-доступи в Налаштуваннях. Live-пошук увімкнемо після отримання офіційного API endpoint/контракту ATL.",
  async isConfigured() {
    const config = await getIntegrationCredential("ATL");
    return Boolean(config?.login && config?.password);
  },
  async testConnection(): Promise<SupplierConnectionCheck> {
    const configured = await this.isConfigured();
    return {
      ok: false,
      state: configured ? "MANUAL_SETUP" : "NOT_CONFIGURED",
      message: configured
        ? "Доступи ATL збережені. Live API не вмикаємо без офіційного endpoint і документації."
        : "Додайте B2B/API доступи ATL у Налаштуваннях.",
      checkedAt: new Date().toISOString(),
    };
  },
  async search(): Promise<SupplierOffer[]> {
    return [];
  },
};

export const supplierAdapters: SupplierAdapter[] = [bmPartsAdapter, uniqueTradeAdapter, autoNovaAdapter, atlAdapter];

const SUPPLIER_REQUEST_TIMEOUT_MS = 8_000;
const MAX_SUPPLIER_SEARCH_QUERIES = 4;
const MAX_PROVIDER_SEARCH_QUERIES = 3;

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = SUPPLIER_REQUEST_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} не відповів за ${Math.round(timeoutMs / 1000)} с.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function getSupplierAdapter(id: SupplierId) {
  return supplierAdapters.find((adapter) => adapter.id === id) ?? null;
}

export async function listSupplierStatuses(): Promise<SupplierStatus[]> {
  return Promise.all(supplierAdapters.map(async (adapter) => {
    const configured = await adapter.isConfigured();
    const needsManualApi = adapter.id === "autonova-d" || adapter.id === "atl";
    return {
      id: adapter.id,
      name: adapter.name,
      website: adapter.website,
      apiBaseUrl: adapter.apiBaseUrl,
      authType: adapter.authType,
      configured,
      state: needsManualApi && configured ? "MANUAL_SETUP" : configured ? "CONFIGURED" : "NOT_CONFIGURED",
      capabilities: adapter.capabilities,
      setupHint: adapter.setupHint,
    };
  }));
}

export async function testSupplier(id: SupplierId) {
  const adapter = getSupplierAdapter(id);
  if (!adapter) throw new Error("Невідомий постачальник.");
  return adapter.testConnection();
}

export type SupplierSearchContext = {
  vehicleId?: string | null;
  vin?: string | null;
  plate?: string | null;
  fitmentStatus?: PartFitmentStatus;
  fitmentConfidence?: number | null;
  fitmentExact?: boolean | null;
  fitmentSource?: string | null;
  fitmentReason?: string | null;
  providerVehicle?: SupplierVehicleContext | null;
  catalogArticles?: string[];
  analogArticles?: string[];
  analogReferences?: Array<{ brand: string | null; article: string }>;
  oeNumbers?: string[];
  normalizedQuery?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  axis?: string | null;
  side?: string | null;
  subPosition?: string | null;
  position?: string | null;
  genericArticleId?: string | null;
};

function looksLikePartNumber(value: string) {
  return /^[a-z0-9][a-z0-9._/\\-]{2,}$/iu.test(value.trim()) && /[0-9]/u.test(value);
}

function annotateOffer(offer: SupplierOffer, context: SupplierSearchContext): SupplierOffer {
  const article = normalizeCatalogNumber(offer.article);
  const catalogArticles = new Set((context.catalogArticles || []).map(normalizeCatalogNumber).filter(Boolean));
  const analogArticles = new Set((context.analogArticles || []).map(normalizeCatalogNumber).filter(Boolean));
  const oeNumbers = new Set((context.oeNumbers || []).map(normalizeCatalogNumber).filter(Boolean));
  const hasCatalogMatch = Boolean(article && (catalogArticles.has(article) || oeNumbers.has(article)));
  const isAnalog = Boolean(article && analogArticles.has(article));
  const isOeNumber = Boolean(article && oeNumbers.has(article));
  const vehicleScoped = Boolean(context.vehicleId?.trim() || context.vin?.trim() || context.plate?.trim());
  const offerClass = hasCatalogMatch
    ? isAnalog ? "ANALOG" as const : "OEM" as const
    : offer.sourceKind === "ANALOG" ? "ANALOG" as const
      : offer.offerClass || "UNKNOWN";
  const verified = context.fitmentStatus === "VERIFIED" && hasCatalogMatch;
  const offerReason = verified && isAnalog
    ? "Аналог підтверджений крос-номером у VIN-каталозі."
    : verified
      ? "Артикул знайдено у підтвердженому VIN-каталозі OE."
      : isOeNumber
        ? "Артикул збігається з OE-номером, але його застосовність ще потрібно перевірити."
        : offer.sourceKind === "ANALOG"
          ? "Постачальник повернув аналог; застосовність підтверджується вручну."
          : "Знайдено за запитом постачальника; потрібна ручна перевірка застосовності.";
  return {
    ...offer,
    offerClass,
    fitmentStatus: verified ? "VERIFIED" : vehicleScoped ? "MANUAL_REQUIRED" : context.fitmentStatus || "MANUAL_REQUIRED",
    fitmentConfidence: verified ? context.fitmentConfidence ?? null : 0,
    fitmentExact: verified ? context.fitmentExact ?? offer.fitmentExact ?? null : false,
    fitmentSource: verified ? context.fitmentSource || offer.fitmentSource || null : context.fitmentSource || null,
    fitmentReason: offerReason,
    offerReason,
  };
}

function offerKey(offer: SupplierOffer) {
  return `${offer.supplierId}:${offer.externalProductId || `${normalizeCatalogNumber(offer.brand)}:${normalizeCatalogNumber(offer.article)}`}`;
}

function offerRank(offer: SupplierOffer) {
  const fitment = offer.fitmentStatus === "VERIFIED" ? 100 : offer.fitmentStatus === "REFERENCE_ONLY" ? 30 : 0;
  const classification = offer.offerClass === "OEM" ? 20 : offer.offerClass === "ANALOG" ? 10 : 0;
  const availability = offer.available ? 5 : 0;
  return fitment + classification + availability;
}

function knowledgeProviderFor(adapter: SupplierAdapter) {
  if (adapter.id === "bm-parts") return "BM_PARTS" as const;
  if (adapter.id === "unique-trade") return "UNITRADE" as const;
  return null;
}

async function providerKnowledgeQueries(adapter: SupplierAdapter, query: string, context: SupplierSearchContext) {
  const provider = knowledgeProviderFor(adapter);
  if (!provider) return [];
  return buildKnowledgeProviderPartQueryCandidates({
    query,
    partName: context.partName || query,
    canonicalCode: context.canonicalCode,
    genericArticleId: context.genericArticleId,
    position: context.position,
    axis: context.axis,
    side: context.side,
    subPosition: context.subPosition,
    provider,
  });
}
async function vehicleScopedSearch(adapter: SupplierAdapter, query: string, limit: number, context: SupplierSearchContext) {
  const providerQueries = adapter.id === "bm-parts" ? [] : await providerKnowledgeQueries(adapter, query, context);
  const exactQueries = [...new Set([
    ...providerQueries,
    ...(context.oeNumbers || []),
    ...(context.catalogArticles || []),
    ...(context.analogArticles || []),
    ...(looksLikePartNumber(query) ? [query] : []),
  ].map((value) => value.trim()).filter((value) => value.length >= 2))].slice(0, MAX_PROVIDER_SEARCH_QUERIES * 2);

  if (adapter.id === "bm-parts" && adapter.searchVehicleParts && context.providerVehicle) {
    const result = await adapter.searchVehicleParts({
      query: query.trim(),
      vehicle: context.providerVehicle,
      limit: Math.min(Math.max(limit, 1), 50),
      position: null,
      canonicalPart: context.canonicalCode || context.partName
        ? { code: context.canonicalCode || null, name: context.partName || query, genericArticleId: context.genericArticleId || null }
        : null,
    });
    return result.map((item) => item.offer);
  }

  if (!exactQueries.length) return [];
  const perQueryLimit = Math.max(2, Math.ceil(limit / exactQueries.length));
  const batches = await Promise.allSettled(exactQueries.map((searchQuery) => adapter.search(searchQuery, perQueryLimit)));
  return batches.flatMap((batch) => batch.status === "fulfilled" ? batch.value : []);
}

export async function searchConfiguredSuppliers(query: string, limitPerSupplier = 20, context: SupplierSearchContext = {}) {
  const statuses = await listSupplierStatuses();
  const configuredIds = new Set(statuses.filter((supplier) => supplier.configured).map((supplier) => supplier.id));
  const vehicleScoped = Boolean(context.vehicleId?.trim() || context.vin?.trim() || context.plate?.trim());
  // A vehicle context must not suppress the supplier request. Use the VIN/OE
  // scoped adapter search only after fitment is verified; otherwise run the
  // ordinary article/name search and mark every returned offer for manual
  // compatibility confirmation in annotateOffer().
  const useVehicleScopedSearch = vehicleScoped && context.fitmentStatus === "VERIFIED";

  const searchable = supplierAdapters
    .filter((adapter) => adapter.id !== "autonova-d" && adapter.id !== "atl" && configuredIds.has(adapter.id));

  const queries = [...new Set([
    context.normalizedQuery?.trim() || "",
    query.trim(),
    ...(context.oeNumbers || []).slice(0, 3),
    ...(context.catalogArticles || []).slice(0, 3),
  ].filter((value) => value.length >= 2))].slice(0, MAX_SUPPLIER_SEARCH_QUERIES);
  const searchQueries = queries.length ? queries : [query.trim()];

  const settled = await Promise.allSettled(searchable.map((adapter) => withTimeout((async () => {
    if (useVehicleScopedSearch) return vehicleScopedSearch(adapter, query, limitPerSupplier, context);
    const providerQueries = await providerKnowledgeQueries(adapter, query, context);
    const adapterSearchQueries = [...new Set([...providerQueries, ...searchQueries])].slice(0, MAX_SUPPLIER_SEARCH_QUERIES);
    const adapterPerQueryLimit = Math.max(2, Math.ceil(limitPerSupplier / adapterSearchQueries.length));
    const batches = await Promise.allSettled(adapterSearchQueries.map((searchQuery) => adapter.search(searchQuery, adapterPerQueryLimit)));
    const directOffers = batches.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const analogBatches: SupplierOffer[][] = [];
    if (adapter.searchAnalogs && context.fitmentStatus === "VERIFIED") {
      const analogReferences = (context.analogReferences || [])
        .filter((reference) => reference.brand && reference.article)
        .slice(0, 3);
      const analogResults = await Promise.allSettled(analogReferences.map((reference) => adapter.searchAnalogs!(reference.brand!, reference.article, adapterPerQueryLimit)));
      analogResults.forEach((result) => {
        if (result.status === "fulfilled") analogBatches.push(result.value);
      });
    }
    return [...directOffers, ...analogBatches.flat()];
  })(), `Постачальник ${adapter.name}`)));

  const offersByKey = new Map<string, SupplierOffer>();
  const providers: Array<{ id: SupplierId; ok: boolean; message?: string }> = [];

  settled.forEach((result, index) => {
    const adapter = searchable[index];
    if (result.status === "fulfilled") {
      for (const offer of result.value) {
        const annotated = annotateOffer(offer, context);
        const key = offerKey(annotated);
        const previous = offersByKey.get(key);
        if (!previous || offerRank(annotated) > offerRank(previous)) offersByKey.set(key, annotated);
      }
      providers.push({ id: adapter.id, ok: true });
    } else {
      providers.push({ id: adapter.id, ok: false, message: result.reason instanceof Error ? result.reason.message : "Помилка API" });
    }
  });

  const offers = [...offersByKey.values()];
  offers.sort((a, b) => {
    const rankDiff = offerRank(b) - offerRank(a);
    if (rankDiff) return rankDiff;
    if (a.purchasePrice == null && b.purchasePrice == null) return 0;
    if (a.purchasePrice == null) return 1;
    if (b.purchasePrice == null) return -1;
    return a.purchasePrice - b.purchasePrice;
  });

  return {
    offers: offers.slice(0, Math.max(limitPerSupplier * Math.max(searchable.length, 1), 40)),
    providers,
    configuredSuppliers: [...configuredIds],
    supplierStatuses: statuses,
    blocked: false,
    blockReason: null,
  };
}
