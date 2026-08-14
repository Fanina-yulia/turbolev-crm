import type { SupplierAdapter, SupplierConnectionCheck, SupplierOffer, SupplierStock } from "./types";

const DEFAULT_BASE_URL = "https://order24-api.utr.ua";
const DEFAULT_FINGERPRINT = "turbolev-crm-unique-trade-v2";

type LoginResponse = {
  token?: string;
  expires_at?: string;
  refresh_token?: string;
};

type UniqueTradeDetail = {
  id?: number;
  displayBrand?: string;
  article?: string;
  title?: string;
  multiplicity?: number;
  quantity?: number;
  yourPriceUAH?: { amount?: number; currency?: { code?: string } };
  yourPrice?: { amount?: number; currency?: { code?: string } };
  remains?: Array<{ storage?: { name?: string }; remain?: string | number }>;
  isDisabled?: boolean;
};

type SearchResponse = {
  details?: UniqueTradeDetail[];
};

let cachedToken: { value: string; validUntil: number } | null = null;

function baseUrl() {
  return (process.env.UNIQUE_TRADE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function email() {
  return process.env.UNIQUE_TRADE_EMAIL?.trim() || "";
}

function password() {
  return process.env.UNIQUE_TRADE_PASSWORD || "";
}

function fingerprint() {
  return (process.env.UNIQUE_TRADE_BROWSER_FINGERPRINT || DEFAULT_FINGERPRINT).slice(0, 128);
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticate(force = false) {
  if (!force && cachedToken && cachedToken.validUntil > Date.now()) return cachedToken.value;
  if (!email() || !password()) throw new Error("Unique Trade login/password не налаштовані.");

  const url = `${baseUrl()}/api/login_check?browser_fingerprint=${encodeURIComponent(fingerprint())}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: email(), password: password() }),
  });

  if (!response.ok) throw new Error(`Unique Trade auth HTTP ${response.status}`);
  const data = (await response.json()) as LoginResponse;
  if (!data.token) throw new Error("Unique Trade не повернув token.");

  cachedToken = { value: data.token, validUntil: Date.now() + 8 * 60 * 1000 };
  return data.token;
}

function normalizeStocks(detail: UniqueTradeDetail): SupplierStock[] {
  return (detail.remains ?? [])
    .map((item) => ({
      warehouse: item.storage?.name?.trim() || "Склад Unique Trade",
      quantity: String(item.remain ?? "0"),
    }))
    .filter((item) => item.quantity !== "0" && item.quantity !== "-");
}

export const uniqueTradeAdapter: SupplierAdapter = {
  id: "unique-trade",
  name: "Юнік Трейд",
  website: "https://order24.utr.ua/ua/home",
  apiBaseUrl: DEFAULT_BASE_URL,
  authType: "JWT через login/password",
  capabilities: ["SEARCH", "PRICE", "STOCK", "CROSSES", "WAREHOUSES", "DELIVERY", "ORDERS"],
  setupHint: "Додайте B2B логін і пароль у UNIQUE_TRADE_EMAIL та UNIQUE_TRADE_PASSWORD на сервері CRM.",

  isConfigured() {
    return Boolean(email() && password());
  },

  async testConnection(): Promise<SupplierConnectionCheck> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        state: "NOT_CONFIGURED",
        message: "Потрібні UNIQUE_TRADE_EMAIL та UNIQUE_TRADE_PASSWORD.",
        checkedAt: new Date().toISOString(),
      };
    }

    const started = Date.now();
    try {
      await authenticate(true);
      return {
        ok: true,
        state: "CONNECTED",
        message: "Авторизація Unique Trade працює.",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        state: "ERROR",
        message: error instanceof Error ? error.message : "Не вдалося авторизуватися в Unique Trade.",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      };
    }
  },

  async search(query: string, limit = 30): Promise<SupplierOffer[]> {
    if (!this.isConfigured()) return [];
    const token = await authenticate();
    const url = `${baseUrl()}/api/search/${encodeURIComponent(query.trim())}?info=1`;
    let response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });

    if (response.status === 401) {
      const freshToken = await authenticate(true);
      response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${freshToken}`, Accept: "application/json" } });
    }

    if (!response.ok) throw new Error(`Unique Trade search HTTP ${response.status}`);
    const data = (await response.json()) as SearchResponse;

    return (data.details ?? []).slice(0, limit).map((detail) => {
      const price = detail.yourPriceUAH ?? detail.yourPrice;
      const stock = normalizeStocks(detail);
      return {
        supplierId: "unique-trade",
        supplierName: "Юнік Трейд",
        externalProductId: detail.id == null ? null : String(detail.id),
        article: detail.article?.trim() || query.trim(),
        brand: detail.displayBrand?.trim() || null,
        name: detail.title?.trim() || "Запчастина",
        purchasePrice: typeof price?.amount === "number" ? price.amount : null,
        currency: price?.currency?.code?.trim() || "UAH",
        multiplicity: typeof detail.multiplicity === "number" ? detail.multiplicity : null,
        stock,
        available: detail.isDisabled !== true && (stock.length > 0 || (detail.quantity ?? 0) > 0),
        sourceUrl: "https://order24.utr.ua/ua/home",
      };
    });
  },
};
