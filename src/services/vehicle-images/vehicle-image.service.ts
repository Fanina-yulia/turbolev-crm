import { getPrisma } from "@/src/lib/prisma";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { resolveImaginImage } from "./imagin.provider";
import { normalizeVehicleImageQuery } from "./normalize-vehicle-query";
import type {
  ResolvedVehicleImage,
  VehicleImageProviderConfig,
  VehicleImageQuery,
} from "./types";
import { resolveVehicleImageColor, normalizeThemePaint } from "./vehicle-color.service";
import { vehicleImageSignature } from "./vehicle-image-signature";

const DEFAULT_IMAGIN_BASE_URL = "https://cdn.imagin.studio";
const ALLOWED_IMAGIN_HOSTS = new Set(["cdn.imagin.studio"]);

function clampInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function safeImaginBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || DEFAULT_IMAGIN_BASE_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !ALLOWED_IMAGIN_HOSTS.has(url.hostname.toLowerCase())) return DEFAULT_IMAGIN_BASE_URL;
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_IMAGIN_BASE_URL;
  }
}

function imageConfigFrom(values: Record<string, string> | null): VehicleImageProviderConfig | null {
  if (!values?.customerId?.trim()) return null;
  const fileType = values.fileType?.trim().toLowerCase();
  const colorMode = values.colorMode?.trim().toUpperCase();
  return {
    provider: "IMAGIN",
    customerId: values.customerId.trim(),
    baseUrl: safeImaginBaseUrl(values.baseUrl),
    angle: values.angle?.trim() || "23",
    width: clampInteger(values.width, 400, 150, 1200),
    fileType: fileType === "png" || fileType === "jpg" ? fileType : "webp",
    colorMode: colorMode === "REAL" || colorMode === "THEME" ? colorMode : "AUTO",
    fallbackPaint: normalizeThemePaint(values.fallbackPaint, "Imagin-orange"),
  };
}

export async function getVehicleImageConfig() {
  return imageConfigFrom(await getIntegrationCredential("VEHICLE_IMAGES"));
}

function powerTrainFromFuel(value: string | null | undefined) {
  const source = (value || "").toLowerCase();
  if (/electric|електр/.test(source)) return "electric";
  if (/hybrid|гібрид/.test(source)) return "hybrid";
  if (/diesel|диз/.test(source)) return "diesel";
  if (/petrol|gasoline|бенз/.test(source)) return "petrol";
  return null;
}

function asResolved(asset: {
  id: string;
  vehicleId: string;
  provider: string;
  sourceUrl: string | null;
  matchConfidence: number | null;
  angle: string;
  requestedColor: string | null;
  status: string;
}): ResolvedVehicleImage | null {
  if (!asset.sourceUrl || (asset.status !== "READY" && asset.status !== "MANUAL")) return null;
  return {
    assetId: asset.id,
    vehicleId: asset.vehicleId,
    provider: asset.provider,
    sourceUrl: asset.sourceUrl,
    proxyUrl: `/api/vehicle-images/${encodeURIComponent(asset.id)}`,
    confidence: asset.matchConfidence ?? 100,
    angle: asset.angle,
    requestedColor: asset.requestedColor,
    status: asset.status as "READY" | "MANUAL",
  };
}

export async function resolveVehicleImage(vehicleId: string, options?: { themePaint?: string | null; force?: boolean }) {
  const prisma = getPrisma();
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      bodyType: true,
      fuelType: true,
      exteriorColorName: true,
      exteriorColorHex: true,
      exteriorPaintCode: true,
      exteriorColorConfirmed: true,
      vehicleImages: {
        where: { status: "MANUAL" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          vehicleId: true,
          provider: true,
          sourceUrl: true,
          matchConfidence: true,
          angle: true,
          requestedColor: true,
          status: true,
        },
      },
    },
  });
  if (!vehicle) return null;

  const manual = vehicle.vehicleImages[0];
  if (manual) return asResolved(manual);

  const config = await getVehicleImageConfig();
  if (!config) return null;

  const rawQuery: VehicleImageQuery = {
    vehicleId: vehicle.id,
    make: vehicle.brand || "",
    model: vehicle.model || "",
    year: vehicle.year,
    bodyType: vehicle.bodyType,
    powerTrain: powerTrainFromFuel(vehicle.fuelType),
    realColorName: vehicle.exteriorColorName,
    realColorHex: vehicle.exteriorColorHex,
    realPaintCode: vehicle.exteriorPaintCode,
    realColorConfirmed: vehicle.exteriorColorConfirmed,
    themePaint: options?.themePaint || null,
  };
  const query = normalizeVehicleImageQuery(rawQuery);
  if (!query) return null;

  const themePaint = normalizeThemePaint(options?.themePaint, config.fallbackPaint);
  const color = resolveVehicleImageColor(query, config.colorMode, themePaint, config.fallbackPaint);
  const signature = vehicleImageSignature(query, config, color);

  if (!options?.force) {
    const existing = await prisma.vehicleImageAsset.findUnique({
      where: { vehicleId_signature: { vehicleId, signature } },
      select: {
        id: true,
        vehicleId: true,
        provider: true,
        sourceUrl: true,
        matchConfidence: true,
        angle: true,
        requestedColor: true,
        status: true,
        expiresAt: true,
      },
    });
    if (existing?.status === "READY" && existing.sourceUrl) return asResolved(existing);
    if (existing?.status === "ERROR" && existing.expiresAt && existing.expiresAt > new Date()) return null;
  }

  const result = resolveImaginImage(query, config, color);
  if (result.confidence < 85) return null;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const asset = await prisma.vehicleImageAsset.upsert({
    where: { vehicleId_signature: { vehicleId, signature } },
    create: {
      vehicleId,
      provider: result.provider,
      make: query.make,
      model: query.model,
      year: query.year,
      trim: query.trim,
      bodyType: query.bodyType,
      angle: result.angle,
      requestedColor: result.requestedColor,
      providerPaintId: result.providerPaintId,
      sourceUrl: result.sourceUrl,
      status: "READY",
      matchConfidence: result.confidence,
      matchReason: result.reason,
      signature,
      fetchedAt: new Date(),
      expiresAt,
      lastError: null,
    },
    update: {
      provider: result.provider,
      make: query.make,
      model: query.model,
      year: query.year,
      trim: query.trim,
      bodyType: query.bodyType,
      angle: result.angle,
      requestedColor: result.requestedColor,
      providerPaintId: result.providerPaintId,
      sourceUrl: result.sourceUrl,
      status: "READY",
      matchConfidence: result.confidence,
      matchReason: result.reason,
      fetchedAt: new Date(),
      expiresAt,
      lastError: null,
    },
    select: {
      id: true,
      vehicleId: true,
      provider: true,
      sourceUrl: true,
      matchConfidence: true,
      angle: true,
      requestedColor: true,
      status: true,
    },
  });
  return asResolved(asset);
}

export async function invalidateVehicleImages(vehicleId: string) {
  await getPrisma().vehicleImageAsset.deleteMany({ where: { vehicleId, status: { not: "MANUAL" } } });
}

export async function markVehicleImageFailure(assetId: string, message: string) {
  await getPrisma().vehicleImageAsset.update({
    where: { id: assetId },
    data: {
      status: "ERROR",
      lastError: message.slice(0, 2000),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  }).catch(() => undefined);
}

export async function getVehicleImageAsset(assetId: string) {
  return getPrisma().vehicleImageAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      vehicleId: true,
      provider: true,
      sourceUrl: true,
      status: true,
      make: true,
      model: true,
      year: true,
      bodyType: true,
      requestedColor: true,
    },
  });
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "image/webp,image/png,image/jpeg,image/*" } });
  } finally {
    clearTimeout(timeout);
  }
}

export async function testVehicleImageConnection() {
  const config = await getVehicleImageConfig();
  if (!config) return { ok: false, message: "Потрібен IMAGIN customer ID." };
  const query = normalizeVehicleImageQuery({
    vehicleId: "connection-test",
    make: "BMW",
    model: "X5",
    year: 2023,
    bodyType: "SUV",
    themePaint: config.fallbackPaint,
  });
  if (!query) return { ok: false, message: "Не вдалося сформувати тестовий запит Vehicle Images." };
  const color = resolveVehicleImageColor(query, "THEME", config.fallbackPaint, config.fallbackPaint);
  const result = resolveImaginImage(query, config, color);
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(result.sourceUrl);
    const type = response.headers.get("content-type") || "";
    const resolved = response.headers.get("x-imaginstudio-request-resolved");
    const found = response.headers.get("x-imaginstudio-request-found");
    if (!response.ok) return { ok: false, message: `IMAGIN відповів HTTP ${response.status}.` };
    if (!type.startsWith("image/")) return { ok: false, message: `IMAGIN повернув не зображення (${type || "unknown content-type"}).` };
    if (resolved?.toLowerCase() === "false" || found?.toLowerCase() === "false") return { ok: false, message: "IMAGIN доступний, але тестова модель не була підтверджена provider-ом." };
    return { ok: true, message: `Vehicle Images підключено. Тестовий render BMW X5 отримано за ${Date.now() - started} мс.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Не вдалося отримати тестове зображення IMAGIN." };
  }
}
