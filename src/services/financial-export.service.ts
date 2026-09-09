import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { getPrisma } from "@/src/lib/prisma";
import { getFinancialCenterV2, type FinancialCenterScope } from "@/src/services/financial-center-v2.service";

type Cell = string | number | null | undefined;
export type FinancialExportKind = "pnl" | "cash-flow" | "expenses" | "ar" | "ap" | "plan-fact";

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function workbookXml(sheetName: string, rows: Cell[][]) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return {
    sheet: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    workbook: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  };
}

export function renderXlsx(sheetName: string, rows: Cell[][]) {
  const parts = workbookXml(sheetName, rows);
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(parts.workbook),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(parts.sheet),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

function shortDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function reportRows(kind: FinancialExportKind, scope: FinancialCenterScope): Promise<{ title: string; rows: Cell[][] }> {
  const prisma = getPrisma();
  const data = await getFinancialCenterV2(scope);
  const locationFilter = scope.locationId
    ? { locationId: scope.locationId }
    : scope.allowedLocationIds?.length
      ? { locationId: { in: scope.allowedLocationIds } }
      : {};

  if (kind === "pnl") {
    const rows: Cell[][] = [
      ["P&L", "Сума, грн"],
      ["Виручка", data.pnl.revenue],
      ["COGS", data.pnl.cogs],
      ["Валовий прибуток", data.pnl.grossProfit],
      ["Валова маржа, %", data.pnl.grossMarginPercent],
      ["OPEX", data.pnl.opex],
      ["Операційний прибуток", data.pnl.operatingProfit],
      ["Інші доходи", data.pnl.otherIncome],
      ["Інші витрати", data.pnl.otherExpense],
      ["Податки", data.pnl.tax],
      ["Чистий прибуток", data.pnl.netProfit],
      ["Чиста маржа, %", data.pnl.netMarginPercent],
      [],
      ["Категорія", "Розділ", "Сума, грн", "Кількість фактів"],
      ...data.pnl.categories.map((row) => [row.name, row.section, row.amount, row.count]),
    ];
    return { title: "P&L", rows };
  }

  if (kind === "cash-flow") {
    const rows: Cell[][] = [
      ["Cash Flow", "Сума, грн"],
      ["Надходження", data.cashFlow.inflow],
      ["Виплати", data.cashFlow.outflow],
      ["Чистий Cash Flow", data.cashFlow.net],
      ["Operating", data.cashFlow.operating],
      ["Investing", data.cashFlow.investing],
      ["Financing", data.cashFlow.financing],
      ["Internal transfer", data.cashFlow.internalTransfer],
      [],
      ["Дата", "Тип", "Секція", "Сума, грн", "Опис", "Джерело"],
      ...data.cashFlow.transactions.map((row) => [shortDate(row.occurredAt), row.kind, row.flowSection, row.amount, row.description || "", row.sourceEntity || ""]),
    ];
    return { title: "Cash Flow", rows };
  }

  if (kind === "plan-fact") {
    const rows: Cell[][] = [
      ["План / факт", "Метрика", "Категорія", "План, грн", "Факт, грн", "Відхилення, грн", "Виконання, %", "Початок", "Кінець"],
      ...data.budgets.map((row) => [row.name, row.metric, row.categoryName || "", row.amount, row.actual, row.variance, row.completionPercent, shortDate(row.periodStart), shortDate(row.periodEnd)]),
    ];
    return { title: "План-факт", rows };
  }

  if (kind === "expenses") {
    const rows = await prisma.expenseDocument.findMany({
      where: { expenseDate: { gte: scope.from, lt: scope.to }, currency: scope.currency || "UAH", ...locationFilter },
      include: { category: { select: { name: true } }, lines: true },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 5000,
    });
    return {
      title: "Витрати",
      rows: [
        ["Дата", "Номер", "Статус", "Оплата", "Контрагент", "Категорія", "Сума, грн", "Оплачено, грн", "Строк", "ЗН", "Опис"],
        ...rows.map((row) => [shortDate(row.expenseDate), row.number, row.status, row.paymentStatus, row.counterpartyName || "", row.category?.name || "", number(row.amount), number(row.paidAmount), shortDate(row.dueAt), row.workOrderId || "", row.description || ""]),
      ],
    };
  }

  const direction = kind === "ar" ? "RECEIVABLE" : "PAYABLE";
  const obligations = await prisma.financialObligation.findMany({
    where: { direction, currency: scope.currency || "UAH", issuedAt: { lt: scope.to }, ...locationFilter },
    orderBy: [{ dueAt: "asc" }, { issuedAt: "asc" }],
    take: 5000,
  });
  return {
    title: kind === "ar" ? "Дебіторка" : "Кредиторка",
    rows: [
      ["Дата", "Строк", "Статус", "Контрагент", "Сума, грн", "Погашено, грн", "Залишок, грн", "ЗН", "Джерело", "Опис"],
      ...obligations.map((row) => [shortDate(row.issuedAt), shortDate(row.dueAt), row.status, row.counterpartyName || "", number(row.amount), number(row.settledAmount), Math.max(0, number(row.amount) - number(row.settledAmount)), row.workOrderId || "", row.sourceEntity || "", row.description || ""]),
    ],
  };
}

function fitText(value: Cell, max = 48) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export async function renderFinancialPdf(kind: Extract<FinancialExportKind, "pnl" | "cash-flow">, scope: FinancialCenterScope) {
  const report = await reportRows(kind, scope);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const root = process.cwd();
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(root, "public", "fonts", "DejaVuSans.ttf")),
    readFile(path.join(root, "public", "fonts", "DejaVuSans-Bold.ttf")),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const width = 595.28;
  const height = 841.89;
  const margin = 42;
  const lineHeight = 15;
  let page = pdf.addPage([width, height]);
  let y = height - margin;

  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - margin;
  };
  const line = (text: string, isBold = false, size = 9) => {
    if (y < margin + lineHeight) newPage();
    page.drawText(text, { x: margin, y, size, font: isBold ? bold : regular, color: rgb(0.08, 0.08, 0.08), maxWidth: width - margin * 2 });
    y -= lineHeight;
  };

  line(`TURBO LEV — ${report.title}`, true, 16);
  line(`Період: ${shortDate(scope.from)} — ${shortDate(new Date(scope.to.getTime() - 1))}`, false, 9);
  if (scope.locationId) line(`Локація: ${scope.locationId}`, false, 9);
  y -= 8;

  for (const row of report.rows) {
    if (!row.length) { y -= 8; continue; }
    const text = row.map((cell) => typeof cell === "number" ? new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(cell) : fitText(cell, 58)).join("   |   ");
    line(text, row === report.rows[0], row === report.rows[0] ? 9 : 8);
  }
  return Buffer.from(await pdf.save());
}

export async function buildFinancialExport(kind: FinancialExportKind, format: "xlsx" | "pdf", scope: FinancialCenterScope) {
  if (format === "pdf") {
    if (kind !== "pnl" && kind !== "cash-flow") throw new Error("PDF доступний лише для P&L та Cash Flow.");
    return { bytes: await renderFinancialPdf(kind, scope), contentType: "application/pdf", extension: "pdf" };
  }
  const report = await reportRows(kind, scope);
  return { bytes: renderXlsx(report.title, report.rows), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" };
}
