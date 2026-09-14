import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { DiagnosticCardSnapshot } from "@/src/services/diagnostic-card.service";
import type { DocumentTemplate } from "@/src/services/document-template.service";
import {
  DIAGNOSTIC_CARD_PREVIEW_LAYOUT,
  DIAGNOSTIC_CARD_REFERENCE,
  DIAGNOSTIC_CARD_TABLE_HEADERS,
  diagnosticCardPdfUnit,
} from "@/src/document-layout/diagnostic-card-reference";

const PAGE_WIDTH = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.page.pdfWidth;
const PAGE_HEIGHT = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.page.pdfHeight;
const px = diagnosticCardPdfUnit;
const WHITE = rgb(1, 1, 1);

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

function colorFromHex(value: string | undefined, fallback: string) {
  const source = value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return rgb(
    Number.parseInt(source.slice(1, 3), 16) / 255,
    Number.parseInt(source.slice(3, 5), 16) / 255,
    Number.parseInt(source.slice(5, 7), 16) / 255,
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

function publicAssetUrl(fileName: string) {
  const host = process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host) return null;
  return `https://${host.replace(/^https?:\/\//, "")}/brand/${encodeURIComponent(fileName)}`;
}

async function readPublicAsset(root: string, fileName: string, mimeType: string): Promise<PdfAsset | null> {
  try {
    return { bytes: await readFile(path.join(root, "public", "brand", fileName)), mimeType };
  } catch {
    const url = publicAssetUrl(fileName);
    if (!url) return null;
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) return null;
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mimeType: response.headers.get("content-type") || mimeType,
      };
    } catch {
      return null;
    }
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

function baselineFromTop(top: number, size: number, baselineFactor = 0.82) {
  return PAGE_HEIGHT - top - size * baselineFactor;
}

function drawCenteredFromTop(page: PDFPage, value: string, top: number, font: PDFFont, size: number, color: PdfColor) {
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, {
    x: (PAGE_WIDTH - width) / 2,
    y: baselineFromTop(top, size),
    size,
    font,
    color,
  });
}

function drawPageBackground(page: PDFPage, template: DocumentTemplate | undefined) {
  const background = template?.style.backgroundColor && /^#[0-9a-f]{6}$/i.test(template.style.backgroundColor)
    ? colorFromHex(template.style.backgroundColor, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.page.background)
    : WHITE;
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: background });
}

function drawCorner(page: PDFPage, accent: PdfColor) {
  const corner = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.corner;
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - px(corner.height),
    width: px(corner.width),
    height: px(corner.height),
    color: accent,
  });
  page.drawRectangle({
    x: px(corner.cutLeft),
    y: PAGE_HEIGHT - px(corner.height),
    width: px(corner.cutWidth),
    height: px(corner.height),
    color: WHITE,
  });
}

function drawStretchedImage(page: PDFPage, image: PDFImage | null, x: number, top: number, width: number, height: number) {
  if (!image) return;
  page.drawImage(image, {
    x,
    y: PAGE_HEIGHT - top - height,
    width,
    height,
  });
}

function drawHeaderPanorama(page: PDFPage, logo: PDFImage | null, car: PDFImage | null, accent: PdfColor) {
  const header = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.header;
  const side = px(header.side);
  const panoramaTop = px(header.paddingTop);

  drawStretchedImage(
    page,
    logo,
    side + px(header.logo.left),
    panoramaTop + px(header.logo.top),
    px(header.logo.width),
    px(header.logo.height),
  );
  drawStretchedImage(
    page,
    car,
    PAGE_WIDTH - side - px(header.car.width) - px(header.car.right),
    panoramaTop + px(header.car.top),
    px(header.car.width),
    px(header.car.height),
  );

  const motionX = side + px(header.motion.left);
  const motionTop = panoramaTop + px(header.motion.top);
  for (const line of header.motion.lines) {
    const y = PAGE_HEIGHT - motionTop - px(line.top);
    page.drawLine({
      start: { x: motionX + px(line.left), y },
      end: { x: motionX + px(line.left + line.width), y },
      thickness: Math.max(0.75, px(line.height)),
      color: accent,
      opacity: line.opacity,
    });
  }
}

function drawDocumentHeading(page: PDFPage, template: DocumentTemplate | undefined, bold: PDFFont, accent: PdfColor, textColor: PdfColor) {
  const header = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.header;
  const titleTop = px(header.paddingTop + header.panoramaHeight + header.headingMarginTop);
  const titleSize = px(header.title.size);
  const eyebrowSize = px(header.eyebrow.size);
  const title = (template?.title || DIAGNOSTIC_CARD_REFERENCE.title).toUpperCase();

  drawCenteredFromTop(page, title, titleTop, bold, titleSize, textColor);
  drawCenteredFromTop(
    page,
    DIAGNOSTIC_CARD_REFERENCE.sectionEyebrow,
    titleTop + px(header.title.lineHeight + header.eyebrow.marginTop),
    bold,
    eyebrowSize,
    accent,
  );
}

function drawMeta(page: PDFPage, snapshot: DiagnosticCardSnapshot, regular: PDFFont, textColor: PdfColor, accent: PdfColor) {
  const meta = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.meta;
  const header = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.header;
  const top = px(header.height);
  const side = px(meta.side);
  const contentWidth = PAGE_WIDTH - side * 2;
  const fontSize = px(meta.fontSize);
  const paddingX = px(meta.paddingX);
  const paddingY = px(meta.paddingY);

  page.drawLine({
    start: { x: side, y: PAGE_HEIGHT - top },
    end: { x: PAGE_WIDTH - side, y: PAGE_HEIGHT - top },
    thickness: Math.max(0.7, px(meta.borderWidth)),
    color: accent,
  });

  const date = dateOnly(snapshot.visit?.actualEndAt || snapshot.visit?.actualStartAt || snapshot.generatedAt);
  const values = [
    `Автомобіль: ${printable(snapshot.vehicle.label)}`,
    `VIN: ${printable(snapshot.vehicle.vin)}`,
    `Дата: ${date}`,
  ];
  const y = baselineFromTop(top + paddingY, fontSize);
  const columnWidth = contentWidth / 3;
  page.drawText(values[0], { x: side + paddingX, y, size: fontSize, font: regular, color: textColor });
  page.drawText(values[1], { x: side + columnWidth + paddingX, y, size: fontSize, font: regular, color: textColor });
  const lastWidth = regular.widthOfTextAtSize(values[2], fontSize);
  page.drawText(values[2], {
    x: PAGE_WIDTH - side - paddingX - lastWidth,
    y,
    size: fontSize,
    font: regular,
    color: textColor,
  });

  return top + paddingY * 2 + px(meta.fontSize * 1.2) + px(meta.borderWidth);
}

function drawSectionTitle(page: PDFPage, top: number, bold: PDFFont, accent: PdfColor, textColor: PdfColor) {
  const section = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.section;
  const side = px(section.side);
  page.drawRectangle({
    x: side,
    y: PAGE_HEIGHT - top - px(section.barHeight),
    width: px(section.barWidth),
    height: px(section.barHeight),
    color: accent,
  });
  const size = px(section.titleSize);
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.sectionTitle, {
    x: side + px(section.titlePaddingLeft),
    y: baselineFromTop(top, size),
    size,
    font: bold,
    color: textColor,
  });
  return top + px(section.titleLineHeight + section.titleMarginBottom);
}

function tableWidths() {
  const section = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.section;
  const table = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table;
  const total = PAGE_WIDTH - px(section.side) * 2;
  const number = px(table.numberWidth);
  const status = px(table.statusWidth);
  return [number, total - number - status, status] as const;
}

function drawTableHeader(page: PDFPage, top: number, bold: PDFFont, dark: PdfColor) {
  const table = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table;
  const section = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.section;
  const widths = tableWidths();
  const height = px(table.headerHeight);
  const size = px(table.fontSize);
  let x = px(section.side);
  DIAGNOSTIC_CARD_TABLE_HEADERS.forEach((header, index) => {
    page.drawRectangle({ x, y: PAGE_HEIGHT - top - height, width: widths[index], height, color: dark });
    const textWidth = bold.widthOfTextAtSize(header, size);
    page.drawText(header, {
      x: x + (widths[index] - textWidth) / 2,
      y: PAGE_HEIGHT - top - height / 2 - size * 0.34,
      size,
      font: bold,
      color: WHITE,
    });
    x += widths[index];
  });
  return { top: top + height, widths };
}

function drawPartRow(
  page: PDFPage,
  rowIndex: number,
  name: string,
  top: number,
  widths: readonly [number, number, number],
  bold: PDFFont,
  textColor: PdfColor,
  lineColor: PdfColor,
  alternateRow: PdfColor,
  danger: PdfColor,
) {
  const table = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table;
  const section = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.section;
  const size = px(table.fontSize);
  const lineHeight = px(table.lineHeight);
  const detailPadding = px(8);
  const detailLines = wrapText(name, bold, size, widths[1] - detailPadding * 2).slice(0, 3);
  const rowHeight = Math.max(px(table.rowMinHeight), detailLines.length * lineHeight + px(table.cellPaddingY * 2 + 3));
  const fill = rowIndex % 2 === 1 ? alternateRow : WHITE;
  let x = px(section.side);

  widths.forEach((width) => {
    page.drawRectangle({
      x,
      y: PAGE_HEIGHT - top - rowHeight,
      width,
      height: rowHeight,
      color: fill,
      borderColor: lineColor,
      borderWidth: Math.max(0.35, px(table.borderWidth) * 0.5),
    });
    x += width;
  });

  const number = String(rowIndex + 1);
  page.drawText(number, {
    x: px(section.side) + (widths[0] - bold.widthOfTextAtSize(number, size)) / 2,
    y: PAGE_HEIGHT - top - rowHeight / 2 - size * 0.34,
    size,
    font: bold,
    color: textColor,
  });

  const firstLineTop = top + Math.max(px(4), (rowHeight - detailLines.length * lineHeight) / 2 + px(1));
  detailLines.forEach((line, index) => {
    page.drawText(line, {
      x: px(section.side) + widths[0] + detailPadding,
      y: baselineFromTop(firstLineTop + index * lineHeight, size),
      size,
      font: bold,
      color: textColor,
    });
  });

  const status = DIAGNOSTIC_CARD_REFERENCE.statusLabel;
  const statusWidth = bold.widthOfTextAtSize(status, size);
  page.drawText(status, {
    x: px(section.side) + widths[0] + widths[1] + (widths[2] - statusWidth) / 2,
    y: PAGE_HEIGHT - top - rowHeight / 2 - size * 0.34,
    size,
    font: bold,
    color: danger,
  });
  return top + rowHeight;
}

function drawWarning(page: PDFPage, top: number, regular: PDFFont, muted: PdfColor) {
  const warning = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.warning;
  const size = px(warning.fontSize);
  const width = PAGE_WIDTH - px(warning.side) * 2;
  const lines = wrapText(DIAGNOSTIC_CARD_REFERENCE.warning, regular, size, width).slice(0, 3);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: px(warning.side),
      y: baselineFromTop(top + index * px(warning.lineHeight), size),
      size,
      font: regular,
      color: muted,
    });
  });
  return top + lines.length * px(warning.lineHeight) + px(warning.marginBottom);
}

function drawFooter(page: PDFPage, regular: PDFFont, bold: PDFFont, accent: PdfColor, dark: PdfColor) {
  const footer = DIAGNOSTIC_CARD_PREVIEW_LAYOUT.footer;
  const height = px(footer.height);
  const padding = px(footer.paddingX);
  const accentWidth = px(footer.accentWidth);
  const size = px(footer.fontSize);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height, color: dark });
  page.drawRectangle({ x: PAGE_WIDTH - accentWidth, y: 0, width: accentWidth, height, color: accent });
  const y = height / 2 - size * 0.34;
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.phone, { x: padding, y, size, font: regular, color: WHITE });
  const addressWidth = bold.widthOfTextAtSize(DIAGNOSTIC_CARD_REFERENCE.address, size);
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.address, { x: (PAGE_WIDTH - addressWidth) / 2, y, size, font: bold, color: WHITE });
  const siteWidth = regular.widthOfTextAtSize(DIAGNOSTIC_CARD_REFERENCE.website, size);
  page.drawText(DIAGNOSTIC_CARD_REFERENCE.website, {
    x: PAGE_WIDTH - padding - accentWidth - siteWidth,
    y,
    size,
    font: regular,
    color: WHITE,
  });
}

function newPage(pdf: PDFDocument, template: DocumentTemplate | undefined) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawPageBackground(page, template);
  return page;
}

function continuationTop(page: PDFPage, bold: PDFFont, accent: PdfColor, textColor: PdfColor, dark: PdfColor) {
  let top = px(26);
  top = drawSectionTitle(page, top, bold, accent, textColor);
  return drawTableHeader(page, top, bold, dark);
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
  const [regularBytes, boldBytes, defaultLogoAsset, panoramaCarAsset] = await Promise.all([
    readFile(path.join(root, "public", "fonts", "DejaVuSans.ttf")),
    readFile(path.join(root, "public", "fonts", "DejaVuSans-Bold.ttf")),
    readPublicAsset(root, DIAGNOSTIC_CARD_REFERENCE.logoAsset, "image/png"),
    readPublicAsset(root, DIAGNOSTIC_CARD_REFERENCE.carAsset, "image/png"),
  ]);

  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const accent = colorFromHex(template?.style.accentColor, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.accent);
  const textColor = colorFromHex(template?.style.textColor, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.text);
  const muted = colorFromHex(template?.style.mutedColor, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.muted);
  const dark = colorFromHex(undefined, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.text);
  const lineColor = colorFromHex(undefined, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.line);
  const alternateRow = colorFromHex(undefined, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.alternateRow);
  const danger = colorFromHex(undefined, DIAGNOSTIC_CARD_PREVIEW_LAYOUT.colors.danger);

  let logoAsset = defaultLogoAsset;
  if (template?.style.logo === "none") logoAsset = null;
  if (template?.style.logo === "custom") logoAsset = imageDataUrl(template.style.logoDataUrl) || defaultLogoAsset;
  const logo = await embedAsset(pdf, logoAsset);
  const car = await embedAsset(pdf, panoramaCarAsset);

  let page = newPage(pdf, template);
  drawCorner(page, accent);
  drawHeaderPanorama(page, logo, car, accent);
  drawDocumentHeading(page, template, bold, accent, textColor);
  let top = drawMeta(page, snapshot, regular, textColor, accent);
  top = drawSectionTitle(page, top, bold, accent, textColor);
  let header = drawTableHeader(page, top, bold, dark);
  top = header.top;

  const safeParts = parts.length ? parts : [{ name: "Деталі до заміни не додані" }];
  const footerReserve = px(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.footer.height + 18);

  for (let index = 0; index < safeParts.length; index += 1) {
    const partName = optionalText(safeParts[index].name) || "—";
    const size = px(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table.fontSize);
    const lines = wrapText(partName, bold, size, header.widths[1] - px(16)).slice(0, 3);
    const expectedHeight = Math.max(
      px(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table.rowMinHeight),
      lines.length * px(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.table.lineHeight) + px(7),
    );

    if (top + expectedHeight > PAGE_HEIGHT - footerReserve) {
      drawFooter(page, regular, bold, accent, dark);
      page = newPage(pdf, template);
      header = continuationTop(page, bold, accent, textColor, dark);
      top = header.top;
    }

    top = drawPartRow(
      page,
      index,
      partName,
      top,
      header.widths,
      bold,
      textColor,
      lineColor,
      alternateRow,
      danger,
    );
  }

  const warningNeed = px(DIAGNOSTIC_CARD_PREVIEW_LAYOUT.warning.lineHeight * 3 + DIAGNOSTIC_CARD_PREVIEW_LAYOUT.warning.marginBottom);
  if (top + px(12) + warningNeed > PAGE_HEIGHT - footerReserve) {
    drawFooter(page, regular, bold, accent, dark);
    page = newPage(pdf, template);
    top = px(34);
  } else {
    top += px(12);
  }
  drawWarning(page, top, regular, muted);

  for (const currentPage of pdf.getPages()) drawFooter(currentPage, regular, bold, accent, dark);
  return Buffer.from(await pdf.save());
}
