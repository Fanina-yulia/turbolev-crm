import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const wrapper = read("app/parts-catalog-legacy.tsx");
const workspace = read("app/parts-selection-workspace-v4.tsx");
const workspaceCss = read("app/parts-selection-workspace-v4.module.css");
const lineRoute = read("app/api/parts-selection/line/route.ts");
const selectRoute = read("app/api/parts-selection/select/route.ts");
const handoffRoute = read("app/api/diagnostics/[id]/commercial-handoff/route.ts");
const proposalRoute = read("app/api/diagnostics/[id]/commercial-proposal/route.ts");
const staging = read("src/services/diagnostic-part-selection-draft.service.ts");
const prismaModel = read("prisma/parts-selection-draft.prisma");
const specV4 = read("docs/TZ_PARTS_PICKER_CART_V4.md");
const specV5 = read("docs/TZ_PARTS_IN_PROGRESS_STAGING_V5.md");
const specV7 = read("docs/TZ_PARTS_WORKSPACE_DENSITY_V7.md");

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

assert.match(workspaceCss, /grid-template-columns:minmax\(390px,40%\) minmax\(0,60%\)/, "desktop workspace must allocate readable width to needs and cart");
assert.match(workspaceCss, /-webkit-line-clamp:2/, "need names must be readable across up to two lines");
assert.match(workspaceCss, /align-items:start/, "workspace panels must not stretch each other into a large empty area");
assert.match(workspaceCss, /\.cartFooter button:disabled\{opacity:1;border-color:var\(--line\);background:var\(--panel\)/, "disabled commercial CTA must be visually secondary");
assert.match(workspaceCss, /min-width:1360px/, "cart must retain all agreed columns through horizontal scrolling");

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
assert.match(specV7, /40% `Деталі до заміни` \/ 60% `Кошик`/, "V7 must codify the balanced desktop workspace");
assert.match(specV7, /(?:усі|всі) погоджені 14 колонок/, "V7 must preserve every agreed cart column");

console.log("Parts picker + editable cart + pre-confirmation staging V5 + workspace density V7 smoke: PASS");