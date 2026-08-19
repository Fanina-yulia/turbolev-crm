import { NextResponse } from "next/server";
import { getVehicleImageAsset, markVehicleImageFailure } from "@/src/services/vehicle-images/vehicle-image.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
