import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import type { SupplierAdapter, SupplierConnectionCheck, SupplierOffer, SupplierStock } from "./types";

const DEFAULT_BASE_URL = "https://order24-api.utr.ua";
const DEFAULT_FINGERPRINT = "turbolev-crm-unique-trade-v2";

type LoginResponse = { token?: string; expires_at?: string; refresh_token?: string };
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
type SearchResponse = { details?: UniqueTradeDetail[] };

let cachedToken: { key: string; value: string; validUntil: number } | null = null;

async function credentials() {
  const config = await getIntegrationCredential("UNIQUE_TRADE");
  return {
    email: config?.email?.trim() || "",
    password: config?.password || "",
    baseUrl: (config?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ""),
    fingerprint: (config?.fingerprint || DEFAULT_FINGERPRINT).slice(0, 128),
  };
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
  const config = await credentials();
  if (!config.email || !config.password) throw new Error("Юнік Трейд login/password не налаштовані.");
  const cacheKey = `${config.email}:${config.baseUrl}`;
  if (!force && cachedToken && cachedToken.key === cacheKey && cachedToken.validUntil > Date.now()) return cachedToken.value;

  const url = `${config.baseUrl}/api/login_check?browser_fingerprint=${encodeURIComponent(config.fingerprint)}`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (!response.ok) throw new Error(`Юнік Трейд auth HTTP ${response.status}`);
  const data = (await response.json()) as LoginResponse;
  if (!data.token) throw new Error("Юнік Трейд не повернув token.");
  cachedToken = { key: cacheKey, value: data.token, validUntil: Date.now() + 8 * 60 * 1000 };
  return data.token;
}

function normalizeStocks(detail: UniqueTradeDetail): SupplierStock[] {
  return (detail.remains ?? [])
    .map((item) => ({ warehouse: item.storage?.name?.trim() || "Склад Юнік Трейд", quantity: String(item.remain ?? "0") }))
    .filter((item) => item.quantity !== "0" && item.quantity !== "-");
}

export const uniqueTradeAdapter: SupplierAdapter = {
  id: "unique-trade",
  name: "Юнік Трейд",
  website: "https://order24.utr.ua/ua/home",
  apiBaseUrl: DEFAULT_BASE_URL,
  authType: "JWT через login/password",
  capabilities: ["SEARCH", "PRICE", "STOCK", "CROSSES", "WAREHOUSES", "DELIVERY", "ORDERS"],
  setupHint: "B2B логін і пароль додаються безпосередньо в CRM: Налаштування → Інтеграції → Постачальники.",

  async isConfigured() {
    const config = await credentials();
    return Boolean(config.email && config.password);
  },

  async testConnection(): Promise<SupplierConnectionCheck> {
    if (!(await this.isConfigured())) {
      return { ok: false, state: "NOT_CONFIGURED", message: "Потрібні B2B логін та пароль Юнік Трейд.", checkedAt: new Date().toISOString() };
    }
    const started = Date.now();
    try {
      await authenticate(true);
      return { ok: true, state: "CONNECTED", message: "Авторизація Юнік Трейд працює.", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, state: "ERROR", message: error instanceof Error ? error.message : "Не вдалося авторизуватися в Юнік Трейд.", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    }
  },

  async search(query: string, limit = 30): Promise<SupplierOffer[]> {
    if (!(await this.isConfigured())) return [];
    const config = await credentials();
    const token = await authenticate();
    const url = `${config.baseUrl}/api/search/${encodeURIComponent(query.trim())}?info=1`;
    let response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (response.status === 401) {
      const freshToken = await authenticate(true);
      response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${freshToken}`, Accept: "application/json" } });
    }
    if (!response.ok) throw new Error(`Юнік Трейд search HTTP ${response.status}`);
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
