import { NextRequest, NextResponse } from "next/server";
import { invalidateVehicleImages, resolveVehicleImage } from "@/src/services/vehicle-images/vehicle-image.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicImage(image: Awaited<ReturnType<typeof resolveVehicleImage>>) {
  if (!image) return null;
  return {
    assetId: image.assetId,
    vehicleId: image.vehicleId,
    provider: image.provider,
    proxyUrl: image.proxyUrl,
    confidence: image.confidence,
    angle: image.angle,
    requestedColor: image.requestedColor,
    status: image.status,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const themePaint = request.nextUrl.searchParams.get("theme");
  try {
    const image = await resolveVehicleImage(id, { themePaint });
    return NextResponse.json(
      image ? { ok: true, image: publicImage(image) } : { ok: true, image: null, fallback: true },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    console.error("vehicle image GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося підготувати зображення автомобіля." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { themePaint?: string };
  try {
    await invalidateVehicleImages(id);
    const image = await resolveVehicleImage(id, { themePaint: body.themePaint, force: true });
    return NextResponse.json({ ok: true, image: publicImage(image), fallback: !image }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle image refresh failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити зображення автомобіля." }, { status: 500 });
  }
}
