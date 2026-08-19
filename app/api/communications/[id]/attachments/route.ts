import { NextRequest, NextResponse } from "next/server";
import { createCommunicationImage } from "@/src/services/communication-attachments.service";

export const runtime = "nodejs";
export const maxDuration = 30;

function statusForError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  if (code === "INQUIRY_NOT_FOUND") return 404;
  if (code === "ATTACHMENT_TYPE_NOT_ALLOWED") return 415;
  if (code === "ATTACHMENT_TOO_LARGE") return 413;
  if (code === "ATTACHMENT_EMPTY") return 400;
  return 500;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Оберіть зображення." }, { status: 400 });
    }
    const attachment = await createCommunicationImage({
      inquiryId: id,
      file,
      origin: request.nextUrl.origin,
    });
    return NextResponse.json({ ok: true, attachment });
  } catch (error) {
    console.error("POST communication attachment failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося завантажити зображення." },
      { status: statusForError(error) },
    );
  }
}
