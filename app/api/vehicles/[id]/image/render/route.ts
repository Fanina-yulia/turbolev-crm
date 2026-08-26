import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { markVehicleImageFailure, resolveVehicleImage } from "@/src/services/vehicle-images/vehicle-image.service";
import { enqueueVehicleImageGeneration, getVehicleLibraryAsset } from "@/src/services/vehicle-images/openai-library.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function imageFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "image/webp,image/png,image/jpeg,image/*" } });
  } finally {
    clearTimeout(timeout);
  }
}

function missingImageResponse() {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Vehicle-Image-Missing": "1",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const themePaint = request.nextUrl.searchParams.get("theme");

  try {
    const image = await resolveVehicleImage(id, { themePaint });
    if (!image) {
      // Rendering a card only registers missing work for the queue. It never
      // starts a remote generation during the user's request.
      after(async () => {
        await enqueueVehicleImageGeneration(id, { themePaint }).catch((error) => {
          console.warn("vehicle image render queue registration failed", {
            vehicleId: id,
            message: error instanceof Error ? error.message : "unknown error",
          });
        });
      });
      return missingImageResponse();
    }

    if (image.provider === "OPENAI") {
      const libraryAsset = await getVehicleLibraryAsset(image.assetId);
      if (!libraryAsset) return missingImageResponse();
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

    const response = await imageFetch(image.sourceUrl);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) {
      await markVehicleImageFailure(image.assetId, `Provider HTTP ${response.status}; content-type=${contentType || "unknown"}`);
      return missingImageResponse();
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "X-Vehicle-Image-Provider": image.provider,
      },
    });
  } catch (error) {
    console.error("vehicle image render failed", error);
    return missingImageResponse();
  }
}
