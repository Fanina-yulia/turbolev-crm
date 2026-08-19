import { NextRequest, NextResponse } from "next/server";
import { resolveVehicleImage } from "@/src/services/vehicle-images/vehicle-image.service";
import {
  generateVehicleImageForVehicle,
  getVehicleImageLibraryState,
} from "@/src/services/vehicle-images/openai-library.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 100;

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

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const themePaint = request.nextUrl.searchParams.get("theme");
  try {
    const [image, library] = await Promise.all([
      resolveVehicleImage(id, { themePaint }),
      getVehicleImageLibraryState(id, themePaint),
    ]);
    return NextResponse.json(
      image
        ? { ok: true, image: publicImage(image), fallback: false, library }
        : { ok: true, image: null, fallback: true, library },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося підготувати зображення автомобіля." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(PERMISSIONS.CLIENTS_WRITE, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { themePaint?: string; force?: boolean };
  try {
    const generation = await generateVehicleImageForVehicle(id, {
      themePaint: body.themePaint,
      force: body.force === true,
    });
    const image = await resolveVehicleImage(id, { themePaint: body.themePaint });
    const library = await getVehicleImageLibraryState(id, body.themePaint);
    return NextResponse.json(
      { ok: true, generation, image: publicImage(image), fallback: !image, library },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image generation failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося згенерувати зображення автомобіля." },
      { status: 422 },
    );
  }
}
