import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getCrmAppearance, saveCrmAppearance } from "@/src/services/appearance.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.SETTINGS_READ, { request, minimumScope: "ALL" });
  if (!access.allowed) return access.response!;
  try {
    const result = await getCrmAppearance();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/appearance failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити глобальне оформлення CRM." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const access = await authorize(PERMISSIONS.SETTINGS_WRITE, { request, minimumScope: "ALL" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const appearance = await saveCrmAppearance(body.appearance ?? body);
    return NextResponse.json({ ok: true, appearance }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_LOGO") return NextResponse.json({ ok: false, error: "Логотип має бути PNG, JPG або WebP до 512 КБ." }, { status: 400 });
    console.error("PUT /api/settings/appearance failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося зберегти глобальне оформлення CRM." }, { status: 500 });
  }
}

