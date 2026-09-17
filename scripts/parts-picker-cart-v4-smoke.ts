import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const wrapper = read("app/parts-catalog-legacy.tsx");
const workspace = read("app/parts-selection-workspace-v4.tsx");
const workspaceCss = read("app/parts-selection-workspace-v4.module.css");
const partsLayoutCss = read("app/parts-cart-summary-layout.css");
const pickerPolishCss = read("app/parts-picker-modal-polish.css");
const ultraCompactCss = read("app/parts-picker-ultra-compact.css");
const referenceLayoutCss = read("app/parts-selection-reference-layout-v8.css");
const loadingEnhancer = read("app/parts-picker-loading-enhancer.tsx");
const rootLayout = read("app/layout.tsx");
const lineRoute = read("app/api/parts-selection/line/route.ts");
const selectRoute = read("app/api/parts-selection/select/route.ts");
const handoffRoute = read("app/api/diagnostics/[id]/commercial-handoff/route.ts");
const proposalRoute = read("app/api/diagnostics/[id]/commercial-proposal/route.ts");
const staging = read("src/services/diagnostic-part-selection-draft.service.ts");
const prismaModel = read("prisma/parts-selection-draft.prisma");
const specV4 = read("docs/TZ_PARTS_PICKER_CART_V4.md");
const specV5 = read("docs/TZ_PARTS_IN_PROGRESS_STAGING_V5.md");
const specV7 = read("docs/TZ_PARTS_WORKSPACE_DENSITY_V7.md");
const specV8 = read("docs/TZ_PARTS_SELECTION_REFERENCE_LAYOUT_V8.md");

assert.match(wrapper, /PartsSelectionWorkspaceV4/, "diagnostic route must mount V4 picker/cart workspace");
assert.match(wrapper, /PartsCatalogV3/, "non-diagnostic legacy entry must remain available");
assert.match(workspace, /К-ть знайдених запчастин/, "picker must show result count");
assert.match(workspace, /Оригінали/, "picker must show originals section");
assert.match(workspace, /Аналоги/, "picker must show analogs section");
assert.match(workspace, /Потребує перевірки/, "picker must isolate unconfirmed results");
assert.match(workspace, /Усі постачальники/, "picker must expose supplier filter");
assert.match(workspace, /toggleSort\("brand"\)/, "picker must sort by brand");
assert.match(workspace, /toggleSort\("price"\)/, "picker must sort by price");
assert.match(workspace, /Наявність ⓘ/, "availability must expose warehouse detail");
assert.match(workspace, /\/api\/parts-selection\/line/, "cart must load and persist manual corrections");
assert.match(workspace, /Ціна закупки, грн/, "cart must retain purchase price column");
assert.match(workspace, /Прибуток, грн/, "cart must calculate profit column");
assert.match(workspace, /priceOverrideReason/, "direct sell-price override must carry reason context");

assert.match(workspaceCss, /-webkit-line-clamp:2/, "need names must remain readable across up to two lines");
assert.match(workspaceCss, /align-items:start/, "workspace panels must not stretch each other into a large empty area");
assert.match(workspaceCss, /\.cartFooter button:disabled\{opacity:1;border-color:var\(--line\);background:var\(--panel\)/, "disabled commercial CTA must be visually secondary");
assert.match(workspaceCss, /min-width:1360px/, "cart must retain all agreed columns through horizontal scrolling");
assert.match(partsLayoutCss, /grid-template-columns:\s*clamp\(340px,\s*28vw,\s*460px\)\s+minmax\(0,\s*1fr\)/, "legacy V7 desktop workspace contract must stay available beneath the final reference override");
assert.match(partsLayoutCss, /max-width:\s*460px/, "needs panel legacy width rule must remain available as a safe fallback");
assert.match(partsLayoutCss, /min-height:\s*50px/, "need rows must stay compact on desktop");
assert.match(partsLayoutCss, /grid-template-columns:\s*18px\s+minmax\(0,\s*1fr\)\s+38px\s+76px/, "need row columns must prioritize the part name over quantity and action chrome");

assert.match(pickerPolishCss, /z-index:3600!important/, "parts picker backdrop must retain modal z-index for tablet/mobile");
assert.match(pickerPolishCss, /grid-template-rows:auto auto auto auto minmax\(180px,1fr\) auto auto!important/, "manual compatibility confirmation must occupy its own row below sorting");
assert.match(pickerPolishCss, /turbo-lev-search\.gif/, "supplier search must use the animated Turbo Lev loader asset");
assert.match(pickerPolishCss, /118px!important/, "result action column must be wide enough to avoid clipped confirmation buttons");
assert.match(ultraCompactCss, /padding:\s*8px 12px 7px !important/, "desktop picker header must stay tightly packed");
assert.match(ultraCompactCss, /height:\s*32px !important/, "search controls must use the compact 32px height");
assert.match(ultraCompactCss, /min-height:\s*46px !important/, "desktop supplier rows must fit more offers in the visible result area");
assert.match(ultraCompactCss, /width:\s*28px !important/, "supplier thumbnails must shrink with the compact row density");
assert.match(ultraCompactCss, /min-height:\s*150px !important/, "animated supplier-search state must remain visible without wasting vertical space");

assert.match(referenceLayoutCss, /grid-template-columns:\s*clamp\(340px,\s*27vw,\s*430px\)\s+minmax\(0,\s*1fr\)/, "reference desktop must use a compact needs column and a dominant supplier column");
assert.match(referenceLayoutCss, /parts-selection-workspace-v4_cartPanel__[\s\S]*grid-column:\s*1\s*\/\s*-1\s*!important/, "selected parts must span the full desktop workspace width");
assert.match(referenceLayoutCss, /parts-selection-workspace-v4_workspace__[\s\S]*display:\s*contents\s*!important/, "workspace wrapper must expose cart/needs to the page reference grid");
assert.match(referenceLayoutCss, /Пропозиції постачальників/, "reference desktop must expose an honest supplier-workspace empty state");
assert.match(referenceLayoutCss, /parts-selection-workspace-v4_backdrop__[\s\S]*position:\s*relative\s*!important/, "desktop supplier picker must be inline instead of a fullscreen overlay");
assert.match(referenceLayoutCss, /parts-selection-workspace-v4_backdrop__[\s\S]*grid-column:\s*2\s*!important/, "inline supplier picker must occupy the right lower column");
assert.match(referenceLayoutCss, /@media\s*\(max-width:\s*1180px\)/, "tablet/mobile must keep the proven modal fallback");

assert.match(loadingEnhancer, /Шукаю BM Parts, UniTrade/, "loading enhancer must detect the real supplier-search state");
assert.match(loadingEnhancer, /partsSearchLoading = "true"/, "loading enhancer must mark only the active supplier-search state");
assert.match(rootLayout, /\.\/parts-picker-modal-polish\.css/, "parts picker modal polish must be globally loaded after responsive popup rules");
assert.match(rootLayout, /\.\/parts-picker-ultra-compact\.css/, "ultra-compact picker overrides must load after modal polish");
assert.match(rootLayout, /\.\/parts-selection-reference-layout-v8\.css/, "approved reference layout must load after all earlier parts picker styles");
assert.ok(rootLayout.indexOf('./parts-selection-reference-layout-v8.css') > rootLayout.indexOf('./parts-picker-ultra-compact.css'), "reference layout must have final CSS precedence");
assert.match(rootLayout, /<PartsPickerLoadingEnhancer\/>/, "animated parts picker loading enhancer must be mounted");

assert.match(lineRoute, /PERMISSIONS\.PARTS_READ/, "cart GET must require PARTS_READ");
assert.match(lineRoute, /PERMISSIONS\.PARTS_WRITE/, "cart PATCH must require PARTS_WRITE");
assert.match(lineRoute, /listDiagnosticPartCartRows/, "cart route must support staged and canonical rows");
assert.match(lineRoute, /updateDiagnosticPartCartRow/, "cart route must delegate staged/canonical updates to the service");

assert.match(selectRoute, /view\.diagnostic\.status === "CONFIRMED"/, "confirmed diagnostics must retain canonical selection flow");
assert.match(selectRoute, /stageDiagnosticPartOffer/, "unconfirmed diagnostics must persist selected offers without creating a WorkOrder");
assert.match(handoffRoute, /getDiagnosticPartSelectionPreview/, "handoff GET must expose parts preview before confirmation");
assert.match(handoffRoute, /commercialReady: false/, "pre-confirmation preview must explicitly remain non-commercial");
assert.match(proposalRoute, /syncDiagnosticPartSelectionDraftsToWorkOrder/, "commercial proposal creation must promote staged selections");

assert.match(staging, /diagnosticPartSelectionDraft\.upsert/, "reselection must replace one staged row for the same diagnostic need");
assert.match(staging, /PART_OFFER_STAGED_BEFORE_DIAGNOSTIC_CONFIRMATION/, "pre-confirmation supplier selection must be audited");
assert.match(staging, /lineId: `draft:\$\{row\.id\}`/, "staged rows must expose stable UI cart ids");
assert.match(staging, /PART_SELECTION_LINE_MANUAL_OVERRIDE/, "manual corrections must create audit events");
assert.match(staging, /partsManualOverrides/, "manual provenance must be persisted when staged facts become canonical");
assert.match(staging, /partsRequestItem\.updateMany/, "cart edits and promotion must sync PartsRequestItem");
assert.match(staging, /LOCKED_REQUEST_STATUSES/, "ordered or received canonical parts must remain protected from unsafe editing");
assert.match(staging, /STAGED_PART_SELECTION_SYNCED_TO_WORK_ORDER/, "promotion to WorkOrder must be explicitly audited");
assert.match(prismaModel, /model DiagnosticPartSelectionDraft/, "staged supplier selections must have a durable database source of truth");
assert.match(prismaModel, /@@unique\(\[diagnosticRequestId, selectionKey\]\)/, "one diagnostic need must have one staged selection row");
assert.match(specV4, /жодних вигаданих даних/i, "V4 spec must forbid fabricated supplier/cart facts");
assert.match(specV5, /не створює WorkOrder і не створює Комерційну пропозицію/, "V5 must preserve the commercial hard gate while allowing sourcing");
assert.match(specV5, /IN_PROGRESS/, "V5 must explicitly support parts sourcing while diagnostics are in progress");
assert.match(specV7, /28–30% `Деталі до заміни` \/ 70–72% `Вибрані деталі`/, "V7 must retain its historical selected-parts-first contract");
assert.match(specV7, /(?:усі|всі) погоджені 14 колонок/, "V7 must preserve every agreed cart column");
assert.match(specV8, /«Вибрані деталі» повинен займати всю доступну ширину робочої області/, "V8 must codify the approved full-width selected-parts requirement");
assert.match(specV8, /жодних вигаданих цін, залишків, термінів, маржі, постачальників або статусів/i, "V8 must forbid fabricated supplier facts");
assert.match(specV8, /чинний picker перестає сприйматися як fullscreen popup/i, "V8 must reuse the current picker as the desktop inline supplier workspace");

console.log("Parts picker + editable cart + pre-confirmation staging V5 + reference full-width workspace V8 + modal/loading polish + ultra-compact density smoke: PASS");
