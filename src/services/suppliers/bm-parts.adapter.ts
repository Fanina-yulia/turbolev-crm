import type { SupplierAdapter, SupplierConnectionCheck, SupplierOffer, SupplierStock } from "./types";

const DEFAULT_BASE_URL = "https://api.bm.parts";
const USER_AGENT = "TurboLEV-CRM/0.3.0";

type BmStock = {
  name?: string;
  quantity?: string | number;
};

type BmProduct = {
  uuid?: string;
  brand?: string;
  article?: string;
  name?: string;
  price?: string | number;
  currency_name?: string;
  multiplicity?: string | number;
  available?: boolean;
  in_stocks?: BmStock[];
};

type BmSearchResponse = {
  products?: BmProduct[] | Record<string, BmProduct>;
};

function baseUrl() {
  return (process.env.BM_PARTS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function apiKey() {
  return process.env.BM_PARTS_API_KEY?.trim() || "";
}

function headers() {
  const key = apiKey();
  if (!key) throw new Error("BM Parts API key не налаштований.");

  return {
    Accept: "application/json",
    Authorization: key,
    "User-Agent": USER_AGENT,
  };
}

async function request(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { headers: headers(), cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function toNumber(value: string | number | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStocks(value: BmStock[] | undefined): SupplierStock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((stock) => ({ warehouse: stock.name?.trim() || "Склад BM Parts", quantity: String(stock.quantity ?? "-") }))
    .filter((stock) => stock.quantity !== "-" && stock.quantity !== "0");
}

export const bmPartsAdapter: SupplierAdapter = {
  id: "bm-parts",
  name: "BM Parts",
  website: "https://b2b.bm.parts/",
  apiBaseUrl: DEFAULT_BASE_URL,
  authType: "API key",
  capabilities: ["SEARCH", "PRICE", "STOCK", "CROSSES", "WAREHOUSES", "DELIVERY", "ORDERS", "VIN"],
  setupHint: "Згенеруйте API key у кабінеті BM Parts та додайте його в BM_PARTS_API_KEY на сервері CRM.",

  isConfigured() {
    return Boolean(apiKey());
  },

  async testConnection(): Promise<SupplierConnectionCheck> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        state: "NOT_CONFIGURED",
        message: "Потрібен BM_PARTS_API_KEY.",
        checkedAt: new Date().toISOString(),
      };
    }

    const started = Date.now();
    try {
      const response = await request(`${baseUrl()}/profile/me`);
      if (!response.ok) {
        return {
          ok: false,
          state: "ERROR",
          message: `BM Parts відповів HTTP ${response.status}.`,
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        state: "CONNECTED",
        message: "З'єднання з BM Parts працює.",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        state: "ERROR",
        message: error instanceof Error ? error.message : "Не вдалося з'єднатися з BM Parts.",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      };
    }
  },

  async search(query: string, limit = 30): Promise<SupplierOffer[]> {
    if (!this.isConfigured()) return [];

    const params = new URLSearchParams({
      q: query.trim(),
      available: "1",
      products_as: "arr",
      warehouses: "all",
      save: "0",
      per_page: String(Math.min(Math.max(limit, 1), 100)),
    });

    const response = await request(`${baseUrl()}/search/products?${params.toString()}`);
    if (!response.ok) throw new Error(`BM Parts search HTTP ${response.status}`);

    const data = (await response.json()) as BmSearchResponse;
    const products = Array.isArray(data.products) ? data.products : Object.values(data.products ?? {});

    return products.slice(0, limit).map((product) => {
      const stock = normalizeStocks(product.in_stocks);
      return {
        supplierId: "bm-parts",
        supplierName: "BM Parts",
        externalProductId: product.uuid ?? null,
        article: product.article?.trim() || query.trim(),
        brand: product.brand?.trim() || null,
        name: product.name?.trim() || "Запчастина",
        purchasePrice: toNumber(product.price),
        currency: product.currency_name?.trim() || "ГРН",
        multiplicity: toNumber(product.multiplicity),
        stock,
        available: product.available === true || stock.length > 0,
        sourceUrl: "https://b2b.bm.parts/",
      };
    });
  },
};
