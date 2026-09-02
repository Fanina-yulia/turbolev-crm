import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { DEFAULT_CRM_APPEARANCE, normalizeCrmAppearance, type CrmAppearance } from "@/src/ui/appearance";

export const CRM_APPEARANCE_SETTING_KEY = "appearance";
const MAX_LOGO_BYTES = 512 * 1024;

type SettingRow = { value: unknown; updatedAt: Date };

function logoBytes(value: string) {
  const payload = value.split(",", 2)[1] || "";
  return Math.floor((payload.replace(/\s/g, "").length * 3) / 4);
}

export function validateCrmAppearance(input: unknown): CrmAppearance {
  const appearance = normalizeCrmAppearance(input);
  if (appearance.logoDataUrl) {
    const validDataUrl = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(appearance.logoDataUrl);
    if (!validDataUrl || logoBytes(appearance.logoDataUrl) > MAX_LOGO_BYTES) throw new Error("INVALID_LOGO");
  }
  return appearance;
}

export async function getCrmAppearance() {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<SettingRow[]>(
    `SELECT "value","updatedAt" FROM "CrmSetting" WHERE "key"=$1 LIMIT 1`,
    CRM_APPEARANCE_SETTING_KEY,
  );
  const row = rows[0];
  return {
    appearance: row ? validateCrmAppearance(row.value) : DEFAULT_CRM_APPEARANCE,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function saveCrmAppearance(input: unknown) {
  const appearance = validateCrmAppearance(input);
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CrmSetting" ("key","value","updatedAt") VALUES ($1,$2::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "updatedAt"=CURRENT_TIMESTAMP`,
    CRM_APPEARANCE_SETTING_KEY,
    JSON.stringify(appearance),
  );
  return appearance;
}
