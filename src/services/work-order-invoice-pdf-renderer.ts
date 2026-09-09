import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { drawNeutralVehicle } from "@/src/services/vehicle-document-art";
import { getVehicleDocumentImage } from "@/src/services/vehicle-images/vehicle-document-asset.service";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_HEIGHT = 35;
const SAFE_BOTTOM = FOOTER_HEIGHT + 18;

const ORANGE = rgb(0.941176, 0.290196, 0.137255);
const DARK = rgb(0.082353, 0.094118, 0.117647);
const TEXT = rgb(0.082353, 0.094118, 0.117647);
const MUTED = rgb(0.333333, 0.356863, 0.380392);
const LINE = rgb(0.843137, 0.862745, 0.882353);
const ROW_LIGHT = rgb(0.94902, 0.956863, 0.964706);
const WHITE = rgb(1, 1, 1);

type PdfColor = ReturnType<typeof rgb>;
type PdfImage = Awaited<ReturnType<PDFDocument["embedPng"]>> | Awaited<ReturnType<PDFDocument["embedJpg"]>>;
type PdfAsset = { bytes: Uint8Array; mimeType: string };

export type WorkOrderInvoicePdfLine = {
  type: string;
  description: string;
  code?: string | null;
  article?: string | null;
  brand?: string | null;
  quantity: string | number;
  unitPrice: string | number;
  total: string | number;
};

export type WorkOrderInvoicePdfData = {
  vehicleId?: string | null;
  vehicleLabel: string;
  vin: string | null;
  date: string;
  parts: WorkOrderInvoicePdfLine[];
  works: WorkOrderInvoicePdfLine[];
  stationName?: string | null;
  phone?: string | null;
  address?: string | null;
  site?: string | null;
  warning?: string | null;
};

function text(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function printable(value: string | number | null | undefined) {
  return text(value) || "—";
}

function numberOf(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantity(value: string | number | null | undefined) {
  const parsed = numberOf(value);
  if (Number.isInteger(parsed)) return String(parsed);
  return parsed.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function money(value: string | number | null | undefined) {
  const parsed = numberOf(value);
  return parsed.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function dateOnly(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return printable(value);
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Kyiv" }).format(parsed);
}

function splitLongToken(token: string, font: PDFFont, size: number, width: number) {
  const chunks: string[] = [];
  let current = "";
  for (const character of token) {
    const next = current + character;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      chunks.push(current);
      current = character;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [token];
}

function wrap(value: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const parts = font.widthOfTextAtSize(word, size) > width ? splitLongToken(word, font, size, width) : [word];
      for (const part of parts) {
        const next = current ? `${current} ${part}` : part;
        if (current && font.widthOfTextAtSize(next, size) > width) {
          lines.push(current);
          current = part;
        } else current = next;
      }
    }
    lines.push(current);
  }
  return lines;
}

function lineAmount(line: WorkOrderInvoicePdfLine) {
  return numberOf(line.total) || numberOf(line.quantity) * numberOf(line.unitPrice);
}

function assetPath(root: string, fileName: string) {
  return path.join(root, "public", "brand", fileName);
}

class InvoicePdfLayout {
  readonly pages: PDFPage[] = [];
  private page: PDFPage;
  private y: number;
  private readonly pdf: PDFDocument;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;
  private readonly logo: PdfImage | null;
  private readonly car: PdfImage | null;
  private readonly qr: PdfImage | null;

  constructor(pdf: PDFDocument, regular: PDFFont, bold: PDFFont, assets: { logo: PdfImage | null; car: PdfImage | null; qr: PdfImage | null }) {
    this.pdf = pdf;
    this.regular = regular;
    this.bold = bold;
    this.logo = assets.logo;
    this.car = assets.car;
    this.qr = assets.qr;
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.paintPage();
    this.y = PAGE_HEIGHT - 18;
  }

  private paintPage() {
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
    // The orange/white corner mark is part of the supplied Turbo LEV document
    // artwork and intentionally touches the top and left page edges.
    this.page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 38, width: 52, height: 38, color: ORANGE });
    this.page.drawRectangle({ x: 14, y: PAGE_HEIGHT - 38, width: 9, height: 38, color: WHITE });
  }

  private startContinuation() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.paintPage();
    this.page.drawText("НАКЛАДНА · ПРОДОВЖЕННЯ", { x: MARGIN, y: PAGE_HEIGHT - 27, size: 8, font: this.bold, color: ORANGE });
    this.y = PAGE_HEIGHT - 46;
  }

  private ensure(height: number) {
    if (this.y - height < SAFE_BOTTOM) this.startContinuation();
  }

  private async embed(bytes: Uint8Array, mimeType: string) {
    try {
      if (mimeType.includes("png")) return await this.pdf.embedPng(bytes);
      if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return await this.pdf.embedJpg(bytes);
    } catch {
      return null;
    }
    return null;
  }

  private centered(value: string, centerX: number, y: number, size: number, font: PDFFont, color: PdfColor) {
    const width = font.widthOfTextAtSize(value, size);
    this.page.drawText(value, { x: centerX - width / 2, y, size, font, color });
  }

  private roundedRectangle(x: number, y: number, width: number, height: number, radius: number, options: { color?: PdfColor; borderColor?: PdfColor; borderWidth?: number }) {
    const r = Math.min(radius, width / 2, height / 2);
    const path = `M ${r} 0 L ${width - r} 0 Q ${width} 0 ${width} ${r} L ${width} ${height - r} Q ${width} ${height} ${width - r} ${height} L ${r} ${height} Q 0 ${height} 0 ${height - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
    // pdf-lib flips SVG Y coordinates, so the SVG origin must be the top edge
    // while the public helper keeps the same bottom-left coordinates as
    // drawRectangle.
    this.page.drawSvgPath(path, { x, y: y + height, color: options.color, borderColor: options.borderColor, borderWidth: options.borderWidth });
  }

  private drawCellText(value: string, x: number, top: number, width: number, height: number, size: number, font: PDFFont, color = TEXT, align: "left" | "center" | "right" = "left", maxLines = 2) {
    const lines = wrap(value || "—", font, size, Math.max(8, width - 8)).slice(0, maxLines);
    const lineHeight = size * 1.28;
    const totalHeight = lines.length * lineHeight;
    const firstY = top - (height + totalHeight) / 2 + totalHeight - size + 1;
    lines.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size);
      const xPosition = align === "right" ? x + width - 4 - lineWidth : align === "center" ? x + (width - lineWidth) / 2 : x + 4;
      this.page.drawText(line, { x: xPosition, y: firstY - index * lineHeight, size, font, color });
    });
  }

  async header(data: WorkOrderInvoicePdfData) {
    // Variant 3: compact diagonal brand composition. The car is resolved from
    // the CRM vehicle card; when it is not ready, a neutral badge-free car is
    // drawn instead of showing the wrong model or a large white image edge.
    if (this.car) {
      const maxWidth = 206;
      const maxHeight = 104;
      const scale = Math.min(maxWidth / this.car.width, maxHeight / this.car.height);
      const width = this.car.width * scale;
      const height = this.car.height * scale;
      this.page.drawImage(this.car, { x: PAGE_WIDTH - 15 - width, y: 707, width, height });
    } else {
      drawNeutralVehicle(this.page, PAGE_WIDTH - 15 - 206, 709, 206, 86);
    }
    if (this.logo) {
      const width = 145;
      const height = 72.5;
      this.page.drawImage(this.logo, { x: 26.5, y: 728, width, height });
    }
    [
      { start: { x: 246, y: 805 }, end: { x: 337, y: 704 }, thickness: 10, opacity: 0.92 },
      { start: { x: 258, y: 807 }, end: { x: 349, y: 706 }, thickness: 3.5, opacity: 0.32 },
      { start: { x: 154, y: 756 }, end: { x: 252, y: 751 }, thickness: 1.6, opacity: 0.32 },
    ].forEach((line) => this.page.drawLine({ ...line, color: ORANGE }));

    this.centered("НАКЛАДНА", PAGE_WIDTH / 2, 674, 22, this.bold, TEXT);
    this.centered("ЗАПЧАСТИНИ ТА РОБОТИ", PAGE_WIDTH / 2, 654, 11, this.bold, ORANGE);
    this.page.drawLine({ start: { x: MARGIN, y: 643 }, end: { x: PAGE_WIDTH - MARGIN, y: 643 }, thickness: 0.85, color: ORANGE });

    const rowY = 629;
    this.page.drawText("Автомобіль:", { x: MARGIN + 2, y: rowY, size: 7.2, font: this.bold, color: TEXT });
    this.page.drawText(printable(data.vehicleLabel), { x: MARGIN + 54, y: rowY, size: 7.2, font: this.regular, color: TEXT });
    this.page.drawText("VIN:", { x: MARGIN + 191, y: rowY, size: 7.2, font: this.bold, color: TEXT });
    this.page.drawText(printable(data.vin), { x: MARGIN + 221, y: rowY, size: 7.2, font: this.regular, color: TEXT });
    this.page.drawText("Дата:", { x: PAGE_WIDTH - MARGIN - 112, y: rowY, size: 7.2, font: this.bold, color: TEXT });
    const dateValue = dateOnly(data.date);
    const dateWidth = this.regular.widthOfTextAtSize(dateValue, 7.2);
    this.page.drawText(dateValue, { x: PAGE_WIDTH - MARGIN - dateWidth, y: rowY, size: 7.2, font: this.regular, color: TEXT });
    this.y = 628;
  }

  private sectionTitle(title: string) {
    this.ensure(34);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - 18, width: 7, height: 18, color: ORANGE });
    this.page.drawText(title, { x: MARGIN + 15, y: top - 16, size: 14, font: this.bold, color: TEXT });
    this.y = top - 28;
  }

  private tableHeader(headers: string[], widths: number[]) {
    const height = 25;
    const top = this.y;
    let x = MARGIN;
    headers.forEach((header, index) => {
      this.page.drawRectangle({ x, y: top - height, width: widths[index], height, color: DARK });
      this.drawCellText(header, x, top, widths[index], height, 6.5, this.bold, WHITE, "center", 2);
      x += widths[index];
    });
    this.y = top - height;
  }

  private tableRows(rows: string[][], widths: number[], options: { rowHeight: number; fonts?: PDFFont[]; align?: Array<"left" | "center" | "right">; boldColumns?: number[] }, headers: string[]) {
    const fonts = options.fonts || widths.map(() => this.regular);
    const align = options.align || widths.map(() => "left" as const);
    const boldColumns = new Set(options.boldColumns || []);
    rows.forEach((row, rowIndex) => {
      const lineCount = row.map((value, index) => wrap(value || "—", boldColumns.has(index) ? this.bold : fonts[index], 6.4, widths[index] - 8).length);
      const height = Math.max(options.rowHeight, Math.min(52, Math.max(...lineCount) * 8 + 12));
      if (this.y - height < SAFE_BOTTOM) {
        this.startContinuation();
        this.tableHeader(headers, widths);
      }
      const top = this.y;
      let x = MARGIN;
      row.forEach((value, index) => {
        this.page.drawRectangle({ x, y: top - height, width: widths[index], height, color: rowIndex % 2 ? ROW_LIGHT : WHITE, borderColor: LINE, borderWidth: 0.38 });
        this.drawCellText(value, x, top, widths[index], height, 6.4, boldColumns.has(index) ? this.bold : fonts[index], TEXT, align[index], 2);
        x += widths[index];
      });
      this.y = top - height;
    });
  }

  private totalRow(label: string, totalQuantity: string, totalAmount: string, widths: number[]) {
    const height = 22;
    if (this.y - height < SAFE_BOTTOM) this.startContinuation();
    const top = this.y;
    let x = MARGIN;
    widths.forEach((width) => {
      this.page.drawRectangle({ x, y: top - height, width, height, color: ROW_LIGHT, borderColor: LINE, borderWidth: 0.38 });
      x += width;
    });
    this.page.drawLine({ start: { x: MARGIN, y: top }, end: { x: PAGE_WIDTH - MARGIN, y: top }, thickness: 0.75, color: ORANGE });
    const labelX = MARGIN + widths[0] + 4;
    this.centered(label, labelX + widths[1] / 2, top - 14, 6.7, this.regular, MUTED);
    this.drawCellText(totalQuantity, MARGIN + widths[0] + widths[1] + widths[2] + widths[3], top, widths[4], height, 7.1, this.bold, TEXT, "center", 1);
    this.drawCellText(totalAmount, MARGIN + widths[0] + widths[1] + widths[2] + widths[3] + widths[4], top, widths[5], height, 7.1, this.bold, TEXT, "right", 1);
    this.y = top - height;
  }

  parts(data: WorkOrderInvoicePdfData) {
    this.sectionTitle("ЗАПЧАСТИНИ");
    const widths = [73, 75, 235, 68, 42, 75];
    const headers = ["Артикул", "Бренд", "Найменування", "Ціна/шт.\n(грн)", "Кільк.", "Сума\n(грн)"];
    this.tableHeader(headers, widths);
    const rows = data.parts.length
      ? data.parts.map((line) => [printable(line.article || line.code), printable(line.brand), printable(line.description), money(line.unitPrice), quantity(line.quantity), money(lineAmount(line))])
      : [["—", "—", "Запчастини не додані", "—", "0", "0.00"]];
    this.tableRows(rows, widths, { rowHeight: 38, align: ["left", "left", "left", "right", "center", "right"], boldColumns: [0, 3, 4, 5] }, headers);
    const totalQuantity = data.parts.reduce((sum, line) => sum + numberOf(line.quantity), 0);
    const totalAmount = data.parts.reduce((sum, line) => sum + lineAmount(line), 0);
    this.totalRow("Всього запчастини:", quantity(totalQuantity), money(totalAmount), widths);
    this.y -= 12;
  }

  works(data: WorkOrderInvoicePdfData) {
    this.sectionTitle("РОБОТИ");
    const widths = [38, 345, 45, 70, 68];
    const headers = ["№", "Найменування робіт", "Кільк.", "Ціна\n(грн)", "Сума\n(грн)"];
    this.tableHeader(headers, widths);
    const rows = data.works.length
      ? data.works.map((line, index) => [String(index + 1), printable(line.description), quantity(line.quantity), money(line.unitPrice), money(lineAmount(line))])
      : [["—", "Роботи не додані", "0", "0.00", "0.00"]];
    this.tableRows(rows, widths, { rowHeight: 22, align: ["center", "left", "center", "right", "right"], boldColumns: [2, 3, 4] }, headers);
    const totalAmount = data.works.reduce((sum, line) => sum + lineAmount(line), 0);
    const height = 22;
    if (this.y - height < SAFE_BOTTOM) this.startContinuation();
    const top = this.y;
    let x = MARGIN;
    widths.forEach((width) => {
      this.page.drawRectangle({ x, y: top - height, width, height, color: ROW_LIGHT, borderColor: LINE, borderWidth: 0.38 });
      x += width;
    });
    this.page.drawLine({ start: { x: MARGIN, y: top }, end: { x: PAGE_WIDTH - MARGIN, y: top }, thickness: 0.75, color: ORANGE });
    this.centered("Всього роботи:", MARGIN + 38 + 345 / 2, top - 14, 6.7, this.regular, MUTED);
    this.drawCellText(money(totalAmount), MARGIN + 38 + 345 + 45 + 70, top, 68, height, 7.1, this.bold, TEXT, "right", 1);
    this.y = top - height;
  }

  async total(data: WorkOrderInvoicePdfData) {
    this.ensure(74);
    const partsTotal = data.parts.reduce((sum, line) => sum + lineAmount(line), 0);
    const worksTotal = data.works.reduce((sum, line) => sum + lineAmount(line), 0);
    const grandTotal = partsTotal + worksTotal;
    const top = this.y;
    const leftWidth = 400;
    const gap = 22.2756;
    const rightX = MARGIN + leftWidth + gap;
    const rightWidth = CONTENT_WIDTH - leftWidth - gap;
    const leftHeight = 48;
    const rightHeight = 53;

    this.roundedRectangle(MARGIN, top - leftHeight, leftWidth, leftHeight, 9, { color: WHITE, borderColor: ORANGE, borderWidth: 1.25 });
    this.roundedRectangle(MARGIN + 12, top - leftHeight + 8, 32, 32, 8, { color: ORANGE });
    this.centered("₴", MARGIN + 28, top - leftHeight + 18, 17, this.bold, WHITE);
    this.page.drawText("Загальна сума до сплати:", { x: MARGIN + 63, y: top - 18, size: 11.4, font: this.bold, color: TEXT });
    this.page.drawText(money(grandTotal), { x: MARGIN + 63, y: top - 40, size: 22, font: this.bold, color: ORANGE });
    this.page.drawText("грн", { x: MARGIN + 254, y: top - 36, size: 12.3, font: this.bold, color: TEXT });

    this.roundedRectangle(rightX, top - rightHeight, rightWidth, rightHeight, 9, { color: WHITE, borderColor: LINE, borderWidth: 1.1 });
    if (this.qr) {
      const scale = Math.min(43 / this.qr.width, 43 / this.qr.height, 1);
      this.page.drawImage(this.qr, { x: rightX + 7, y: top - 48, width: this.qr.width * scale, height: this.qr.height * scale });
    }
    this.page.drawText("Скануй QR", { x: rightX + 54, y: top - 19, size: 7.6, font: this.bold, color: TEXT });
    this.page.drawText("для зв'язку", { x: rightX + 54, y: top - 31, size: 6.2, font: this.regular, color: TEXT });
    this.page.drawText(data.site || "turbolev.net", { x: rightX + 54, y: top - 43, size: 6.5, font: this.bold, color: ORANGE });
    this.y = top - rightHeight - 4;
  }

  note(data: WorkOrderInvoicePdfData) {
    const value = data.warning || "Увага: накладну сформовано за наданим кошиком. Перед установленням необхідно окремо перевірити сумісність кожної деталі з VIN автомобіля.";
    const lines = wrap(value, this.regular, 5.9, CONTENT_WIDTH).slice(0, 2);
    const needed = Math.max(17, lines.length * 7 + 8);
    this.ensure(needed);
    lines.forEach((line, index) => this.page.drawText(line, { x: MARGIN + 2, y: this.y - 6 - index * 7, size: 5.9, font: this.regular, color: MUTED }));
    this.y -= Math.max(17, lines.length * 7 + 8);
  }

  footer(data: WorkOrderInvoicePdfData) {
    const phone = data.phone || "098 341 56 46";
    const address = data.address || "Глеваха, вул. Окружна, 55 Г";
    const site = data.site || "turbolev.net";
    this.pages.forEach((page) => {
      page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: FOOTER_HEIGHT, color: DARK });
      page.drawRectangle({ x: PAGE_WIDTH - 26, y: 0, width: 26, height: FOOTER_HEIGHT, color: ORANGE });
      page.drawText(phone, { x: 48, y: 14, size: 7.1, font: this.bold, color: WHITE });
      this.centered(address, PAGE_WIDTH / 2, 14, 7.1, this.bold, WHITE);
      const siteWidth = this.bold.widthOfTextAtSize(site, 7.1);
      page.drawText(site, { x: PAGE_WIDTH - 42 - siteWidth, y: 14, size: 7.1, font: this.bold, color: WHITE });
    });
  }
}

async function readAsset(pdf: PDFDocument, root: string, fileName: string, mimeType: string) {
  try {
    const bytes = await readFile(assetPath(root, fileName));
    if (mimeType === "image/png") return await pdf.embedPng(bytes);
    return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function renderWorkOrderInvoicePdf(data: WorkOrderInvoicePdfData) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const root = process.cwd();
  const regularBytes = await readFile(path.join(root, "public", "fonts", "DejaVuSans.ttf"));
  const boldBytes = await readFile(path.join(root, "public", "fonts", "DejaVuSans-Bold.ttf"));
  const [logo, vehicleImage, qr] = await Promise.all([
    readAsset(pdf, root, "turbo-lev-document-logo.png", "image/png"),
    data.vehicleId ? getVehicleDocumentImage(data.vehicleId) : Promise.resolve(null),
    readAsset(pdf, root, "turbo-lev-contact-qr.png", "image/png"),
  ]);
  const car = vehicleImage ? await pdf.embedPng(vehicleImage.bytes) : null;
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const layout = new InvoicePdfLayout(pdf, regular, bold, { logo, car, qr });
  await layout.header(data);
  layout.parts(data);
  layout.works(data);
  await layout.total(data);
  layout.note(data);
  layout.footer(data);
  return Buffer.from(await pdf.save());
}
