import { after, NextRequest, NextResponse } from "next/server";
import { resolveVehicleImage } from "@/src/services/vehicle-images/vehicle-image.service";
import {
  generateVehicleImageInBackground,
  getVehicleImageDeliveryState,
} from "@/src/services/vehicle-images/vehicle-image-background.service";
import { enqueueVehicleImageGeneration } from "@/src/services/vehicle-images/openai-library.service";
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

function scheduleBackground(vehicleId: string, themePaint: string | null, force = false) {
  after(async () => {
    try {
      await generateVehicleImageInBackground(vehicleId, { themePaint, force });
    } catch (error) {
      console.error("background vehicle image generation failed", {
        vehicleId,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

function scheduleQueue(vehicleId: string, themePaint: string | null, force = false) {
  after(async () => {
    try {
      await enqueueVehicleImageGeneration(vehicleId, { themePaint, force });
    } catch (error) {
      console.error("vehicle image queue registration failed", {
        vehicleId,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const themePaint = request.nextUrl.searchParams.get("theme");
  try {
    const [image, library] = await Promise.all([
      resolveVehicleImage(id, { themePaint }),
      getVehicleImageDeliveryState(id, themePaint),
    ]);

    if (library.state === "GENERATING" && library.needsOptimization) {
      scheduleBackground(id, themePaint);
    }
    if (library.state === "MISSING" && library.autoGenerate && library.canGenerate) {
      scheduleQueue(id, themePaint);
    }

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
  const themePaint = body.themePaint || null;
  const force = body.force === true;

  try {
    const [image, library] = await Promise.all([
      resolveVehicleImage(id, { themePaint }),
      getVehicleImageDeliveryState(id, themePaint),
    ]);

    if (library.state === "READY" && image && !force) {
      return NextResponse.json(
        { ok: true, generation: { state: "READY", assetId: library.assetId, libraryKey: library.libraryKey }, image: publicImage(image), fallback: false, library },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (library.state === "GENERATING" && !force) {
      if (library.needsOptimization) scheduleBackground(id, themePaint);
      return NextResponse.json(
        { ok: true, generation: { state: "GENERATING", assetId: library.assetId, libraryKey: library.libraryKey }, image: publicImage(image), fallback: !image, library },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (library.state === "ERROR" && !force) {
      return NextResponse.json(
        { ok: false, error: library.error || "Попередня генерація завершилась помилкою.", library },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (library.state === "NOT_CONFIGURED" || library.state === "MISSING_DATA" || !library.canGenerate) {
      return NextResponse.json(
        { ok: false, error: library.error || "Генерація зображення недоступна.", library },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }

    scheduleQueue(id, themePaint, force);

    return NextResponse.json(
      {
        ok: true,
        generation: { state: "GENERATING", assetId: library.assetId, libraryKey: library.libraryKey, background: true },
        image: publicImage(image),
        fallback: !image,
        library: { ...library, state: "GENERATING" },
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image generation enqueue failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося поставити зображення автомобіля в генерацію." },
      { status: 422 },
    );
  }
}
