import assert from "node:assert/strict";
import {
  buildCascadeReferences,
  classifySupplierResultType,
  getAssemblyFallback,
} from "@/src/services/suppliers/cascade-search";
import type { SupplierOffer } from "@/src/services/suppliers/types";

function offer(overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    supplierId: "bm-parts",
    supplierName: "BM Parts",
    externalProductId: "p-1",
    article: "9036945003",
    brand: "LEXUS",
    name: "Подшипник правой ступицы переднего моста",
    purchasePrice: 100,
    currency: "UAH",
    multiplicity: 1,
    stock: [],
    available: true,
    sourceUrl: null,
    ...overrides,
  };
}

const references = buildCascadeReferences("Ступичний підшипник", {
  canonicalCode: "WHEEL_HUB_BEARING",
  partName: "Ступичний підшипник",
  oeNumbers: ["90369-45003"],
  catalogArticles: [],
  analogReferences: [],
  providerVehicleBrand: "LEXUS",
}, [offer({ oeNumbers: ["9036945003"] })]);

assert.equal(references.some((item) => item.article.replace(/\D/g, "") === "9036945003"), true,
  "OEM 9036945003 must become a cascade seed for every configured supplier");

const promoted = buildCascadeReferences("9036945003", {
  canonicalCode: "WHEEL_HUB_BEARING",
  partName: "Ступичний підшипник",
}, [offer({ article: "9036945003", offerClass: "OEM" })]);
assert.equal(promoted.length > 0, true, "Direct article search must be promoted into the cascade");

const fallback = getAssemblyFallback({ canonicalCode: "WHEEL_HUB_BEARING", partName: "Ступичний підшипник" });
assert.equal(fallback?.canonicalCode, "WHEEL_HUB_ASSEMBLY", "Bearing must fall back to a complete hub assembly");
assert.equal(fallback?.providerQueries.BM_PARTS.includes("ступица в сборе"), true);
assert.equal(fallback?.providerQueries.UNITRADE.includes("ступиця з підшипником"), true);

assert.equal(classifySupplierResultType(offer(), {
  isOeNumber: true,
  vehicleBrand: "LEXUS",
}), "ORIGINAL", "Vehicle-brand OEM must be classified as original");

assert.equal(classifySupplierResultType(offer({ brand: "SKF", offerClass: "OEM" }), {
  isOeNumber: true,
  vehicleBrand: "LEXUS",
}), "OEM_REPLACEMENT", "Different-brand OEM-number match must be an OEM replacement");

assert.equal(classifySupplierResultType(offer({ sourceKind: "ANALOG", offerClass: "ANALOG" }), {
  isAnalog: true,
}), "ANALOG");

assert.equal(classifySupplierResultType(offer({ sourceKind: "ASSEMBLY" }), {
  isAssembly: true,
}), "ASSEMBLY");

console.log("Parts cascade search contract: PASS (9 checks)");
