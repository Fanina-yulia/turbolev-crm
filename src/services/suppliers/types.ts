export type SupplierId = "bm-parts" | "unique-trade" | "autonova-d";

export type SupplierCapability =
  | "SEARCH"
  | "PRICE"
  | "STOCK"
  | "CROSSES"
  | "WAREHOUSES"
  | "DELIVERY"
  | "ORDERS"
  | "VIN";

export type SupplierConnectionState = "CONNECTED" | "CONFIGURED" | "NOT_CONFIGURED" | "MANUAL_SETUP" | "ERROR";

export type SupplierConnectionCheck = {
  ok: boolean;
  state: SupplierConnectionState;
  message: string;
  checkedAt: string;
  latencyMs?: number;
};

export type SupplierStatus = {
  id: SupplierId;
  name: string;
  website: string;
  apiBaseUrl: string | null;
  authType: string;
  configured: boolean;
  state: SupplierConnectionState;
  capabilities: SupplierCapability[];
  setupHint: string;
};

export type SupplierStock = {
  warehouse: string;
  quantity: string;
};

export type SupplierOffer = {
  supplierId: SupplierId;
  supplierName: string;
  externalProductId: string | null;
  article: string;
  brand: string | null;
  name: string;
  purchasePrice: number | null;
  currency: string | null;
  multiplicity: number | null;
  stock: SupplierStock[];
  available: boolean;
  sourceUrl: string | null;
};

export interface SupplierAdapter {
  readonly id: SupplierId;
  readonly name: string;
  readonly website: string;
  readonly apiBaseUrl: string | null;
  readonly authType: string;
  readonly capabilities: SupplierCapability[];
  readonly setupHint: string;
  isConfigured(): boolean;
  testConnection(): Promise<SupplierConnectionCheck>;
  search(query: string, limit?: number): Promise<SupplierOffer[]>;
}
