import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { generateVehicleImageInBackground, optimizeVehicleImageAsset } from "./vehicle-image-background.service";
import { getVehicleImageLibraryState } from "./openai-library.service";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type VehicleImageLibraryAdminAsset = {
  id: string;
  libraryKey: string;
  make: string;
  model: string;
  year: number | null;
  bodyType: string | null;
  theme: string;
  provider: string;
  providerModel: string | null;
  promptVersion: string;
  status: string;
  reviewStatus: string;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  imageMimeType: string | null;
  imageSizeBytes: number | null;
  lastError: string | null;
  generatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  templateKey: string | null;
  variantKey: string | null;
  normalizedColor: string | null;
  generationFrom: number | null;
  generationTo: number | null;
  sourceAssetId: string | null;
  generationMode: string;
};

const ADMIN_COLUMNS = `"id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","status","reviewStatus","reviewedAt","reviewedByUserId","imageMimeType","imageSizeBytes","lastError","generatedAt","createdAt","updatedAt","templateKey","variantKey","normalizedColor","generationFrom","generationTo","sourceAssetId","generationMode"`;

function isMissingReviewColumns(error: unknown) {
  return error instanceof Error && /reviewStatus|reviewedAt|reviewedByUserId|templateKey|variantKey|normalizedColor|generationFrom|generationTo|sourceAssetId|generationMode|does not exist|42703|42P01/i.test(error.message);
}

export async function listVehicleImageLibraryAdmin(limit = 250): Promise<VehicleImageLibraryAdminAsset[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  try {
    const result = await getSqlPool().query(
      `SELECT ${ADMIN_COLUMNS}
       FROM public."VehicleImageLibraryAsset"
       ORDER BY "updatedAt" DESC
       LIMIT $1`,
      [safeLimit],
    );
    return result.rows as VehicleImageLibraryAdminAsset[];
  } catch (error) {
    if (isMissingReviewColumns(error)) return [];
    throw error;
  }
}

export async function getVehicleImageLibraryAdminAsset(assetId: string): Promise<VehicleImageLibraryAdminAsset | null> {
  const result = await getSqlPool().query(
    `SELECT ${ADMIN_COLUMNS} FROM public."VehicleImageLibraryAsset" WHERE "id"=$1 LIMIT 1`,
    [assetId],
  );
  return result.rowCount ? result.rows[0] as VehicleImageLibraryAdminAsset : null;
}

export async function approveVehicleImageLibraryAsset(assetId: string, userId: string | null) {
  const result = await getSqlPool().query(
    `UPDATE public."VehicleImageLibraryAsset"
       SET "reviewStatus"='APPROVED',
           "reviewedAt"=CURRENT_TIMESTAMP,
           "reviewedByUserId"=$2,
           "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1 AND "status"='READY'
     RETURNING ${ADMIN_COLUMNS}`,
    [assetId, userId],
  );
  if (!result.rowCount) throw new Error("Зображення не знайдено або воно ще не готове до затвердження.");
  return result.rows[0] as VehicleImageLibraryAdminAsset;
}

function assertPng(bytes: Buffer, mimeType: string) {
  if (!bytes.length) throw new Error("Файл порожній.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("PNG перевищує максимальний розмір 12 MB.");
  if (mimeType !== "image/png") throw new Error("Для бібліотеки дозволено лише PNG.");
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) throw new Error("Файл не є коректним PNG.");
}

export async function replaceVehicleImageLibraryAsset(assetId: string, bytes: Buffer, mimeType: string, userId: string | null) {
  assertPng(bytes, mimeType);
  const result = await getSqlPool().query(
    `UPDATE public."VehicleImageLibraryAsset"
       SET "provider"='MANUAL',
           "providerModel"=NULL,
           "status"='READY',
           "reviewStatus"='APPROVED',
           "reviewedAt"=CURRENT_TIMESTAMP,
           "reviewedByUserId"=$4,
           "imageMimeType"='image/png',
           "imageData"=$2,
           "imageSizeBytes"=$3,
           "lastError"=NULL,
           "generatedAt"=CURRENT_TIMESTAMP,
           "generationMode"='MANUAL',
           "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1
     RETURNING "id"`,
    [assetId, bytes, bytes.length, userId],
  );
  if (!result.rowCount) throw new Error("Зображення бібліотеки не знайдено.");

  // Delivery endpoint serves compact transparent WebP assets. Manual replacements
  // therefore pass through the same validated optimizer as OpenAI generations.
  await optimizeVehicleImageAsset(assetId);
  const optimized = await getVehicleImageLibraryAdminAsset(assetId);
  if (!optimized) throw new Error("Зображення бібліотеки не знайдено після оптимізації.");
  return optimized;
}

export async function regenerateVehicleImageLibraryAsset(assetId: string) {
  const asset = await getVehicleImageLibraryAdminAsset(assetId);
  if (!asset) throw new Error("Зображення бібліотеки не знайдено.");

  const prisma = getPrisma();
  const candidates = await prisma.vehicle.findMany({
    where: {
      brand: { equals: asset.make, mode: "insensitive" },
      model: { equals: asset.model, mode: "insensitive" },
      ...(asset.bodyType ? { bodyType: { equals: asset.bodyType, mode: "insensitive" } } : {}),
      ...(asset.generationFrom != null && asset.generationTo != null
        ? { year: { gte: asset.generationFrom, lte: asset.generationTo } }
        : asset.year == null ? {} : { year: asset.year }),
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 60,
  });

  let vehicleId: string | null = null;
  for (const candidate of candidates) {
    const state = await getVehicleImageLibraryState(candidate.id, asset.theme);
    if (state.libraryKey === asset.libraryKey) {
      vehicleId = candidate.id;
      break;
    }
  }

  if (!vehicleId) {
    throw new Error("У CRM немає автомобіля, що відповідає саме цьому поколінню та кольоровому варіанту. Додайте таке авто або замініть PNG вручну.");
  }

  await getSqlPool().query(
    `UPDATE public."VehicleImageLibraryAsset"
       SET "reviewStatus"='PENDING',"reviewedAt"=NULL,"reviewedByUserId"=NULL,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1`,
    [assetId],
  );

  return generateVehicleImageInBackground(vehicleId, { themePaint: asset.theme, force: true });
}
