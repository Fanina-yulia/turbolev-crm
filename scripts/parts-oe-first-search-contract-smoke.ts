import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCuratedOeEvidence } from "../src/services/parts-oe-evidence.service";
import { resolvePartSearchIntent } from "../src/services/parts-search-intent.service";
import {
  applyStrictOfferPolicy,
  evaluateStrictOffer,
  sanitizeSupplierOfferPrice,
} from "../src/services/part-offer-compatibility.service";
import type { SupplierOffer } from "../src/services/suppliers/types";

function offer(input: Partial<SupplierOffer>): SupplierOffer {
  return {
    supplierId: "unique-trade",
    supplierName: "Юнік Трейд",
    externalProductId: "1",
    article: "TEST",
    brand: "TEST",
    name: "Запчастина",
    purchasePrice: 100,
    currency: "UAH",
    multiplicity: 1,
    stock: [{ warehouse: "Склад", quantity: "1" }],
    available: true,
    sourceUrl: null,
    ...input,
  };
}

const geelyRear = resolveCuratedOeEvidence({
  vehicle: { brand: "GEELY", model: "EMGRAND X7", year: 2014 },
  canonicalCode: "STABILIZER_BUSHING",
  partName: "Втулка стабілізатора задня вісь",
  axis: "REAR",
});
assert.ok(geelyRear, "Geely Emgrand X7 2014 rear stabilizer bushing must resolve curated OE evidence");
assert.deepEqual(geelyRear.oeNumbers, ["1014012805"]);
assert.equal(geelyRear.exact, false, "curated OE evidence must not pretend to be exact VIN fitment");

const geelyFront = resolveCuratedOeEvidence({
  vehicle: { brand: "GEELY", model: "EMGRAND X7", year: 2014 },
  canonicalCode: "STABILIZER_BUSHING",
  partName: "Втулка стабілізатора передня вісь",
  axis: "FRONT",
});
assert.equal(geelyFront, null, "rear-only curated OE seed must not leak into FRONT search");

const brakeIntent = resolvePartSearchIntent({
  query: "Гальмівні колодки — права сторона, задня вісь",
  partName: "Гальмівні колодки — права сторона, задня вісь",
  canonicalCode: "STABILIZER_BUSHING",
  genericArticleId: "stale-stabilizer-id",
  axis: "REAR",
  side: "RIGHT",
});
assert.equal(brakeIntent.metadataConflict, true, "visible brake-pad text must override stale stabilizer metadata");
assert.equal(brakeIntent.canonicalCode, "BRAKE_PAD");
assert.equal(brakeIntent.genericArticleId, null, "stale generic article id must be discarded on family conflict");
assert.equal(brakeIntent.axis, "REAR");
assert.equal(brakeIntent.side, null, "brake pads are axle-scoped, so a stale wheel side must not poison supplier search");

const brakePadMustNotReuseStabilizerOe = resolveCuratedOeEvidence({
  vehicle: { brand: "GEELY", model: "EMGRAND X7", year: 2014 },
  canonicalCode: brakeIntent.canonicalCode,
  partName: brakeIntent.partName,
  axis: brakeIntent.axis,
});
assert.equal(brakePadMustNotReuseStabilizerOe, null, "BRAKE_PAD search must never receive stabilizer OE 1014012805");

const strictContext = {
  query: "Втулка стабілізатора задня вісь",
  partName: "Втулка стабілізатора",
  canonicalCode: "STABILIZER_BUSHING",
  axis: "REAR",
  vehicleBrand: "GEELY",
  vehicleModel: "EMGRAND X7",
  oeNumbers: ["1014012805"],
  curatedOeNumbers: ["1014012805"],
  fitmentConfirmed: false,
  fitmentExact: false,
};

const wrongAxis = evaluateStrictOffer(offer({
  name: "Втулка стабілізатора переднього Renault Trafic 01-",
  article: "BG1811",
  brand: "BELGUM PARTS",
}), strictContext);
assert.equal(wrongAxis.rejected, true);
assert.equal(wrongAxis.rejectCode, "AXIS_CONFLICT");

const wrongVehicle = evaluateStrictOffer(offer({
  name: "Втулка стабілізатора заднього MB Sprinter 208-316",
  article: "819000810",
  brand: "FAG",
}), strictContext);
assert.equal(wrongVehicle.rejected, true);
assert.equal(wrongVehicle.rejectCode, "VEHICLE_CONFLICT");

const exactOe = evaluateStrictOffer(offer({
  name: "Втулка стабілізатора заднього Geely Emgrand X7",
  article: "1014012805",
  brand: "GEELY",
}), strictContext);
assert.equal(exactOe.rejected, false);
assert.equal(exactOe.evidence, "EXACT_OE");
assert.equal(exactOe.compatibilityTier, "PARTIAL", "curated OE must remain model-level evidence until exact VIN is proven");

const genericReview = evaluateStrictOffer(offer({
  name: "Sway Bar Bushing",
  article: "AMGK201659",
  brand: "MOOG",
}), strictContext);
assert.equal(genericReview.rejected, false);
assert.equal(genericReview.evidence, "REVIEW");

const zeroPrice = sanitizeSupplierOfferPrice(offer({
  name: "Sway Bar Bushing",
  article: "AMGK201659",
  brand: "MOOG",
  purchasePrice: 0,
  sellPrice: 0,
}));
assert.equal(zeroPrice.purchasePrice, null);
assert.equal(zeroPrice.sellPrice, null);

const applied = applyStrictOfferPolicy(offer({
  name: "Втулка стабілізатора заднього Geely Emgrand X7",
  article: "1014012805",
  brand: "GEELY",
  purchasePrice: 0,
  sellPrice: 0,
}), strictContext);
assert.ok(applied.offer);
assert.equal(applied.offer?.purchasePrice, null, "zero-priced OE offer must be non-orderable until a real price arrives");

const strictSearchSource = readFileSync("src/services/strict-parts-search.service.ts", "utf8");
assert.ok(strictSearchSource.includes("searchBmVehicleEvidence"), "OE-first search must supplement generic supplier search with BM vehicle evidence");
assert.ok(strictSearchSource.includes("adapter.searchVehicleParts"), "BM vehicle-scoped API must be called directly when vehicle context is available");
assert.ok(strictSearchSource.includes("OE_FIRST_V3"), "search audit must expose the V3 algorithm");
assert.ok(strictSearchSource.includes('fitmentExact: null'), "review-only rows must not masquerade as model-confirmed rows");

console.log("[parts-oe-first] V3 intent guard, BM vehicle search, hard reject, evidence tier and zero-price contracts OK");
