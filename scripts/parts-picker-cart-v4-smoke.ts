import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const wrapper = read("app/parts-catalog-legacy.tsx");
const workspace = read("app/parts-selection-workspace-v4.tsx");
const route = read("app/api/parts-selection/line/route.ts");
const spec = read("docs/TZ_PARTS_PICKER_CART_V4.md");

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
assert.match(route, /PERMISSIONS\.PARTS_READ/, "cart GET must require PARTS_READ");
assert.match(route, /PERMISSIONS\.PARTS_WRITE/, "cart PATCH must require PARTS_WRITE");
assert.match(route, /PART_SELECTION_LINE_MANUAL_OVERRIDE/, "manual corrections must create audit event");
assert.match(route, /partsManualOverrides/, "manual provenance must be persisted in metadata");
assert.match(route, /partsRequestItem\.updateMany/, "cart edits must sync PartsRequestItem");
assert.match(route, /LOCKED_REQUEST_STATUSES/, "ordered or received parts must be protected from unsafe editing");
assert.match(spec, /жодних вигаданих даних/i, "spec must forbid fabricated supplier/cart facts");

console.log("Parts picker + editable cart V4 smoke: PASS");
