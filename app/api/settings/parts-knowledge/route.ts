import { NextRequest, NextResponse } from "next/server";
import { getGoogleSheetsKnowledgeConfig } from "@/src/services/parts-knowledge-google-sheets.service";
import { seedStaticPartKnowledge } from "@/src/services/parts-knowledge.service";
import { getPartsKnowledgeStats } from "@/src/services/parts-knowledge-sync.service";
import { syncPartsKnowledgeFromGoogleSheets } from "@/src/services/parts-knowledge-sync.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_READ, {
    request,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  const config = getGoogleSheetsKnowledgeConfig();
  try {
    const stats = await getPartsKnowledgeStats();
    return NextResponse.json({
      ok: true,
      schemaReady: true,
      googleSheets: {
        configured: config.configured,
        mode: config.mode,
        spreadsheetId: config.spreadsheetId,
        reason: config.reason,
      },
      stats,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/parts-knowledge failed", error);
    return NextResponse.json({
      ok: true,
      schemaReady: false,
      googleSheets: {
        configured: config.configured,
        mode: config.mode,
        spreadsheetId: config.spreadsheetId,
        reason: config.reason,
      },
      stats: null,
      message: "Таблиці каталогу ще не застосовані до бази CRM.",
    }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_WRITE, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    // Empty body means the default action: synchronize the configured sheet.
  }

  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "SYNC_GOOGLE_SHEETS";
  try {
    if (action === "SEED_DEFAULTS") {
      const result = await seedStaticPartKnowledge();
      return NextResponse.json({
        ok: true,
        status: "SEEDED",
        message: "Базові канонічні групи та синоніми додані до CRM.",
        result,
      });
    }

    if (action === "SYNC_GOOGLE_SHEETS") {
      const result = await syncPartsKnowledgeFromGoogleSheets();
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    return NextResponse.json({ ok: false, error: "Невідома дія каталогу." }, { status: 400 });
  } catch (error) {
    console.error("POST /api/settings/parts-knowledge failed", error);
    return NextResponse.json({
      ok: false,
      status: "FAILED",
      message: error instanceof Error ? error.message : "Операція каталогу завершилася помилкою.",
    }, { status: 500 });
  }
}
