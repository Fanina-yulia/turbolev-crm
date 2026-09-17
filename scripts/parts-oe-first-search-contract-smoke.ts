import assert from "node:assert/strict";
import { resolveCuratedOeEvidence } from "../src/services/parts-oe-evidence.service";
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
assert.equal(wrongVehicle.rejectCode, "VEHICLE_MAKE_CONFLICT");

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

console.log("[parts-oe-first] curated OE, V3 hard reject, evidence tier and zero-price contracts OK");
