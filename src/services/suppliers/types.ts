export type SupplierId = "bm-parts" | "unique-trade" | "autonova-d" | "atl";

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
  warehouseId?: string | null;
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

export type SupplierDeliveryPoint = {
  id: string;
  label: string;
};

export type SupplierTransporter = {
  id: string;
  label: string;
};

export type SupplierDeliveryOption = {
  id: string;
  label: string;
  time?: string | null;
  timestamp?: number | null;
};

export type SupplierOrderItemInput = {
  externalProductId: string;
  quantity: number;
  warehouseId: string;
};

export type SupplierOrderSubmitInput = {
  comment?: string | null;
  deliveryId: string;
  deliveryDate: string;
  deliveryPointId: string;
  paymentType: "nal" | "beznal";
  withoutDocument: boolean;
  items: SupplierOrderItemInput[];
};

export type SupplierOrderResult = {
  externalOrderId: string;
  externalCode?: string | null;
  providerStatus: string;
  totalPurchase: number | null;
  currency: string | null;
  raw: unknown;
};

export type SupplierOrderStatusResult = SupplierOrderResult & {
  items?: Array<{
    externalProductId: string | null;
    article: string | null;
    brand: string | null;
    name: string | null;
    quantity: number | null;
    purchasePrice: number | null;
    warehouseId: string | null;
    warehouse: string | null;
  }>;
};

export interface SupplierAdapter {
  readonly id: SupplierId;
  readonly name: string;
  readonly website: string;
  readonly apiBaseUrl: string | null;
  readonly authType: string;
  readonly capabilities: SupplierCapability[];
  readonly setupHint: string;
  isConfigured(): Promise<boolean>;
  testConnection(): Promise<SupplierConnectionCheck>;
  search(query: string, limit?: number): Promise<SupplierOffer[]>;
  listDeliveryPoints?(): Promise<SupplierDeliveryPoint[]>;
  listTransporters?(input: { date: string; deliveryPointId: string }): Promise<SupplierTransporter[]>;
  listDeliveryOptions?(input: { date: string; deliveryPointId: string; transporterId: string; warehouseIds: string[] }): Promise<SupplierDeliveryOption[]>;
  submitOrder?(input: SupplierOrderSubmitInput): Promise<SupplierOrderResult>;
  getOrder?(externalOrderId: string): Promise<SupplierOrderStatusResult>;
}
