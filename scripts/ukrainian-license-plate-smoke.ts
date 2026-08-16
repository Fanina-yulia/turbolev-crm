import assert from "node:assert/strict";
import { isStandardUkrainianPlate, normalizeUkrainianPlate, parseUkrainianPlateDisplay } from "../app/ukrainian-license-plate";

assert.equal(normalizeUkrainianPlate("ax 7756 ki"), "AX7756KI");
assert.equal(normalizeUkrainianPlate("AX-7756-KI"), "AX7756KI");
assert.equal(isStandardUkrainianPlate("AX7756KI"), true);
assert.equal(isStandardUkrainianPlate("АХ 7756 КІ"), true);
assert.equal(isStandardUkrainianPlate("WVWZZZ1JZXW000001"), false, "VIN must never be styled as a plate");
assert.equal(isStandardUkrainianPlate("380673292456"), false, "phone must never be styled as a plate");
assert.equal(isStandardUkrainianPlate("ABC123"), false);

assert.deepEqual(parseUkrainianPlateDisplay("AX7756KI"), {
  plate: "AX7756KI", prefix: "", suffix: "", placement: "trailing",
});
assert.deepEqual(parseUkrainianPlateDisplay("ДержЗнак: AX7756KI"), {
  plate: "AX7756KI", prefix: "", suffix: "", placement: "trailing",
});
assert.deepEqual(parseUkrainianPlateDisplay("ДержЗнак: AX7756KI · VIN WVWZZZ1JZXW000001"), {
  plate: "AX7756KI", prefix: "", suffix: "VIN WVWZZZ1JZXW000001", placement: "leading",
});
assert.deepEqual(parseUkrainianPlateDisplay("2020 · AX7756KI"), {
  plate: "AX7756KI", prefix: "2020 ·", suffix: "", placement: "trailing",
});
assert.deepEqual(parseUkrainianPlateDisplay("PEUGEOT PARTNER · AX7756KI"), {
  plate: "AX7756KI", prefix: "PEUGEOT PARTNER ·", suffix: "", placement: "trailing",
});
assert.deepEqual(parseUkrainianPlateDisplay("AX7756KI · VIN WVWZZZ1JZXW000001"), {
  plate: "AX7756KI", prefix: "", suffix: "VIN WVWZZZ1JZXW000001", placement: "leading",
});
assert.equal(parseUkrainianPlateDisplay("VIN WVWZZZ1JZXW000001"), null);
assert.equal(parseUkrainianPlateDisplay("Телефон 380673292456"), null);

console.log("ukrainian-license-plate-smoke: ok");
