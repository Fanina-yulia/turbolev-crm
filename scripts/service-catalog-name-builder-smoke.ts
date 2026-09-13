import assert from "node:assert/strict";
import { normalizeServiceCatalogName } from "../src/services/service-catalog-name-builder.service";
import { resolvePartTerminology } from "../src/services/parts-terminology.service";

const cases = [
  ["Ступиця в зборі передня — заміна", "Ступиця в зборі передня — заміна"],
  ["Ступиця в зборі задня — заміна", "Ступиця в зборі задня — заміна"],
  ["Опора амортизатора передня — заміна", "Опора амортизатора передня — заміна"],
  ["Опора амортизатора задня — заміна", "Опора амортизатора задня — заміна"],
  ["Підшипник ступиці передній — заміна", "Підшипник ступиці передній — заміна"],
] as const;

for (const [sourceName, expected] of cases) {
  const normalized = normalizeServiceCatalogName({ sourceName });
  assert.equal(normalized.displayName, expected, `${sourceName} → ${normalized.displayName}`);
}

assert.equal(resolvePartTerminology({ query: "тормозні колодки" }).definition?.code, "BRAKE_PAD");
assert.equal(resolvePartTerminology({ query: "подкрылок" }).definition?.code, "WHEEL_ARCH_LINER");
console.log(`service-catalog-name-builder smoke passed: ${cases.length} gender cases + synonym resolution`);
