import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { getStructuredDiagnosticForMechanic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const AUTOMOTIVE_PROMPT = [
  "Це висновок автомеханіка українською мовою для CRM автосервісу.",
  "Зберігай технічний зміст, цифри, коди помилок, назви деталей, марки автомобілів та скорочення.",
  "Не вигадуй і не виправляй технічні факти.",
  "Слова, які можуть зустрічатися: підвіска, гальмівні диски, колодки, кульова опора, сайлентблок, ступичний підшипник, рульова тяга, ШРУС, амортизатор, підтікання, люфт, розвал-сходження, діагностика.",
].join(" ");

function responseMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  return typeof record.error === "object" && record.error && typeof (record.error as Record<string, unknown>).message === "string"
    ? String((record.error as Record<string, unknown>).message)
    : typeof record.message === "string" ? record.message : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED", message: "Голосовий висновок доступний лише механіку." }, { status: 403 });
    }

    // This also enforces that the diagnostic belongs to the caller's assigned work.
    const diagnostic = await getStructuredDiagnosticForMechanic(access.context.user.id, id);
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json({ ok: false, error: "AUDIO_REQUIRED", message: "Не знайдено аудіозапис." }, { status: 400 });
    }
    if (!audio.size || audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ ok: false, error: "AUDIO_TOO_LARGE", message: "Аудіозапис завеликий. Скоротіть запис і спробуйте ще раз." }, { status: 413 });
    }

    const credentials = await getIntegrationCredential("VEHICLE_IMAGES");
    const apiKey = credentials?.apiKey?.trim();
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_NOT_CONFIGURED", message: "Голосове розпізнавання не налаштоване. Введіть текст вручну." }, { status: 503 });
    }

    const upload = new FormData();
    upload.append("file", new File([await audio.arrayBuffer()], audio.name || "mechanic-voice-note.webm", { type: audio.type || "audio/webm" }));
    upload.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe");
    upload.append("response_format", "json");
    upload.append("prompt", AUTOMOTIVE_PROMPT);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upload,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) {
        console.error("OpenAI diagnostic voice transcription failed", { diagnosticRequestId: diagnostic.diagnostic.id, status: response.status, message: responseMessage(payload) });
        return NextResponse.json({ ok: false, error: "TRANSCRIPTION_FAILED", message: "Не вдалося розпізнати голос. Спробуйте ще раз або введіть текст вручну." }, { status: 502 });
      }
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!text) return NextResponse.json({ ok: false, error: "EMPTY_TRANSCRIPTION", message: "У записі не знайдено мовлення. Надиктуйте текст ще раз." }, { status: 422 });
      return NextResponse.json({ ok: true, text, language: String(form.get("language") || "uk") });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("Diagnostic voice transcription failed", { diagnosticRequestId: id, error });
    return NextResponse.json({ ok: false, error: "VOICE_TRANSCRIPTION_FAILED", message: "Не вдалося обробити аудіозапис. Введіть текст вручну або спробуйте ще раз." }, { status: 500 });
  }
}
