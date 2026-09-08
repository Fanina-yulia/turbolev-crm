import { NextRequest, NextResponse } from "next/server";
import { getGoogleSheetsKnowledgeConfig } from "@/src/services/parts-knowledge-google-sheets.service";
import { getPartsKnowledgeStats, syncPartsKnowledgeFromGoogleSheets } from "@/src/services/parts-knowledge-sync.service";
import {
  dualWritePartsKnowledge,
  PartsKnowledgeValidationError,
  retryPartsKnowledgeDualWrite,
  seedPartsKnowledgeDualWrite,
} from "@/src/services/parts-knowledge-dual-write.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function dualWriteHttpStatus(status: string) {
  if (status === "SUCCEEDED") return 200;
  if (status === "IN_PROGRESS") return 202;
  if (status === "PARTIAL") return 207;
  return 409;
}

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

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    body = {};
  }

  const action = typeof body.action === "string"
    ? body.action.trim().toUpperCase()
    : "";

  if (!action) {
    return NextResponse.json({
      ok: false,
      error: "Вкажіть action. Звичайний запис каталогу виконується через UPSERT_DUAL.",
    }, { status: 400 });
  }

  try {
    if (action === "UPSERT_DUAL" || action === "UPSERT_PARTS_KNOWLEDGE") {
      const input = body.input ?? body;
      const result = await dualWritePartsKnowledge(input);
      return NextResponse.json(result, { status: dualWriteHttpStatus(result.status) });
    }

    if (action === "RETRY_DUAL_WRITE") {
      const operationId = body.operationId ?? body.operationKey;
      const result = await retryPartsKnowledgeDualWrite(operationId);
      return NextResponse.json(result, { status: dualWriteHttpStatus(result.status) });
    }

    if (action === "SEED_DEFAULTS") {
      const result = await seedPartsKnowledgeDualWrite();
      return NextResponse.json({
        ok: true,
        status: "SEEDED",
        message: "Повний каталог діагностичних деталей і відповідностей записано до CRM та Google Sheets.",
        result,
      });
    }

    if (action === "SYNC_GOOGLE_SHEETS") {
      const result = await syncPartsKnowledgeFromGoogleSheets();
      return NextResponse.json({
        ...result,
        warning: "Це legacy-імпорт, він не запускається автоматично. Звичайні зміни записуються паралельно через UPSERT_DUAL.",
      }, { status: result.ok ? 200 : 409 });
    }

    return NextResponse.json({ ok: false, error: "Невідома дія каталогу." }, { status: 400 });
  } catch (error) {
    if (error instanceof PartsKnowledgeValidationError) {
      return NextResponse.json({
        ok: false,
        status: "INVALID_INPUT",
        message: error.message,
      }, { status: 400 });
    }
    console.error("POST /api/settings/parts-knowledge failed", error);
    return NextResponse.json({
      ok: false,
      status: "FAILED",
      message: error instanceof Error ? error.message : "Операція каталогу завершилася помилкою.",
    }, { status: 500 });
  }
}
