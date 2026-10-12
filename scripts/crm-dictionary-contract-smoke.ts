import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_CRM_DICTIONARY,
  findCrmDictionaryMatches,
  getCrmDictionaryStats,
  resolveCrmDictionaryTerm,
} from "@/src/services/crm-dictionary.service";

const stats = getCrmDictionaryStats(DEFAULT_CRM_DICTIONARY);
assert.ok(stats.entries >= 45, "CRM dictionary must start with a broad base of canonical terms");
assert.ok(stats.aliases >= 220, "CRM dictionary must include common Ukrainian/Russian aliases and typo variants");
assert.ok(stats.fitmentGuarded >= 20, "Part dictionary must keep fitment-sensitive entries guarded");

const cases = [
  ["рычаг", "Важіль підвіски"],
  ["рьічаг", "Важіль підвіски"],
  ["ричаг", "Важіль підвіски"],
  ["накінечник", "Наконечник рульової тяги"],
  ["торможа", "Ремонт гальмівної системи"],
  ["тормозные колодки", "Гальмівні колодки"],
  ["саленблок", "Сайлентблок важеля"],
  ["бьет руль", "Б'є кермо"],
  ["кп", "Комерційна пропозиція"],
];

for (const [input, expected] of cases) {
  const result = resolveCrmDictionaryTerm(input, DEFAULT_CRM_DICTIONARY);
  assert.equal(result?.entry.canonicalName, expected, `${input} must resolve to ${expected}`);
}

const broad = findCrmDictionaryMatches("передний рычаг", DEFAULT_CRM_DICTIONARY, 5);
assert.equal(broad[0]?.entry.canonicalName, "Важіль підвіски", "Phrase search must still resolve control arm aliases");
assert.equal(
  broad[0]?.entry.requiresFitmentCheck,
  true,
  "Control arm match must not bypass VIN/fitment validation",
);

const searchRoute = fs.readFileSync("app/api/search/route.ts", "utf8");
const searchUi = fs.readFileSync("app/global-smart-search.tsx", "utf8");
const settingsPanel = fs.readFileSync("app/crm-dictionary-settings-panel.tsx", "utf8");
const tz = fs.readFileSync("docs/TZ_CRM_DICTIONARY_SAFE_SEARCH.md", "utf8");

for (const marker of [
  "loadCrmDictionary()",
  "findCrmDictionaryMatches(q, dictionary, 5)",
  "observeUnknownCrmDictionaryTerm(q, \"GLOBAL_SEARCH\")",
  "dictionary: dictionaryMatches.map",
]) {
  assert.ok(searchRoute.includes(marker), `Global search must include dictionary contract marker: ${marker}`);
}

for (const marker of ["Словник CRM", "matchedAlias", "requiresFitmentCheck", "settingsTab: \"crmDictionary\""]) {
  assert.ok(searchUi.includes(marker), `Global search UI must include dictionary hint marker: ${marker}`);
}

for (const marker of ["Черга невідомих термінів", "crm_dictionary_unknown_terms", "Потребують VIN/сумісності"]) {
  assert.ok(settingsPanel.includes(marker), `Settings dictionary panel must include unknown queue marker: ${marker}`);
}

for (const marker of ["не повинна автоматично змінювати", "Черга невідомих термінів", "Не входить у перший етап"]) {
  assert.ok(tz.includes(marker), `TZ must document non-breaking scope: ${marker}`);
}

console.log(`[crm-dictionary] OK — ${stats.entries} entries, ${stats.aliases} aliases, ${stats.fitmentGuarded} fitment-guarded terms.`);