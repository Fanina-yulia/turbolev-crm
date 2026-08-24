import assert from "node:assert/strict";
import { extractPhoneCandidates, normalizePhoneForClipboard, phoneCandidateAtOffset } from "../src/lib/phone-copy";

const cases = [
  ["+38 (098) 341-56-46", "+380983415646"],
  ["098 341 56 46", "0983415646"],
  ["380983415646", "+380983415646"],
  ["+1 (415) 555-2671", "+14155552671"],
] as const;

for (const [source, expected] of cases) assert.equal(extractPhoneCandidates(source)[0]?.value, expected, source);

assert.equal(normalizePhoneForClipboard("tel:+380983415646"), "+380983415646");
assert.equal(extractPhoneCandidates("24.08.2026 · замовлення 1234567890").length, 0);

const sentence = "Клієнт: +38 (098) 341-56-46 · готовий до дзвінка";
assert.equal(phoneCandidateAtOffset(sentence, sentence.indexOf("341") + 1)?.value, "+380983415646");

console.log("Global phone copy smoke passed.");
