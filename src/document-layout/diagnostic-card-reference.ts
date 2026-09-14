export const DIAGNOSTIC_CARD_REFERENCE = {
  title: "ДІАГНОСТИЧНА КАРТА",
  sectionTitle: "ДЕТАЛІ ДО ЗАМІНИ",
  sectionEyebrow: "ПЕРЕЛІК ДЕТАЛЕЙ ДО ЗАМІНИ",
  statusLabel: "Потребує заміни",
  warning: "У діагностичній карті відображається лише клієнтська інформація: номер позиції, назва деталі та статус «Потребує заміни».",
  phone: "098 341 56 46",
  address: "Глеваха, вул. Окружна, 55 Г",
  website: "turbolev.net",
  logoAsset: "turbo-lev-document-logo.png",
  carAsset: "turbo-lev-document-car-panorama.png",
} as const;

export const DIAGNOSTIC_CARD_TABLE_HEADERS = ["№", "Деталь", "Статус"] as const;

/**
 * Canonical geometry of the approved Settings → A4 · HTML preview.
 *
 * The browser preview is 620 CSS px wide. The PDF renderer scales these same
 * measurements proportionally to A4 width, so changes must be made here first
 * and then mirrored by the preview CSS contract. This prevents the generated
 * Diagnostic Card from drifting into a separate design.
 */
export const DIAGNOSTIC_CARD_PREVIEW_LAYOUT = {
  width: 620,
  page: {
    pdfWidth: 595.28,
    pdfHeight: 841.89,
    background: "#ffffff",
  },
  colors: {
    accent: "#f04a23",
    text: "#15181e",
    muted: "#555b61",
    line: "#d7dce1",
    alternateRow: "#f2f4f6",
    danger: "#c62828",
    white: "#ffffff",
  },
  corner: { width: 27, height: 19, cutLeft: 7, cutWidth: 5 },
  header: {
    height: 132,
    paddingTop: 9,
    side: 15,
    panoramaHeight: 78,
    headingMarginTop: 5,
    logo: { left: 0, top: 0, width: 158, height: 78 },
    car: { right: 0, top: 0, width: 205, height: 78 },
    motion: {
      left: 145,
      top: 48,
      lines: [
        { left: 0, top: 4, width: 148, height: 2, opacity: 0.48 },
        { left: 23, top: 13, width: 157, height: 1.5, opacity: 0.30 },
        { left: 58, top: 21, width: 133, height: 1, opacity: 0.20 },
      ],
    },
    title: { size: 19, lineHeight: 19.95, weight: 900 },
    eyebrow: { size: 11, lineHeight: 11, marginTop: 5, weight: 900 },
  },
  meta: {
    side: 15,
    paddingX: 2,
    paddingY: 7,
    fontSize: 11,
    borderWidth: 1,
  },
  section: {
    side: 15,
    marginBottom: 9,
    titleSize: 15,
    titleLineHeight: 18,
    titlePaddingLeft: 15,
    titleMarginBottom: 8,
    barWidth: 7,
    barHeight: 18,
  },
  table: {
    numberWidth: 38,
    statusWidth: 120,
    headerHeight: 25,
    rowMinHeight: 22,
    cellPaddingX: 3,
    cellPaddingY: 2,
    fontSize: 11,
    lineHeight: 12.1,
    borderWidth: 1,
  },
  warning: {
    side: 16,
    marginBottom: 22,
    fontSize: 11,
    lineHeight: 14.3,
  },
  footer: {
    height: 26,
    paddingX: 24,
    fontSize: 11,
    accentWidth: 18,
  },
} as const;

export const DIAGNOSTIC_CARD_PREVIEW_SAMPLE = {
  vehicle: "Citroen C3",
  vin: "VF7SXHNVTKT682038",
  date: "05.08.2026",
  parts: [
    "Направляюча переднього супорта Opel Astra J/Chevrolet Aveo 09-",
    "Колодки гальмівні передні Toyota Corolla 2001-2014",
    "Тяга переднього стабілізатора Citroen C4/C5/Berlingo/Peugeot 307",
    "Колодки гальмівні передні Mercedes-Benz A-Class W168",
    "Ремкомплект заднього супорта Mercedes-Benz Vito W639",
    "Диск гальмівний задній Citroen Berlingo/Peugeot Partner",
  ],
} as const;

export function diagnosticCardPdfUnit(previewPixels: number) {
  return previewPixels * (DIAGNOSTIC_CARD_PREVIEW_LAYOUT.page.pdfWidth / DIAGNOSTIC_CARD_PREVIEW_LAYOUT.width);
}
