import { getPrisma } from "@/src/lib/prisma";

export const DEFAULT_MARKUP_PERCENT = 40;

type SettingRow = { value: unknown };

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function percentage(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : fallback;
}

/** Shared CRM rule used by supplier search, quotes and supplier orders. */
export async function getConfiguredPartsMarkupPercent() {
  try {
    const rows = await getPrisma().$queryRawUnsafe<SettingRow[]>(
      `SELECT "value" FROM "CrmSetting" WHERE "key"='markup' LIMIT 1`,
    );
    return percentage(objectValue(rows[0]?.value).defaultPartsPercent, DEFAULT_MARKUP_PERCENT);
  } catch (error) {
    console.warn("Parts markup settings unavailable; using default", error);
    return DEFAULT_MARKUP_PERCENT;
  }
}

export function calculateSellPrice(purchasePrice: number, markupPercent = DEFAULT_MARKUP_PERCENT) {
  return Math.round(purchasePrice * (1 + markupPercent / 100) * 100) / 100;
}
