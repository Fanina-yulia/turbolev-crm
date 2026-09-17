import assert from "node:assert/strict";
import { evaluateStrictOffer, sanitizeSupplierOfferPrice } from "../src/services/part-offer-compatibility.service";
import { buildPartSearchIntentV3 } from "../src/services/part-search-intent-v3.service";
import { resolveCuratedOeEvidence } from "../src/services/parts-oe-evidence.service";
import { aggregatePartCandidates } from "../src/services/parts-candidate-aggregator.service";
import type { SupplierOffer } from "../src/services/suppliers/types";

function offer(partial: Partial<SupplierOffer>): SupplierOffer {
  return {
    supplierId: "unique-trade",
    supplierName: "Юнік Трейд",
    externalProductId: "1",
    article: "X1",
    brand: "TEST",
    name: "Запчастина",
    purchasePrice: 100,
    currency: "UAH",
    multiplicity: 1,
    stock: [{ warehouse: "Київ", quantity: "1" }],
    available: true,
    sourceUrl: null,
    ...partial,
  };
}

let checks = 0;

const wrongFamily = evaluateStrictOffer(offer({ name: "Супорт гальмівний задній правий", article: "440016959R", brand: "RENAULT" }), {
  canonicalCode: "BRAKE_DISC",
  partName: "Гальмівний диск — права сторона, задня вісь",
  axis: "REAR",
  side: "RIGHT",
  vehicleBrand: "GEELY",
});
assert.equal(wrongFamily.rejected, true); checks++;
assert.equal(wrongFamily.rejectCode, "PART_FAMILY_CONFLICT"); checks++;

const padIntent = buildPartSearchIntentV3({
  partName: "Гальмівні колодки — права сторона, задня вісь",
  canonicalCode: "BRAKE_PAD",
  axis: "REAR",
  side: "RIGHT",
  quantity: 1,
});
assert.equal(padIntent.part.axis, "REAR"); checks++;
assert.equal(padIntent.part.side, null); checks++;
assert.equal(padIntent.quantity.scope, "AXLE"); checks++;
assert.equal(padIntent.quantity.soldAs, "SET"); checks++;

const wrongSide = evaluateStrictOffer(offer({ name: "Гальмівний супорт задній лівий", article: "CAL-L" }), {
  canonicalCode: "BRAKE_CALIPER",
  partName: "Гальмівний супорт",
  axis: "REAR",
  side: "RIGHT",
});
assert.equal(wrongSide.rejected, true); checks++;
assert.equal(wrongSide.rejectCode, "SIDE_CONFLICT"); checks++;

const wrongMake = evaluateStrictOffer(offer({ name: "Brake disc Renault Master rear", brand: "RENAULT", article: "R1" }), {
  canonicalCode: "BRAKE_DISC",
  partName: "Гальмівний диск",
  axis: "REAR",
  vehicleBrand: "GEELY",
});
assert.equal(wrongMake.rejected, true); checks++;
assert.equal(wrongMake.rejectCode, "VEHICLE_MAKE_CONFLICT"); checks++;

const geely = { brand: "GEELY", model: "EMGRAND X7", year: 2014 };
const discOe = resolveCuratedOeEvidence({ vehicle: geely, canonicalCode: "BRAKE_DISC", partName: "Гальмівний диск", axis: "REAR" });
assert.deepEqual(discOe?.oeNumbers, ["1014012463"]); checks++;
const padOe = resolveCuratedOeEvidence({ vehicle: geely, canonicalCode: "BRAKE_PAD", partName: "Гальмівні колодки", axis: "REAR" });
assert.deepEqual(padOe?.oeNumbers, ["101402006059"]); checks++;
const bushingOe = resolveCuratedOeEvidence({ vehicle: geely, canonicalCode: "STABILIZER_BUSHING", partName: "Втулка стабілізатора", axis: "REAR" });
assert.deepEqual(bushingOe?.oeNumbers, ["1014012805"]); checks++;

const fuzzy = evaluateStrictOffer(offer({ name: "Гальмівний диск", article: "GENERIC" }), {
  canonicalCode: "BRAKE_DISC",
  partName: "Гальмівний диск",
  axis: "REAR",
  vehicleBrand: "GEELY",
});
assert.equal(fuzzy.accepted, true); checks++;
assert.equal(fuzzy.compatibilityTier, "REVIEW_REQUIRED"); checks++;
assert.notEqual(fuzzy.compatibilityTier, "CONFIRMED"); checks++;

const zero = sanitizeSupplierOfferPrice(offer({ purchasePrice: 0, sellPrice: 0 }));
assert.equal(zero.purchasePrice, null); checks++;
assert.equal(zero.sellPrice, null); checks++;

const candidates = aggregatePartCandidates([
  offer({ supplierId: "bm-parts", supplierName: "BM Parts", externalProductId: "bm1", brand: "TRW", article: "DF8071", name: "Гальмівний диск", resultType: "ANALOG", compatibilityTier: "PARTIAL", analogOfArticle: "1014012463", purchasePrice: 2100 }),
  offer({ supplierId: "unique-trade", supplierName: "Юнік Трейд", externalProductId: "ut1", brand: "TRW", article: "DF8071", name: "Гальмівний диск", resultType: "ANALOG", compatibilityTier: "PARTIAL", analogOfArticle: "1014012463", purchasePrice: 2030 }),
]);
assert.equal(candidates.length, 1); checks++;
assert.equal(candidates[0]?.resultType, "ANALOG"); checks++;
assert.equal(candidates[0]?.compatibility, "SUPPORTED"); checks++;
assert.equal(candidates[0]?.offers.length, 2); checks++;
assert.equal(candidates[0]?.bestOffer.supplierId, "unique-trade"); checks++;

const knownRejected = evaluateStrictOffer(offer({ name: "Гальмівний диск", article: "BAD123" }), {
  canonicalCode: "BRAKE_DISC",
  partName: "Гальмівний диск",
  knownRejectedArticles: ["BAD123"],
});
assert.equal(knownRejected.rejectCode, "KNOWN_REJECTED_MATCH"); checks++;

console.log(`Parts Search V3 Evidence First contract: PASS (${checks} checks)`);
