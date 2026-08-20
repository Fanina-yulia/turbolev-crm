import { createHash, randomUUID } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { normalizeThemePaint } from "./vehicle-color.service";
import { getOpenAIVehiclePaint, type OpenAIVehiclePaintSpec } from "./openai-vehicle-paint";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const PROMPT_VERSION = "vehicle-card-v5-shared-template-color-variant";
const TEMPLATE_VERSION = "vehicle-template-v2-model-year";
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

type TemplateIdentity = {
  templateKey: string;
  variantKey: string;
  normalizedColor: string;
  libraryKey: string;
  generationFrom: number | null;
  generationTo: number | null;
  generationLabel: string;
};

type LibraryAssetRow = {
  id: string;
  libraryKey: string;
  status: string;
  imageMimeType: string | null;
  imageData?: Buffer | null;
  imageSizeBytes: number | null;
  lastError: string | null;
  updatedAt: Date;
};

type ReferenceAssetRow = {
  id: string;
  imageMimeType: string | null;
  imageData: Buffer;
};

export type VehicleImageLibraryState = {
  state: "READY" | "MISSING" | "GENERATING" | "ERROR" | "NOT_CONFIGURED" | "MISSING_DATA";
  assetId: string | null;
  libraryKey: string | null;
  autoGenerate: boolean;
  canGenerate: boolean;
  error: string | null;
  templateKey?: string | null;
  variantKey?: string | null;
  normalizedColor?: string | null;
  generationLabel?: string | null;
};

function cleanPart(value: string | null | undefined) {
  return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[‐‑‒–—]/g, "-");
}

function keyPart(value: string | null | undefined) {
  return cleanPart(value).toLowerCase().replace(/[^\p{L}\p{N}#._-]+/gu, "-").replace(/^-+|-+$/g, "");
}

function hashIdentity(parts: Array<string | number | null | undefined>) {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|"), "utf8").digest("hex");
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

function colorFamilyFromHex(value: string | null | undefined) {
  const source = cleanPart(value).toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(source)) return null;
  const r = Number.parseInt(source.slice(1, 3), 16);
  const g = Number.parseInt(source.slice(3, 5), 16);
  const b = Number.parseInt(source.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const light = (max + min) / 2;
  if (max < 58) return "black";
  if (min > 226 && delta < 28) return "white";
  if (delta < 24) return light > 158 ? "silver" : "grey";
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = ((hue * 60) + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 45) return light < 145 ? "brown" : "orange";
  if (hue < 70) return "yellow";
  if (hue < 165) return "green";
  if (hue < 195) return "light-blue";
  if (hue < 255) return "blue";
  if (hue < 330) return "purple";
  return "red";
}

function colorFamilyFromText(value: string | null | undefined) {
  const source = cleanPart(value).toLowerCase();
  if (!source) return null;
  if (/чорн|black/.test(source)) return "black";
  if (/бі(л|л)|white|ivory/.test(source)) return "white";
  if (/сріб|silver/.test(source)) return "silver";
  if (/сір|grey|gray|графіт|graphite/.test(source)) return "grey";
  if (/блакит|light blue|cyan/.test(source)) return "light-blue";
  if (/син|blue/.test(source)) return "blue";
  if (/черв|red|бордо|burgundy/.test(source)) return "red";
  if (/зелен|green/.test(source)) return "green";
  if (/жовт|yellow/.test(source)) return "yellow";
  if (/помаранч|orange/.test(source)) return "orange";
  if (/беж|beige/.test(source)) return "beige";
  if (/корич|brown/.test(source)) return "brown";
  if (/фіолет|purple|violet/.test(source)) return "purple";
  if (/золот|gold/.test(source)) return "gold";
  return null;
}

function normalizedColorVariant(vehicle: VehicleDescriptor, paint: OpenAIVehiclePaintSpec, theme: string) {
  if (paint.source === "THEME") {
    const family = colorFamilyFromText(theme.replace(/^Imagin-/i, "")) || keyPart(theme) || "theme";
    return { variantKey: `theme:${family}`, normalizedColor: family };
  }

  // Exact factory/user paint metadata wins. Broad registry colors intentionally share one variant.
  const source = cleanPart(vehicle.exteriorColorSource).toUpperCase();
  const paintCode = keyPart(vehicle.exteriorPaintCode);
  const hex = cleanPart(vehicle.exteriorColorHex).toUpperCase();
  if (paintCode) return { variantKey: `paint:${paintCode}`, normalizedColor: paintCode };
  if (/^#[0-9A-F]{6}$/.test(hex) && source !== "REGISTRY") {
    return { variantKey: `hex:${hex}`, normalizedColor: hex };
  }

  const family = colorFamilyFromText(vehicle.exteriorColorName)
    || colorFamilyFromHex(vehicle.exteriorColorHex)
    || colorFamilyFromText(paint.requestedColor);
  if (family) return { variantKey: `real:${family}`, normalizedColor: family };

  const fallback = keyPart(paint.requestedColor).slice(0, 48) || "confirmed";
  return { variantKey: `real:${fallback}`, normalizedColor: fallback };
}

function imageIdentity(vehicle: VehicleDescriptor, theme: string, paint: OpenAIVehiclePaintSpec): TemplateIdentity {
  // Without an explicit generation field, model-year is the safe visual boundary.
  // It still deduplicates every repeated vehicle of the same make/model/year/body while
  // avoiding the much worse failure of reusing a previous/next generation across a facelift boundary.
  const yearKey = vehicle.year == null ? "year-unknown" : String(vehicle.year);
  const templateKey = hashIdentity([
    TEMPLATE_VERSION,
    keyPart(vehicle.make),
    keyPart(vehicle.model),
    yearKey,
    keyPart(vehicle.bodyType) || "body-unknown",
  ]);
  const color = normalizedColorVariant(vehicle, paint, theme);
  return {
    templateKey,
    variantKey: color.variantKey,
    normalizedColor: color.normalizedColor,
    libraryKey: hashIdentity([PROMPT_VERSION, templateKey, color.variantKey]),
    generationFrom: vehicle.year,
    generationTo: vehicle.year,
    generationLabel: vehicle.year == null ? "Рік не визначено" : String(vehicle.year),
  };
}

function masterPrompt(vehicle: VehicleDescriptor, paint: OpenAIVehiclePaintSpec) {
  const year = vehicle.year ? String(vehicle.year) : "model year not provided";
  const body = vehicle.bodyType ? ` Body type: ${vehicle.bodyType}.` : "";
  return [
    "Create exactly one production-quality vehicle cutout for an automotive service CRM card and a shared model-template library.",
    `Vehicle: ${vehicle.make} ${vehicle.model}, ${year}.${body}`,
    "This image will be reused by CRM vehicles with the same make, model, model-year and body type. Match the real production generation for that model-year as closely as possible.",
    "Preserve the generation-specific silhouette, body proportions, roofline, glazing, lights, grille, bumpers, wheel arches and door layout. Do not substitute a generic car, a different generation, a different body style or a visually similar model.",
    "Composition standard for the whole library: full vehicle visible, facing right, clean front three-quarter side view, camera near belt-line height, natural realistic proportions, centered horizontally, tires fully visible, no cropping.",
    paint.instruction,
    "The background must be fully transparent alpha. Every pixel outside the vehicle must remain transparent: no white, grey or colored backdrop, no road, no scenery, no studio wall, no floor, no gradient panel and no environmental reflections that imply a background.",
    "No people, no text, no captions, no watermark and no readable license-plate text. Use a blank neutral plate area if a plate holder is visible.",
    "Avoid large cast shadows. At most, use a tiny soft contact shadow immediately beneath the tires; never create a visible studio floor or a shadow field around the vehicle.",
    "Style: photorealistic automotive catalog cutout, consistent neutral lighting, restrained reflections, clean edges, no exaggerated wide-angle distortion.",
    "The final asset must contain exactly one car on transparency and be delivered as a PNG with alpha transparency.",
  ].join(" ");
}

function recolorPrompt(vehicle: VehicleDescriptor, paint: OpenAIVehiclePaintSpec) {
  return [
    "Edit the supplied automotive CRM reference image.",
    "Preserve the exact same vehicle identity, production generation, body shape, camera angle, crop, wheels, glazing, lights, grille, bumpers and proportions.",
    `The target vehicle is ${vehicle.make} ${vehicle.model}${vehicle.year ? ` model-year ${vehicle.year}` : ""}${vehicle.bodyType ? `, ${vehicle.bodyType}` : ""}.`,
    "Change only the factory-painted exterior body panels to the requested body color. Do not recolor glass, tires, wheels, lights, grille, chrome, black trim, badges or the plate area.",
    paint.instruction,
    "Keep neutral catalog lighting and physically realistic paint reflections. Preserve a fully transparent alpha background with no road, floor, scenery, text, people or watermark.",
    "Return exactly one complete vehicle cutout, facing right, with the same front three-quarter view as the reference.",
  ].join(" ");
}

function isMissingTableError(error: unknown) {
  return error instanceof Error && /VehicleImageLibraryAsset|VehicleImageGenerationJob|templateKey|variantKey|normalizedColor|generationFrom|generationTo|sourceAssetId|generationMode|does not exist|42P01|42703/i.test(error.message);
}

const ASSET_COLUMNS = `"id","libraryKey","status","imageMimeType","imageSizeBytes","lastError","updatedAt"`;

async function findAssetByKey(libraryKey: string): Promise<LibraryAssetRow | null> {
  try {
    const result = await getSqlPool().query(
      `SELECT ${ASSET_COLUMNS} FROM public."VehicleImageLibraryAsset" WHERE "libraryKey"=$1 LIMIT 1`,
      [libraryKey],
    );
    return result.rowCount ? result.rows[0] as LibraryAssetRow : null;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

async function findReferenceAsset(vehicle: VehicleDescriptor, identity: TemplateIdentity, excludeAssetId?: string | null): Promise<ReferenceAssetRow | null> {
  const result = await getSqlPool().query(
    `SELECT "id","imageMimeType","imageData"
       FROM public."VehicleImageLibraryAsset"
      WHERE "status"='READY'
        AND "imageData" IS NOT NULL
        AND ($6::text IS NULL OR "id"<>$6)
        AND (
          "templateKey"=$1
          OR (
            "templateKey" IS NULL
            AND lower("make")=lower($2)
            AND lower("model")=lower($3)
            AND ($4::text IS NULL OR lower(COALESCE("bodyType",''))=lower($4))
            AND (($5::int IS NULL AND "year" IS NULL) OR "year"=$5)
          )
        )
      ORDER BY ("templateKey"=$1) DESC, ("reviewStatus"='APPROVED') DESC, "updatedAt" DESC
      LIMIT 1`,
    [identity.templateKey, vehicle.make, vehicle.model, vehicle.bodyType, vehicle.year, excludeAssetId || null],
  );
  return result.rowCount ? result.rows[0] as ReferenceAssetRow : null;
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
  const paint = getOpenAIVehiclePaint(vehicle, theme);
  const identity = imageIdentity(vehicle, theme, paint);
  const extra = {
    templateKey: identity.templateKey,
    variantKey: identity.variantKey,
    normalizedColor: identity.normalizedColor,
    generationLabel: identity.generationLabel,
  };
  const asset = await findAssetByKey(identity.libraryKey);
  if (asset?.status === "READY") return { state: "READY", assetId: asset.id, libraryKey: identity.libraryKey, autoGenerate: config?.autoGenerate ?? false, canGenerate: Boolean(config), error: null, ...extra };
  if (asset?.status === "GENERATING") return { state: "GENERATING", assetId: asset.id, libraryKey: identity.libraryKey, autoGenerate: config?.autoGenerate ?? false, canGenerate: Boolean(config), error: null, ...extra };
  if (asset?.status === "ERROR") return { state: "ERROR", assetId: asset.id, libraryKey: identity.libraryKey, autoGenerate: config?.autoGenerate ?? false, canGenerate: Boolean(config), error: asset.lastError, ...extra };
  if (!config) return { state: "NOT_CONFIGURED", assetId: asset?.id ?? null, libraryKey: identity.libraryKey, autoGenerate: false, canGenerate: false, error: "OpenAI API не налаштовано.", ...extra };
  return { state: "MISSING", assetId: asset?.id ?? null, libraryKey: identity.libraryKey, autoGenerate: config.autoGenerate, canGenerate: true, error: null, ...extra };
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

function assertGeneratedPng(bytes: Buffer) {
  if (!bytes.length) throw new Error("OpenAI не повернув байти зображення.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`PNG завеликий для CRM: ${Math.round(bytes.length / 1024)} KB.`);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) throw new Error("OpenAI повернув файл, який не є PNG.");
  return bytes;
}

async function imageBytesFromPayload(payload: { data?: Array<{ b64_json?: string; url?: string }> } | null) {
  const item = payload?.data?.[0];
  let bytes: Buffer | null = null;
  if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
  else if (item?.url) {
    const imageResponse = await fetchWithTimeout(item.url, { headers: { Accept: "image/png,image/*" } }, 30_000);
    if (!imageResponse.ok) throw new Error(`Не вдалося завантажити згенерований PNG: HTTP ${imageResponse.status}`);
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  }
  if (!bytes) throw new Error("OpenAI не повернув зображення.");
  return assertGeneratedPng(bytes);
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
  const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }>; error?: unknown } | null;
  if (!response.ok) throw new Error(openAIErrorMessage(payload, `OpenAI Images API: HTTP ${response.status}`));
  return imageBytesFromPayload(payload);
}

async function editPngFromReference(config: VehicleImageConfig, reference: ReferenceAssetRow, prompt: string) {
  const form = new FormData();
  form.set("model", config.model);
  form.append(
    "image[]",
    new Blob([new Uint8Array(reference.imageData)], { type: reference.imageMimeType || "image/webp" }),
    reference.imageMimeType === "image/png" ? "vehicle-template.png" : "vehicle-template.webp",
  );
  form.set("prompt", prompt);
  form.set("n", "1");
  form.set("size", config.imageSize);
  form.set("quality", config.quality);
  form.set("background", "transparent");
  form.set("output_format", "png");

  const response = await fetchWithTimeout(OPENAI_EDITS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
    body: form,
  }, 90_000);
  const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }>; error?: unknown } | null;
  if (!response.ok) throw new Error(openAIErrorMessage(payload, `OpenAI Image Edits API: HTTP ${response.status}`));
  return imageBytesFromPayload(payload);
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
  const identity = imageIdentity(vehicle, theme, paint);
  const prompt = masterPrompt(vehicle, paint);
  const existing = await findAssetByKey(identity.libraryKey);
  const now = Date.now();

  if (!options?.force && existing?.status === "READY") {
    return { state: "READY" as const, assetId: existing.id, libraryKey: identity.libraryKey, templateKey: identity.templateKey, variantKey: identity.variantKey, normalizedColor: identity.normalizedColor, requestedColor: paint.requestedColor, reused: true };
  }
  if (!options?.force && existing?.status === "GENERATING" && now - new Date(existing.updatedAt).getTime() < GENERATION_LOCK_MS) {
    return { state: "GENERATING" as const, assetId: existing.id, libraryKey: identity.libraryKey, templateKey: identity.templateKey, variantKey: identity.variantKey, requestedColor: paint.requestedColor };
  }
  if (!options?.force && existing?.status === "ERROR" && now - new Date(existing.updatedAt).getTime() < ERROR_RETRY_MS) {
    return { state: "ERROR" as const, assetId: existing.id, libraryKey: identity.libraryKey, templateKey: identity.templateKey, variantKey: identity.variantKey, error: existing.lastError, requestedColor: paint.requestedColor };
  }

  const assetId = existing?.id || `vimg_${randomUUID().replace(/-/g, "")}`;
  const pool = getSqlPool();
  await pool.query(
    `INSERT INTO public."VehicleImageLibraryAsset"
       ("id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","promptText","status","lastError","templateKey","variantKey","normalizedColor","generationFrom","generationTo","sourceAssetId","generationMode","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,'OPENAI',$8,$9,$10,'GENERATING',NULL,$11,$12,$13,$14,$15,NULL,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("libraryKey") DO UPDATE SET
       "make"=EXCLUDED."make","model"=EXCLUDED."model","year"=EXCLUDED."year","bodyType"=EXCLUDED."bodyType","theme"=EXCLUDED."theme",
       "provider"='OPENAI',"providerModel"=EXCLUDED."providerModel","promptVersion"=EXCLUDED."promptVersion","promptText"=EXCLUDED."promptText",
       "status"='GENERATING',"lastError"=NULL,"templateKey"=EXCLUDED."templateKey","variantKey"=EXCLUDED."variantKey",
       "normalizedColor"=EXCLUDED."normalizedColor","generationFrom"=EXCLUDED."generationFrom","generationTo"=EXCLUDED."generationTo",
       "sourceAssetId"=NULL,"generationMode"='PENDING',"updatedAt"=CURRENT_TIMESTAMP`,
    [
      assetId,
      identity.libraryKey,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.bodyType,
      theme,
      config.model,
      PROMPT_VERSION,
      prompt,
      identity.templateKey,
      identity.variantKey,
      identity.normalizedColor,
      identity.generationFrom,
      identity.generationTo,
    ],
  );

  const claimed = await findAssetByKey(identity.libraryKey);
  if (!claimed) throw new Error("Не вдалося створити запис бібліотеки зображень.");
  const jobId = await createJob(identity.libraryKey, vehicleId, claimed.id);

  try {
    const reference = await findReferenceAsset(vehicle, identity, claimed.id);
    let png: Buffer;
    let generationMode = "TEXT_GENERATION";
    let sourceAssetId: string | null = null;

    if (reference) {
      try {
        png = await editPngFromReference(config, reference, recolorPrompt(vehicle, paint));
        generationMode = "REFERENCE_EDIT";
        sourceAssetId = reference.id;
      } catch (editError) {
        console.warn("vehicle image reference recolor failed; falling back to text generation", {
          vehicleId,
          sourceAssetId: reference.id,
          message: editError instanceof Error ? editError.message : "unknown",
        });
        png = await generatePng(config, prompt);
        generationMode = "TEXT_GENERATION_FALLBACK";
        sourceAssetId = reference.id;
      }
    } else {
      png = await generatePng(config, prompt);
    }

    await pool.query(
      `UPDATE public."VehicleImageLibraryAsset"
          SET "provider"='OPENAI',"providerModel"=$2,"status"='READY',"imageMimeType"='image/png',"imageData"=$3,"imageSizeBytes"=$4,
              "lastError"=NULL,"generatedAt"=CURRENT_TIMESTAMP,"sourceAssetId"=$5,"generationMode"=$6,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1`,
      [claimed.id, config.model, png, png.length, sourceAssetId, generationMode],
    );
    await finishJob(jobId, "DONE");
    return {
      state: "READY" as const,
      assetId: claimed.id,
      libraryKey: identity.libraryKey,
      templateKey: identity.templateKey,
      variantKey: identity.variantKey,
      normalizedColor: identity.normalizedColor,
      generationLabel: identity.generationLabel,
      requestedColor: paint.requestedColor,
      reusedTemplate: Boolean(reference),
      sourceAssetId,
      generationMode,
    };
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
      `SELECT "id","make","model","year","bodyType","theme","provider","providerModel","promptVersion","status","imageMimeType","imageSizeBytes","lastError","generatedAt","createdAt","updatedAt","templateKey","variantKey","normalizedColor","generationFrom","generationTo","sourceAssetId","generationMode" FROM public."VehicleImageLibraryAsset" ORDER BY "updatedAt" DESC LIMIT $1`,
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
