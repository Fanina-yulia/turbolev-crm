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
const ORANGE = rgb(0.94, 0.29, 0.05);
const DARK = rgb(0.09, 0.11, 0.14);
const MUTED = rgb(0.34, 0.38, 0.44);
const LIGHT = rgb(0.93, 0.94, 0.95);
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

function printable(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
}

function optionalText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function dateText(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }).format(date);
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
  return { mimeType: match[1].toLowerCase() === "png" ? "image/png" : "image/jpeg", bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
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
  private readonly embeddedImages = new Map<string, PdfImage>();

  constructor(pdf: PDFDocument, regular: PDFFont, bold: PDFFont, media: DiagnosticCardPdfMedia[], theme: { accent: PdfColor; text: PdfColor; muted: PdfColor; background: PdfColor }) {
    this.pdf = pdf;
    this.regular = regular;
    this.bold = bold;
    this.media = new Map(media.map((item) => [item.id, item]));
    this.accent = theme.accent;
    this.textColor = theme.text;
    this.mutedColor = theme.muted;
    this.backgroundColor = theme.background;
    this.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
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
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN + 24) this.addPage();
  }

  private lineHeight(size: number) { return Math.max(size * 1.3, 10); }

  private drawWrapped(value: string, x: number, top: number, width: number, size: number, font: PDFFont, color: PdfColor, maxLines = Number.POSITIVE_INFINITY) {
    const lines = wrapText(value, font, size, width).slice(0, maxLines);
    lines.forEach((line, index) => this.page.drawText(line, { x, y: top - size - index * this.lineHeight(size), size, font, color }));
    return lines.length * this.lineHeight(size);
  }

  text(value: string | null | undefined, options: { size?: number; bold?: boolean; color?: PdfColor; gapAfter?: number; width?: number } = {}) {
    const text = optionalText(value) || "—";
    const size = options.size || 8.5;
    const font = options.bold ? this.bold : this.regular;
    const width = options.width || CONTENT_WIDTH;
    const lines = wrapText(text, font, size, width);
    const height = lines.length * this.lineHeight(size) + (options.gapAfter || 0);
    this.ensure(height);
    lines.forEach((line, index) => this.page.drawText(line, { x: MARGIN, y: this.y - size - index * this.lineHeight(size), size, font, color: options.color || this.textColor }));
    this.y -= height;
  }

  section(value: string) {
    this.ensure(28);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - 22, width: CONTENT_WIDTH, height: 22, color: DARK });
    this.page.drawRectangle({ x: MARGIN, y: top - 22, width: 7, height: 22, color: this.accent });
    this.page.drawText(value.toUpperCase(), { x: MARGIN + 14, y: top - 15, size: 9.2, font: this.bold, color: WHITE });
    this.y -= 31;
  }

  subsection(value: string) {
    this.ensure(22);
    this.page.drawText(value, { x: MARGIN, y: this.y - 10, size: 8.5, font: this.bold, color: this.accent });
    this.y -= 17;
  }

  async asset(bytes: Uint8Array, mimeType: string, options: { x: number; top: number; width: number; maxHeight: number }) {
    const image = await this.embedImage(bytes, mimeType);
    if (!image) return;
    const scale = Math.min(options.width / image.width, options.maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    this.page.drawImage(image, { x: options.x, y: options.top - height, width, height });
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

  async header(snapshot: DiagnosticCardSnapshot, title: string, description: string, logo: { bytes: Uint8Array; mimeType: string } | null, car: { bytes: Uint8Array; mimeType: string } | null) {
    this.ensure(163);
    const top = this.y;
    if (logo) await this.asset(logo.bytes, logo.mimeType, { x: MARGIN, top: top - 3, width: 146, maxHeight: 70 });
    if (car) await this.asset(car.bytes, car.mimeType, { x: PAGE_WIDTH - MARGIN - 146, top: top - 3, width: 146, maxHeight: 70 });

    const titleX = MARGIN + 153;
    const titleWidth = CONTENT_WIDTH - 306;
    const titleLines = wrapText(title.toUpperCase(), this.bold, 15, titleWidth);
    titleLines.forEach((line, index) => this.page.drawText(line, { x: titleX, y: top - 24 - index * 18, size: 15, font: this.bold, color: this.textColor }));
    if (description) this.drawWrapped(description, titleX, top - 62, titleWidth, 7.2, this.regular, this.mutedColor, 2);
    this.page.drawRectangle({ x: MARGIN, y: top - 86, width: CONTENT_WIDTH, height: 3, color: this.accent });
    this.y = top - 99;

    this.fieldRow([["Дата", dateText(snapshot.visit?.actualEndAt || snapshot.visit?.actualStartAt || snapshot.generatedAt)], ["Автомобіль", snapshot.vehicle.label], ["Держ. номер", snapshot.vehicle.plateNumber]], 29);
    this.fieldRow([["VIN", snapshot.vehicle.vin]], 25);
    this.fieldRow([["Клієнт", snapshot.client.name], ["Телефон", snapshot.client.phone], ["Механік", snapshot.mechanic.name]], 29);
  }

  private fieldRow(entries: Array<[string, string | number | null | undefined]>, height: number) {
    const gap = 10;
    const width = (CONTENT_WIDTH - gap * (entries.length - 1)) / entries.length;
    this.ensure(height);
    const top = this.y;
    entries.forEach(([label, value], index) => {
      const x = MARGIN + index * (width + gap);
      this.page.drawText(label, { x, y: top - 9, size: 6.5, font: this.bold, color: this.mutedColor });
      const lines = wrapText(printable(value), this.bold, 8.2, width);
      lines.slice(0, 2).forEach((line, lineIndex) => this.page.drawText(line, { x, y: top - 20 - lineIndex * 10, size: 8.2, font: this.bold, color: this.textColor }));
      this.page.drawLine({ start: { x, y: top - height + 2 }, end: { x: x + width, y: top - height + 2 }, thickness: 0.5, color: LIGHT });
    });
    this.y = top - height;
  }

  summary(snapshot: DiagnosticCardSnapshot) {
    this.section("Підсумок діагностики");
    const values: Array<[string, string]> = [
      ["Перевірено", `${snapshot.counts.checked} з ${snapshot.counts.total}`],
      ["Норма", String(snapshot.counts.ok)],
      ["Увага", String(snapshot.counts.attention)],
      ["Дефекти", String(snapshot.counts.defect)],
      ["Критичні", String(snapshot.counts.critical)],
      ["Статус", snapshot.revisionKind === "FINAL" ? "Фінальна карта" : "На перевірці"],
    ];
    const gap = 7;
    const width = (CONTENT_WIDTH - gap * 2) / 3;
    const rowHeight = 38;
    this.ensure(rowHeight * 2 + 8);
    const top = this.y;
    values.forEach(([label, value], index) => {
      const row = Math.floor(index / 3);
      const column = index % 3;
      const x = MARGIN + column * (width + gap);
      const rowTop = top - row * (rowHeight + 8);
      this.page.drawRectangle({ x, y: rowTop - rowHeight, width, height: rowHeight, color: index === 3 || index === 4 ? rgb(1, 0.97, 0.93) : LIGHT, borderColor: LIGHT, borderWidth: 0.6 });
      this.page.drawText(label, { x: x + 8, y: rowTop - 13, size: 6.8, font: this.regular, color: this.mutedColor });
      this.page.drawText(value, { x: x + 8, y: rowTop - 29, size: 10, font: this.bold, color: index === 3 ? RED : index === 4 ? YELLOW : this.textColor });
    });
    this.y = top - rowHeight * 2 - 8;
  }

  table(headers: string[], rows: string[][], widths: number[], colors: PdfColor[] = []) {
    const headerHeight = 27;
    const size = 7.1;
    const drawHeader = () => {
      this.ensure(headerHeight);
      const top = this.y;
      let x = MARGIN;
      headers.forEach((header, index) => {
        this.page.drawRectangle({ x, y: top - headerHeight, width: widths[index], height: headerHeight, color: DARK });
        const lines = wrapText(header, this.bold, size, widths[index] - 10).slice(0, 2);
        lines.forEach((line, lineIndex) => this.page.drawText(line, { x: x + 5, y: top - 10 - lineIndex * 8, size, font: this.bold, color: WHITE }));
        x += widths[index];
      });
      this.y = top - headerHeight;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const lineSets = row.map((value, index) => wrapText(value || "—", this.regular, size, widths[index] - 10).slice(0, 4));
      const height = Math.max(25, Math.max(...lineSets.map((lines) => lines.length)) * 9 + 10);
      if (this.y - height < MARGIN + 24) drawHeader();
      const top = this.y;
      let x = MARGIN;
      row.forEach((_, index) => {
        this.page.drawRectangle({ x, y: top - height, width: widths[index], height, color: rowIndex % 2 ? rgb(0.955, 0.96, 0.97) : WHITE, borderColor: LIGHT, borderWidth: 0.5 });
        const lines = lineSets[index];
        lines.forEach((line, lineIndex) => this.page.drawText(line, { x: x + 5, y: top - 12 - lineIndex * 9, size, font: index === 0 ? this.bold : this.regular, color: index === 2 ? colors[rowIndex] || this.textColor : this.textColor }));
        x += widths[index];
      });
      this.y = top - height;
    });
    this.y -= 8;
  }

  list(title: string, rows: Array<{ name: string; detail: string; tone: PdfColor }>) {
    if (!rows.length) {
      this.text(title, { size: 8.5, bold: true, gapAfter: 2 });
      this.text("Немає зафіксованих позицій.", { size: 8, color: this.mutedColor, gapAfter: 5 });
      return;
    }
    this.table(["№", title, "Деталі"], rows.map((row, index) => [String(index + 1), row.name, row.detail]), [30, 250, CONTENT_WIDTH - 280], rows.map((row) => row.tone));
  }

  async photos(snapshot: DiagnosticCardSnapshot) {
    const ids = snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding?.mediaIds || [])));
    if (!ids.length) {
      this.text("Фото дефектів до цієї карти не прикріплені.", { size: 8, color: this.mutedColor, gapAfter: 5 });
      return;
    }
    for (const id of ids) {
      const media = this.media.get(id);
      if (!media) continue;
      const mime = media.mimeType.toLowerCase();
      if (!mime.includes("png") && !mime.includes("jpeg") && !mime.includes("jpg")) {
        this.text(`Фото ${media.fileName}: формат не підтримується у PDF.`, { size: 7.5, color: this.mutedColor, gapAfter: 3 });
        continue;
      }
      const image = await this.embedImage(media.fileData, media.mimeType);
      if (!image) continue;
      const scale = Math.min(CONTENT_WIDTH / image.width, 155 / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      this.ensure(height + 18);
      this.page.drawImage(image, { x: MARGIN, y: this.y - height, width, height });
      this.y -= height + 5;
      this.text(media.fileName, { size: 7, color: this.mutedColor, gapAfter: 6 });
    }
  }

  async closing(snapshot: DiagnosticCardSnapshot, qr: { bytes: Uint8Array; mimeType: string } | null, footerText: string) {
    this.section("Підсумок і контакти");
    this.ensure(77);
    const top = this.y;
    const qrWidth = 67;
    if (qr) await this.asset(qr.bytes, qr.mimeType, { x: PAGE_WIDTH - MARGIN - qrWidth, top: top - 3, width: qrWidth, maxHeight: qrWidth });
    const contactWidth = CONTENT_WIDTH - qrWidth - 18;
    this.page.drawRectangle({ x: MARGIN, y: top - 58, width: contactWidth, height: 58, color: rgb(1, 0.98, 0.96), borderColor: this.accent, borderWidth: 1 });
    this.page.drawText("Рекомендації", { x: MARGIN + 10, y: top - 15, size: 8, font: this.bold, color: this.accent });
    const recommendation = snapshot.technicalConclusion || "Використовуйте рекомендації діагностичної карти для погодження подальших робіт.";
    this.drawWrapped(recommendation, MARGIN + 10, top - 22, contactWidth - 20, 7.5, this.regular, this.textColor, 4);
    if (qr) this.page.drawText("Скануйте QR для зв'язку", { x: PAGE_WIDTH - MARGIN - qrWidth, y: top - 70, size: 6.4, font: this.regular, color: this.mutedColor });
    this.y = top - 78;
    this.text(`${footerText} · ${snapshot.station.name || "СТО Турбо Лев"}`, { size: 7.5, color: this.mutedColor, gapAfter: 2 });
  }

  footer(cardNumber: string, footerText: string) {
    this.pages.forEach((page, index) => {
      page.drawLine({ start: { x: MARGIN, y: 23 }, end: { x: PAGE_WIDTH - MARGIN, y: 23 }, thickness: 0.6, color: this.accent });
      page.drawText(`${footerText} · ${cardNumber} · сторінка ${index + 1}/${this.pages.length}`, { x: MARGIN, y: 12, size: 6.7, font: this.regular, color: this.mutedColor });
      page.drawText("098 341 56 46 · turbolev.net", { x: PAGE_WIDTH - MARGIN - 125, y: 12, size: 6.7, font: this.bold, color: this.mutedColor });
    });
  }
}

async function readOptionalAsset(root: string, fileName: string, mimeType: string) {
  try { return { bytes: await readFile(path.join(root, "public", "brand", fileName)), mimeType }; } catch { return null; }
}

function visible(template: DocumentTemplate | undefined, id: string) {
  return !template || template.blocks.find((block) => block.id === id)?.visible !== false;
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
  const accent = colorFromHex(template?.style.accentColor, ORANGE);
  const text = colorFromHex(template?.style.textColor, DARK);
  const muted = colorFromHex(template?.style.mutedColor, MUTED);
  const background = template?.style.background === "brand" ? rgb(1, 0.98, 0.96) : colorFromHex(template?.style.backgroundColor, WHITE);
  const layout = new PdfLayout(pdf, regular, bold, media, { accent, text, muted, background });

  let logo = defaultLogo;
  if (template?.style.logo === "none") logo = null;
  if (template?.style.logo === "custom") {
    const custom = imageDataUrl(template.style.logoDataUrl);
    logo = custom ? { bytes: custom.bytes, mimeType: custom.mimeType } : defaultLogo;
  }
  await layout.header(snapshot, template?.title || "Діагностична карта", template?.description || "Результати проведеної діагностики автомобіля.", logo, car);

  if (visible(template, "summary")) {
    layout.summary(snapshot);
    if (snapshot.problem) {
      layout.section("Заявлена проблема");
      layout.text(snapshot.problem, { size: 8.5, gapAfter: 5 });
    }
  }

  if (visible(template, "findings")) {
    const findings = snapshot.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.filter((item) => item.state !== "OK").map((item) => ({ item, section }))));
    layout.section("Виявлені несправності");
    layout.list("Вузол / елемент", findings.map(({ item, section }) => ({ name: item.name, detail: [section.name, stateLabels[item.state] || item.state, item.finding?.text, item.note].filter(Boolean).join(" · "), tone: stateColor(item.state) })));
  }

  if (visible(template, "inspections")) {
    layout.section("Результати перевірки");
    for (const inspection of snapshot.inspections) {
      layout.subsection(inspection.name);
      for (const section of inspection.sections) {
        layout.subsection(section.name);
        const rows = section.items.map((item, index) => {
          const details = [item.position, measurementText(item), item.finding?.text, item.finding?.action && item.finding.action !== "NONE" ? actionLabels[item.finding.action] || item.finding.action : "", item.note].filter(Boolean).join(" · ");
          return [String(index + 1), item.name, stateLabels[item.state] || item.state, details || "—"];
        });
        layout.table(["№", "Вузол / елемент", "Стан", "Результат / примітки"], rows, [27, 158, 62, CONTENT_WIDTH - 247], section.items.map((item) => stateColor(item.state)));
      }
    }
  }

  if (visible(template, "parts")) {
    layout.section("Деталі, що потребують заміни");
    layout.list("Деталь", snapshot.recommendations.parts.map((item) => ({ name: item.name, detail: [item.section, item.checkName, stateLabels[item.urgency] || actionLabels[item.action] || item.urgency].filter(Boolean).join(" · "), tone: item.urgency === "CRITICAL" ? RED : YELLOW })));
  }

  if (visible(template, "conclusion")) {
    layout.section("Рекомендації механіка");
    layout.list("Робота", snapshot.recommendations.works.map((item) => ({ name: item.name, detail: [item.section, item.checkName, stateLabels[item.urgency] || actionLabels[item.action] || item.urgency].filter(Boolean).join(" · "), tone: item.urgency === "CRITICAL" ? RED : YELLOW })));
    if (snapshot.technicalConclusion) layout.text(snapshot.technicalConclusion, { size: 8.5, color: text, gapAfter: 4 });
    if (snapshot.mechanicComment) layout.text(`Коментар механіка: ${snapshot.mechanicComment}`, { size: 8, color: muted, gapAfter: 3 });
    if (snapshot.managerComment) layout.text(`Коментар менеджера: ${snapshot.managerComment}`, { size: 8, color: muted, gapAfter: 3 });
  }

  if (visible(template, "media")) {
    layout.section("Фото та докази");
    await layout.photos(snapshot);
  }

  if (visible(template, "signature")) {
    layout.section("Підтвердження");
    layout.table(["Відповідальний механік", "Перевірив", "Дата"], [[snapshot.mechanic.name || "—", snapshot.reviewer.name || "—", dateText(snapshot.generatedAt)]], [CONTENT_WIDTH / 3, CONTENT_WIDTH / 3, CONTENT_WIDTH / 3]);
  }

  if (visible(template, "contacts")) await layout.closing(snapshot, qr, template?.style.footerText || "СТО «Турбо Лев»");
  layout.footer(snapshot.cardNumber, template?.style.footerText || "СТО «Турбо Лев»");
  return Buffer.from(await pdf.save());
}
