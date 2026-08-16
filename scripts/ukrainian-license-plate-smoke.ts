import assert from "node:assert/strict";
import { isStandardUkrainianPlate, normalizeUkrainianPlate } from "../app/ukrainian-license-plate";

assert.equal(normalizeUkrainianPlate("ax 7756 ki"), "AX7756KI");
assert.equal(normalizeUkrainianPlate("AX-7756-KI"), "AX7756KI");
assert.equal(isStandardUkrainianPlate("AX7756KI"), true);
assert.equal(isStandardUkrainianPlate("АХ 7756 КІ"), true);
assert.equal(isStandardUkrainianPlate("WVWZZZ1JZXW000001"), false, "VIN must never be styled as a plate");
assert.equal(isStandardUkrainianPlate("380673292456"), false, "phone must never be styled as a plate");
assert.equal(isStandardUkrainianPlate("ABC123"), false);

console.log("ukrainian-license-plate-smoke: ok");
