import { createHash, randomUUID } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { normalizeThemePaint } from "./vehicle-color.service";
import { getOpenAIVehiclePaint, type OpenAIVehiclePaintSpec } from "./openai-vehicle-paint";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const PROMPT_VERSION = "vehicle-card-v4-real-color-transparent-png";
const GENERATION_LOCK_MS = 10 * 60 * 1000;
const ERROR_RETRY_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

type ImageQuality = "low" | "medium" | "high" | "auto";
type ImageSize = "1536x1024" | "1024x1024" | "1024x1536";

type VehicleImageConfig = {
  apiKey: string;
  model: string;
  quality: ImageQuality;
  imageSize: ImageSize;
  autoGenerate: boolean;
};

type VehicleDescriptor = {
  vehicleId: string;
  make: string;
  model: string;
  year: number | null;
  bodyType: string | null;
  exteriorColorName: string | null;
  exteriorColorHex: string | null;
  exteriorPaintCode: string | null;
  exteriorColorSource: string | null;
  exteriorColorConfirmed: boolean;
};

type LibraryAssetRow = {
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
  promptText: string;
  status: string;
  imageMimeType: string | null;
  imageData?: Buffer | null;
  imageSizeBytes: number | null;
  lastError: string | null;
  generatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VehicleImageLibraryState = {
  state: "READY" | "MISSING" | "GENERATING" | "ERROR" | "NOT_CONFIGURED" | "MISSING_DATA";
  assetId: string | null;
  libraryKey: string | null;
  autoGenerate: boolean;
  canGenerate: boolean;
  error: string | null;
};

function cleanPart(value: string | null | undefined) {
  return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[‐‑‒–—]/g, "-");
}

function keyPart(value: string | null | undefined) {
  return cleanPart(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value?.trim()) return fallback;
  return !/^(0|false|off|no|ні)$/i.test(value.trim());
}

function parseQuality(value: string | undefined): ImageQuality {
  const quality = value?.trim().toLowerCase();
  return quality === "low" || quality === "medium" || quality === "high" || quality === "auto" ? quality : "medium";
}

function parseSize(value: string | undefined): ImageSize {
  return value === "1024x1024" || value === "1024x1536" || value === "1536x1024" ? value : "1536x1024";
}

export async function getOpenAIVehicleImageConfig(): Promise<VehicleImageConfig | null> {
  const values = await getIntegrationCredential("VEHICLE_IMAGES");
  const apiKey = values?.apiKey?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: values?.model?.trim() || "gpt-image-2",
    quality: parseQuality(values?.quality),
    imageSize: parseSize(values?.imageSize),
    autoGenerate: parseBoolean(values?.autoGenerate, true),
  };
}

async function loadVehicleDescriptor(vehicleId: string): Promise<VehicleDescriptor | null> {
  const vehicle = await getPrisma().vehicle.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
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
  if (!vehicle) return null;
  return {
    vehicleId: vehicle.id,
    make: cleanPart(vehicle.brand),
    model: cleanPart(vehicle.model),
    year: vehicle.year,
    bodyType: cleanPart(vehicle.bodyType) || null,
    exteriorColorName: cleanPart(vehicle.exteriorColorName) || null,
    exteriorColorHex: cleanPart(vehicle.exteriorColorHex) || null,
    exteriorPaintCode: cleanPart(vehicle.exteriorPaintCode) || null,
    exteriorColorSource: vehicle.exteriorColorSource ? String(vehicle.exteriorColorSource) : null,
    exteriorColorConfirmed: vehicle.exteriorColorConfirmed,
  };
}

function normalizedTheme(themePaint?: string | null) {
  return normalizeThemePaint(themePaint, "Imagin-orange");
}

function libraryKeyFor(vehicle: VehicleDescriptor, theme: string) {
  const paint = getOpenAIVehiclePaint(vehicle, theme);
  const identity = [
    PROMPT_VERSION,
    keyPart(vehicle.make),
    keyPart(vehicle.model),
    vehicle.year == null ? "year-unknown" : String(vehicle.year),
    keyPart(vehicle.bodyType) || "body-unknown",
    paint.signature,
  ].join("|");
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

function masterPrompt(vehicle: VehicleDescriptor, paint: OpenAIVehiclePaintSpec) {
  const year = vehicle.year ? String(vehicle.year) : "model year not provided";
  const body = vehicle.bodyType ? ` Body type: ${vehicle.bodyType}.` : "";
  return [
    "Create exactly one production-quality vehicle cutout for an automotive service CRM card and shared vehicle image library.",
    `Vehicle: ${vehicle.make} ${vehicle.model}, ${year}.${body}`,
    "The vehicle must visually match the real production make, model and model-year/generation as closely as possible. Preserve the generation-specific silhouette, body proportions, roofline, glazing, lights, grille, bumpers, wheel arches and door layout.",
    "Do not substitute a generic car, a different generation, a different body style or a visually similar model. If the model-year is supplied, prioritize generation accuracy over decorative styling.",
    "Composition standard for the whole library: full vehicle visible, facing right, clean front three-quarter side view, camera near belt-line height, natural realistic proportions, centered horizontally, tires fully visible, no cropping.",
    paint.instruction,
    "The background must be fully transparent alpha. Every pixel outside the vehicle must remain transparent: no white, grey or colored backdrop, no road, no scenery, no studio wall, no floor, no gradient panel and no environmental reflections that imply a background.",
    "No people, no text, no captions, no watermark and no readable license-plate text. Use a blank neutral plate area if a plate holder is visible.",
    "Avoid large cast shadows. At most, use a tiny soft contact shadow immediately beneath the tires; never create a visible studio floor or a shadow field around the vehicle.",
    "Style: photorealistic automotive catalog cutout, consistent neutral lighting, restrained reflections, clean edges, no exaggerated wide-angle distortion. Keep visual noise and unnecessary micro-detail low so the image remains clear when displayed as a small CRM card.",
    "The final asset must contain exactly one car on transparency and be delivered as a PNG with alpha transparency.",
  ].join(" ");
}

function isMissingTableError(error: unknown) {
  return error instanceof Error && /VehicleImageLibraryAsset|VehicleImageGenerationJob|does not exist|42P01/i.test(error.message);
}

async function findAssetByKey(libraryKey: string, includeBytes = false): Promise<LibraryAssetRow | null> {
  try {
    const columns = includeBytes
      ? `"id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","promptText","status","imageMimeType","imageData","imageSizeBytes","lastError","generatedAt","createdAt","updatedAt"`
      : `"id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","promptText","status","imageMimeType","imageSizeBytes","lastError","generatedAt","createdAt","updatedAt"`;
    const result = await getSqlPool().query(`SELECT ${columns} FROM public."VehicleImageLibraryAsset" WHERE "libraryKey"=$1 LIMIT 1`, [libraryKey]);
    return result.rowCount ? result.rows[0] as LibraryAssetRow : null;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

export async function getVehicleLibraryAsset(assetId: string) {
  try {
    const result = await getSqlPool().query(
      `SELECT "id","status","imageMimeType","imageData","imageSizeBytes","updatedAt" FROM public."VehicleImageLibraryAsset" WHERE "id"=$1 LIMIT 1`,
      [assetId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0] as { id: string; status: string; imageMimeType: string | null; imageData: Buffer | null; imageSizeBytes: number | null; updatedAt: Date };
    if (row.status !== "READY" || !row.imageData) return null;
    return { id: row.id, mimeType: row.imageMimeType || "image/png", bytes: row.imageData, sizeBytes: row.imageSizeBytes ?? row.imageData.length, updatedAt: row.updatedAt };
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

export async function getVehicleImageLibraryState(vehicleId: string, themePaint?: string | null): Promise<VehicleImageLibraryState> {
  const config = await getOpenAIVehicleImageConfig();
  const vehicle = await loadVehicleDescriptor(vehicleId);
  if (!vehicle) return { state: "MISSING_DATA", assetId: null, libraryKey: null, autoGenerate: false, canGenerate: false, error: "Автомобіль не знайдено." };
  if (!vehicle.make || !vehicle.model) return { state: "MISSING_DATA", assetId: null, libraryKey: null, autoGenerate: config?.autoGenerate ?? false, canGenerate: false, error: "Для генерації потрібні марка і модель." };

  const theme = normalizedTheme(themePaint);
  const libraryKey = libraryKeyFor(vehicle, theme);
  const asset = await findAssetByKey(libraryKey);
  if (asset?.status === "READY") return { state: "READY", assetId: asset.id, libraryKey, autoGenerate: config?.autoGenerate ?? false, canGenerate: Boolean(config), error: null };
  if (asset?.status === "GENERATING") return { state: "GENERATING", assetId: asset.id, libraryKey, autoGenerate: config?.autoGenerate ?? false, canGenerate: Boolean(config), error: null };
  if (asset?.status === "ERROR") return { state: "ERROR", assetId: asset.id, libraryKey, autoGenerate: config?.autoGenerate ?? false, canGenerate: Boolean(config), error: asset.lastError };
  if (!config) return { state: "NOT_CONFIGURED", assetId: asset?.id ?? null, libraryKey, autoGenerate: false, canGenerate: false, error: "OpenAI API не налаштовано." };
  return { state: "MISSING", assetId: asset?.id ?? null, libraryKey, autoGenerate: config.autoGenerate, canGenerate: true, error: null };
}

function openAIErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message;
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

async function generatePng(config: VehicleImageConfig, prompt: string) {
  const response = await fetchWithTimeout(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model: config.model,
      prompt,
      n: 1,
      size: config.imageSize,
      quality: config.quality,
      background: "transparent",
      output_format: "png",
    }),
  }, 90_000);

  const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }> } | null;
  if (!response.ok) throw new Error(openAIErrorMessage(payload, `OpenAI Images API: HTTP ${response.status}`));
  const item = payload?.data?.[0];
  let bytes: Buffer | null = null;
  if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
  else if (item?.url) {
    const imageResponse = await fetchWithTimeout(item.url, { headers: { Accept: "image/png,image/*" } }, 30_000);
    if (!imageResponse.ok) throw new Error(`Не вдалося завантажити згенерований PNG: HTTP ${imageResponse.status}`);
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  }
  if (!bytes?.length) throw new Error("OpenAI не повернув байти зображення.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`PNG завеликий для CRM: ${Math.round(bytes.length / 1024)} KB.`);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) throw new Error("OpenAI повернув файл, який не є PNG.");
  return bytes;
}

async function createJob(libraryKey: string, vehicleId: string, assetId: string) {
  const id = `vimgjob_${randomUUID().replace(/-/g, "")}`;
  await getSqlPool().query(
    `INSERT INTO public."VehicleImageGenerationJob" ("id","libraryKey","vehicleId","assetId","status","attempts","requestedAt","startedAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'PROCESSING',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [id, libraryKey, vehicleId, assetId],
  );
  return id;
}

async function finishJob(jobId: string, status: "DONE" | "FAILED", errorMessage?: string | null) {
  await getSqlPool().query(
    `UPDATE public."VehicleImageGenerationJob" SET "status"=$2,"errorMessage"=$3,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
    [jobId, status, errorMessage || null],
  ).catch(() => undefined);
}

export async function generateVehicleImageForVehicle(vehicleId: string, options?: { themePaint?: string | null; force?: boolean }) {
  const config = await getOpenAIVehicleImageConfig();
  if (!config) throw new Error("OpenAI API не налаштовано. Додайте API key у Налаштування → Інтеграції.");
  const vehicle = await loadVehicleDescriptor(vehicleId);
  if (!vehicle) throw new Error("Автомобіль не знайдено.");
  if (!vehicle.make || !vehicle.model) throw new Error("Для генерації зображення потрібні марка і модель автомобіля.");

  const theme = normalizedTheme(options?.themePaint);
  const paint = getOpenAIVehiclePaint(vehicle, theme);
  const libraryKey = libraryKeyFor(vehicle, theme);
  const prompt = masterPrompt(vehicle, paint);
  const existing = await findAssetByKey(libraryKey);
  const now = Date.now();

  if (!options?.force && existing?.status === "READY") return { state: "READY" as const, assetId: existing.id, libraryKey, requestedColor: paint.requestedColor };
  if (!options?.force && existing?.status === "GENERATING" && now - new Date(existing.updatedAt).getTime() < GENERATION_LOCK_MS) return { state: "GENERATING" as const, assetId: existing.id, libraryKey, requestedColor: paint.requestedColor };
  if (!options?.force && existing?.status === "ERROR" && now - new Date(existing.updatedAt).getTime() < ERROR_RETRY_MS) return { state: "ERROR" as const, assetId: existing.id, libraryKey, error: existing.lastError, requestedColor: paint.requestedColor };

  const assetId = existing?.id || `vimg_${randomUUID().replace(/-/g, "")}`;
  const pool = getSqlPool();
  await pool.query(
    `INSERT INTO public."VehicleImageLibraryAsset" ("id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","promptText","status","lastError","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'OPENAI',$8,$9,$10,'GENERATING',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("libraryKey") DO UPDATE SET "make"=EXCLUDED."make","model"=EXCLUDED."model","year"=EXCLUDED."year","bodyType"=EXCLUDED."bodyType","theme"=EXCLUDED."theme","provider"='OPENAI',"providerModel"=EXCLUDED."providerModel","promptVersion"=EXCLUDED."promptVersion","promptText"=EXCLUDED."promptText","status"='GENERATING',"lastError"=NULL,"updatedAt"=CURRENT_TIMESTAMP`,
    [assetId, libraryKey, vehicle.make, vehicle.model, vehicle.year, vehicle.bodyType, theme, config.model, PROMPT_VERSION, prompt],
  );

  const claimed = await findAssetByKey(libraryKey);
  if (!claimed) throw new Error("Не вдалося створити запис бібліотеки зображень.");
  const jobId = await createJob(libraryKey, vehicleId, claimed.id);

  try {
    const png = await generatePng(config, prompt);
    await pool.query(
      `UPDATE public."VehicleImageLibraryAsset" SET "provider"='OPENAI',"providerModel"=$2,"status"='READY',"imageMimeType"='image/png',"imageData"=$3,"imageSizeBytes"=$4,"lastError"=NULL,"generatedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
      [claimed.id, config.model, png, png.length],
    );
    await finishJob(jobId, "DONE");
    return { state: "READY" as const, assetId: claimed.id, libraryKey, requestedColor: paint.requestedColor };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка генерації зображення.";
    await pool.query(`UPDATE public."VehicleImageLibraryAsset" SET "status"='ERROR',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [claimed.id, message.slice(0, 4000)]).catch(() => undefined);
    await finishJob(jobId, "FAILED", message.slice(0, 4000));
    throw error;
  }
}

export async function listVehicleImageLibrary(limit = 100) {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  try {
    const result = await getSqlPool().query(
      `SELECT "id","make","model","year","bodyType","theme","provider","providerModel","promptVersion","status","imageMimeType","imageSizeBytes","lastError","generatedAt","createdAt","updatedAt" FROM public."VehicleImageLibraryAsset" ORDER BY "updatedAt" DESC LIMIT $1`,
      [safeLimit],
    );
    return result.rows;
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export async function testOpenAIVehicleImageConnection() {
  const config = await getOpenAIVehicleImageConfig();
  if (!config) return { ok: false, message: "Спочатку введіть OpenAI API key." };
  const started = Date.now();
  const response = await fetchWithTimeout(
    `${OPENAI_MODELS_URL}/${encodeURIComponent(config.model)}`,
    { method: "GET", headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" } },
    12_000,
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, message: openAIErrorMessage(payload, `OpenAI відповів HTTP ${response.status}.`) };
  return { ok: true, message: `OpenAI API підключено. Модель ${config.model} доступна.`, latencyMs: Date.now() - started };
}
