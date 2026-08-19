import { NextResponse } from "next/server";
import { getVehicleImageAsset, markVehicleImageFailure } from "@/src/services/vehicle-images/vehicle-image.service";
import { getVehicleLibraryAsset } from "@/src/services/vehicle-images/openai-library.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_LIBRARY_DELIVERY_BYTES = 100 * 1024;

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "image/webp,image/png,image/jpeg,image/*" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;

  const libraryAsset = await getVehicleLibraryAsset(assetId);
  if (libraryAsset && libraryAsset.mimeType === "image/webp" && libraryAsset.sizeBytes <= MAX_LIBRARY_DELIVERY_BYTES) {
    return new NextResponse(new Uint8Array(libraryAsset.bytes), {
      status: 200,
      headers: {
        "Content-Type": libraryAsset.mimeType,
        "Content-Length": String(libraryAsset.sizeBytes),
        "Cache-Control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Vehicle-Image-Provider": "OPENAI",
        "X-Vehicle-Image-Library": "1",
      },
    });
  }
  if (libraryAsset) {
    return NextResponse.json({ ok: false, error: "Зображення бібліотеки ще оптимізується." }, { status: 425, headers: { "Cache-Control": "no-store" } });
  }

  const asset = await getVehicleImageAsset(assetId);
  if (!asset?.sourceUrl || (asset.status !== "READY" && asset.status !== "MANUAL")) {
    return NextResponse.json({ ok: false, error: "Зображення не знайдено." }, { status: 404 });
  }

  try {
    const response = await fetchWithTimeout(asset.sourceUrl);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) {
      await markVehicleImageFailure(asset.id, `Provider HTTP ${response.status}; content-type=${contentType || "unknown"}`);
      return NextResponse.json({ ok: false, error: "Постачальник зображення тимчасово недоступний." }, { status: 502 });
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "X-Vehicle-Image-Provider": asset.provider,
      },
    });
  } catch (error) {
    await markVehicleImageFailure(asset.id, error instanceof Error ? error.message : "Vehicle image proxy failed");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити зображення автомобіля." }, { status: 502 });
  }
}
