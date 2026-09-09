import sharp from "sharp";

export type VehicleDocumentImage = {
  bytes: Uint8Array;
  mimeType: "image/png";
  source: "LIBRARY" | "MANUAL";
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

async function fetchImage(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "image/png,image/jpeg,image/webp,image/*" },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) return null;
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

async function toPng(bytes: Uint8Array) {
  return sharp(Buffer.from(bytes), { failOn: "none" })
    .rotate()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/**
 * Resolves the vehicle-specific image already associated with the CRM vehicle.
 * It deliberately does not start a new generation while a PDF is rendering:
 * a document must remain fast and deterministic, so the caller can use its
 * neutral fallback when the model image is not ready yet.
 */
export async function getVehicleDocumentImage(vehicleId: string): Promise<VehicleDocumentImage | null> {
  try {
    // Keep the DB-backed vehicle image services lazy. This service is also used by
    // the standalone PDF smoke renderers, where server-only modules are not loaded.
    const [{ getVehicleLibraryAsset }, { getVehicleImageAsset, resolveVehicleImage }] = await Promise.all([
      import("./openai-library.service"),
      import("./vehicle-image.service"),
    ]);
    const resolved = await resolveVehicleImage(vehicleId, { themePaint: "Imagin-grey" });
    if (!resolved) return null;

    if (resolved.provider === "OPENAI") {
      const libraryAsset = await getVehicleLibraryAsset(resolved.assetId);
      if (!libraryAsset?.bytes) return null;
      return { bytes: await toPng(libraryAsset.bytes), mimeType: "image/png", source: "LIBRARY" };
    }

    const manualAsset = await getVehicleImageAsset(resolved.assetId);
    const sourceUrl = manualAsset?.sourceUrl || resolved.sourceUrl;
    if (!sourceUrl) return null;
    const sourceBytes = await fetchImage(sourceUrl);
    if (!sourceBytes) return null;
    return { bytes: await toPng(sourceBytes), mimeType: "image/png", source: "MANUAL" };
  } catch (error) {
    console.warn("vehicle document image resolution failed", {
      vehicleId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
