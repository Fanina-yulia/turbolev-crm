import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { DiagnosticCardSnapshot } from "@/src/services/diagnostic-card.service";
import type { DocumentTemplate } from "@/src/services/document-template.service";
import { DIAGNOSTIC_CARD_REFERENCE, DIAGNOSTIC_CARD_TABLE_HEADERS } from "@/src/document-layout/diagnostic-card-reference";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const SIDE = 22;
const CONTENT_WIDTH = PAGE_WIDTH - SIDE * 2;
const FOOTER_HEIGHT = 30;
const ORANGE = rgb(0.96, 0.35, 0.04);
const DARK = rgb(0.09, 0.10, 0.12);
const MUTED = rgb(0.35, 0.38, 0.42);
const LINE = rgb(0.82, 0.84, 0.87);
const ROW = rgb(0.95, 0.96, 0.97);
const WHITE = rgb(1, 1, 1);
const RED = rgb(0.78, 0.16, 0.14);

type PdfColor = ReturnType<typeof rgb>;
type PdfAsset = { bytes: Uint8Array; mimeType: string };

export type DiagnosticCardPdfMedia = {
  id: string;
  fileName: string;
  mimeType: string;
  fileData: Uint8Array;
};

export type DiagnosticCardPdfPart = {
  name: string;
  article?: string | number | null;
  brand?: string | null;
  quantity?: string | number | null;
};

function optionalText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function printable(value: string | number | null | undefined) {
  return optionalText(value) || "—";
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function colorFromHex(value: string | undefined, fallback: PdfColor) {
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
  return rgb(
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  );
}

function imageDataUrl(value: string) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value || "");
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase() === "png" ? "image/png" : "image/jpeg",
    bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
  } as PdfAsset;
}

async function readOptionalAsset(root: string, fileName: string, mimeType: string): Promise<PdfAsset | null> {
  try {
    return { bytes: await readFile(path.join(root, "public", "brand", fileName)), mimeType };
  } catch {
    return null;
  }
}

async function embedAsset(pdf: PDFDocument, asset: PdfAsset | null): Promise<PDFImage | null> {
  if (!asset) return null;
  try {
    if (asset.mimeType.includes("png")) return await pdf.embedPng(asset.bytes);
    if (asset.mimeType.includes("jpeg") || asset.mimeType.includes("jpg")) return await pdf.embedJpg(asset.bytes);
  } catch {
    return null;
  }
  return null;
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
  for (const paragraph of String(value || "").split(/\r?\n/)) {
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
    if (current) lines.push(current);
  }
  return lines;
}

function drawCentered(page: PDFPage, value: string, y: number, font: PDFFont, size: number, color: PdfColor) {
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: (PAGE_WIDTH - width) / 2, y, size, font, color });
}

function drawHeaderPanorama(
  page: PDFPage,
  logo: PDFImage | null,
  car: PDFImage | null,
  accent: PdfColor,
) {
  const top = PAGE_HEIGHT - 18;
  if (logo) {
    const boxWidth = 150;
    const boxHeight = 75;
    const scale = Math.min(boxWidth / logo.width, boxHeight / logo.height);
    page.drawImage(logo, {
      x: SIDE,
      y: top - logo.height * scale,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }
  if (car) {
    const boxWidth = 198;
    const boxHeight = 108;
    const scale = Math.min(boxWidth / car.width, boxHeight / car.height);
    const width = car.width * scale;
    const height = car.height * scale;
    page.drawImage(car, {
      x: PAGE_WIDTH - SIDE - width,
      y: top - height,
      width,
      height,
    });
  }

  page.drawLine({ start: { x: 153, y: top - 64 }, end: { x: 295, y: top - 64 }, thickness: 1.9, color: accent, opacity: 0.48 });
  page.drawLine({ start: { x: 176, y: top - 73 }, end: { x: 327, y: top - 73 }, thickness: 1.3, color: accent, opacity: 0.30 });
  page.drawLine({ start: { x: 210, y: top - 81 }, end: { x: 338, y: top - 81 }, thickness: 0.9, color: accent, opacity: 0.20 });
}

function drawMeta(page: PDFPage, snapshot: DiagnosticCardSnapshot, regular: PDFFont, bold: PDFFont, y: number) {
  page.drawLine({ start: { x: SIDE, y: y + 13 }, end: { x: PAGE_WIDTH - SIDE, y: y + 13 }, thickness: 0.9, color: LINE });
  const date = dateOnly(snapshot.visit?.actualEndAt || snapshot.visit?.actualStartAt || snapshot.generatedAt);
  const items = [
    { label: "Автомобіль", value: snapshot.vehicle.label, x: SIDE, width: 220, align: "left" as const },
    { label: "VIN", value: snapshot.vehicle.vin, x: PAGE_WIDTH / 2 - 70, width: 210, align: "left" as const },
    { label: "Дата", value: date, x: PAGE_WIDTH - SIDE - 118, width: 118, align: "right" as const },
  ];
  for (const item of items) {
    const label = `${item.label}:`;
    const text = `${label} ${printable(item.value)}`;
    const textWidth = regular.widthOfTextAtSize(text, 7.4);
    const x = item.align === "right" ? item.x + item.width - textWidth : item.x;
    page.drawText(label, { x, y, size: 7.4, font: regular, color: DARK });
    page.drawText(` ${printable(item.value)}`, {
      x: x + regular.widthOfTextAtSize(label, 7.4),
      y,
      size: 7.4,
      font: bold,
      color: DARK,
    });
  }
}

function drawTableHeader(page: PDFPage, top: number, bold: PDFFont) {
  const noWidth = 34;
  const statusWidth = 132;
  const detailWidth = CONTENT_WIDTH - noWidth - statusWidth;
  const height = 25;
  const widths = [noWidth, detailWidth, statusWidth];
  let x = SIDE;
  DIAGNOSTIC_CARD_TABLE_HEADERS.forEach((header, index) => {
    page.drawRectangle({ x, y: top - height, width: widths[index], height, color: DARK });
    const textWidth = bold.widthOfTextAtSize(header, 8.2);
    const textX = index === 1 ? x + (widths[index] - textWidth) / 2 : x + (widths[index] - textWidth) / 2;
    page.drawText(header, { x: textX, y: top - 16, size: 8.2, font: bold, color: WHITE });
    x += widths[index];
  });
  return { y: top - height, widths };
}

function drawPartRow(
  page: PDFPage,
  rowIndex: number,
  name: string,
  top: number,
  widths: number[],
  regular: PDFFont,
  bold: PDFFont,
  textColor: PdfColor,
) {
  const size = 7.5;
  const noWidth = widths[0];
  const detailWidth = widths[1];
  const statusWidth = widths[2];
  const detailLines = wrapText(name, bold, size, detailWidth - 14).slice(0, 3);
  const rowHeight = Math.max(24, detailLines.length * 9 + 10);
  const fill = rowIndex % 2 === 1 ? ROW : WHITE;
  let x = SIDE;
  widths.forEach((width) => {
    page.drawRectangle({ x, y: top - rowHeight, width, height: rowHeight, color: fill, borderColor: LINE, borderWidth: 0.45 });
    x += width;
  });
  const number = String(rowIndex + 1);
  page.drawText(number, {
    x: SIDE + (noWidth - bold.widthOfTextAtSize(number, size)) / 2,
    y: top - 15,
    size,
    font: bold,
    color: textColor,
  });
  detailLines.forEach((line, index) => {
    page.drawText(line, {
      x: SIDE + noWidth + 8,
      y: top - 14 - index * 9,
      size,
      font: bold,
      color: textColor,
    });
  });
  const status = DIAGNOSTIC_CARD_REFERENCE.statusLabel;
  const statusWidthText = bold.widthOfTextAtSize(status, size);
  page.drawText(status, {
    x: SIDE + noWidth + detailWidth + (statusWidth - statusWidthText) / 2,
    y: top - 15,
    size,
    font: bold,
    color: RED,
  });
  return top - rowHeight;
}

function drawWarning(page: PDFPage, top: number, regular: PDFFont, muted: PdfColor) {
  const lines = wrapText(DIAGNOSTIC_CARD_REFERENCE.warning, regular, 8.1, CONTENT_WIDTH).slice(0, 3);
  lines.forEach((line, index) => {
    page.drawText(line, { x: SIDE, y: top - index * 11, size: 8.1, font: regular, color: muted });
  });
  return top - Math.max(28, lines.length * 11 + 8);
}

function drawFooter(page: PDFPage, bold: PDFFont, accent: PdfColor) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: FOOTER_HEIGHT, color: DARK });
  page.drawRectangle({ x: PAGE_WIDTH - 17, y: 0, width: 17, height: FOOTER_HEIGHT, color: accent });
  const y = 10.5;
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.phone, { x: SIDE, y, size: 7.2, font: bold, color: WHITE });
  drawCentered(page, DIAGNOSTIC_CARD_REFERENCE.address, y, bold, 7.2, WHITE);
  const siteWidth = bold.widthOfTextAtSize(DIAGNOSTIC_CARD_REFERENCE.website, 7.2);
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.website, { x: PAGE_WIDTH - SIDE - 18 - siteWidth, y, size: 7.2, font: bold, color: WHITE });
}

function drawDocumentHeader(
  page: PDFPage,
  snapshot: DiagnosticCardSnapshot,
  template: DocumentTemplate | undefined,
  regular: PDFFont,
  bold: PDFFont,
  logo: PDFImage | null,
  car: PDFImage | null,
  accent: PdfColor,
  textColor: PdfColor,
) {
  drawHeaderPanorama(page, logo, car, accent);
  const title = (template?.title || "Діагностична карта").toUpperCase();
  drawCentered(page, title, PAGE_HEIGHT - 127, bold, 18.5, textColor);
  drawCentered(page, DIAGNOSTIC_CARD_REFERENCE.sectionEyebrow, PAGE_HEIGHT - 146, bold, 8.9, accent);
  drawMeta(page, snapshot, regular, bold, PAGE_HEIGHT - 162);
  return PAGE_HEIGHT - 181;
}

function drawContinuationHeader(page: PDFPage, bold: PDFFont, accent: PdfColor, textColor: PdfColor) {
  page.drawRectangle({ x: SIDE, y: PAGE_HEIGHT - 50, width: 7, height: 22, color: accent });
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.sectionTitle, {
    x: SIDE + 15,
    y: PAGE_HEIGHT - 45,
    size: 15,
    font: bold,
    color: textColor,
  });
  return PAGE_HEIGHT - 62;
}

export async function renderDiagnosticCardPdf(
  snapshot: DiagnosticCardSnapshot,
  _media: DiagnosticCardPdfMedia[] = [],
  template?: DocumentTemplate,
  parts: DiagnosticCardPdfPart[] = snapshot.recommendations.parts,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const root = process.cwd();
  const [regularBytes, boldBytes, defaultLogo, panoramaCar] = await Promise.all([
    readFile(path.join(root, "public", "fonts", "DejaVuSans.ttf")),
    readFile(path.join(root, "public", "fonts", "DejaVuSans-Bold.ttf")),
    readOptionalAsset(root, DIAGNOSTIC_CARD_REFERENCE.logoAsset, "image/png"),
    readOptionalAsset(root, DIAGNOSTIC_CARD_REFERENCE.carAsset, "image/png"),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const accent = colorFromHex(template?.style.accentColor, ORANGE);
  const textColor = colorFromHex(template?.style.textColor, DARK);
  const muted = colorFromHex(template?.style.mutedColor, MUTED);

  let logoAsset = defaultLogo;
  if (template?.style.logo === "none") logoAsset = null;
  if (template?.style.logo === "custom") logoAsset = imageDataUrl(template.style.logoDataUrl) || defaultLogo;
  const logo = await embedAsset(pdf, logoAsset);
  const car = await embedAsset(pdf, panoramaCar);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
  let cursor = drawDocumentHeader(page, snapshot, template, regular, bold, logo, car, accent, textColor);

  page.drawRectangle({ x: SIDE, y: cursor - 27, width: 7, height: 25, color: accent });
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.sectionTitle, {
    x: SIDE + 15,
    y: cursor - 22,
    size: 15.5,
    font: bold,
    color: textColor,
  });
  cursor -= 36;

  const safeParts = parts.length ? parts : [{ name: "Деталі до заміни не додані" }];
  let header = drawTableHeader(page, cursor, bold);
  cursor = header.y;

  for (let index = 0; index < safeParts.length; index += 1) {
    const part = safeParts[index];
    const lines = wrapText(optionalText(part.name) || "—", bold, 7.5, header.widths[1] - 14).slice(0, 3);
    const expectedHeight = Math.max(24, lines.length * 9 + 10);
    if (cursor - expectedHeight < FOOTER_HEIGHT + 54) {
      drawFooter(page, bold, accent);
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
      cursor = drawContinuationHeader(page, bold, accent, textColor);
      header = drawTableHeader(page, cursor, bold);
      cursor = header.y;
    }
    cursor = drawPartRow(page, index, optionalText(part.name) || "—", cursor, header.widths, regular, bold, textColor);
  }

  if (cursor - 50 < FOOTER_HEIGHT + 18) {
    drawFooter(page, bold, accent);
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: WHITE });
    cursor = PAGE_HEIGHT - 48;
  } else cursor -= 18;
  drawWarning(page, cursor, regular, muted);

  for (const currentPage of pdf.getPages()) drawFooter(currentPage, bold, accent);
  return Buffer.from(await pdf.save());
}
