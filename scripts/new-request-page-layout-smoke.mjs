import { readFile } from "node:fs/promises";

const pageCss = await readFile(new URL("../app/new-request-page.css", import.meta.url), "utf8");
const popupCss = await readFile(new URL("../app/responsive-popups.css", import.meta.url), "utf8");
const wizard = await readFile(new URL("../app/new-request-wizard-v5.tsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(wizard.includes('data-surface="page"'), "new request must declare page surface");
assert(wizard.includes('data-page="new-request"'), "new request page identity must be explicit");
assert(/\.requestPage\s*\{[\s\S]*display:flex/.test(pageCss), "page surface must be a column flex layout");
assert(/\.requestPage\s+\.requestScroll\s*\{[\s\S]*overflow:visible!important/.test(pageCss), "page must use document scroll");
assert(/\.requestPage\s+\.requestActions\s*\{[\s\S]*position:relative/.test(pageCss), "page actions must stay in normal flow");
assert(!/\.requestPage[^\{]*\{[^}]*position:\s*sticky/i.test(pageCss), "page surface must not use sticky positioning");
assert(!/\.requestPage[^\{]*\{[^}]*position:\s*fixed/i.test(pageCss), "page surface must not use fixed positioning");
assert(!popupCss.includes("  .requestModalV4,"), "popup contract must not classify requestModalV4 as a popup");
assert(popupCss.includes(":not(.requestPage)"), "popup contract must explicitly exclude page surfaces");

console.log("New request page layout smoke: OK");

