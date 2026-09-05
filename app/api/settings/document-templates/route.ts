import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getDocumentTemplates, saveDocumentTemplates } from "@/src/services/document-template.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.SETTINGS_READ, { request, minimumScope: "ALL" });
  if (!access.allowed) return access.response!;
  try {
    return NextResponse.json({ ok: true, ...(await getDocumentTemplates()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/document-templates failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити шаблони документів." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const access = await authorize(PERMISSIONS.SETTINGS_WRITE, { request, minimumScope: "ALL" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json().catch(() => ({})) as { templates?: unknown };
    return NextResponse.json({ ok: true, ...(await saveDocumentTemplates(body.templates ?? body)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_DOCUMENT_IMAGE") {
      return NextResponse.json({ ok: false, error: "Зображення документа має бути PNG, JPG або WebP розміром до 1 МБ." }, { status: 400 });
    }
    console.error("PUT /api/settings/document-templates failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося зберегти шаблони документів." }, { status: 500 });
  }
}
