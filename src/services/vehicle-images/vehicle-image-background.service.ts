import sharp from "sharp";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import {
  generateVehicleImageForVehicle,
  getOpenAIVehicleImageConfig,
  getVehicleImageLibraryState,
} from "./openai-library.service";
import { normalizeThemePaint } from "./vehicle-color.service";
import { getOpenAIVehiclePaint } from "./openai-vehicle-paint";

const TARGET_IMAGE_BYTES = 100 * 1024;
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const FALLBACK_MAX_BYTES = 16 * 1024 * 1024;

type ImageRow = {
  id: string;
  status: string;
  imageMimeType: string | null;
  imageData: Buffer | null;
  imageSizeBytes: number | null;
};

type BackgroundOptions = {
  themePaint?: string | null;
  force?: boolean;
};

type OpenAIImageConfig = NonNullable<Awaited<ReturnType<typeof getOpenAIVehicleImageConfig>>>;

const OPTIMIZATION_PROFILES = [
  { width: 1024, quality: 70, alphaQuality: 82 },
  { width: 960, quality: 64, alphaQuality: 78 },
  { width: 900, quality: 58, alphaQuality: 74 },
  { width: 840, quality: 52, alphaQuality: 70 },
  { width: 760, quality: 46, alphaQuality: 66 },
  { width: 680, quality: 40, alphaQuality: 62 },
  { width: 600, quality: 34, alphaQuality: 58 },
  { width: 520, quality: 28, alphaQuality: 54 },
  { width: 440, quality: 22, alphaQuality: 50 },
  { width: 360, quality: 18, alphaQuality: 46 },
] as const;

function isWebp(bytes: Buffer) {
  return bytes.length >= 12
    && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP";
}

function isTransparentBackgroundCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /transparent background is not supported for this model/i.test(message);
}

function openAIErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const nested = (payload as { error?: unknown }).error;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function buildCompatibilityPrompt(vehicleId: string, themePaint?: string | null) {
  const vehicle = await getPrisma().vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      brand: true,
      model: true,
      year: true,
      bodyType: true,
      exteriorColorName: true,
      exteriorColorHex: true,
      exteriorPaintCode: true,
      exteriorColorSource: true,
      exteriorColorConfirmed: true,
    },
  });
  if (!vehicle?.brand?.trim() || !vehicle.model?.trim()) {
    throw new Error("Для резервної генерації потрібні марка і модель автомобіля.");
  }
  const identity = [vehicle.brand.trim(), vehicle.model.trim(), vehicle.year || null, vehicle.bodyType?.trim() || null]
    .filter(Boolean)
    .join(" ");
  const theme = normalizeThemePaint(themePaint, "Imagin-grey");
  const paint = getOpenAIVehiclePaint({
    exteriorColorName: vehicle.exteriorColorName,
    exteriorColorHex: vehicle.exteriorColorHex,
    exteriorPaintCode: vehicle.exteriorPaintCode,
    exteriorColorSource: vehicle.exteriorColorSource ? String(vehicle.exteriorColorSource) : null,
    exteriorColorConfirmed: vehicle.exteriorColorConfirmed,
  }, theme);
  return [
    "Create exactly one photorealistic production vehicle cutout for a professional automotive service CRM card.",
    `Vehicle: ${identity}.`,
    "Match the real production generation, silhouette, body proportions, roofline, lights, grille, bumpers, wheel arches, glazing and door layout as closely as possible.",
    "Show the complete vehicle, facing right, in a clean front three-quarter side view, centered, with all tires visible and no cropping.",
    paint.instruction,
    "Compatibility background rule: render the entire background as one perfectly uniform pure chroma-key magenta color #FF00FF.",
    "The magenta background must contain no floor, no road, no scenery, no studio wall, no gradient, no texture, no cast shadow and no reflected objects.",
    "Do not use magenta anywhere on the vehicle itself. Do not add people, text, captions, watermarks or readable license-plate text.",
    "Use a blank neutral plate area. Keep the vehicle edges clean and catalog-like. The magenta background will be removed programmatically after generation.",
  ].join(" ");
}

async function requestCompatibilityPng(config: OpenAIImageConfig, prompt: string) {
  const response = await fetchWithTimeout(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      size: config.imageSize,
      quality: config.quality,
      output_format: "png",
    }),
  }, 90_000);

  const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }> } | null;
  if (!response.ok) {
    throw new Error(openAIErrorMessage(payload, `OpenAI Images API: HTTP ${response.status}`));
  }

  const item = payload?.data?.[0];
  let bytes: Buffer | null = null;
  if (item?.b64_json) {
    bytes = Buffer.from(item.b64_json, "base64");
  } else if (item?.url) {
    const imageResponse = await fetchWithTimeout(item.url, { headers: { Accept: "image/png,image/*" } }, 30_000);
    if (!imageResponse.ok) throw new Error(`Не вдалося завантажити резервний PNG: HTTP ${imageResponse.status}`);
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  }

  if (!bytes?.length) throw new Error("OpenAI не повернув байти резервного зображення.");
  if (bytes.length > FALLBACK_MAX_BYTES) throw new Error(`Резервний PNG завеликий: ${Math.ceil(bytes.length / 1024)} КБ.`);
  return bytes;
}

async function convertChromaKeyToTransparentPng(source: Buffer) {
  const decoded = await sharp(source, { failOn: "none" })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = decoded.data;
  const { width, height, channels } = decoded.info;
  if (!width || !height || channels !== 4) throw new Error("Не вдалося декодувати резервний PNG у RGBA.");

  let alreadyTransparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 245) alreadyTransparent += 1;
  }
  const pixels = width * height;
  if (alreadyTransparent / Math.max(1, pixels) > 0.01) {
    return sharp(data, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  }

  let removed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const originalAlpha = data[i + 3];
    const distance = Math.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2);

    if (distance <= 52) {
      data[i + 3] = 0;
      removed += 1;
      continue;
    }
    if (distance < 132) {
      const edgeAlpha = Math.max(0, Math.min(255, Math.round(((distance - 52) / 80) * 255)));
      data[i + 3] = Math.min(originalAlpha, edgeAlpha);
      if (data[i + 3] < 245) removed += 1;
    }
  }

  if (removed / Math.max(1, pixels) < 0.08) {
    throw new Error("OpenAI не дотримався однотонного chroma-key фону; безпечне видалення фону неможливе.");
  }

  const output = await sharp(data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const metadata = await sharp(output, { failOn: "none" }).metadata();
  if (!metadata.hasAlpha) throw new Error("Після chroma-key обробки PNG не має alpha-каналу.");
  return output;
}

async function generateVehicleImageWithCompatibilityFallback(vehicleId: string, options?: BackgroundOptions) {
  try {
    return await generateVehicleImageForVehicle(vehicleId, {
      themePaint: options?.themePaint,
      force: options?.force === true,
    });
  } catch (error) {
    if (!isTransparentBackgroundCompatibilityError(error)) throw error;

    const [config, state] = await Promise.all([
      getOpenAIVehicleImageConfig(),
      getVehicleImageLibraryState(vehicleId, options?.themePaint),
    ]);
    if (!config || !state.assetId || !state.libraryKey) throw error;

    try {
      const prompt = await buildCompatibilityPrompt(vehicleId, options?.themePaint);
      const generated = await requestCompatibilityPng(config, prompt);
      const transparent = await convertChromaKeyToTransparentPng(generated);
      await getSqlPool().query(
        `UPDATE public."VehicleImageLibraryAsset"
            SET "provider"='OPENAI',
                "providerModel"=$2,
                "status"='READY',
                "imageMimeType"='image/png',
                "imageData"=$3,
                "imageSizeBytes"=$4,
                "lastError"=NULL,
                "generatedAt"=CURRENT_TIMESTAMP,
                "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1`,
        [state.assetId, config.model, transparent, transparent.length],
      );
      return { state: "READY" as const, assetId: state.assetId, libraryKey: state.libraryKey, compatibilityFallback: true };
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : "Помилка сумісної генерації зображення.";
      await getSqlPool().query(
        `UPDATE public."VehicleImageLibraryAsset"
            SET "status"='ERROR',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1`,
        [state.assetId, message.slice(0, 4000)],
      ).catch(() => undefined);
      throw fallbackError;
    }
  }
}

async function loadAsset(assetId: string): Promise<ImageRow | null> {
  const result = await getSqlPool().query(
    `SELECT "id","status","imageMimeType","imageData","imageSizeBytes"
       FROM public."VehicleImageLibraryAsset"
      WHERE "id"=$1
      LIMIT 1`,
    [assetId],
  );
  return result.rowCount ? result.rows[0] as ImageRow : null;
}

function assetIsDeliveryReady(asset: ImageRow | null) {
  if (!asset || asset.status !== "READY" || !asset.imageData?.length) return false;
  const sizeBytes = asset.imageSizeBytes ?? asset.imageData.length;
  return asset.imageMimeType === "image/webp" && sizeBytes <= TARGET_IMAGE_BYTES && isWebp(Buffer.from(asset.imageData));
}

export async function getVehicleImageDeliveryState(vehicleId: string, themePaint?: string | null) {
  const state = await getVehicleImageLibraryState(vehicleId, themePaint);
  if (state.state !== "READY" || !state.assetId) return { ...state, needsOptimization: false };

  const asset = await loadAsset(state.assetId);
  // A READY asset may still be the original PNG or be larger than the compact
  // delivery target. It is already usable by the browser, so do not hide it
  // behind a GENERATING placeholder while the background optimizer runs.
  if (asset?.status === "READY" && asset.imageData?.length) {
    return { ...state, needsOptimization: !assetIsDeliveryReady(asset) };
  }

  return {
    ...state,
    state: "MISSING" as const,
    needsOptimization: false,
    error: null,
  };
}

async function rejectOverweightAsset(assetId: string, message: string) {
  await getSqlPool().query(
    `UPDATE public."VehicleImageLibraryAsset"
        SET "status"='ERROR',
            "imageData"=NULL,
            "imageSizeBytes"=NULL,
            "lastError"=$2,
            "updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1`,
    [assetId, message.slice(0, 4000)],
  ).catch(() => undefined);
}

export async function optimizeVehicleImageAsset(assetId: string) {
  const asset = await loadAsset(assetId);
  if (!asset || asset.status !== "READY" || !asset.imageData?.length) {
    return { optimized: false, sizeBytes: asset?.imageSizeBytes ?? null, reason: "NOT_READY" as const };
  }

  const source = Buffer.from(asset.imageData);
  if (assetIsDeliveryReady(asset)) {
    return { optimized: false, sizeBytes: source.length, reason: "ALREADY_WITHIN_LIMIT" as const };
  }

  try {
    const sourceMetadata = await sharp(source, { failOn: "none" }).metadata();
    if (!sourceMetadata.hasAlpha) {
      throw new Error("Зображення автомобіля не має прозорого alpha-каналу і не може бути збережене в бібліотеку CRM.");
    }

    let smallest: Buffer | null = null;
    for (const profile of OPTIMIZATION_PROFILES) {
      const output = await sharp(source, { failOn: "none" })
        .rotate()
        .resize({
          width: profile.width,
          height: Math.round(profile.width * 0.75),
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({
          quality: profile.quality,
          alphaQuality: profile.alphaQuality,
          effort: 6,
          smartSubsample: true,
        })
        .toBuffer();

      if (!smallest || output.length < smallest.length) smallest = output;
      if (output.length > TARGET_IMAGE_BYTES) continue;

      const finalMetadata = await sharp(output, { failOn: "none" }).metadata();
      if (!finalMetadata.hasAlpha || !isWebp(output)) {
        throw new Error("Оптимізований файл втратив прозорість або формат WebP.");
      }

      await getSqlPool().query(
        `UPDATE public."VehicleImageLibraryAsset"
            SET "imageMimeType"='image/webp',
                "imageData"=$2,
                "imageSizeBytes"=$3,
                "lastError"=NULL,
                "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1`,
        [assetId, output, output.length],
      );

      return {
        optimized: true,
        sizeBytes: output.length,
        width: finalMetadata.width ?? null,
        height: finalMetadata.height ?? null,
        targetBytes: TARGET_IMAGE_BYTES,
      };
    }

    const smallestKb = smallest ? Math.ceil(smallest.length / 1024) : null;
    throw new Error(`Не вдалося стиснути зображення до 100 КБ${smallestKb ? `; мінімальний результат ${smallestKb} КБ` : ""}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося оптимізувати зображення автомобіля до 100 КБ.";
    await rejectOverweightAsset(assetId, message);
    throw error;
  }
}

export async function generateVehicleImageInBackground(vehicleId: string, options?: BackgroundOptions) {
  const initialState = await getVehicleImageDeliveryState(vehicleId, options?.themePaint);
  if (!initialState.libraryKey) {
    return {
      state: initialState.state,
      assetId: initialState.assetId,
      libraryKey: initialState.libraryKey,
      error: initialState.error,
    };
  }

  const pool = getSqlPool();
  const client = await pool.connect();
  const lockName = `vehicle-image-library:${initialState.libraryKey}`;
  let locked = false;

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockName],
    );
    locked = Boolean(lockResult.rows[0]?.locked);

    if (!locked) {
      const state = await getVehicleImageDeliveryState(vehicleId, options?.themePaint);
      return {
        state: "GENERATING" as const,
        assetId: state.assetId,
        libraryKey: state.libraryKey,
        deduplicated: true,
      };
    }

    const rechecked = await getVehicleImageDeliveryState(vehicleId, options?.themePaint);
    if (rechecked.state === "READY" && rechecked.assetId && !options?.force) {
      const optimization = await optimizeVehicleImageAsset(rechecked.assetId);
      return { state: "READY" as const, assetId: rechecked.assetId, libraryKey: rechecked.libraryKey, optimization, reused: true };
    }

    const generation = await generateVehicleImageWithCompatibilityFallback(vehicleId, {
      ...options,
      // A library row without delivery bytes is not reusable, even if its
      // status column still says READY. Rebuild that asset instead of leaving
      // the vehicle permanently without an image.
      force: options?.force === true || (rechecked.state === "MISSING" && Boolean(rechecked.assetId)),
    });

    if (generation.state !== "READY" || !generation.assetId) return generation;

    const optimization = await optimizeVehicleImageAsset(generation.assetId);
    return { ...generation, optimization };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined);
    client.release();
  }
}

export async function ensureExistingVehicleImageUnderLimit(assetId: string | null | undefined) {
  if (!assetId) return null;
  return optimizeVehicleImageAsset(assetId);
}
