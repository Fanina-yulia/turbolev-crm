import sharp from "sharp";
import { getSqlPool } from "@/src/lib/sql";
import {
  generateVehicleImageForVehicle,
  getVehicleImageLibraryState,
} from "./openai-library.service";

const TARGET_IMAGE_BYTES = 100 * 1024;

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
  if (isWebp(source) && source.length <= TARGET_IMAGE_BYTES) {
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
  const initialState = await getVehicleImageLibraryState(vehicleId, options?.themePaint);
  if (initialState.state === "READY" && initialState.assetId && !options?.force) {
    const optimization = await optimizeVehicleImageAsset(initialState.assetId);
    return { state: "READY" as const, assetId: initialState.assetId, libraryKey: initialState.libraryKey, optimization };
  }
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
      const state = await getVehicleImageLibraryState(vehicleId, options?.themePaint);
      return {
        state: "GENERATING" as const,
        assetId: state.assetId,
        libraryKey: state.libraryKey,
        deduplicated: true,
      };
    }

    const rechecked = await getVehicleImageLibraryState(vehicleId, options?.themePaint);
    if (rechecked.state === "READY" && rechecked.assetId && !options?.force) {
      const optimization = await optimizeVehicleImageAsset(rechecked.assetId);
      return { state: "READY" as const, assetId: rechecked.assetId, libraryKey: rechecked.libraryKey, optimization, reused: true };
    }

    const generation = await generateVehicleImageForVehicle(vehicleId, {
      themePaint: options?.themePaint,
      force: options?.force === true,
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
