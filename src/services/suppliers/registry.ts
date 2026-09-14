import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { bmPartsAdapter } from "./bm-parts.adapter";
import { uniqueTradeAdapter } from "./unique-trade.adapter";
import type { PartFitmentStatus } from "@/src/services/parts-fitment.service";
import { normalizeCatalogNumber } from "@/src/services/parts-fitment.service";
import { buildKnowledgeProviderPartQueryCandidates } from "@/src/services/parts-knowledge.service";
import { isPartOfferRelevant } from "@/src/services/part-relevance.service";
import {
  buildCascadeReferences,
  cascadeReason,
  classifySupplierResultType,
  getAssemblyFallback,
} from "./cascade-search";
import type {
  SupplierAdapter,
  SupplierCompatibilityTier,
  SupplierConnectionCheck,
  SupplierId,
  SupplierOffer,
  SupplierResultType,
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
const MAX_CASCADE_REFERENCES = 6;
const MAX_ASSEMBLY_QUERIES = 3;

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
  /** Live provider matches already resolved while building VIN/vehicle fitment. */
  fitmentOffers?: SupplierOffer[];
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

function compatibilityTier(
  fitmentStatus: PartFitmentStatus | undefined,
  exact: boolean | null | undefined,
  isAssembly = false,
): SupplierCompatibilityTier {
  if (isAssembly) return "REVIEW_REQUIRED";
  if (fitmentStatus === "VERIFIED" && exact !== false) return "CONFIRMED";
  if (fitmentStatus === "VERIFIED") return "PARTIAL";
  if (fitmentStatus === "MANUAL_REQUIRED" || fitmentStatus === "REFERENCE_ONLY") return "REVIEW_REQUIRED";
  return "UNCONFIRMED";
}

function annotateOffer(
  offer: SupplierOffer,
  context: SupplierSearchContext,
  options: {
    resultType?: SupplierResultType;
    reason?: string | null;
    isAssembly?: boolean;
    forceAnalog?: boolean;
  } = {},
): SupplierOffer {
  const article = normalizeCatalogNumber(offer.article);
  const catalogArticles = new Set((context.catalogArticles || []).map(normalizeCatalogNumber).filter(Boolean));
  const analogArticles = new Set((context.analogArticles || []).map(normalizeCatalogNumber).filter(Boolean));
  const oeNumbers = new Set((context.oeNumbers || []).map(normalizeCatalogNumber).filter(Boolean));
  const hasCatalogMatch = Boolean(article && (catalogArticles.has(article) || oeNumbers.has(article)));
  const isAnalog = Boolean(options.forceAnalog || (article && analogArticles.has(article)) || offer.sourceKind === "ANALOG");
  const isOeNumber = Boolean(article && oeNumbers.has(article));
  const vehicleScoped = Boolean(context.vehicleId?.trim() || context.vin?.trim() || context.plate?.trim());
  const isAssembly = options.isAssembly === true || offer.sourceKind === "ASSEMBLY";
  const offerClass = isAssembly
    ? "UNKNOWN" as const
    : hasCatalogMatch
      ? isAnalog ? "ANALOG" as const : "OEM" as const
      : isAnalog ? "ANALOG" as const
        : offer.offerClass || "UNKNOWN";
  const verified = !isAssembly && context.fitmentStatus === "VERIFIED" && hasCatalogMatch;
  const effectiveFitmentStatus: PartFitmentStatus = isAssembly
    ? "MANUAL_REQUIRED"
    : verified
      ? "VERIFIED"
      : vehicleScoped
        ? "MANUAL_REQUIRED"
        : context.fitmentStatus || "MANUAL_REQUIRED";
  const effectiveExact = isAssembly ? false : verified ? context.fitmentExact ?? offer.fitmentExact ?? null : false;
  const resultType = options.resultType || classifySupplierResultType(offer, {
    isAssembly,
    isAnalog,
    isOeNumber: hasCatalogMatch || isOeNumber,
    vehicleBrand: context.providerVehicle?.brand || null,
  });
  const defaultReason = isAssembly
    ? cascadeReason("ASSEMBLY")
    : verified && isAnalog
      ? "Аналог підтверджений крос-номером у VIN-каталозі."
      : verified
        ? "Артикул знайдено у підтвердженому VIN-каталозі OE."
        : isOeNumber
          ? "Артикул збігається з OE-номером, але його застосовність ще потрібно перевірити."
          : offer.sourceKind === "ANALOG"
            ? "Постачальник повернув аналог; застосовність підтверджується вручну."
            : offer.offerReason || "Знайдено за запитом постачальника; потрібна ручна перевірка застосовності.";
  const offerReason = options.reason || defaultReason;
  const tier = compatibilityTier(effectiveFitmentStatus, effectiveExact, isAssembly);
  const matchReasons = [...new Set([
    ...(offer.matchReasons || []),
    offer.offerReason || "",
    offer.fitmentReason || "",
    offerReason || "",
  ].map((value) => value.trim()).filter(Boolean))];

  return {
    ...offer,
    offerClass,
    resultType,
    fitmentStatus: effectiveFitmentStatus,
    fitmentConfidence: verified ? context.fitmentConfidence ?? null : isAssembly ? 0 : offer.fitmentConfidence ?? 0,
    fitmentExact: effectiveExact,
    fitmentSource: verified ? context.fitmentSource || offer.fitmentSource || null : context.fitmentSource || offer.fitmentSource || null,
    fitmentReason: offerReason,
    offerReason,
    matchReasons,
    compatibilityTier: tier,
    requiresManualConfirmation: isAssembly || tier !== "CONFIRMED",
    alternativeForCanonicalCode: isAssembly ? context.canonicalCode || null : offer.alternativeForCanonicalCode || null,
  };
}

function offerKey(offer: SupplierOffer) {
  const brand = normalizeCatalogNumber(offer.brand);
  const article = normalizeCatalogNumber(offer.article);
  if (article) return `${offer.supplierId}:${brand}:${article}`;
  return `${offer.supplierId}:${offer.externalProductId || offer.name}`;
}

function offerRank(offer: SupplierOffer) {
  const fitment = offer.compatibilityTier === "CONFIRMED"
    ? 120
    : offer.compatibilityTier === "PARTIAL"
      ? 80
      : offer.fitmentStatus === "REFERENCE_ONLY"
        ? 30
        : 0;
  const classification = offer.resultType === "ORIGINAL"
    ? 35
    : offer.resultType === "OEM_REPLACEMENT"
      ? 30
      : offer.resultType === "ANALOG"
        ? 20
        : offer.resultType === "ASSEMBLY"
          ? -10
          : offer.offerClass === "OEM"
            ? 20
            : offer.offerClass === "ANALOG"
              ? 10
              : 0;
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

async function primarySupplierSearch(
  adapter: SupplierAdapter,
  query: string,
  limitPerSupplier: number,
  context: SupplierSearchContext,
  searchQueries: string[],
  useVehicleScopedSearch: boolean,
  reusableFitmentOffers: SupplierOffer[],
) {
  if (adapter.id === "bm-parts" && reusableFitmentOffers.length) return reusableFitmentOffers;
  if (useVehicleScopedSearch) return vehicleScopedSearch(adapter, query, limitPerSupplier, context);

  const providerQueries = await providerKnowledgeQueries(adapter, query, context);
  const adapterSearchQueries = [...new Set([...providerQueries, ...searchQueries])].slice(0, MAX_SUPPLIER_SEARCH_QUERIES);
  const adapterPerQueryLimit = Math.max(2, Math.ceil(limitPerSupplier / Math.max(adapterSearchQueries.length, 1)));
  const batches = await Promise.allSettled(adapterSearchQueries.map((searchQuery) => adapter.search(searchQuery, adapterPerQueryLimit)));
  const directOffers = batches.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const analogBatches: SupplierOffer[][] = [];

  if (adapter.searchAnalogs && context.fitmentStatus === "VERIFIED") {
    const analogReferences = (context.analogReferences || [])
      .filter((reference) => reference.brand && reference.article)
      .slice(0, 3);
    const analogResults = await Promise.allSettled(analogReferences.map((reference) =>
      adapter.searchAnalogs!(reference.brand!, reference.article, adapterPerQueryLimit)));
    analogResults.forEach((result) => {
      if (result.status === "fulfilled") {
        analogBatches.push(result.value.map((offer) => ({
          ...offer,
          sourceKind: "ANALOG" as const,
          offerReason: offer.offerReason || "Аналог повернутий постачальником за OE/крос-номером.",
        })));
      }
    });
  }
  return [...directOffers, ...analogBatches.flat()];
}

async function cascadeSupplierSearch(
  adapter: SupplierAdapter,
  references: ReturnType<typeof buildCascadeReferences>,
  limitPerSupplier: number,
) {
  if (!references.length) return [];
  const perReferenceLimit = Math.max(2, Math.ceil(limitPerSupplier / Math.max(references.length, 1)));
  const jobs: Array<Promise<SupplierOffer[]>> = [];

  for (const reference of references.slice(0, MAX_CASCADE_REFERENCES)) {
    const exact = adapter.searchByArticle
      ? adapter.searchByArticle(reference.article, reference.brand, perReferenceLimit)
      : adapter.search(reference.article, perReferenceLimit);
    jobs.push(exact.then((offers) => offers.map((offer) => ({
      ...offer,
      sourceKind: "OEM" as const,
      offerReason: `Каскадний пошук: ${reference.reason}.`,
      matchReasons: [...new Set([...(offer.matchReasons || []), reference.reason])],
    }))));

    if (adapter.searchAnalogs && reference.brand) {
      jobs.push(adapter.searchAnalogs(reference.brand, reference.article, perReferenceLimit).then((offers) => offers.map((offer) => ({
        ...offer,
        sourceKind: "ANALOG" as const,
        analogOfArticle: offer.analogOfArticle || reference.article,
        offerReason: `Аналог за ${reference.brand} ${reference.article}. ${reference.reason}.`,
        matchReasons: [...new Set([...(offer.matchReasons || []), `Аналог до ${reference.brand} ${reference.article}`, reference.reason])],
      }))));
    }
  }

  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

function looksLikeAssemblyOffer(offer: SupplierOffer) {
  const value = `${offer.name} ${offer.article}`.toLocaleLowerCase("uk-UA");
  const mentionsHub = /(ступиц|маточин|wheel\s+hub|hub\s+assembly)/iu.test(value);
  if (!mentionsHub) return false;
  const mentionsBearing = /(подшипник|підшипник|bearing)/iu.test(value);
  const includesAssemblySignal = /(в\s+(сбор|збор)|с\s+подшипник|з\s+підшипник|with\s+bearing|assembly|комплект|kit)/iu.test(value);
  return !mentionsBearing || includesAssemblySignal;
}

async function assemblySupplierSearch(
  adapter: SupplierAdapter,
  fallback: NonNullable<ReturnType<typeof getAssemblyFallback>>,
  limitPerSupplier: number,
) {
  const provider = knowledgeProviderFor(adapter);
  if (!provider) return [];
  const queries = fallback.providerQueries[provider].slice(0, MAX_ASSEMBLY_QUERIES);
  const perQueryLimit = Math.max(2, Math.ceil(limitPerSupplier / Math.max(queries.length, 1)));
  const settled = await Promise.allSettled(queries.map((searchQuery) => adapter.search(searchQuery, perQueryLimit)));
  return settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter(looksLikeAssemblyOffer)
    .map((offer) => ({
      ...offer,
      sourceKind: "ASSEMBLY" as const,
      offerClass: "UNKNOWN" as const,
      resultType: "ASSEMBLY" as const,
      requiresManualConfirmation: true,
      offerReason: cascadeReason("ASSEMBLY"),
      matchReasons: [...new Set([...(offer.matchReasons || []), `Fallback ${fallback.canonicalName}`])],
    }));
}

export async function searchConfiguredSuppliers(query: string, limitPerSupplier = 20, context: SupplierSearchContext = {}) {
  const statuses = await listSupplierStatuses();
  const configuredIds = new Set(statuses.filter((supplier) => supplier.configured).map((supplier) => supplier.id));
  const vehicleScoped = Boolean(context.vehicleId?.trim() || context.vin?.trim() || context.plate?.trim());
  const reusableFitmentOffers = (context.fitmentOffers || []).filter((offer) => offer.supplierId === "bm-parts");
  // A vehicle context must not suppress the supplier request. Use the VIN/OE
  // scoped adapter search only after fitment is verified; otherwise run the
  // ordinary article/name search and mark every returned offer for manual
  // compatibility confirmation in annotateOffer().
  const useVehicleScopedSearch = vehicleScoped && context.fitmentStatus === "VERIFIED" && !reusableFitmentOffers.length;

  const searchable = supplierAdapters
    .filter((adapter) => adapter.id !== "autonova-d" && adapter.id !== "atl" && configuredIds.has(adapter.id));
  const searchMode = reusableFitmentOffers.length || (vehicleScoped && context.fitmentStatus === "VERIFIED")
    ? "VIN_OE_CASCADE"
    : context.canonicalCode || context.genericArticleId
      ? "CANONICAL_CASCADE"
      : "FREE_TEXT_CASCADE";

  const queries = [...new Set([
    context.normalizedQuery?.trim() || "",
    query.trim(),
    ...(context.oeNumbers || []).slice(0, 3),
    ...(context.catalogArticles || []).slice(0, 3),
  ].filter((value) => value.length >= 2))].slice(0, MAX_SUPPLIER_SEARCH_QUERIES);
  const searchQueries = queries.length ? queries : [query.trim()];

  const primarySettled = await Promise.allSettled(searchable.map((adapter) => withTimeout(
    primarySupplierSearch(adapter, query, limitPerSupplier, context, searchQueries, useVehicleScopedSearch, reusableFitmentOffers),
    `Постачальник ${adapter.name}`,
  )));

  const rawPrimaryOffers: SupplierOffer[] = [];
  const providers: Array<{ id: SupplierId; ok: boolean; message?: string }> = [];
  primarySettled.forEach((result, index) => {
    const adapter = searchable[index];
    if (result.status === "fulfilled") {
      rawPrimaryOffers.push(...result.value);
      providers.push({ id: adapter.id, ok: true });
    } else {
      providers.push({ id: adapter.id, ok: false, message: result.reason instanceof Error ? result.reason.message : "Помилка API" });
    }
  });

  const references = buildCascadeReferences(query, {
    canonicalCode: context.canonicalCode,
    partName: context.partName,
    oeNumbers: context.oeNumbers,
    catalogArticles: context.catalogArticles,
    analogReferences: context.analogReferences,
    providerVehicleBrand: context.providerVehicle?.brand || null,
  }, rawPrimaryOffers, MAX_CASCADE_REFERENCES);

  const cascadeSettled = await Promise.allSettled(searchable.map((adapter) => withTimeout(
    cascadeSupplierSearch(adapter, references, limitPerSupplier),
    `Каскад ${adapter.name}`,
  )));
  const rawCascadeOffers = cascadeSettled.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  const offersByKey = new Map<string, SupplierOffer>();
  const addRelevantOffer = (offer: SupplierOffer, options: Parameters<typeof annotateOffer>[2] = {}) => {
    if (!options.isAssembly && !isPartOfferRelevant(offer, {
      query,
      partName: context.partName || query,
      canonicalCode: context.canonicalCode,
      catalogArticles: context.catalogArticles,
      analogArticles: context.analogArticles,
      oeNumbers: context.oeNumbers,
    })) return;
    const annotated = annotateOffer(offer, context, options);
    const key = offerKey(annotated);
    const previous = offersByKey.get(key);
    if (!previous || offerRank(annotated) > offerRank(previous)) offersByKey.set(key, annotated);
  };

  for (const offer of rawPrimaryOffers) addRelevantOffer(offer);
  for (const offer of rawCascadeOffers) addRelevantOffer(offer, {
    forceAnalog: offer.sourceKind === "ANALOG",
    reason: offer.offerReason || null,
  });

  const componentOfferCount = [...offersByKey.values()].filter((offer) => offer.resultType !== "ASSEMBLY").length;
  const assemblyFallback = componentOfferCount === 0 ? getAssemblyFallback({
    canonicalCode: context.canonicalCode,
    partName: context.partName || query,
  }) : null;

  if (assemblyFallback) {
    const assemblySettled = await Promise.allSettled(searchable.map((adapter) => withTimeout(
      assemblySupplierSearch(adapter, assemblyFallback, limitPerSupplier),
      `Комплектна альтернатива ${adapter.name}`,
    )));
    const assemblyOffers = assemblySettled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    for (const offer of assemblyOffers) addRelevantOffer(offer, {
      isAssembly: true,
      resultType: "ASSEMBLY",
      reason: cascadeReason("ASSEMBLY"),
    });
  }

  const offers = [...offersByKey.values()];
  offers.sort((a, b) => {
    const rankDiff = offerRank(b) - offerRank(a);
    if (rankDiff) return rankDiff;
    if (a.purchasePrice == null && b.purchasePrice == null) return 0;
    if (a.purchasePrice == null) return 1;
    if (b.purchasePrice == null) return -1;
    return a.purchasePrice - b.purchasePrice;
  });

  const resultSummary = {
    total: offers.length,
    originals: offers.filter((offer) => offer.resultType === "ORIGINAL").length,
    oemReplacements: offers.filter((offer) => offer.resultType === "OEM_REPLACEMENT").length,
    analogs: offers.filter((offer) => offer.resultType === "ANALOG").length,
    assemblies: offers.filter((offer) => offer.resultType === "ASSEMBLY").length,
    unknown: offers.filter((offer) => !offer.resultType || offer.resultType === "UNKNOWN").length,
    confirmed: offers.filter((offer) => offer.compatibilityTier === "CONFIRMED").length,
    partial: offers.filter((offer) => offer.compatibilityTier === "PARTIAL").length,
    reviewRequired: offers.filter((offer) => offer.compatibilityTier === "REVIEW_REQUIRED").length,
  };

  return {
    offers: offers.slice(0, Math.max(limitPerSupplier * Math.max(searchable.length, 1), 40)),
    providers,
    supplierStatuses: statuses,
    configuredSuppliers: searchable.map((adapter) => adapter.id),
    searchMode,
    resultSummary,
    cascade: {
      references: references.map((reference) => ({ article: reference.article, brand: reference.brand, reason: reference.reason })),
      assemblyFallback: assemblyFallback ? {
        canonicalCode: assemblyFallback.canonicalCode,
        canonicalName: assemblyFallback.canonicalName,
        triggered: true,
      } : null,
    },
    blocked: false,
    blockReason: null,
  };
}
