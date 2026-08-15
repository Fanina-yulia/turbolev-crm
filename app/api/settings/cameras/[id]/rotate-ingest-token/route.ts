import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { generateCameraIngestToken, hashCameraIngestToken } from "@/src/services/camera-ingest-token.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const prisma = getPrisma();
  try {
    const { id } = await context.params;
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) return NextResponse.json({ ok: false, error: "Камеру не знайдено." }, { status: 404 });
    if (camera.connectionMode !== "EMAIL_EVENTS") {
      return NextResponse.json({ ok: false, error: "Email-ключ доступний лише для режиму Email Events." }, { status: 409 });
    }

    const ingestToken = generateCameraIngestToken();
    await prisma.camera.update({
      where: { id },
      data: {
        ingestTokenHash: hashCameraIngestToken(ingestToken),
        status: "NOT_TESTED",
        lastTestMessage: "Ключ Email Events оновлено. Очікуємо наступний лист від Reolink.",
      },
    });

    return NextResponse.json({ ok: true, ingestToken, ingestEndpoint: "/api/camera-events/email" });
  } catch (error) {
    console.error("POST /api/settings/cameras/[id]/rotate-ingest-token failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити ключ Email Events." }, { status: 500 });
  }
}
