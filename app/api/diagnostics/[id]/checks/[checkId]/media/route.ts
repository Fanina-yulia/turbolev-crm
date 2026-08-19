import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { addDiagnosticMedia, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string; checkId: string }> }) {
  const { id, checkId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "FILE_REQUIRED", message: "Оберіть фото дефекту." }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: "UNSUPPORTED_FILE", message: "Доступні JPG, PNG або WEBP." }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "FILE_TOO_LARGE", message: "Максимальний розмір фото — 4 МБ." }, { status: 413 });
    const data = Buffer.from(await file.arrayBuffer());
    const media = await addDiagnosticMedia(access.context.user.id, id, checkId, { name: file.name || "diagnostic-photo.jpg", type: file.type, size: file.size, data });
    return NextResponse.json({ ok: true, media });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("POST diagnostic media failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_MEDIA_UPLOAD_FAILED" }, { status: 500 });
  }
}
