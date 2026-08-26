import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";
import { getOpenAIVehicleImageConfig } from "./openai-library.service";
import { normalizeThemePaint } from "./vehicle-color.service";
import { getOpenAIVehiclePaint, type OpenAIVehiclePaintSpec } from "./openai-vehicle-paint";
import { optimizeVehicleImageAsset } from "./vehicle-image-background.service";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const PROMPT_VERSION = "vehicle-card-v4-real-color-transparent-png";
const SOURCE_MAX_BYTES = 12 * 1024 * 1024;
const GENERATION_LOCK_MS = 10 * 60 * 1000;
const ERROR_RETRY_MS = 30 * 60 * 1000;

export type ConfirmedVehicleDescriptor = {
  make: string;
  model: string;
  year?: number | null;
  bodyType?: string | null;
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  exteriorPaintCode?: string | null;
  exteriorColorSource?: string | null;
  exteriorColorConfirmed?: boolean | null;
};

type AssetRow = {
  id: string;
  libraryKey: string;
  status: string;
  imageMimeType: string | null;
  imageSizeBytes: number | null;
  lastError: string | null;
  updatedAt: Date;
};

function cleanPart(value: string | null | undefined) {
  return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[‐‑‒–—]/g, "-");
}

function keyPart(value: string | null | undefined) {
  return cleanPart(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function normalizedDescriptor(input: ConfirmedVehicleDescriptor) {
  return {
    make: cleanPart(input.make),
    model: cleanPart(input.model),
    year: Number.isInteger(input.year) ? Number(input.year) : null,
    bodyType: cleanPart(input.bodyType) || null,
    exteriorColorName: cleanPart(input.exteriorColorName) || null,
    exteriorColorHex: cleanPart(input.exteriorColorHex) || null,
    exteriorPaintCode: cleanPart(input.exteriorPaintCode) || null,
    exteriorColorSource: cleanPart(input.exteriorColorSource) || null,
    exteriorColorConfirmed: input.exteriorColorConfirmed === true,
  };
}

function libraryKeyFor(input: ReturnType<typeof normalizedDescriptor>, paint: OpenAIVehiclePaintSpec) {
  const identity = [
    PROMPT_VERSION,
    keyPart(input.make),
    keyPart(input.model),
    input.year == null ? "year-unknown" : String(input.year),
    keyPart(input.bodyType) || "body-unknown",
    paint.signature,
  ].join("|");
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

function masterPrompt(input: ReturnType<typeof normalizedDescriptor>, paint: OpenAIVehiclePaintSpec) {
  const year = input.year ? String(input.year) : "model year not provided";
  const body = input.bodyType ? ` Body type: ${input.bodyType}.` : "";
  return [
    "Create exactly one production-quality vehicle cutout for an automotive service CRM card and shared vehicle image library.",
    `Vehicle: ${input.make} ${input.model}, ${year}.${body}`,
    "The vehicle must visually match the real production make, model and model-year/generation as closely as possible. Preserve the generation-specific silhouette, body proportions, roofline, glazing, lights, grille, bumpers, wheel arches and door layout.",
    "Do not substitute a generic car, a different generation, a different body style or a visually similar model. If the model-year is supplied, prioritize generation accuracy over decorative styling.",
    "Composition standard for the whole library: full vehicle visible, facing right, clean front three-quarter side view, camera near belt-line height, natural realistic proportions, centered horizontally, tires fully visible, no cropping.",
    paint.instruction,
    "The background must be fully transparent alpha. Every pixel outside the vehicle must remain transparent: no white, grey or colored backdrop, no road, no scenery, no studio wall, no floor, no gradient panel and no environmental reflections that imply a background.",
    "No people, no text, no captions, no watermark and no readable license-plate text. Use a blank neutral plate area if a plate holder is visible.",
    "Avoid large cast shadows. At most, use a tiny soft contact shadow immediately beneath the tires; never create a visible studio floor or a shadow field around the vehicle.",
    "Style: photorealistic automotive catalog cutout, consistent neutral lighting, restrained reflections, clean edges, no exaggerated wide-angle distortion. Keep visual noise and unnecessary micro-detail low so the image remains clear after strong web optimization.",
    "The source must contain exactly one car on transparency. CRM will post-process it to a transparent WebP asset of 100 KB or less before delivery.",
  ].join(" ");
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

async function generateTransparentPng(config: NonNullable<Awaited<ReturnType<typeof getOpenAIVehicleImageConfig>>>, prompt: string) {
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
  if (bytes.length > SOURCE_MAX_BYTES) throw new Error(`PNG завеликий для CRM: ${Math.round(bytes.length / 1024)} KB.`);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error("OpenAI повернув файл, який не є PNG.");
  }
  return bytes;
}

async function findAsset(libraryKey: string): Promise<AssetRow | null> {
  const result = await getSqlPool().query(
    `SELECT "id","libraryKey","status","imageMimeType","imageSizeBytes","lastError","updatedAt"
       FROM public."VehicleImageLibraryAsset"
      WHERE "libraryKey"=$1
      LIMIT 1`,
    [libraryKey],
  );
  return result.rowCount ? result.rows[0] as AssetRow : null;
}

async function createJob(libraryKey: string, assetId: string) {
  const id = `vimgjob_${randomUUID().replace(/-/g, "")}`;
  await getSqlPool().query(
    `INSERT INTO public."VehicleImageGenerationJob"
       ("id","libraryKey","vehicleId","assetId","status","attempts","requestedAt","startedAt","createdAt","updatedAt")
     VALUES ($1,$2,NULL,$3,'PROCESSING',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [id, libraryKey, assetId],
  );
  return id;
}

async function finishJob(jobId: string, status: "DONE" | "FAILED", errorMessage?: string | null) {
  await getSqlPool().query(
    `UPDATE public."VehicleImageGenerationJob"
        SET "status"=$2,"errorMessage"=$3,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1`,
    [jobId, status, errorMessage || null],
  ).catch(() => undefined);
}

export async function generateVehicleImageForConfirmedDescriptor(
  descriptor: ConfirmedVehicleDescriptor,
  options?: { themePaint?: string | null },
) {
  const input = normalizedDescriptor(descriptor);
  if (!input.make || !input.model) return { state: "MISSING_DATA" as const, assetId: null, libraryKey: null };

  const config = await getOpenAIVehicleImageConfig();
  if (!config) return { state: "NOT_CONFIGURED" as const, assetId: null, libraryKey: null };

  const theme = normalizeThemePaint(options?.themePaint, "Imagin-grey");
  const paint = getOpenAIVehiclePaint(input, theme);
  const libraryKey = libraryKeyFor(input, paint);
  const prompt = masterPrompt(input, paint);
  const pool = getSqlPool();
  const client = await pool.connect();
  const lockName = `vehicle-image-library:${libraryKey}`;
  let locked = false;
  let jobId: string | null = null;
  let assetId: string | null = null;

  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockName],
    );
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) return { state: "GENERATING" as const, assetId: null, libraryKey, deduplicated: true };

    const existing = await findAsset(libraryKey);
    const now = Date.now();
    if (existing?.status === "READY") {
      await optimizeVehicleImageAsset(existing.id);
      return { state: "READY" as const, assetId: existing.id, libraryKey, reused: true, requestedColor: paint.requestedColor };
    }
    if (existing?.status === "GENERATING" && now - new Date(existing.updatedAt).getTime() < GENERATION_LOCK_MS) {
      return { state: "GENERATING" as const, assetId: existing.id, libraryKey, deduplicated: true, requestedColor: paint.requestedColor };
    }
    if (existing?.status === "ERROR" && now - new Date(existing.updatedAt).getTime() < ERROR_RETRY_MS) {
      return { state: "ERROR" as const, assetId: existing.id, libraryKey, error: existing.lastError, requestedColor: paint.requestedColor };
    }

    assetId = existing?.id || `vimg_${randomUUID().replace(/-/g, "")}`;
    await pool.query(
      `INSERT INTO public."VehicleImageLibraryAsset"
         ("id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","promptText","status","lastError","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OPENAI',$8,$9,$10,'GENERATING',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT ("libraryKey") DO UPDATE SET
         "make"=EXCLUDED."make","model"=EXCLUDED."model","year"=EXCLUDED."year","bodyType"=EXCLUDED."bodyType",
         "theme"=EXCLUDED."theme","provider"='OPENAI',"providerModel"=EXCLUDED."providerModel",
         "promptVersion"=EXCLUDED."promptVersion","promptText"=EXCLUDED."promptText","status"='GENERATING',
         "lastError"=NULL,"updatedAt"=CURRENT_TIMESTAMP`,
      [assetId, libraryKey, input.make, input.model, input.year, input.bodyType, theme, config.model, PROMPT_VERSION, prompt],
    );

    const claimed = await findAsset(libraryKey);
    if (!claimed) throw new Error("Не вдалося створити запис бібліотеки зображень.");
    assetId = claimed.id;
    jobId = await createJob(libraryKey, claimed.id);

    const png = await generateTransparentPng(config, prompt);
    await pool.query(
      `UPDATE public."VehicleImageLibraryAsset"
          SET "provider"='OPENAI',"providerModel"=$2,"status"='READY',"imageMimeType"='image/png',
              "imageData"=$3,"imageSizeBytes"=$4,"lastError"=NULL,"generatedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1`,
      [claimed.id, config.model, png, png.length],
    );

    const optimization = await optimizeVehicleImageAsset(claimed.id);
    await finishJob(jobId, "DONE");
    return { state: "READY" as const, assetId: claimed.id, libraryKey, optimization, requestedColor: paint.requestedColor };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка генерації зображення.";
    if (assetId) {
      await pool.query(
        `UPDATE public."VehicleImageLibraryAsset"
            SET "status"='ERROR',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1`,
        [assetId, message.slice(0, 4000)],
      ).catch(() => undefined);
    }
    if (jobId) await finishJob(jobId, "FAILED", message.slice(0, 4000));
    throw error;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined);
    client.release();
  }
}
