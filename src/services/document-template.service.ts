import "server-only";

import { getPrisma } from "@/src/lib/prisma";

export const DOCUMENT_TEMPLATES_SETTING_KEY = "document_templates";

export type DocumentTemplateType = "DIAGNOSTIC_CARD" | "COMMERCIAL_PROPOSAL";
export type DocumentTemplateStatus = "DRAFT" | "PUBLISHED";
export type DocumentTemplateFont = "system" | "inter" | "manrope";
export type DocumentTemplateBackground = "plain" | "brand" | "image";
export type DocumentTemplateLogo = "global" | "custom" | "none";

export type DocumentTemplateBlock = {
  id: string;
  label: string;
  visible: boolean;
};

export type DocumentTemplateStyle = {
  font: DocumentTemplateFont;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  background: DocumentTemplateBackground;
  backgroundColor: string;
  backgroundImageDataUrl: string;
  logo: DocumentTemplateLogo;
  logoDataUrl: string;
  footerText: string;
};

export type DocumentTemplate = {
  type: DocumentTemplateType;
  title: string;
  description: string;
  status: DocumentTemplateStatus;
  version: number;
  style: DocumentTemplateStyle;
  blocks: DocumentTemplateBlock[];
};

export type DocumentTemplatesSettings = {
  templates: DocumentTemplate[];
  updatedAt: string | null;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const TEMPLATE_TYPES: DocumentTemplateType[] = ["DIAGNOSTIC_CARD", "COMMERCIAL_PROPOSAL"];
const FONTS: DocumentTemplateFont[] = ["system", "inter", "manrope"];
const BACKGROUNDS: DocumentTemplateBackground[] = ["plain", "brand", "image"];
const LOGOS: DocumentTemplateLogo[] = ["global", "custom", "none"];
const STATUSES: DocumentTemplateStatus[] = ["DRAFT", "PUBLISHED"];
const MAX_IMAGE_BYTES = 1024 * 1024;

const BLOCKS: Record<DocumentTemplateType, DocumentTemplateBlock[]> = {
  DIAGNOSTIC_CARD: [
    { id: "identity", label: "Клієнт та автомобіль", visible: true },
    { id: "summary", label: "Загальний висновок", visible: true },
    { id: "inspections", label: "Результати перевірки", visible: true },
    { id: "findings", label: "Виявлені несправності", visible: true },
    { id: "parts", label: "Деталі, що потребують заміни", visible: true },
    { id: "media", label: "Фото та докази", visible: true },
    { id: "conclusion", label: "Рекомендації механіка", visible: true },
    { id: "signature", label: "Механік та дата", visible: true },
    { id: "contacts", label: "Контакти станції", visible: true },
  ],
  COMMERCIAL_PROPOSAL: [
    { id: "identity", label: "Клієнт та автомобіль", visible: true },
    { id: "intro", label: "Вступний текст", visible: true },
    { id: "works", label: "Роботи", visible: true },
    { id: "parts", label: "Запчастини", visible: true },
    { id: "totals", label: "Підсумок та сума", visible: true },
    { id: "terms", label: "Умови та гарантія", visible: true },
    { id: "signature", label: "Підтвердження клієнта", visible: true },
    { id: "contacts", label: "Контакти станції", visible: true },
  ],
};

function bytes(dataUrl: string) {
  const payload = dataUrl.split(",", 2)[1] || "";
  return Math.floor((payload.replace(/\s/g, "").length * 3) / 4);
}

function safeText(value: unknown, fallback: string, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && HEX.test(value) ? value.toUpperCase() : fallback;
}

function image(value: unknown, maxBytes: number) {
  if (typeof value !== "string" || !value) return "";
  if (!IMAGE.test(value) || bytes(value) > maxBytes) throw new Error("INVALID_DOCUMENT_IMAGE");
  return value;
}

function defaultStyle(): DocumentTemplateStyle {
  return {
    font: "system",
    accentColor: "#F45A0A",
    textColor: "#171717",
    mutedColor: "#667085",
    background: "plain",
    backgroundColor: "#FFFFFF",
    backgroundImageDataUrl: "",
    logo: "global",
    logoDataUrl: "",
    footerText: "Turbo Lev · Автосервіс",
  };
}

export function defaultDocumentTemplate(type: DocumentTemplateType): DocumentTemplate {
  return {
    type,
    title: type === "DIAGNOSTIC_CARD" ? "Діагностична карта" : "Комерційна пропозиція",
    description: type === "DIAGNOSTIC_CARD"
      ? "Результати проведеної діагностики автомобіля."
      : "Перелік робіт, запчастин і вартості ремонту.",
    status: "PUBLISHED",
    version: 1,
    style: defaultStyle(),
    blocks: BLOCKS[type].map((block) => ({ ...block })),
  };
}

export function normalizeDocumentTemplate(input: unknown, type: DocumentTemplateType): DocumentTemplate {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const styleSource = source.style && typeof source.style === "object" ? source.style as Record<string, unknown> : {};
  const base = defaultDocumentTemplate(type);
  const incomingBlocks = Array.isArray(source.blocks) ? source.blocks : [];
  const byId = new Map(incomingBlocks.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return [String(row.id || ""), row] as const;
  }));
  const blocks = base.blocks.map((block) => ({
    ...block,
    visible: byId.has(block.id) ? byId.get(block.id)?.visible !== false : block.visible,
  }));

  return {
    type,
    title: safeText(source.title, base.title, 120),
    description: safeText(source.description, base.description, 300),
    status: enumValue(source.status, STATUSES, base.status),
    version: Math.max(1, Math.min(9999, Number(source.version) || base.version)),
    style: {
      font: enumValue(styleSource.font, FONTS, base.style.font),
      accentColor: color(styleSource.accentColor, base.style.accentColor),
      textColor: color(styleSource.textColor, base.style.textColor),
      mutedColor: color(styleSource.mutedColor, base.style.mutedColor),
      background: enumValue(styleSource.background, BACKGROUNDS, base.style.background),
      backgroundColor: color(styleSource.backgroundColor, base.style.backgroundColor),
      backgroundImageDataUrl: image(styleSource.backgroundImageDataUrl, MAX_IMAGE_BYTES),
      logo: enumValue(styleSource.logo, LOGOS, base.style.logo),
      logoDataUrl: image(styleSource.logoDataUrl, MAX_IMAGE_BYTES),
      footerText: safeText(styleSource.footerText, base.style.footerText, 180),
    },
    blocks,
  };
}

export function normalizeDocumentTemplates(input: unknown): DocumentTemplate[] {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rows = Array.isArray(source.templates) ? source.templates : Array.isArray(input) ? input : [];
  return TEMPLATE_TYPES.map((type) => normalizeDocumentTemplate(rows.find((row) => {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
    return item.type === type;
  }), type));
}

export async function getDocumentTemplates(): Promise<DocumentTemplatesSettings> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<Array<{ value: unknown; updatedAt: Date }>>(
    `SELECT "value","updatedAt" FROM "CrmSetting" WHERE "key"=$1 LIMIT 1`,
    DOCUMENT_TEMPLATES_SETTING_KEY,
  );
  const row = rows[0];
  return { templates: normalizeDocumentTemplates(row?.value), updatedAt: row?.updatedAt?.toISOString() || null };
}

export async function saveDocumentTemplates(input: unknown): Promise<DocumentTemplatesSettings> {
  const templates = normalizeDocumentTemplates(input);
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CrmSetting" ("key","value","updatedAt") VALUES ($1,$2::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "updatedAt"=CURRENT_TIMESTAMP`,
    DOCUMENT_TEMPLATES_SETTING_KEY,
    JSON.stringify({ version: 1, templates }),
  );
  return getDocumentTemplates();
}
