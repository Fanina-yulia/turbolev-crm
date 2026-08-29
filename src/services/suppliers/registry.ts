import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
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

export async function searchConfiguredSuppliers(query: string, limitPerSupplier = 20) {
  const statuses = await listSupplierStatuses();
  const configuredIds = new Set(statuses.filter((supplier) => supplier.configured).map((supplier) => supplier.id));
  const readiness = supplierAdapters.map((adapter) => ({ adapter, configured: configuredIds.has(adapter.id) }));
  const searchable = readiness
    .filter((item) => item.adapter.id !== "autonova-d" && item.adapter.id !== "atl" && item.configured)
    .map((item) => item.adapter);
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

  return {
    offers,
    providers,
    configuredSuppliers: [...configuredIds],
    supplierStatuses: statuses,
  };
}
