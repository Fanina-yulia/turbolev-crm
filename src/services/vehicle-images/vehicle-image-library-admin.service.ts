import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { generateVehicleImageForVehicle } from "./openai-library.service";

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
};

const ADMIN_COLUMNS = `"id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","status","reviewStatus","reviewedAt","reviewedByUserId","imageMimeType","imageSizeBytes","lastError","generatedAt","createdAt","updatedAt"`;

function isMissingReviewColumns(error: unknown) {
  return error instanceof Error && /reviewStatus|reviewedAt|reviewedByUserId|does not exist|42703|42P01/i.test(error.message);
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
           "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1
     RETURNING ${ADMIN_COLUMNS}`,
    [assetId, bytes, bytes.length, userId],
  );
  if (!result.rowCount) throw new Error("Зображення бібліотеки не знайдено.");
  return result.rows[0] as VehicleImageLibraryAdminAsset;
}

export async function regenerateVehicleImageLibraryAsset(assetId: string) {
  const asset = await getVehicleImageLibraryAdminAsset(assetId);
  if (!asset) throw new Error("Зображення бібліотеки не знайдено.");

  const prisma = getPrisma();
  const baseWhere = {
    brand: { equals: asset.make, mode: "insensitive" as const },
    model: { equals: asset.model, mode: "insensitive" as const },
    ...(asset.year == null ? {} : { year: asset.year }),
  };

  const vehicle = await prisma.vehicle.findFirst({
    where: asset.bodyType
      ? { ...baseWhere, bodyType: { equals: asset.bodyType, mode: "insensitive" } }
      : baseWhere,
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  }) ?? await prisma.vehicle.findFirst({
    where: baseWhere,
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!vehicle) {
    throw new Error("У CRM більше немає авто з цією маркою, моделлю та роком. Замініть PNG вручну або додайте відповідне авто.");
  }

  await getSqlPool().query(
    `UPDATE public."VehicleImageLibraryAsset"
       SET "reviewStatus"='PENDING',"reviewedAt"=NULL,"reviewedByUserId"=NULL,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1`,
    [assetId],
  );

  return generateVehicleImageForVehicle(vehicle.id, { themePaint: asset.theme, force: true });
}
