import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import type {
  SupplierAdapter,
  SupplierConnectionCheck,
  SupplierOffer,
  SupplierStock,
  SupplierVehicleContext,
  SupplierVehiclePart,
} from "./types";

const DEFAULT_BASE_URL = "https://api.bm.parts";
const USER_AGENT = "TurboLEV-CRM/0.5.0";
const VEHICLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const BM_PARTS_VEHICLE_CONTEXT_VERSION = "v3";
const PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;

type JsonRecord = Record<string, unknown>;
type BmStock = { name?: unknown; quantity?: unknown; warehouse_id?: unknown; id?: unknown };
type BmProduct = JsonRecord & {
  uuid?: unknown;
  brand?: unknown;
  article?: unknown;
  name?: unknown;
  price?: unknown;
  currency_name?: unknown;
  multiplicity?: unknown;
  available?: unknown;
  in_stocks?: unknown;
  default_image?: unknown;
  images?: unknown;
};
type BmOeReference = { number?: unknown; article?: unknown; brand?: unknown; is_oem?: unknown; isOem?: unknown };
type BmProductDetails = BmProduct & {
  oe?: unknown;
  analogs?: unknown;
  cars?: unknown;
};
type CacheEntry<T> = { expiresAt: number; value: T };

const vehicleCache = new Map<string, CacheEntry<SupplierVehicleContext | null>>();
const modelCache = new Map<string, CacheEntry<string[]>>();
const productCache = new Map<string, CacheEntry<BmProductDetails | null>>();

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function textValue(value: unknown, max = 320): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "";
}

function recordText(record: JsonRecord | null, key: string, max = 320): string {
  return textValue(record?.[key], max);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").replace(/\s/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (/^(true|1|yes)$/iu.test(value.trim())) return true;
    if (/^(false|0|no)$/iu.test(value.trim())) return false;
  }
  return null;
}

function normalizeText(value: unknown) {
  return textValue(value, 180).toLocaleLowerCase("uk-UA").replace(/[^a-zа-яіїє0-9]+/giu, " ").replace(/\s+/g, " ").trim();
}

function normalizeVehicleModel(brand: string, model: string) {
  const cleanBrand = brand.trim();
  const cleanModel = model.trim();
  if (!cleanBrand || !cleanModel) return cleanModel;
  const brandLower = cleanBrand.toLocaleLowerCase("uk-UA");
  const modelLower = cleanModel.toLocaleLowerCase("uk-UA");
  if (!modelLower.startsWith(brandLower)) return cleanModel;
  const separator = modelLower.slice(brandLower.length, brandLower.length + 1);
  if (!separator) return cleanModel;
  if (![" ", "-", "_", ":"].includes(separator)) return cleanModel;
  return cleanModel.slice(cleanBrand.length + 1).trim() || cleanModel;
}

function extractProducts(payload: unknown): BmProduct[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => {
      const product = asRecord(item);
      return product ? [product as BmProduct] : [];
    });
  }
  const root = asRecord(payload);
  const dataValue = root?.data;
  const data = asRecord(dataValue);
  const raw = root?.products ?? data?.products ?? (Array.isArray(dataValue) ? dataValue : null);
  if (Array.isArray(raw)) return raw.flatMap((item) => {
    const product = asRecord(item);
    return product ? [product as BmProduct] : [];
  });
  const object = asRecord(raw);
  return object ? Object.values(object).flatMap((item) => {
    const product = asRecord(item);
    return product ? [product as BmProduct] : [];
  }) : [];
}

function extractModelNames(payload: unknown): string[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const raw = root?.models ?? data?.models;
  const rows = Array.isArray(raw) ? raw : Object.values(asRecord(raw) || {});
  return [...new Set(rows.flatMap((row) => {
    const record = asRecord(row);
    const name = textValue(record?.name ?? row, 180);
    return name ? [name] : [];
  }))];
}

export function rankBmModelNames(vehicleModel: string, modelNames: string[], limit = 8) {
  const requestedTokens = normalizeText(vehicleModel).split(" ").filter((token) => token.length >= 2);
  if (!requestedTokens.length) return [];
  return modelNames
    .map((name, index) => {
      const candidateTokens = normalizeText(name).split(" ").filter((token) => token.length >= 2);
      const overlap = requestedTokens.reduce((total, token) => total + (
        candidateTokens.some((candidate) => {
          const tokenHasLetters = /[a-zа-яіїє]/iu.test(token);
          const candidateHasLetters = /[a-zа-яіїє]/iu.test(candidate);
          if (tokenHasLetters !== candidateHasLetters) return false;
          return candidate === token || candidate.includes(token) || token.includes(candidate);
        })
          ? 1
          : 0
      ), 0);
      if (!overlap) return null;
      return {
        name,
        score: overlap * 100 - Math.abs(candidateTokens.length - requestedTokens.length),
        index,
      };
    })
    .filter((row): row is { name: string; score: number; index: number } => Boolean(row))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(limit, 1))
    .map((row) => row.name);
}

async function getBmModelNames(brand: string): Promise<string[]> {
  const key = normalizeText(brand).toUpperCase();
  if (!key) return [];
  const cached = cacheGet(modelCache, key);
  if (cached !== undefined) return cached;
  const response = await request("/search/products/aggregations/car/" + encodeURIComponent(brand.trim()) + "/models");
  if (!response.ok) return cacheSet(modelCache, key, [], MODEL_CACHE_TTL_MS);
  const payload = await response.json() as unknown;
  return cacheSet(modelCache, key, extractModelNames(payload), MODEL_CACHE_TTL_MS);
}

function normalizeStocks(value: unknown): SupplierStock[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const stock = asRecord(item);
      if (!stock) return [];
      const quantity = textValue(stock.quantity ?? stock.remain ?? stock.amount ?? "-");
      const name = textValue(stock.name ?? stock.warehouse ?? stock.storage_name) || "Склад BM Parts";
      const warehouseId = textValue(stock.warehouse_id ?? stock.storage_id ?? stock.id) || null;
      return [{ warehouse: name, quantity, warehouseId }];
    })
    .filter((stock) => stock.quantity !== "-" && stock.quantity !== "0");
}

function imageUrl(value: unknown): string | null {
  const source = Array.isArray(value) ? textValue(value[0]) : textValue(value);
  if (!source) return null;
  if (/^https?:\/\//iu.test(source)) return source;
  return "https://cdn.bm.parts/" + source.replace(/\\/g, "/").replace(/^\/+/, "");
}

function quotaMessage(response: Response) {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const limit = response.headers.get("x-ratelimit-limit");
  if (!remaining || !limit) return "";
  return ` Ліміт API: ${remaining}/${limit}.`;
}

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

async function credentials() {
  const config = await getIntegrationCredential("BM_PARTS");
  return {
    apiKey: config?.apiKey?.trim() || "",
    baseUrl: (config?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ""),
  };
}

async function request(path: string) {
  const config = await credentials();
  if (!config.apiKey) throw new Error("BM Parts API key не налаштований.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      headers: { Accept: "application/json", Authorization: config.apiKey, "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function extractVehicle(payload: unknown, identifier: string): SupplierVehicleContext | null {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const candidate = [root?.vehicle, data?.vehicle, root]
    .map(asRecord)
    .find((value) => Boolean(value && (
      value.vehicle_id != null
      || value.id != null
      || value.ssd != null
      || value.catalog_code != null
      || value.brand != null
    )));
  if (!candidate) return null;

  const externalVehicleId = textValue(candidate.vehicle_id ?? candidate.id, 180) || null;
  const externalSecurityKey = textValue(candidate.ssd ?? candidate.security_key ?? candidate.securityKey, 180) || null;
  const catalogCode = textValue(candidate.catalog_code ?? candidate.catalogCode, 80) || null;
  const brand = textValue(candidate.brand ?? candidate.make, 100) || null;
  const rawModel = textValue(candidate.name ?? candidate.model ?? candidate.title, 180) || null;
  const model = brand && rawModel ? normalizeVehicleModel(brand, rawModel) : rawModel;
  if (!brand || !model) return null;

  const vehicleKey = [catalogCode, externalVehicleId, externalSecurityKey].filter(Boolean).join(":") || identifier;
  return {
    provider: "bm-parts",
    vehicleKey: vehicleKey.slice(0, 240),
    externalVehicleId,
    externalSecurityKey,
    catalogCode,
    brand,
    model,
    variant: textValue(candidate.engine ?? candidate.modification ?? candidate.variant, 180) || null,
    confidence: 90,
    exact: false,
    source: "BM_PARTS_VIN_MODEL_FILTER",
    sourceVersion: BM_PARTS_VEHICLE_CONTEXT_VERSION,
    rawEvidence: {
      brand,
      model,
      rawModel,
      catalogCode,
      externalVehicleId,
      externalSecurityKey,
      foundBy: textValue(candidate.found_by ?? candidate.foundBy, 40) || "vin",
    },
  };
}

function extractOeReferences(product: BmProductDetails | null): Array<{ number: string; brand: string | null; isOem: boolean | null }> {
  const values = Array.isArray(product?.oe) ? product.oe : [];
  return values.flatMap((value) => {
    const reference = asRecord(value) as BmOeReference | null;
    if (!reference) return [];
    const number = textValue(reference.number ?? reference.article, 120);
    if (!number) return [];
    return [{
      number,
      brand: textValue(reference.brand, 120) || null,
      isOem: booleanValue(reference.is_oem ?? reference.isOem),
    }];
  });
}

function extractAnalogProducts(product: BmProductDetails | null): Array<{ id: string | null; product: BmProduct }> {
  const root = asRecord(product?.analogs);
  if (!root) return [];
  return Object.entries(root).flatMap(([key, value]) => {
    const row = asRecord(value);
    if (!row) return [];
    const nested = asRecord(row.product);
    const candidate = (nested || row) as BmProduct;
    return [{ id: textValue(candidate.uuid, 180) || key || null, product: candidate }];
  });
}

function classifyProduct(product: BmProduct, references: Array<{ number: string; brand: string | null; isOem: boolean | null }>, vehicle: SupplierVehicleContext) {
  if (references.some((reference) => reference.isOem === true)) return "OEM" as const;
  const productBrand = normalizeText(product.brand);
  const vehicleBrand = normalizeText(vehicle.brand);
  if (productBrand && vehicleBrand && productBrand === vehicleBrand) return "OEM" as const;
  return "ANALOG" as const;
}

function mapProductOffer(product: BmProduct, query: string): SupplierOffer {
  const stock = normalizeStocks(product.in_stocks);
  const uuid = textValue(product.uuid, 180) || null;
  return {
    supplierId: "bm-parts",
    supplierName: "BM Parts",
    externalProductId: uuid,
    article: textValue(product.article, 160) || query,
    brand: textValue(product.brand, 120) || null,
    name: textValue(product.name ?? product.title, 320) || "Запчастина",
    purchasePrice: toNumber(product.price ?? product.price_uah ?? product.your_price),
    currency: textValue(product.currency_name ?? product.currency, 20) || "ГРН",
    multiplicity: toNumber(product.multiplicity),
    stock,
    available: booleanValue(product.available) === true || stock.length > 0,
    sourceUrl: uuid ? `https://b2b.bm.parts/product/${encodeURIComponent(uuid)}` : "https://b2b.bm.parts/",
    imageUrl: imageUrl(product.default_image ?? product.image ?? product.photo ?? product.images),
  };
}

export function buildBmVehicleFilterCandidates(vehicle: Pick<SupplierVehicleContext, "brand" | "model">) {
  const brand = vehicle.brand?.trim() || "";
  const rawModel = vehicle.model?.trim() || "";
  const normalizedModel = normalizeVehicleModel(brand, rawModel);
  const candidates = [
    brand && normalizedModel ? brand + ">" + normalizedModel : "",
    brand && rawModel ? brand + ">" + rawModel : "",
  ];
  return [...new Set(candidates.filter(Boolean))];
}

export function buildBmVehicleFilter(vehicle: Pick<SupplierVehicleContext, "brand" | "model">) {
  return buildBmVehicleFilterCandidates(vehicle)[0] || "";
}

function isArticleLike(query: string) {
  return /^[a-z0-9][a-z0-9._/\\-]{2,}$/iu.test(query.trim()) && /[0-9]/u.test(query);
}

export function bmSearchMode(query: string) {
  return isArticleLike(query) ? "strict" : "extended" as const;
}

/** BM requires a second URL-encoding pass for slashes inside a car model. */
export function encodeBmCarFilter(carFilter: string) {
  return carFilter.replace(/\//g, "%2F");
}

async function getProductDetails(productId: string): Promise<BmProductDetails | null> {
  const cached = cacheGet(productCache, productId);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    oe: "full",
    output_field: "all",
    analogs_available: "1",
    available: "0",
    warehouses: "all",
    with_extra: "0",
    products_as: "arr",
    save: "0",
  });
  const response = await request(`/product/${encodeURIComponent(productId)}?${params.toString()}`);
  if (!response.ok) throw new Error(`BM Parts product HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const product = asRecord(root?.product ?? data?.product) || root;
  if (!product) return cacheSet(productCache, productId, null, PRODUCT_CACHE_TTL_MS);
  return cacheSet(productCache, productId, product as BmProductDetails, PRODUCT_CACHE_TTL_MS);
}

function fitmentReason(vehicle: SupplierVehicleContext, carFilter: string) {
  return `BM Parts підтвердив відповідність через фільтр ${carFilter}. VIN визначив модель «${vehicle.brand} ${vehicle.model}», але точну модифікацію/двигун потрібно перевірити вручну.`;
}

function withFitment(offer: SupplierOffer, vehicle: SupplierVehicleContext, carFilter: string, offerClass: "OEM" | "ANALOG" | "UNKNOWN", analogOfArticle: string | null = null): SupplierOffer {
  const reason = fitmentReason(vehicle, carFilter);
  return {
    ...offer,
    offerClass,
    fitmentStatus: "VERIFIED",
    fitmentConfidence: vehicle.confidence,
    fitmentExact: vehicle.exact,
    fitmentSource: vehicle.source,
    fitmentReason: reason,
    catalogProductId: offer.externalProductId,
    vehicleMatch: carFilter,
    analogOfArticle,
  };
}

export const bmPartsAdapter: SupplierAdapter = {
  id: "bm-parts",
  name: "BM Parts",
  website: "https://b2b.bm.parts/",
  apiBaseUrl: DEFAULT_BASE_URL,
  authType: "API key",
  capabilities: ["SEARCH", "PRICE", "STOCK", "CROSSES", "WAREHOUSES", "DELIVERY", "ORDERS", "VIN"],
  setupHint: "API key додається безпосередньо в CRM: Налаштування → Інтеграції → Постачальники.",

  async isConfigured() {
    const config = await credentials();
    return Boolean(config.apiKey);
  },

  async testConnection(): Promise<SupplierConnectionCheck> {
    if (!(await this.isConfigured())) {
      return { ok: false, state: "NOT_CONFIGURED", message: "Потрібен BM Parts API key.", checkedAt: new Date().toISOString() };
    }
    const started = Date.now();
    try {
      const response = await request("/profile/me");
      return response.ok
        ? { ok: true, state: "CONNECTED", message: `З'єднання з BM Parts працює.${quotaMessage(response)}`, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started }
        : { ok: false, state: "ERROR", message: `BM Parts відповів HTTP ${response.status}.`, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, state: "ERROR", message: error instanceof Error ? error.message : "Не вдалося з'єднатися з BM Parts.", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    }
  },

  async search(query: string, limit = 30): Promise<SupplierOffer[]> {
    if (!(await this.isConfigured())) return [];
    const params = new URLSearchParams({
      q: query.trim(),
      available: "1",
      products_as: "arr",
      warehouses: "all",
      save: "0",
      per_page: String(Math.min(Math.max(limit, 1), 100)),
    });
    const response = await request(`/search/products?${params.toString()}`);
    if (!response.ok) throw new Error(`BM Parts search HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    return extractProducts(payload).slice(0, limit).map((product) => mapProductOffer(product, query));
  },

  async resolveVehicle(identifier: string): Promise<SupplierVehicleContext | null> {
    const normalizedIdentifier = identifier.trim();
    if (normalizedIdentifier.length < 3 || !(await this.isConfigured())) return null;
    const cached = cacheGet(vehicleCache, normalizedIdentifier.toUpperCase());
    if (cached !== undefined) return cached;
    const params = new URLSearchParams({ q: normalizedIdentifier, products_as: "arr" });
    const response = await request(`/search/suggests?${params.toString()}`);
    if (!response.ok) throw new Error(`BM Parts vehicle suggest HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    return cacheSet(vehicleCache, normalizedIdentifier.toUpperCase(), extractVehicle(payload, normalizedIdentifier), VEHICLE_CACHE_TTL_MS);
  },

  async searchVehicleParts(input): Promise<SupplierVehiclePart[]> {
    const query = input.query.trim();
    const vehicle = input.vehicle;
    const carFilters = buildBmVehicleFilterCandidates(vehicle);
    if (query.length < 2 || !carFilters.length) return [];
    if (!(await this.isConfigured())) return [];

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const searchScopedProducts = async (filters: string[]) => {
      let selectedFilter = filters[0] || "";
      let foundProducts: BmProduct[] = [];

search:
      for (const candidateFilter of filters) {
        for (const available of ["1", "0"]) {
          const params = new URLSearchParams({
            q: query,
            search_mode: bmSearchMode(query),
            available,
            products_as: "arr",
            warehouses: "all",
            with_extra: "0",
            save: "0",
            per_page: String(limit),
            cars: encodeBmCarFilter(candidateFilter),
          });
          const response = await request("/search/products?" + params.toString());
          if (!response.ok) throw new Error("BM Parts vehicle search HTTP " + response.status);
          const payload = await response.json() as unknown;
          const candidateProducts = extractProducts(payload);
          if (candidateProducts.length) {
            selectedFilter = candidateFilter;
            foundProducts = candidateProducts.slice(0, limit);
            break search;
          }
        }
      }

      return { carFilter: selectedFilter, products: foundProducts };
    };

    let searchResult = await searchScopedProducts(carFilters);
    if (!searchResult.products.length && vehicle.brand) {
      let modelNames: string[] = [];
      try {
        modelNames = await getBmModelNames(vehicle.brand);
      } catch {
        modelNames = [];
      }
      const discoveredFilters = rankBmModelNames(vehicle.model || "", modelNames)
        .map((model) => vehicle.brand + ">" + model)
        .filter((filter) => !carFilters.includes(filter));
      if (discoveredFilters.length) searchResult = await searchScopedProducts(discoveredFilters);
    }

    const { carFilter, products } = searchResult;
    if (!products.length) return [];

    const detailProducts = products.slice(0, 12);
    const details = await Promise.allSettled(detailProducts.map((product) => {
      const productId = textValue(product.uuid, 180);
      return productId ? getProductDetails(productId) : Promise.resolve(null);
    }));
    const result: SupplierVehiclePart[] = [];

    products.forEach((product, index) => {
      const detailResult = details[index];
      const detail = detailResult?.status === "fulfilled" ? detailResult.value : null;
      const merged = detail ? { ...product, ...detail } as BmProductDetails : product as BmProductDetails;
      const oeReferences = extractOeReferences(merged);
      const primary = withFitment(mapProductOffer(merged, query), vehicle, carFilter, classifyProduct(merged, oeReferences, vehicle));
      primary.oeNumbers = oeReferences.map((reference) => reference.number);
      const analogOfArticle = primary.article;
      result.push({
        offer: primary,
        oeNumbers: oeReferences,
        vehicleEvidence: { car: carFilter, foundBy: "cars" },
      });

      if (!detail) return;
      for (const analog of extractAnalogProducts(detail)) {
        const analogOffer = withFitment(
          mapProductOffer({ ...analog.product, uuid: analog.product.uuid ?? analog.id } as BmProduct, query),
          vehicle,
          carFilter,
          "ANALOG",
          analogOfArticle,
        );
        const analogReferences = extractOeReferences(analog.product as BmProductDetails);
        analogOffer.oeNumbers = analogReferences.length ? analogReferences.map((reference) => reference.number) : primary.oeNumbers;
        result.push({
          offer: analogOffer,
          oeNumbers: analogReferences.length ? analogReferences : oeReferences,
          analogOfArticle,
          vehicleEvidence: { car: carFilter, foundBy: "cars+product.analogs" },
        });
      }
    });
    return result;
  },
};
