import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DiagnosticCardSnapshot } from "@/src/services/diagnostic-card.service";
import type { DocumentTemplate } from "@/src/services/document-template.service";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_HEIGHT = 31;
const ORANGE = rgb(0.94, 0.29, 0.05);
const ORANGE_LIGHT = rgb(1, 0.96, 0.93);
const DARK = rgb(0.09, 0.11, 0.14);
const MUTED = rgb(0.34, 0.38, 0.44);
const LIGHT = rgb(0.90, 0.91, 0.93);
const ROW_LIGHT = rgb(0.96, 0.965, 0.97);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.08, 0.56, 0.30);
const YELLOW = rgb(0.86, 0.55, 0.05);
const RED = rgb(0.78, 0.15, 0.12);

export type DiagnosticCardPdfMedia = {
  id: string;
  fileName: string;
  mimeType: string;
  fileData: Uint8Array;
};

type PdfColor = ReturnType<typeof rgb>;
type PdfImage = Awaited<ReturnType<PDFDocument["embedPng"]>> | Awaited<ReturnType<PDFDocument["embedJpg"]>>;
type PdfAsset = { bytes: Uint8Array; mimeType: string };

const stateLabels: Record<string, string> = {
  OK: "Норма",
  ATTENTION: "Увага",
  DEFECT: "Дефект",
  NOT_CHECKED: "Не перевірено",
  IN_PROGRESS: "В роботі",
};

const actionLabels: Record<string, string> = {
  REPLACE: "Заміна",
  REPAIR: "Ремонт",
  OBSERVE: "Спостерігати",
  DIAGNOSE: "Додаткова діагностика",
  NONE: "Без дії",
};

function colorFromHex(value: string | undefined, fallback: PdfColor) {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  return rgb(Number.parseInt(value.slice(1, 3), 16) / 255, Number.parseInt(value.slice(3, 5), 16) / 255, Number.parseInt(value.slice(5, 7), 16) / 255);
}

type HexRgb = { red: number; green: number; blue: number };

function hexRgb(value: string | undefined): HexRgb | null {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return {
    red: Number.parseInt(value.slice(1, 3), 16) / 255,
    green: Number.parseInt(value.slice(3, 5), 16) / 255,
    blue: Number.parseInt(value.slice(5, 7), 16) / 255,
  };
}

function luminance(color: HexRgb) {
  const channel = (value: number) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

function contrastRatio(first: HexRgb, second: HexRgb) {
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function readableColor(value: string | undefined, fallback: PdfColor, background: string, minimumContrast: number) {
  const candidate = hexRgb(value);
  const backgroundRgb = hexRgb(background);
  return candidate && backgroundRgb && contrastRatio(candidate, backgroundRgb) >= minimumContrast
    ? colorFromHex(value, fallback)
    : fallback;
}

function optionalText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function printable(value: string | number | null | undefined) {
  return optionalText(value) || "—";
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function mileageText(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${new Intl.NumberFormat("uk-UA").format(value)} км`;
}

function measurementText(item: { measurementValue: string | null; measurementText: string | null; measurementUnit: string | null }) {
  if (item.measurementValue) return `${item.measurementValue}${item.measurementUnit ? ` ${item.measurementUnit}` : ""}`;
  return item.measurementText || "";
}

function stateColor(state: string): PdfColor {
  if (state === "DEFECT") return RED;
  if (state === "ATTENTION") return YELLOW;
  if (state === "OK") return GREEN;
  return MUTED;
}

function cardStatus(snapshot: DiagnosticCardSnapshot) {
  if (snapshot.counts.critical > 0 || snapshot.counts.defect > 0) return { label: "Критично", color: RED };
  if (snapshot.counts.attention > 0) return { label: "Увага", color: YELLOW };
  return { label: "Норма", color: GREEN };
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

function wrapText(value: string, font: PDFFont, size: number, width: number) {
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

function imageDataUrl(value: string) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value || "");
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase() === "png" ? "image/png" : "image/jpeg",
    bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
  };
}

class PdfLayout {
  readonly pages: PDFPage[] = [];
  private page: PDFPage;
  private y: number;
  private readonly pdf: PDFDocument;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;
  private readonly media: Map<string, DiagnosticCardPdfMedia>;
  private readonly accent: PdfColor;
  private readonly textColor: PdfColor;
  private readonly mutedColor: PdfColor;
  private readonly backgroundColor: PdfColor;

  constructor(
    pdf: PDFDocument,
    regular: PDFFont,
    bold: PDFFont,
    media: DiagnosticCardPdfMedia[],
    theme: { accent: PdfColor; text: PdfColor; muted: PdfColor; background: PdfColor },
  ) {
    this.pdf = pdf;
    this.regular = regular;
    this.bold = bold;
    this.media = new Map(media.map((item) => [item.id, item]));
    this.accent = theme.accent;
    this.textColor = theme.text;
    this.mutedColor = theme.muted;
    this.backgroundColor = theme.background;
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.paintBackground();
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private paintBackground() {
    this.page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: this.backgroundColor });
  }

  private addPage() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.paintBackground();
    this.y = PAGE_HEIGHT - MARGIN;
    this.page.drawText("ДІАГНОСТИЧНА КАРТА · ПРОДОВЖЕННЯ", {
      x: MARGIN,
      y: this.y - 9,
      size: 6.8,
      font: this.bold,
      color: this.accent,
    });
    this.y -= 18;
  }

  private ensure(height: number) {
    if (this.y - height < FOOTER_HEIGHT + 10) this.addPage();
  }

  private lineHeight(size: number) {
    return Math.max(size * 1.28, 9.5);
  }

  private writeAt(value: string, x: number, top: number, width: number, size: number, font: PDFFont, color: PdfColor, maxLines = Number.POSITIVE_INFINITY) {
    const lines = wrapText(value, font, size, width).slice(0, maxLines);
    lines.forEach((line, index) => {
      this.page.drawText(line, { x, y: top - size - index * this.lineHeight(size), size, font, color });
    });
    return lines.length * this.lineHeight(size);
  }

  private async embedImage(bytes: Uint8Array, mimeType: string) {
    try {
      if (mimeType.toLowerCase().includes("png")) return await this.pdf.embedPng(bytes);
      if (mimeType.toLowerCase().includes("jpeg") || mimeType.toLowerCase().includes("jpg")) return await this.pdf.embedJpg(bytes);
    } catch {
      return null;
    }
    return null;
  }

  private async drawAsset(asset: PdfAsset | null, options: { x: number; top: number; width: number; maxHeight: number }) {
    if (!asset) return;
    const image = await this.embedImage(asset.bytes, asset.mimeType);
    if (!image) return;
    const scale = Math.min(options.width / image.width, options.maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    this.page.drawImage(image, { x: options.x, y: options.top - height, width, height });
  }

  text(value: string | null | undefined, options: { size?: number; bold?: boolean; color?: PdfColor; gapAfter?: number; width?: number } = {}) {
    const text = optionalText(value) || "—";
    const size = options.size || 8.5;
    const font = options.bold ? this.bold : this.regular;
    const width = options.width || CONTENT_WIDTH;
    const height = wrapText(text, font, size, width).length * this.lineHeight(size) + (options.gapAfter || 0);
    this.ensure(height);
    this.writeAt(text, MARGIN, this.y, width, size, font, options.color || this.textColor);
    this.y -= height;
  }

  section(value: string, reserve = 31) {
    this.ensure(reserve);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - 23, width: 7, height: 23, color: this.accent });
    this.page.drawText(value.toUpperCase(), {
      x: MARGIN + 15,
      y: top - 17,
      size: 12.5,
      font: this.bold,
      color: this.textColor,
    });
    this.y = top - 33;
  }

  subsection(value: string) {
    this.ensure(22);
    this.page.drawText(value.toUpperCase(), {
      x: MARGIN,
      y: this.y - 10,
      size: 8.2,
      font: this.bold,
      color: this.accent,
    });
    this.y -= 17;
  }

  private infoRow(entries: Array<[string, string | number | null | undefined, PdfColor?]>, height = 28) {
    const gap = 10;
    const width = (CONTENT_WIDTH - gap * (entries.length - 1)) / entries.length;
    this.ensure(height);
    const top = this.y;
    entries.forEach(([label, value, valueColor], index) => {
      const x = MARGIN + index * (width + gap);
      this.page.drawText(label.toUpperCase(), { x, y: top - 8, size: 6.2, font: this.bold, color: this.mutedColor });
      const valueLines = wrapText(printable(value), this.bold, 8, width).slice(0, 2);
      valueLines.forEach((line, lineIndex) => {
        this.page.drawText(line, { x, y: top - 19 - lineIndex * 9, size: 8, font: this.bold, color: valueColor || this.textColor });
      });
      this.page.drawLine({ start: { x, y: top - height + 2 }, end: { x: x + width, y: top - height + 2 }, thickness: 0.45, color: LIGHT });
    });
    this.y = top - height;
  }

  async header(snapshot: DiagnosticCardSnapshot, title: string, description: string, logo: PdfAsset | null, car: PdfAsset | null) {
    this.ensure(195);
    const top = this.y;
    await this.drawAsset(logo, { x: MARGIN, top: top - 2, width: 168, maxHeight: 78 });
    await this.drawAsset(car, { x: PAGE_WIDTH - MARGIN - 198, top: top - 2, width: 198, maxHeight: 94 });

    const titleText = title.toUpperCase();
    const titleSize = 17;
    const titleWidth = this.bold.widthOfTextAtSize(titleText, titleSize);
    this.page.drawText(titleText, { x: (PAGE_WIDTH - titleWidth) / 2, y: top - 101, size: titleSize, font: this.bold, color: this.textColor });
    const subtitle = description || "Результати проведеної діагностики автомобіля.";
    const subtitleWidth = this.regular.widthOfTextAtSize(subtitle, 7.7);
    this.page.drawText(subtitle, { x: (PAGE_WIDTH - subtitleWidth) / 2, y: top - 117, size: 7.7, font: this.regular, color: this.accent });
    this.page.drawRectangle({ x: MARGIN, y: top - 128, width: CONTENT_WIDTH, height: 2, color: this.accent });
    this.y = top - 139;

    const status = cardStatus(snapshot);
    this.infoRow([
      ["Автомобіль", `${snapshot.vehicle.label}${snapshot.vehicle.plateNumber ? ` · ${snapshot.vehicle.plateNumber}` : ""}`],
      ["VIN", snapshot.vehicle.vin],
      ["Дата формування", dateText(snapshot.visit?.actualEndAt || snapshot.visit?.actualStartAt || snapshot.generatedAt)],
    ], 30);
    this.infoRow([
      ["Клієнт", snapshot.client.name],
      ["Телефон", snapshot.client.phone],
      ["Механік", snapshot.mechanic.name],
      ["Пробіг", mileageText(snapshot.vehicle.mileageKm)],
    ], 30);
    this.infoRow([
      ["Статус карти", status.label, status.color],
      ["Ревізія", snapshot.revisionKind === "FINAL" ? "Підтверджена" : "На перевірці"],
      ["Станція", snapshot.station.name],
    ], 30);
    this.y -= 7;
  }

  metrics(snapshot: DiagnosticCardSnapshot) {
    this.ensure(47);
    const gap = 7;
    const width = (CONTENT_WIDTH - gap * 3) / 4;
    const height = 38;
    const top = this.y;
    const values: Array<[string, string, PdfColor]> = [
      ["Перевірено", `${snapshot.counts.checked}/${snapshot.counts.total}`, this.textColor],
      ["Норма", String(snapshot.counts.ok), GREEN],
      ["Увага", String(snapshot.counts.attention), YELLOW],
      ["Дефекти", String(snapshot.counts.defect), RED],
    ];
    values.forEach(([label, value, color], index) => {
      const x = MARGIN + index * (width + gap);
      this.page.drawRectangle({ x, y: top - height, width, height, color: index === 3 ? rgb(1, 0.96, 0.95) : ROW_LIGHT, borderColor: LIGHT, borderWidth: 0.6 });
      this.page.drawText(label, { x: x + 8, y: top - 12, size: 6.8, font: this.regular, color: this.mutedColor });
      this.page.drawText(value, { x: x + 8, y: top - 29, size: 10.5, font: this.bold, color });
    });
    this.y = top - height - 8;
  }

  callout(label: string, value: string | null | undefined, color = this.accent) {
    const text = optionalText(value) || "Не вказано.";
    const lines = wrapText(text, this.regular, 8.2, CONTENT_WIDTH - 20).slice(0, 5);
    const height = Math.max(47, 25 + lines.length * this.lineHeight(8.2));
    this.ensure(height + 7);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: ORANGE_LIGHT, borderColor: color, borderWidth: 0.9 });
    this.page.drawText(label.toUpperCase(), { x: MARGIN + 10, y: top - 15, size: 7.2, font: this.bold, color });
    this.writeAt(text, MARGIN + 10, top - 22, CONTENT_WIDTH - 20, 8.2, this.regular, this.textColor, 5);
    this.y = top - height - 7;
  }

  table(headers: string[], rows: string[][], widths: number[], rowColors: PdfColor[] = [], accentColumn = 2) {
    const headerHeight = 27;
    const size = 7.05;
    const drawHeader = () => {
      this.ensure(headerHeight + 32);
      const top = this.y;
      let x = MARGIN;
      headers.forEach((header, index) => {
        this.page.drawRectangle({ x, y: top - headerHeight, width: widths[index], height: headerHeight, color: DARK });
        const lines = wrapText(header, this.bold, size, widths[index] - 10).slice(0, 2);
        lines.forEach((line, lineIndex) => {
          this.page.drawText(line, { x: x + 5, y: top - 10 - lineIndex * 8, size, font: this.bold, color: WHITE });
        });
        x += widths[index];
      });
      this.y = top - headerHeight;
    };

    drawHeader();
    rows.forEach((row, rowIndex) => {
      const lineSets = row.map((value, index) => wrapText(value || "—", this.regular, size, widths[index] - 10).slice(0, 4));
      const height = Math.max(25, Math.max(...lineSets.map((lines) => lines.length)) * 9 + 10);
      if (this.y - height < FOOTER_HEIGHT + 10) drawHeader();
      const top = this.y;
      let x = MARGIN;
      row.forEach((_, index) => {
        this.page.drawRectangle({ x, y: top - height, width: widths[index], height, color: rowIndex % 2 ? ROW_LIGHT : WHITE, borderColor: LIGHT, borderWidth: 0.5 });
        const lines = lineSets[index];
        lines.forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x: x + 5,
            y: top - 12 - lineIndex * 9,
            size,
            font: index === 0 ? this.bold : this.regular,
            color: index === accentColumn ? rowColors[rowIndex] || this.textColor : this.textColor,
          });
        });
        x += widths[index];
      });
      this.y = top - height;
    });
    this.y -= 8;
  }

  list(title: string, rows: Array<{ name: string; detail: string; tone: PdfColor }>) {
    const safeRows = rows.length ? rows : [{ name: "Немає зафіксованих позицій", detail: "—", tone: this.mutedColor }];
    this.table(["№", title, "Опис / стан"], safeRows.map((row, index) => [String(index + 1), row.name, row.detail]), [30, 245, CONTENT_WIDTH - 275], safeRows.map((row) => row.tone), 2);
  }

  async photos(snapshot: DiagnosticCardSnapshot) {
    const ids = snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding?.mediaIds || [])));
    const invalid: string[] = [];
    const valid: Array<{ name: string; image: PdfImage }> = [];
    for (const id of ids) {
      const media = this.media.get(id);
      if (!media) continue;
      const mime = media.mimeType.toLowerCase();
      if (!mime.includes("png") && !mime.includes("jpeg") && !mime.includes("jpg")) {
        invalid.push(`${media.fileName}: формат не підтримується у PDF`);
        continue;
      }
      const image = await this.embedImage(media.fileData, media.mimeType);
      if (!image) {
        invalid.push(`${media.fileName}: файл пошкоджений або недоступний`);
        continue;
      }
      valid.push({ name: media.fileName, image });
    }

    if (!valid.length && !invalid.length) {
      this.text("Фото дефектів до цієї карти не прикріплені.", { size: 8, color: this.mutedColor, gapAfter: 5 });
      return;
    }

    const gap = 8;
    const cellWidth = (CONTENT_WIDTH - gap) / 2;
    for (let index = 0; index < valid.length; index += 2) {
      const pair = valid.slice(index, index + 2);
      const layouts = pair.map(({ image }) => {
        const scale = Math.min((cellWidth - 12) / image.width, 105 / image.height, 1);
        return { width: image.width * scale, height: image.height * scale };
      });
      const rowHeight = Math.max(125, ...layouts.map((item) => item.height + 28));
      this.ensure(rowHeight + 5);
      const top = this.y;
      pair.forEach(({ name, image }, pairIndex) => {
        const x = MARGIN + pairIndex * (cellWidth + gap);
        const item = layouts[pairIndex];
        this.page.drawRectangle({ x, y: top - rowHeight, width: cellWidth, height: rowHeight, color: WHITE, borderColor: LIGHT, borderWidth: 0.6 });
        this.page.drawImage(image, { x: x + (cellWidth - item.width) / 2, y: top - 8 - item.height, width: item.width, height: item.height });
        this.writeAt(name, x + 6, top - rowHeight + 20, cellWidth - 12, 6.6, this.regular, this.mutedColor, 2);
      });
      this.y = top - rowHeight - 7;
    }
    invalid.forEach((message) => this.callout("Доказ недоступний у PDF", message, this.mutedColor));
  }

  signature(snapshot: DiagnosticCardSnapshot) {
    this.section("ВІДПОВІДАЛЬНІ ОСОБИ", 31 + 27 + 25);
    this.table(
      ["Механік", "Перевірив", "Дата формування"],
      [[snapshot.mechanic.name || "—", snapshot.reviewer.name || "Не перевірено", dateText(snapshot.generatedAt)]],
      [CONTENT_WIDTH / 3, CONTENT_WIDTH / 3, CONTENT_WIDTH / 3],
      [],
      -1,
    );
  }

  async contacts(snapshot: DiagnosticCardSnapshot, qr: PdfAsset | null, footerText: string) {
    this.section("КОНТАКТИ СТО", 31 + 92);
    this.ensure(92);
    const top = this.y;
    const qrWidth = 76;
    const leftWidth = CONTENT_WIDTH - qrWidth - 14;
    this.page.drawRectangle({ x: MARGIN, y: top - 76, width: leftWidth, height: 76, color: ORANGE_LIGHT, borderColor: this.accent, borderWidth: 1 });
    this.page.drawText("Turbo Lev · Автосервіс", { x: MARGIN + 12, y: top - 19, size: 9.2, font: this.bold, color: this.textColor });
    this.page.drawText("Діагностична карта сформована у CRM", { x: MARGIN + 12, y: top - 34, size: 7.2, font: this.regular, color: this.mutedColor });
    this.page.drawText("098 341 56 46  ·  turbolev.net", { x: MARGIN + 12, y: top - 53, size: 8, font: this.bold, color: this.accent });
    this.page.drawText(snapshot.station.name || footerText, { x: MARGIN + 12, y: top - 67, size: 6.8, font: this.regular, color: this.mutedColor });
    if (qr) {
      await this.drawAsset(qr, { x: PAGE_WIDTH - MARGIN - qrWidth, top: top - 1, width: qrWidth, maxHeight: qrWidth });
      this.page.drawText("Скануйте QR", { x: PAGE_WIDTH - MARGIN - qrWidth, y: top - 87, size: 6.2, font: this.regular, color: this.mutedColor });
    }
    this.y = top - 92;
  }

  footer(cardNumber: string, footerText: string) {
    this.pages.forEach((page, index) => {
      page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: FOOTER_HEIGHT, color: DARK });
      page.drawRectangle({ x: PAGE_WIDTH - 22, y: 0, width: 22, height: FOOTER_HEIGHT, color: this.accent });
      page.drawText("098 341 56 46", { x: MARGIN, y: 11, size: 6.8, font: this.bold, color: WHITE });
      const station = footerText || "Turbo Lev · Автосервіс";
      const stationWidth = this.bold.widthOfTextAtSize(station, 6.8);
      page.drawText(station, { x: (PAGE_WIDTH - stationWidth) / 2, y: 11, size: 6.8, font: this.bold, color: WHITE });
      const right = `ДК ${cardNumber} · ${index + 1}/${this.pages.length}`;
      const rightWidth = this.regular.widthOfTextAtSize(right, 6.4);
      page.drawText(right, { x: PAGE_WIDTH - MARGIN - 22 - rightWidth, y: 11, size: 6.4, font: this.regular, color: WHITE });
    });
  }
}

async function readOptionalAsset(root: string, fileName: string, mimeType: string): Promise<PdfAsset | null> {
  try {
    return { bytes: await readFile(path.join(root, "public", "brand", fileName)), mimeType };
  } catch {
    return null;
  }
}

function visible(template: DocumentTemplate | undefined, id: string) {
  if (!template) return true;
  const contentBlockIds = ["summary", "findings", "inspections", "parts", "conclusion", "media", "signature", "contacts"];
  const hasVisibleContent = contentBlockIds.some((blockId) => template.blocks.find((block) => block.id === blockId)?.visible !== false);
  if (!hasVisibleContent) return true;
  return template.blocks.find((block) => block.id === id)?.visible !== false;
}

export async function renderDiagnosticCardPdf(snapshot: DiagnosticCardSnapshot, media: DiagnosticCardPdfMedia[] = [], template?: DocumentTemplate) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const root = process.cwd();
  const [regularBytes, boldBytes, defaultLogo, car, qr] = await Promise.all([
    readFile(path.join(root, "public", "fonts", "DejaVuSans.ttf")),
    readFile(path.join(root, "public", "fonts", "DejaVuSans-Bold.ttf")),
    readOptionalAsset(root, "turbo-lev-document-logo.png", "image/png"),
    readOptionalAsset(root, "turbo-lev-document-car.png", "image/png"),
    readOptionalAsset(root, "turbo-lev-document-qr.png", "image/png"),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  // CRM uses a dark interface, but the PDF is printed on light paper. Prevent
  // a dark/low-contrast CRM palette from producing an unreadable document.
  const requestedBackground = template?.style.background === "brand" ? "#FFF7F0" : template?.style.backgroundColor;
  const backgroundRgb = hexRgb(requestedBackground);
  const backgroundHex = backgroundRgb && luminance(backgroundRgb) >= 0.42 ? requestedBackground! : "#FFFFFF";
  const accent = readableColor(template?.style.accentColor, ORANGE, backgroundHex, 3);
  const text = readableColor(template?.style.textColor, DARK, backgroundHex, 4.5);
  const muted = readableColor(template?.style.mutedColor, MUTED, backgroundHex, 3);
  const background = colorFromHex(backgroundHex, WHITE);
  const layout = new PdfLayout(pdf, regular, bold, media, { accent, text, muted, background });

  let logo = defaultLogo;
  if (template?.style.logo === "none") logo = null;
  if (template?.style.logo === "custom") {
    const custom = imageDataUrl(template.style.logoDataUrl);
    logo = custom ? { bytes: custom.bytes, mimeType: custom.mimeType } : defaultLogo;
  }

  await layout.header(snapshot, template?.title || "Діагностична карта", template?.description || "Результати проведеної діагностики автомобіля.", logo, car);

  if (visible(template, "summary")) {
    layout.section("СТАН АВТОМОБІЛЯ", 31 + 47);
    layout.metrics(snapshot);
    if (snapshot.problem) layout.callout("Заявлена проблема", snapshot.problem);
  }

  if (visible(template, "findings")) {
    const findings = snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state !== "OK").map((item) => ({ item, section }))));
    layout.section("ВИЯВЛЕНІ НЕСПРАВНОСТІ", 31 + 27 + 32);
    layout.list("Вузол / елемент", findings.map(({ item, section }) => ({
      name: item.name,
      detail: [section.name, stateLabels[item.state] || item.state, item.finding?.text, item.note].filter(Boolean).join(" · "),
      tone: stateColor(item.state),
    })));
  }

  if (visible(template, "inspections")) {
    layout.section("РЕЗУЛЬТАТИ ПЕРЕВІРКИ", 31 + 22 + 22 + 27 + 32);
    for (const inspection of snapshot.inspections) {
      layout.subsection(inspection.name);
      for (const section of inspection.sections) {
        layout.subsection(section.name);
        const rows = section.items.map((item, index) => {
          const details = [item.position, measurementText(item), item.finding?.text, item.finding?.action && item.finding.action !== "NONE" ? actionLabels[item.finding.action] || item.finding.action : "", item.note].filter(Boolean).join(" · ");
          return [String(index + 1), item.name, stateLabels[item.state] || item.state, details || "—"];
        });
        layout.table(["№", "Вузол / елемент", "Стан", "Результат / примітки"], rows, [27, 158, 62, CONTENT_WIDTH - 247], section.items.map((item) => stateColor(item.state)), 2);
      }
    }
  }

  if (visible(template, "parts")) {
    layout.section("ДЕТАЛІ ДО ЗАМІНИ", 31 + 27 + 32);
    layout.list("Деталь", snapshot.recommendations.parts.map((item) => ({
      name: item.name,
      detail: [item.section, item.checkName, actionLabels[item.action] || item.action].filter(Boolean).join(" · "),
      tone: item.urgency === "CRITICAL" ? RED : item.urgency === "ATTENTION" ? YELLOW : MUTED,
    })));
  }

  if (visible(template, "conclusion")) {
    layout.section("РЕКОМЕНДОВАНІ РОБОТИ", 31 + 27 + 32);
    layout.list("Робота", snapshot.recommendations.works.map((item) => ({
      name: item.name,
      detail: [item.section, item.checkName, actionLabels[item.action] || item.action].filter(Boolean).join(" · "),
      tone: item.urgency === "CRITICAL" ? RED : item.urgency === "ATTENTION" ? YELLOW : MUTED,
    })));
    if (snapshot.technicalConclusion) layout.callout("Технічний висновок", snapshot.technicalConclusion);
    if (snapshot.mechanicComment) layout.callout("Коментар механіка", snapshot.mechanicComment, muted);
    if (snapshot.managerComment) layout.callout("Коментар сервіс-менеджера", snapshot.managerComment, muted);
  }

  if (visible(template, "media")) {
    layout.section("ФОТО ТА ДОКАЗИ", 31 + 125 + 5);
    await layout.photos(snapshot);
  }

  if (visible(template, "signature")) layout.signature(snapshot);
  if (visible(template, "contacts")) await layout.contacts(snapshot, qr, template?.style.footerText || "Turbo Lev · Автосервіс");
  layout.footer(snapshot.cardNumber, template?.style.footerText || "Turbo Lev · Автосервіс");
  return Buffer.from(await pdf.save());
}
