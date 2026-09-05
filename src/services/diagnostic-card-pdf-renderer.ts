import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { DiagnosticCardSnapshot } from "@/src/services/diagnostic-card.service";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ORANGE = rgb(0.94, 0.29, 0.05);
const DARK = rgb(0.09, 0.11, 0.14);
const MUTED = rgb(0.34, 0.38, 0.44);
const LIGHT = rgb(0.94, 0.95, 0.96);
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

const stateLabels: Record<string, string> = {
  OK: "Норма",
  ATTENTION: "Увага",
  DEFECT: "Дефект",
  NOT_CHECKED: "Не перевірено",
  IN_PROGRESS: "В роботі",
};

function stateColor(state: string): PdfColor {
  if (state === "DEFECT") return RED;
  if (state === "ATTENTION") return YELLOW;
  if (state === "OK") return GREEN;
  return MUTED;
}

function printable(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
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
  }).format(date);
}

function measurementText(item: {
  measurementValue: string | null;
  measurementText: string | null;
  measurementUnit: string | null;
}) {
  if (item.measurementValue) return `${item.measurementValue}${item.measurementUnit ? ` ${item.measurementUnit}` : ""}`;
  return item.measurementText || null;
}

function splitLongToken(token: string, font: PDFFont, size: number, width: number) {
  const chunks: string[] = [];
  let current = "";
  for (const character of token) {
    const next = current + character;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      chunks.push(current);
      current = character;
    } else {
      current = next;
    }
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
      const wordParts = font.widthOfTextAtSize(word, size) > width ? splitLongToken(word, font, size, width) : [word];
      for (const part of wordParts) {
        const next = current ? `${current} ${part}` : part;
        if (current && font.widthOfTextAtSize(next, size) > width) {
          lines.push(current);
          current = part;
        } else {
          current = next;
        }
      }
    }
    lines.push(current);
  }
  return lines;
}

class PdfLayout {
  readonly pages: PDFPage[] = [];
  private page: PDFPage;
  private y: number;
  private readonly pdf: PDFDocument;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;
  private readonly media: Map<string, DiagnosticCardPdfMedia>;
  private readonly embeddedImages = new Map<string, Awaited<ReturnType<PDFDocument["embedJpg"]>>>();

  constructor(pdf: PDFDocument, regular: PDFFont, bold: PDFFont, media: DiagnosticCardPdfMedia[]) {
    this.pdf = pdf;
    this.regular = regular;
    this.bold = bold;
    this.media = new Map(media.map((item) => [item.id, item]));
    this.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private addPage() {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN + 24) this.addPage();
  }

  private lineHeight(size: number) {
    return Math.max(size * 1.35, 12);
  }

  text(value: string | null | undefined, options: { size?: number; bold?: boolean; color?: PdfColor; gapAfter?: number; width?: number } = {}) {
    const text = printable(value);
    const size = options.size || 9;
    const font = options.bold ? this.bold : this.regular;
    const width = options.width || CONTENT_WIDTH;
    const lineHeight = this.lineHeight(size);
    const lines = wrapText(text, font, size, width);
    this.ensure(lines.length * lineHeight + (options.gapAfter || 0));
    for (const line of lines) {
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color: options.color || DARK });
      this.y -= lineHeight;
    }
    this.y -= options.gapAfter || 0;
  }

  title(value: string) {
    this.ensure(60);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 44, width: CONTENT_WIDTH, height: 44, color: DARK });
    this.page.drawText(value, { x: MARGIN + 14, y: this.y - 20, size: 15, font: this.bold, color: rgb(1, 1, 1) });
    this.y -= 60;
  }

  section(value: string) {
    this.ensure(58);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 20, width: CONTENT_WIDTH, height: 20, color: LIGHT });
    this.page.drawText(value.toUpperCase(), { x: MARGIN + 8, y: this.y - 14, size: 8, font: this.bold, color: ORANGE });
    this.y -= 30;
  }

  labelValue(label: string, value: string | number | null | undefined, options: { gapAfter?: number } = {}) {
    this.ensure(30);
    this.page.drawText(label, { x: MARGIN, y: this.y - 9, size: 7, font: this.regular, color: MUTED });
    const valueText = printable(value);
    const valueLines = wrapText(valueText, this.bold, 9, CONTENT_WIDTH - 105);
    for (let index = 0; index < valueLines.length; index += 1) {
      this.page.drawText(valueLines[index], { x: MARGIN + 105, y: this.y - 10 - index * 12, size: 9, font: this.bold, color: DARK });
    }
    this.y -= Math.max(19, valueLines.length * 12 + 5) + (options.gapAfter || 0);
  }

  columns(entries: Array<[string, string | number | null | undefined]>) {
    const columnGap = 14;
    const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
    const rows = Math.ceil(entries.length / 2);
    const heights = Array.from({ length: rows }, (_, row) => {
      const rowEntries = entries.slice(row * 2, row * 2 + 2);
      return Math.max(...rowEntries.map(([, value]) => {
        const lines = wrapText(printable(value), this.bold, 8.5, columnWidth - 14);
        return Math.max(36, lines.length * 12 + 20);
      }));
    });
    const totalHeight = heights.reduce((sum, height) => sum + height + 6, 0);
    this.ensure(totalHeight);
    let top = this.y;
    for (let row = 0; row < rows; row += 1) {
      const height = heights[row];
      const rowEntries = entries.slice(row * 2, row * 2 + 2);
      for (let column = 0; column < rowEntries.length; column += 1) {
        const [label, value] = rowEntries[column];
        const x = MARGIN + column * (columnWidth + columnGap);
        this.page.drawRectangle({ x, y: top - height, width: columnWidth, height, color: rgb(0.975, 0.975, 0.975), borderColor: LIGHT, borderWidth: 0.7 });
        this.page.drawText(label, { x: x + 7, y: top - 13, size: 7, font: this.regular, color: MUTED });
        const lines = wrapText(printable(value), this.bold, 8.5, columnWidth - 14);
        lines.forEach((line, index) => this.page.drawText(line, { x: x + 7, y: top - 27 - index * 12, size: 8.5, font: this.bold, color: DARK }));
      }
      top -= height + 6;
    }
    this.y = top;
  }

  badge(value: string, color: PdfColor) {
    const width = this.bold.widthOfTextAtSize(value, 8) + 16;
    this.ensure(22);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 17, width, height: 17, color, opacity: 0.12, borderColor: color, borderWidth: 0.7 });
    this.page.drawText(value, { x: MARGIN + 8, y: this.y - 12, size: 8, font: this.bold, color });
    this.y -= 24;
  }

  listItem(index: number, title: string, details: string, color: PdfColor) {
    const titleLines = wrapText(`${index > 0 ? `${index}. ` : ""}${title}`, this.bold, 9, CONTENT_WIDTH - 24);
    const detailLines = details ? wrapText(details, this.regular, 8, CONTENT_WIDTH - 24) : [];
    const height = 8 + (titleLines.length + detailLines.length) * 11 + 8;
    this.ensure(height);
    this.page.drawCircle({ x: MARGIN + 7, y: this.y - 10, size: 5, color });
    let lineY = this.y - 8;
    for (const line of titleLines) {
      this.page.drawText(line, { x: MARGIN + 19, y: lineY, size: 9, font: this.bold, color: DARK });
      lineY -= 11;
    }
    for (const line of detailLines) {
      this.page.drawText(line, { x: MARGIN + 19, y: lineY, size: 8, font: this.regular, color: MUTED });
      lineY -= 11;
    }
    this.y -= height;
  }

  async image(mediaId: string) {
    const media = this.media.get(mediaId);
    if (!media) return;
    const mime = media.mimeType.toLowerCase();
    const isJpeg = mime === "image/jpeg" || mime === "image/jpg" || /\.(jpe?g)$/i.test(media.fileName);
    const isPng = mime === "image/png" || /\.png$/i.test(media.fileName);
    if (!isJpeg && !isPng) {
      this.text(`Фото ${media.fileName}: формат ${media.mimeType} не вбудовується в PDF, оригінал доступний у CRM.`, { size: 7.5, color: MUTED, gapAfter: 4 });
      return;
    }
    let embedded = this.embeddedImages.get(mediaId);
    if (!embedded) {
      try {
        embedded = isJpeg ? await this.pdf.embedJpg(media.fileData) : await this.pdf.embedPng(media.fileData);
      } catch {
        this.text(`Фото ${media.fileName}: файл пошкоджений або не вдалося вбудувати, оригінал доступний у CRM.`, { size: 7.5, color: MUTED, gapAfter: 4 });
        return;
      }
      this.embeddedImages.set(mediaId, embedded);
    }
    const maxWidth = CONTENT_WIDTH;
    const maxHeight = 165;
    const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    this.ensure(height + 18);
    this.page.drawImage(embedded, { x: MARGIN, y: this.y - height, width, height });
    this.y -= height + 10;
  }

  footer(cardNumber: string) {
    this.pages.forEach((page, index) => {
      page.drawLine({ start: { x: MARGIN, y: 22 }, end: { x: PAGE_WIDTH - MARGIN, y: 22 }, thickness: 0.5, color: LIGHT });
      page.drawText(`Turbo LEV • ${cardNumber} • сторінка ${index + 1}/${this.pages.length}`, { x: MARGIN, y: 11, size: 7, font: this.regular, color: MUTED });
      page.drawText("Документ сформовано CRM", { x: PAGE_WIDTH - MARGIN - 125, y: 11, size: 7, font: this.regular, color: MUTED });
    });
  }
}

function allMediaIds(snapshot: DiagnosticCardSnapshot) {
  return snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding?.mediaIds || [])));
}

export async function renderDiagnosticCardPdf(snapshot: DiagnosticCardSnapshot, media: DiagnosticCardPdfMedia[] = []) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const root = process.cwd();
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(root, "public", "fonts", "DejaVuSans.ttf")),
    readFile(path.join(root, "public", "fonts", "DejaVuSans-Bold.ttf")),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const layout = new PdfLayout(pdf, regular, bold, media);

  layout.title("ДІАГНОСТИЧНА КАРТА");
  layout.columns([
    ["Номер карти", snapshot.cardNumber],
    ["Версія", `${snapshot.revisionKind} · сформовано ${dateText(snapshot.generatedAt)}`],
    ["Автомобіль", snapshot.vehicle.label],
    ["Держномер", snapshot.vehicle.plateNumber],
    ["VIN", snapshot.vehicle.vin],
    ["Пробіг", snapshot.vehicle.mileageKm === null ? null : `${snapshot.vehicle.mileageKm.toLocaleString("uk-UA")} км`],
    ["Клієнт", snapshot.client.name],
    ["Телефон", snapshot.client.phone],
    ["Механік", snapshot.mechanic.name],
    ["Сервісна станція", snapshot.station.name],
  ]);

  layout.section("Результат перевірки");
  const count = snapshot.counts;
  layout.badge(`Статус ревізії: ${snapshot.revisionKind === "FINAL" ? "Фінальна" : "На перевірці"}`, snapshot.revisionKind === "FINAL" ? GREEN : YELLOW);
  layout.columns([
    ["Перевірено", `${count.checked}/${count.total}`],
    ["Норма", count.ok],
    ["Увага", count.attention],
    ["Дефекти", count.defect],
    ["Критичні", count.critical],
    ["Дата діагностики", dateText(snapshot.visit?.actualEndAt || snapshot.visit?.actualStartAt || snapshot.generatedAt)],
  ]);

  if (snapshot.problem) {
    layout.section("Заявлена проблема");
    layout.text(snapshot.problem, { size: 9, gapAfter: 4 });
  }
  if (snapshot.technicalConclusion) {
    layout.section("Технічний висновок");
    layout.text(snapshot.technicalConclusion, { size: 9, gapAfter: 4 });
  }
  if (snapshot.mechanicComment || snapshot.managerComment) {
    layout.section("Коментарі");
    if (snapshot.mechanicComment) layout.labelValue("Коментар механіка", snapshot.mechanicComment, { gapAfter: 4 });
    if (snapshot.managerComment) layout.labelValue("Коментар менеджера", snapshot.managerComment, { gapAfter: 4 });
  }

  if (snapshot.recommendations.works.length || snapshot.recommendations.parts.length) {
    layout.section("Рекомендації");
    snapshot.recommendations.works.forEach((item, index) => layout.listItem(index + 1, `Робота: ${item.name}`, `${item.section} • ${item.checkName} • ${stateLabels[item.urgency] || item.urgency}`, stateColor(item.urgency === "CRITICAL" ? "DEFECT" : "ATTENTION")));
    snapshot.recommendations.parts.forEach((item, index) => layout.listItem(index + 1, `Деталь: ${item.name}`, `${item.section} • ${item.checkName} • ${stateLabels[item.urgency] || item.urgency}`, stateColor(item.urgency === "CRITICAL" ? "DEFECT" : "ATTENTION")));
  }

  layout.section("Повна матриця перевірки");
  for (const inspection of snapshot.inspections) {
    layout.text(inspection.name, { size: 11, bold: true, color: DARK, gapAfter: 3 });
    for (const section of inspection.sections) {
      layout.text(section.name, { size: 9, bold: true, color: ORANGE, gapAfter: 2 });
      for (const item of section.items) {
        const state = stateLabels[item.state] || item.state;
        const measurement = measurementText(item);
        const finding = item.finding;
        const details = [
          state,
          item.position,
          measurement,
          finding?.text,
          finding?.action && finding.action !== "NONE" ? `Дія: ${finding.action}` : null,
          item.note,
        ].filter(Boolean).join(" • ");
        layout.listItem(0, item.name, details, stateColor(item.state));
        for (const mediaId of finding?.mediaIds || []) await layout.image(mediaId);
      }
    }
  }

  if (!allMediaIds(snapshot).length) {
    layout.text("Фото дефектів до цієї ревізії не прикріплені.", { size: 8, color: MUTED, gapAfter: 4 });
  }
  layout.footer(snapshot.cardNumber);
  return Buffer.from(await pdf.save());
}
