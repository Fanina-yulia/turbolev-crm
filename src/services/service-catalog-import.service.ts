import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export type CatalogSource = "MS_MASTER" | "MANUAL";
export type CatalogItemType = "LABOR" | "DIAGNOSTIC" | "MATERIAL" | "INFORMATION" | "CHECKLIST" | "RENT" | "PARKING" | "WASH" | "OTHER";
export type CatalogReviewStatus = "READY" | "NEEDS_REVIEW" | "QUARANTINED";
export type CatalogBodySide = "LEFT" | "RIGHT" | null;
export type CatalogCalculatorOperation = "REPLACE_NO_PAINT" | "REPLACE_WITH_PAINT" | "PAINT_NO_REPAIR" | "LIGHT_REPAIR" | "LIGHT_REPAIR_PAINT" | "COMPLEX_REPAIR" | "COMPLEX_REPAIR_PAINT" | null;
export type CatalogPayrollType = "NONE" | "PERCENT_NORM_HOURS";

export type ParsedCatalogRow = {
  externalServiceId: string;
  code: string;
  internalName: string;
  displayName: string;
  searchAliases: string[];
  categoryId: string;
  normalizedCategory: string;
  sourceCategory: string;
  itemType: CatalogItemType;
  basePrice: number | null;
  unit: string;
  defaultQuantity: number;
  normMinutes: number | null;
  complexSurcharge: number | null;
  vehicleCoefficientEnabled: boolean;
  warrantyKm: number | null;
  warrantyDays: number | null;
  payrollCategory: string | null;
  payrollType: CatalogPayrollType;
  mechanicPercent: number | null;
  mechanicFixedAmount: number | null;
  bodyPart: string | null;
  bodySide: CatalogBodySide;
  calculatorOperation: CatalogCalculatorOperation;
  sourceActive: boolean | null;
  sourceLanding: boolean | null;
  reviewStatus: CatalogReviewStatus;
  reviewReason: string | null;
  sourceRow: number;
  originalData: Record<string, string | number | boolean | null>;
};

export type ParsedCatalogWorkbook = {
  format: "MS_MASTER" | "TURBO_LEV_TEMPLATE";
  source: CatalogSource;
  fileName: string;
  sha256: string;
  sheetName: string;
  rows: ParsedCatalogRow[];
  stats: {
    total: number;
    ready: number;
    needsReview: number;
    quarantined: number;
    bodyCalculatorRows: number;
    warrantyRows: number;
    payrollRows: number;
    missingPrice: number;
    lowTechnicalPrice: number;
    missingCategory: number;
    missingPrintName: number;
  };
  warnings: string[];
};

const NS = "(?:[A-Za-z_][\\w.-]*:)?";

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function attr(source: string, name: string) {
  const match = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`).exec(source);
  return match ? xmlDecode(match[1]) : "";
}
function unzip(buffer: Buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("INVALID_XLSX");
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("INVALID_XLSX");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("INVALID_XLSX");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (content) files.set(name.replace(/^\//, ""), content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function matches(xml: string, tag: string) { return xml.matchAll(new RegExp(`<${NS}${tag}\\b[^>]*>([\\s\\S]*?)<\\/${NS}${tag}>`, "g")); }
function sharedStrings(files: Map<string, Buffer>) {
  const xml = files.get("xl/sharedStrings.xml")?.toString("utf8") || "";
  const result: string[] = [];
  for (const match of matches(xml, "si")) result.push([...matches(match[1], "t")].map((x) => xmlDecode(x[1])).join(""));
  return result;
}
function workbookSheets(files: Map<string, Buffer>) {
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") || "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const id = attr(match[1], "Id");
    const raw = attr(match[1], "Target").replace(/^\//, "");
    if (id) targets.set(id, raw.startsWith("xl/") ? raw : `xl/${raw.replace(/^\.\//, "")}`);
  }
  const result: Array<{ name: string; path: string }> = [];
  const sheetRe = new RegExp(`<${NS}sheet\\b([^>]*)\/?\s*>`, "g");
  for (const match of workbook.matchAll(sheetRe)) {
    const name = attr(match[1], "name");
    const path = targets.get(attr(match[1], "r:id"));
    if (name && path) result.push({ name, path });
  }
  return result;
}
function columnIndex(ref: string) {
  const letters = (/^([A-Z]+)/i.exec(ref)?.[1] || "A").toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}
function parseSheet(xml: string, shared: string[]) {
  const rows: Array<Array<string | number | boolean | null>> = [];
  for (const rowMatch of matches(xml, "row")) {
    const row: Array<string | number | boolean | null> = [];
    const cellRe = new RegExp(`<${NS}c\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/${NS}c>)`, "g");
    for (const cellMatch of rowMatch[1].matchAll(cellRe)) {
      const attrs = cellMatch[1], body = cellMatch[2] ?? "", ref = attr(attrs, "r"), type = attr(attrs, "t");
      const v = new RegExp(`<${NS}v\\b[^>]*>([\\s\\S]*?)<\\/${NS}v>`).exec(body)?.[1] ?? "";
      const inline = [...matches(body, "t")].map((x) => xmlDecode(x[1])).join("");
      let value: string | number | boolean | null = null;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr" || type === "str") value = inline || xmlDecode(v);
      else if (type === "b") value = v === "1";
      else if (v !== "") { const n = Number(v); value = Number.isFinite(n) ? n : xmlDecode(v); }
      else if (inline) value = inline;
      if (ref) row[columnIndex(ref)] = value;
    }
    rows.push(row);
  }
  return rows;
}
function clean(value: unknown) { return String(value ?? "").trim(); }
function numberOrNull(value: unknown) {
  if (value == null || clean(value) === "") return null;
  const parsed = typeof value === "number" ? value : Number(clean(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function integerOrNull(value: unknown) { const n = numberOrNull(value); return n == null ? null : Math.max(0, Math.round(n)); }
function booleanOrNull(value: unknown) {
  if (value == null || clean(value) === "") return null;
  if (typeof value === "boolean") return value;
  const normalized = clean(value).toLocaleLowerCase("uk-UA");
  if (["1", "true", "так", "да", "yes", "+"].includes(normalized)) return true;
  if (["0", "false", "ні", "нет", "no", "-"].includes(normalized)) return false;
  return null;
}
function key(value: string) { return value.toLocaleLowerCase("uk-UA").replace(/[’']/g, "'").replace(/\s+/g, " ").trim(); }
function aliases(...values: Array<string | null | undefined>) { return [...new Set(values.map((v) => clean(v)).filter(Boolean))].slice(0, 20); }

const CATEGORY_MAP: Array<[RegExp, string, string]> = [
  [/кузов/, "svc_cat_body", "Кузовний ремонт"],
  [/ходов/, "svc_cat_chassis", "Ходова"],
  [/агрегат|датчик|электр|електр/, "svc_cat_electrics", "Агрегати, датчики, електрика"],
  [/шин/, "svc_cat_tires", "Шиномонтаж"],
  [/масл|жидк|ріди|олив/, "svc_cat_fluids", "Мастила та рідини"],
  [/диаг|діаг/, "svc_cat_diagnostics", "Діагностика"],
  [/двиг/, "svc_cat_engine", "Двигун"],
  [/мий|мой/, "svc_cat_wash", "Мийка"],
  [/комплекс/, "svc_cat_complex", "Комплекси послуг"],
  [/фильтр|фільтр/, "svc_cat_filters", "Фільтри"],
  [/гбо/, "svc_cat_gas", "ГБО"],
  [/стоян|парков/, "svc_cat_parking", "Стоянка"],
  [/водень|водород/, "svc_cat_hydrogen", "Водень"],
  [/салон/, "svc_cat_interior", "Салон"],
];
function normalizeCategory(source: string) {
  const normalized = key(source);
  const found = CATEGORY_MAP.find(([pattern]) => pattern.test(normalized));
  return found ? { id: found[1], name: found[2] } : { id: "svc_cat_other", name: "Інше" };
}
function side(value: string): CatalogBodySide { const normalized = key(value); return /ліво|лево|left/.test(normalized) ? "LEFT" : /право|right/.test(normalized) ? "RIGHT" : null; }
const OP_MAP: Array<[RegExp, Exclude<CatalogCalculatorOperation, null>]> = [
  [/заміна без фарбування|замена без покраски/, "REPLACE_NO_PAINT"],
  [/заміна з фарбуванням|замена с покраской/, "REPLACE_WITH_PAINT"],
  [/фарбування без ремонту|покраска без ремонта/, "PAINT_NO_REPAIR"],
  [/легкий ремонт з фарбуванням|легкий ремонт с покраской/, "LIGHT_REPAIR_PAINT"],
  [/легкий ремонт/, "LIGHT_REPAIR"],
  [/складний ремонт з фарбуванням|сложный ремонт с покраской/, "COMPLEX_REPAIR_PAINT"],
  [/складний ремонт|сложный ремонт/, "COMPLEX_REPAIR"],
];
function operation(value: string): CatalogCalculatorOperation { const normalized = key(value); return OP_MAP.find(([pattern]) => pattern.test(normalized))?.[1] ?? null; }
function inferOperationFromName(name: string): CatalogCalculatorOperation { return operation(name); }
function payrollType(value: string): CatalogPayrollType { return /відсоток|процент/.test(key(value)) && /норма/.test(key(value)) ? "PERCENT_NORM_HOURS" : "NONE"; }
function itemType(name: string, category: string, price: number | null): CatalogItemType {
  const value = key(`${category} ${name}`);
  if (/діаг|диаг/.test(value)) return "DIAGNOSTIC";
  if (/мий|мойк/.test(value)) return "WASH";
  if (/стоян|парков/.test(value)) return "PARKING";
  if (/оренд|аренд|прокат/.test(value)) return "RENT";
  if (/в нормі|ошибок нет|без помилок|осмотр состояния|огляд стану|рекомендац|пред.?явлен|страховий поліс|страховой полис/.test(value)) return "CHECKLIST";
  if (/інформац|информац|топливо|паливо/.test(value) && (price == null || price <= 50)) return "INFORMATION";
  return "LABOR";
}
function reviewFor(row: {
  internalName: string; displayName: string; sourceCategory: string; basePrice: number | null; bodyPart: string | null;
  calculatorOperation: CatalogCalculatorOperation; nameOperation: CatalogCalculatorOperation;
}) {
  const review: string[] = [], quarantine: string[] = [];
  const normalizedName = key(row.internalName);
  if (!row.internalName) quarantine.push("Відсутня внутрішня назва");
  if (/не\s*использ|не використов/.test(normalizedName)) quarantine.push("Позиція позначена як не використовувати");
  if (row.basePrice == null) review.push("Не вказана ціна");
  else if (row.basePrice <= 50) review.push("Технічна/аномально низька ціна ≤ 50 грн");
  if (!row.sourceCategory) review.push("Не вказана категорія джерела");
  if (row.bodyPart && !row.calculatorOperation) review.push("Є кузовна деталь, але немає операції калькулятора");
  if (row.calculatorOperation && row.nameOperation && row.calculatorOperation !== row.nameOperation) quarantine.push("Операція калькулятора конфліктує з назвою послуги");
  if (quarantine.length) return { status: "QUARANTINED" as const, reason: quarantine.join("; ") };
  if (review.length) return { status: "NEEDS_REVIEW" as const, reason: review.join("; ") };
  return { status: "READY" as const, reason: null };
}

function rowObject(headers: string[], row: Array<string | number | boolean | null>) {
  return Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, row[index] ?? null]));
}
function col(headers: string[], name: string) { return headers.findIndex((header) => clean(header) === name); }

function parseMsMaster(sheetRows: Array<Array<string | number | boolean | null>>) {
  const headerIndex = sheetRows.findIndex((row) => row.some((v) => clean(v) === "Послуга") && row.some((v) => clean(v) === "Назва") && row.some((v) => clean(v) === "Ціна"));
  if (headerIndex < 0) return null;
  const headers = sheetRows[headerIndex].map(clean);
  const indexes = {
    id: col(headers, "Послуга"), internal: col(headers, "Назва"), print: col(headers, "Назва (друк)"), category: col(headers, "Категорія послуг"),
    price: col(headers, "Ціна"), minutes: col(headers, "Тривалість роботи механіка (хв.)"), qty: col(headers, "Кількість по замовчуванню при додаванні в Н/З"),
    warrantyKm: col(headers, "Гарантійний пробіг (км)"), warrantyDays: col(headers, "Гарантійний термін (днів)"), payrollCategory: col(headers, "Категорія для зарплат"),
    payrollType: col(headers, "Тип нарахування зарплат"), bodyPart: col(headers, "Назва частина авто"), side: col(headers, "Сторона"), calc: col(headers, "Послуги калькулятора"),
    active: col(headers, "Активний"), landing: col(headers, "Показувати на Landing"),
  };
  const result: ParsedCatalogRow[] = [];
  for (let offset = headerIndex + 1; offset < sheetRows.length; offset++) {
    const row = sheetRows[offset];
    const externalServiceId = clean(row[indexes.id]);
    const internalName = clean(row[indexes.internal]);
    if (!externalServiceId && !internalName) continue;
    if (!externalServiceId) continue;
    const printName = clean(row[indexes.print]);
    const displayName = printName || internalName;
    const sourceCategory = clean(row[indexes.category]);
    const category = normalizeCategory(sourceCategory);
    const basePrice = numberOrNull(row[indexes.price]);
    const bodyPart = clean(row[indexes.bodyPart]) || null;
    const calculatorOperation = operation(clean(row[indexes.calc]));
    const nameOperation = inferOperationFromName(internalName);
    const review = reviewFor({ internalName, displayName, sourceCategory, basePrice, bodyPart, calculatorOperation, nameOperation });
    result.push({
      externalServiceId,
      code: externalServiceId,
      internalName,
      displayName,
      searchAliases: aliases(internalName, displayName, bodyPart, externalServiceId),
      categoryId: category.id,
      normalizedCategory: category.name,
      sourceCategory,
      itemType: itemType(internalName, sourceCategory, basePrice),
      basePrice,
      unit: "роб",
      defaultQuantity: numberOrNull(row[indexes.qty]) ?? 1,
      normMinutes: integerOrNull(row[indexes.minutes]),
      complexSurcharge: null,
      vehicleCoefficientEnabled: true,
      warrantyKm: integerOrNull(row[indexes.warrantyKm]),
      warrantyDays: integerOrNull(row[indexes.warrantyDays]),
      payrollCategory: clean(row[indexes.payrollCategory]) || null,
      payrollType: payrollType(clean(row[indexes.payrollType])),
      mechanicPercent: null,
      mechanicFixedAmount: null,
      bodyPart,
      bodySide: side(clean(row[indexes.side])),
      calculatorOperation,
      sourceActive: booleanOrNull(row[indexes.active]),
      sourceLanding: booleanOrNull(row[indexes.landing]),
      reviewStatus: review.status,
      reviewReason: review.reason,
      sourceRow: offset + 1,
      originalData: rowObject(headers, row),
    });
  }

  const matrix = new Map<string, ParsedCatalogRow[]>();
  for (const row of result) {
    if (!row.bodyPart || !row.calculatorOperation) continue;
    const matrixKey = `${key(row.bodyPart)}|${row.bodySide ?? "CENTER"}|${row.calculatorOperation}`;
    const group = matrix.get(matrixKey) ?? [];
    group.push(row); matrix.set(matrixKey, group);
  }
  for (const group of matrix.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.reviewStatus = "QUARANTINED";
      const conflict = `Дубль кузовної матриці (${group.map((item) => item.externalServiceId).join(", ")})`;
      row.reviewReason = row.reviewReason ? `${row.reviewReason}; ${conflict}` : conflict;
    }
  }
  return { headerIndex, headers, rows: result };
}

function parseTurboLevTemplate(sheetRows: Array<Array<string | number | boolean | null>>) {
  const headerIndex = sheetRows.findIndex((row) => row.some((v) => clean(v) === "Код") && row.some((v) => clean(v) === "Назва роботи") && row.some((v) => clean(v) === "Базова ціна"));
  if (headerIndex < 0) return null;
  const headers = sheetRows[headerIndex].map(clean);
  const indexes = { code: col(headers, "Код"), category: col(headers, "Категорія"), name: col(headers, "Назва роботи"), unit: col(headers, "Одиниця"), price: col(headers, "Базова ціна"), hours: col(headers, "Нормо-години"), surcharge: col(headers, "Доплата в комплексі"), note: col(headers, "Примітка") };
  const result: ParsedCatalogRow[] = [];
  for (let offset = headerIndex + 1; offset < sheetRows.length; offset++) {
    const row = sheetRows[offset];
    const code = clean(row[indexes.code]), internalName = clean(row[indexes.name]);
    if (!code || !internalName) continue;
    const sourceCategory = indexes.category >= 0 ? clean(row[indexes.category]) : "";
    const category = normalizeCategory(sourceCategory);
    const basePrice = numberOrNull(row[indexes.price]);
    const review = reviewFor({ internalName, displayName: internalName, sourceCategory, basePrice, bodyPart: null, calculatorOperation: null, nameOperation: null });
    result.push({
      externalServiceId: code, code, internalName, displayName: internalName, searchAliases: aliases(code, internalName), categoryId: category.id, normalizedCategory: category.name, sourceCategory,
      itemType: itemType(internalName, sourceCategory, basePrice), basePrice, unit: indexes.unit >= 0 ? clean(row[indexes.unit]) || "роб" : "роб", defaultQuantity: 1,
      normMinutes: indexes.hours >= 0 && numberOrNull(row[indexes.hours]) != null ? Math.round((numberOrNull(row[indexes.hours]) as number) * 60) : null,
      complexSurcharge: indexes.surcharge >= 0 ? numberOrNull(row[indexes.surcharge]) : null, vehicleCoefficientEnabled: true,
      warrantyKm: null, warrantyDays: null, payrollCategory: null, payrollType: "NONE", mechanicPercent: null, mechanicFixedAmount: null, bodyPart: null, bodySide: null, calculatorOperation: null,
      sourceActive: null, sourceLanding: null, reviewStatus: review.status, reviewReason: review.reason, sourceRow: offset + 1, originalData: rowObject(headers, row),
    });
  }
  return { headerIndex, headers, rows: result };
}

export function parseServiceCatalogWorkbook(buffer: Buffer, fileName: string): ParsedCatalogWorkbook {
  const files = unzip(buffer), shared = sharedStrings(files), sheets = workbookSheets(files);
  if (!sheets.length) throw new Error("PRICE_SHEET_NOT_FOUND");
  let selected: { name: string; rows: Array<Array<string | number | boolean | null>> } | null = null;
  let parsedMs: ReturnType<typeof parseMsMaster> = null;
  let parsedLegacy: ReturnType<typeof parseTurboLevTemplate> = null;
  for (const sheet of sheets) {
    const xml = files.get(sheet.path)?.toString("utf8");
    if (!xml) continue;
    const rows = parseSheet(xml, shared);
    const ms = parseMsMaster(rows);
    if (ms) { selected = { name: sheet.name, rows }; parsedMs = ms; break; }
    const legacy = parseTurboLevTemplate(rows);
    if (legacy && !parsedLegacy) { selected = { name: sheet.name, rows }; parsedLegacy = legacy; }
  }
  if (!selected || (!parsedMs && !parsedLegacy)) throw new Error("PRICE_HEADER_NOT_FOUND");
  const rows = parsedMs?.rows ?? parsedLegacy?.rows ?? [];
  if (!rows.length) throw new Error("PRICE_EMPTY");
  const source: CatalogSource = parsedMs ? "MS_MASTER" : "MANUAL";
  const stats = {
    total: rows.length,
    ready: rows.filter((row) => row.reviewStatus === "READY").length,
    needsReview: rows.filter((row) => row.reviewStatus === "NEEDS_REVIEW").length,
    quarantined: rows.filter((row) => row.reviewStatus === "QUARANTINED").length,
    bodyCalculatorRows: rows.filter((row) => row.bodyPart && row.calculatorOperation).length,
    warrantyRows: rows.filter((row) => row.warrantyKm != null || row.warrantyDays != null).length,
    payrollRows: rows.filter((row) => row.payrollType !== "NONE" || row.payrollCategory).length,
    missingPrice: rows.filter((row) => row.basePrice == null).length,
    lowTechnicalPrice: rows.filter((row) => row.basePrice != null && row.basePrice <= 50).length,
    missingCategory: rows.filter((row) => !row.sourceCategory).length,
    missingPrintName: parsedMs ? rows.filter((row) => !clean(row.originalData["Назва (друк)"])).length : 0,
  };
  const warnings: string[] = [];
  if (parsedMs) {
    warnings.push("Поле «Активний» у МС Мастер не використовується для автоактивації: імпортовані позиції потрапляють у staging.");
    warnings.push("Стабільний ключ імпорту — «Послуга» (externalServiceId), а не назва.");
    if (stats.quarantined) warnings.push(`${stats.quarantined} позицій із конфліктами ізольовано в QUARANTINED.`);
    if (stats.needsReview) warnings.push(`${stats.needsReview} позицій потребують перевірки перед активацією.`);
  }
  return {
    format: parsedMs ? "MS_MASTER" : "TURBO_LEV_TEMPLATE",
    source,
    fileName,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sheetName: selected.name,
    rows,
    stats,
    warnings,
  };
}
