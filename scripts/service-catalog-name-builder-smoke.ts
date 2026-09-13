import assert from "node:assert/strict";
import { buildServiceSearchAliases, normalizeServiceCatalogName } from "../src/services/service-catalog-name-builder.service";
import { resolvePartTerminology } from "../src/services/parts-terminology.service";

const cases = [
  ["Ступиця в зборі передня — заміна", "Ступиця в зборі передня — заміна"],
  ["Ступиця в зборі задня — заміна", "Ступиця в зборі задня — заміна"],
  ["Опора амортизатора передня — заміна", "Опора амортизатора передня — заміна"],
  ["Опора амортизатора задня — заміна", "Опора амортизатора задня — заміна"],
  ["Підшипник ступиці передній — заміна", "Підшипник ступиці передній — заміна"],
  ["Прокладка клапанної кришки — заміна", "Прокладка клапанної кришки — заміна"],
  ["Комплект пружин гальмівних колодок задній — заміна", "Комплект пружин гальмівних колодок задній — заміна"],
  ["Ремкомплект гальмівного супорта — заміна", "Ремкомплект гальмівного супорта — заміна"],
  ["ШРУС зовнішній — заміна", "Зовнішній ШРУС — заміна"],
  ["Гальмівні диски та колодки передні — заміна", "Гальмівні диски та колодки передні — заміна"],
] as const;

for (const [sourceName, expected] of cases) {
  const normalized = normalizeServiceCatalogName({ sourceName });
  assert.equal(normalized.displayName, expected, `${sourceName} → ${normalized.displayName}`);
}

assert.equal(resolvePartTerminology({ query: "тормозні колодки" }).definition?.code, "BRAKE_PAD");
assert.equal(resolvePartTerminology({ query: "подкрылок" }).definition?.code, "WHEEL_ARCH_LINER");
assert.ok(buildServiceSearchAliases({ part: "Гальмівні колодки", operation: "заміна" }).includes("тормозні колодки"));
assert.ok(!buildServiceSearchAliases({ part: "Комплект пружин гальмівних колодок", operation: "заміна" }).includes("тормозні колодки"));
console.log(`service-catalog-name-builder smoke passed: ${cases.length} canonical and compound-name cases + synonym resolution`);
