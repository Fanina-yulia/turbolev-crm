import assert from "node:assert/strict";
import { checkPartOfferRelevance } from "@/src/services/part-relevance.service";
import type { SupplierOffer } from "@/src/services/suppliers/types";

function offer(name: string, overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    supplierId: "bm-parts",
    supplierName: "BM Parts",
    externalProductId: null,
    article: "TEST-1",
    brand: null,
    name,
    purchasePrice: 100,
    currency: "UAH",
    multiplicity: 1,
    stock: [],
    available: true,
    sourceUrl: null,
    ...overrides,
  };
}

const context = {
  query: "шарову опору",
  partName: "Кульова опора — ліва сторона, передня вісь",
  canonicalCode: "BALL_JOINT",
};

assert.equal(
  checkPartOfferRelevance(offer("Кульова опора передня ліва"), context).relevant,
  true,
  "Окрема кульова опора має залишатися в результатах",
);

assert.equal(
  checkPartOfferRelevance(
    offer("Важіль підвіски (передній/знизу) (R) Renault Megane I/Scenic I (10RN2001 кульова)"),
    context,
  ).relevant,
  false,
  "Важіль, який лише містить згадку кульової, не є окремою кульовою опорою",
);

assert.equal(
  checkPartOfferRelevance(offer("Рычаг подвески передний"), context).relevant,
  false,
  "Важіль без слова кульова також не має проходити нечіткий пошук",
);

assert.equal(
  checkPartOfferRelevance(offer("Шаровая опора для рычага"), context).relevant,
  true,
  "Кульова опора, що призначена для важеля, є валідним результатом",
);

assert.equal(
  checkPartOfferRelevance(offer("Невідомий товар", { article: "OE-123" }), {
    ...context,
    catalogArticles: ["OE123"],
  }).relevant,
  true,
  "Точний каталожний артикул може підтвердити товар без терміна в назві",
);

assert.equal(
  checkPartOfferRelevance(offer("Важіль підвіски (кульова)", { article: "OE-123" }), {
    ...context,
    catalogArticles: ["OE123"],
  }).relevant,
  false,
  "Конфліктна назва assembly не може бути замаскована широким OE-збігом",
);

console.log("Parts relevance contract: PASS (6 checks)");
