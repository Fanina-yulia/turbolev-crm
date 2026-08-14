import { bmPartsAdapter } from "./bm-parts.adapter";
import { uniqueTradeAdapter } from "./unique-trade.adapter";
import type { SupplierAdapter, SupplierConnectionCheck, SupplierId, SupplierOffer, SupplierStatus } from "./types";

const autoNovaAdapter: SupplierAdapter = {
  id: "autonova-d",
  name: "Автонова-Д",
  website: "https://autonovad.ua/",
  apiBaseUrl: null,
  authType: "Окремий API-доступ через менеджера",
  capabilities: ["SEARCH", "PRICE", "STOCK", "WAREHOUSES", "VIN"],
  setupHint: "Потрібно отримати в Автонова-Д окремі API credentials і технічну документацію. Поточний B2B пароль у код CRM не вбудовуємо.",
  isConfigured() {
    return Boolean(process.env.AUTONOVA_API_BASE_URL && process.env.AUTONOVA_API_LOGIN && process.env.AUTONOVA_API_PASSWORD);
  },
  async testConnection(): Promise<SupplierConnectionCheck> {
    return {
      ok: false,
      state: "MANUAL_SETUP",
      message: "Очікуємо офіційні API credentials та документацію Автонова-Д.",
      checkedAt: new Date().toISOString(),
    };
  },
  async search(): Promise<SupplierOffer[]> {
    return [];
  },
};

export const supplierAdapters: SupplierAdapter[] = [bmPartsAdapter, uniqueTradeAdapter, autoNovaAdapter];

export function getSupplierAdapter(id: SupplierId) {
  return supplierAdapters.find((adapter) => adapter.id === id) ?? null;
}

export function listSupplierStatuses(): SupplierStatus[] {
  return supplierAdapters.map((adapter) => {
    const configured = adapter.isConfigured();
    return {
      id: adapter.id,
      name: adapter.name,
      website: adapter.website,
      apiBaseUrl: adapter.apiBaseUrl,
      authType: adapter.authType,
      configured,
      state: adapter.id === "autonova-d" ? "MANUAL_SETUP" : configured ? "CONFIGURED" : "NOT_CONFIGURED",
      capabilities: adapter.capabilities,
      setupHint: adapter.setupHint,
    };
  });
}

export async function testSupplier(id: SupplierId) {
  const adapter = getSupplierAdapter(id);
  if (!adapter) throw new Error("Невідомий постачальник.");
  return adapter.testConnection();
}

export async function searchConfiguredSuppliers(query: string, limitPerSupplier = 20) {
  const searchable = supplierAdapters.filter((adapter) => adapter.id !== "autonova-d" && adapter.isConfigured());
  const settled = await Promise.allSettled(searchable.map((adapter) => adapter.search(query, limitPerSupplier)));

  const offers: SupplierOffer[] = [];
  const providers: Array<{ id: SupplierId; ok: boolean; message?: string }> = [];

  settled.forEach((result, index) => {
    const adapter = searchable[index];
    if (result.status === "fulfilled") {
      offers.push(...result.value);
      providers.push({ id: adapter.id, ok: true });
    } else {
      providers.push({ id: adapter.id, ok: false, message: result.reason instanceof Error ? result.reason.message : "Помилка API" });
    }
  });

  offers.sort((a, b) => {
    if (a.purchasePrice == null && b.purchasePrice == null) return 0;
    if (a.purchasePrice == null) return 1;
    if (b.purchasePrice == null) return -1;
    return a.purchasePrice - b.purchasePrice;
  });

  return { offers, providers, configuredSuppliers: searchable.map((adapter) => adapter.id) };
}
