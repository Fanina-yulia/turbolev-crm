import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const access = await authorize(PERMISSIONS.SETTINGS_READ, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const { id } = await context.params;
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 5);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 5, 20));

    const camera = await prisma.camera.findUnique({ where: { id }, select: { id: true } });
    if (!camera) return NextResponse.json({ ok: false, error: "Камеру не знайдено." }, { status: 404 });

    const events = await prisma.cameraEvent.findMany({
      where: { cameraId: id },
      orderBy: { detectedAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventType: true,
        source: true,
        plateNumber: true,
        plateNormalized: true,
        confidence: true,
        recognitionStatus: true,
        detectedAt: true,
        snapshotSize: true,
        snapshotMimeType: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      events: events.map((event) => ({
        ...event,
        hasSnapshot: Boolean(event.snapshotSize),
        snapshotSize: undefined,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/cameras/[id]/events failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити події камери." }, { status: 500 });
  }
}
