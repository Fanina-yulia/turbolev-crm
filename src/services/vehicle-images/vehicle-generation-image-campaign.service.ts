import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";
import { getOpenAIVehicleImageConfig } from "./openai-library.service";
import { optimizeVehicleImageAsset } from "./vehicle-image-background.service";

const CAMPAIGN_SETTING_PREFIX = "vehicle_image_generation_campaign:";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const PROMPT_VERSION = "vehicle-card-v5-shared-template-color-variant";
const TEMPLATE_VERSION = "vehicle-template-v3-generation-catalog";
const CAMPAIGN_MODEL = "gpt-image-2";
const CAMPAIGN_QUALITY = "low";
const CAMPAIGN_SIZE = "1536x1024";
const CAMPAIGN_VARIANT = "theme:grey";
const CAMPAIGN_COLOR = "grey";
const CAMPAIGN_THEME = "Imagin-grey";
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export type VehicleGenerationImageCampaignState = {
  campaignId: string;
  tokenHash: string;
  status: "ACTIVE" | "COMPLETED" | "BUDGET_EXHAUSTED" | "PAUSED";
  budgetUsd: number;
  reservePerAttemptUsd: number;
  reservedUsd: number;
  attempts: number;
  generated: number;
  failed: number;
  skipped: number;
  model: string;
  quality: string;
  imageSize: string;
  startedAt: string;
  updatedAt: string;
  completedGenerationIds: string[];
  failedGenerationIds: string[];
  lastGenerationId?: string | null;
  lastError?: string | null;
};

type GenerationRow = {
  id: string;
  rank: number;
  make: string;
  model: string;
  generationCode: string;
  generationLabel: string;
  fromYear: number;
  toYear: number;
  confidence: number;
};

type CampaignIdentity = {
  templateKey: string;
  libraryKey: string;
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

function identityForGeneration(row: GenerationRow): CampaignIdentity {
  const templateKey = hashIdentity([
    TEMPLATE_VERSION,
    keyPart(row.make),
    keyPart(row.model),
    `generation:${row.generationCode}:${row.fromYear}-${row.toYear}`,
    "body-unknown",
  ]);
  return {
    templateKey,
    libraryKey: hashIdentity([PROMPT_VERSION, templateKey, CAMPAIGN_VARIANT]),
  };
}

function campaignPrompt(row: GenerationRow) {
  return [
    "Create exactly one production-quality vehicle cutout for an automotive service CRM card and shared vehicle generation library.",
    `Vehicle: ${row.make} ${row.model}. Confirmed generation: ${row.generationLabel} (${row.generationCode}), production window ${row.fromYear}-${row.toYear}.`,
    "Match this exact real production generation. Preserve its generation-specific silhouette, body proportions, roofline, glazing, headlights, taillights, grille, bumpers, wheel arches and door layout.",
    "Do not substitute a generic car, another generation, facelift from outside the stated production window, another make/model, or a visually similar vehicle.",
    "Use the most representative standard body configuration for this generation. If the model is primarily a van, SUV or MPV, preserve that real vehicle class.",
    "Composition standard: exactly one complete vehicle, facing right, clean front three-quarter side view, camera near belt-line height, centered, all tires visible, no cropping, realistic catalog proportions.",
    "Paint the factory body panels a neutral realistic graphite-grey metallic color. Keep glass, tires, wheels, lamps, grille, chrome and black trim physically correct.",
    "Background must be fully transparent alpha: no road, floor, scenery, studio wall, gradient, backdrop or environmental objects.",
    "No people, no text, no captions, no watermark and no readable license-plate text. Use a blank neutral plate area.",
    "Use neutral catalog lighting, restrained reflections and clean edges. Avoid wide-angle distortion and large cast shadows.",
    "Return exactly one photorealistic vehicle cutout as PNG with alpha transparency.",
  ].join(" ");
}

function settingKey(campaignId: string) {
  return `${CAMPAIGN_SETTING_PREFIX}${campaignId}`;
}

function normalizeState(value: unknown): VehicleGenerationImageCampaignState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<VehicleGenerationImageCampaignState>;
  if (!raw.campaignId || !raw.tokenHash || !raw.status) return null;
  return {
    campaignId: String(raw.campaignId),
    tokenHash: String(raw.tokenHash),
    status: raw.status as VehicleGenerationImageCampaignState["status"],
    budgetUsd: Number(raw.budgetUsd ?? 3),
    reservePerAttemptUsd: Number(raw.reservePerAttemptUsd ?? 0.01),
    reservedUsd: Number(raw.reservedUsd ?? 0),
    attempts: Number(raw.attempts ?? 0),
    generated: Number(raw.generated ?? 0),
    failed: Number(raw.failed ?? 0),
    skipped: Number(raw.skipped ?? 0),
    model: String(raw.model || CAMPAIGN_MODEL),
    quality: String(raw.quality || CAMPAIGN_QUALITY),
    imageSize: String(raw.imageSize || CAMPAIGN_SIZE),
    startedAt: String(raw.startedAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    completedGenerationIds: Array.isArray(raw.completedGenerationIds) ? raw.completedGenerationIds.map(String) : [],
    failedGenerationIds: Array.isArray(raw.failedGenerationIds) ? raw.failedGenerationIds.map(String) : [],
    lastGenerationId: raw.lastGenerationId == null ? null : String(raw.lastGenerationId),
    lastError: raw.lastError == null ? null : String(raw.lastError),
  };
}

async function loadCampaign(campaignId: string) {
  const result = await getSqlPool().query(
    `SELECT "value" FROM public."CrmSetting" WHERE "key"=$1 LIMIT 1`,
    [settingKey(campaignId)],
  );
  return result.rowCount ? normalizeState(result.rows[0]?.value) : null;
}

async function saveCampaign(state: VehicleGenerationImageCampaignState) {
  state.updatedAt = new Date().toISOString();
  await getSqlPool().query(
    `UPDATE public."CrmSetting" SET "value"=$2::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "key"=$1`,
    [settingKey(state.campaignId), JSON.stringify(state)],
  );
}

function tokenMatches(token: string, expectedHash: string) {
  if (!token || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(createHash("sha256").update(token, "utf8").digest("hex"), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function listGenerations(): Promise<GenerationRow[]> {
  const result = await getSqlPool().query(
    `SELECT g."id",p."rank",g."make",g."model",g."generationCode",g."generationLabel",g."fromYear",g."toYear",g."confidence"
       FROM public."VehicleGenerationReference" g
       JOIN public."VehicleModelPopularity" p
         ON p."normalizedMake"=g."normalizedMake" AND p."normalizedModel"=g."normalizedModel"
      WHERE g."isActive"=TRUE
        AND g."verificationStatus" IN ('CURATED','VERIFIED')
        AND g."confidence">=88
        AND p."status"='ACTIVE'
        AND p."rank"<=100
      ORDER BY p."rank" ASC,g."fromYear" ASC,g."toYear" ASC`,
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    rank: Number(row.rank),
    make: String(row.make),
    model: String(row.model),
    generationCode: String(row.generationCode),
    generationLabel: String(row.generationLabel),
    fromYear: Number(row.fromYear),
    toYear: Number(row.toYear),
    confidence: Number(row.confidence),
  }));
}

async function existingMaster(identity: CampaignIdentity) {
  const result = await getSqlPool().query(
    `SELECT "id","libraryKey","status" FROM public."VehicleImageLibraryAsset"
      WHERE "templateKey"=$1 AND "variantKey"=$2
      ORDER BY ("status"='READY') DESC,"updatedAt" DESC LIMIT 1`,
    [identity.templateKey, CAMPAIGN_VARIANT],
  );
  return result.rowCount ? result.rows[0] as { id: string; libraryKey: string; status: string } : null;
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

async function generateLowPng(apiKey: string, prompt: string) {
  const response = await fetchWithTimeout(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: CAMPAIGN_MODEL,
      prompt,
      n: 1,
      size: CAMPAIGN_SIZE,
      quality: CAMPAIGN_QUALITY,
      background: "transparent",
      output_format: "png",
    }),
  }, 90_000);
  const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }>; error?: unknown } | null;
  if (!response.ok) throw new Error(openAIErrorMessage(payload, `OpenAI Images API: HTTP ${response.status}`));
  const item = payload?.data?.[0];
  let bytes: Buffer | null = null;
  if (item?.b64_json) bytes = Buffer.from(item.b64_json, "base64");
  else if (item?.url) {
    const imageResponse = await fetchWithTimeout(item.url, { headers: { Accept: "image/png,image/*" } }, 30_000);
    if (!imageResponse.ok) throw new Error(`Не вдалося завантажити PNG: HTTP ${imageResponse.status}`);
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  }
  if (!bytes?.length) throw new Error("OpenAI не повернув зображення.");
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`PNG завеликий: ${Math.ceil(bytes.length / 1024)} КБ.`);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) throw new Error("OpenAI повернув файл, який не є PNG.");
  return bytes;
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

async function generateMaster(row: GenerationRow, apiKey: string, options: { force?: boolean } = {}) {
  const identity = identityForGeneration(row);
  const prompt = campaignPrompt(row);
  const prior = await existingMaster(identity);
  if (prior?.status === "READY" && options.force !== true) return { state: "READY" as const, assetId: prior.id, reused: true };

  const assetId = prior?.id || `vimg_${randomUUID().replace(/-/g, "")}`;
  const libraryKey = prior?.libraryKey || identity.libraryKey;
  const representativeYear = Math.floor((row.fromYear + row.toYear) / 2);

  if (prior) {
    await getSqlPool().query(
      `UPDATE public."VehicleImageLibraryAsset"
          SET "make"=$2,"model"=$3,"year"=$4,"bodyType"=NULL,"theme"=$5,"provider"='OPENAI',"providerModel"=$6,
              "promptVersion"=$7,"promptText"=$8,"status"='GENERATING',"lastError"=NULL,"templateKey"=$9,"variantKey"=$10,
              "normalizedColor"=$11,"generationFrom"=$12,"generationTo"=$13,"sourceAssetId"=NULL,"generationMode"='TOP_GENERATION_MASTER',"updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1`,
      [assetId, row.make, row.model, representativeYear, CAMPAIGN_THEME, CAMPAIGN_MODEL, PROMPT_VERSION, prompt, identity.templateKey, CAMPAIGN_VARIANT, CAMPAIGN_COLOR, row.fromYear, row.toYear],
    );
  } else {
    await getSqlPool().query(
      `INSERT INTO public."VehicleImageLibraryAsset"
         ("id","libraryKey","make","model","year","bodyType","theme","provider","providerModel","promptVersion","promptText","status","lastError","templateKey","variantKey","normalizedColor","generationFrom","generationTo","sourceAssetId","generationMode","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,NULL,$6,'OPENAI',$7,$8,$9,'GENERATING',NULL,$10,$11,$12,$13,$14,NULL,'TOP_GENERATION_MASTER',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [assetId, libraryKey, row.make, row.model, representativeYear, CAMPAIGN_THEME, CAMPAIGN_MODEL, PROMPT_VERSION, prompt, identity.templateKey, CAMPAIGN_VARIANT, CAMPAIGN_COLOR, row.fromYear, row.toYear],
    );
  }

  const jobId = await createJob(libraryKey, assetId);
  try {
    const png = await generateLowPng(apiKey, prompt);
    await getSqlPool().query(
      `UPDATE public."VehicleImageLibraryAsset"
          SET "provider"='OPENAI',"providerModel"=$2,"status"='READY',"imageMimeType"='image/png',"imageData"=$3,"imageSizeBytes"=$4,
              "lastError"=NULL,"generatedAt"=CURRENT_TIMESTAMP,"generationMode"='TOP_GENERATION_MASTER',"updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1`,
      [assetId, CAMPAIGN_MODEL, png, png.length],
    );
    const optimization = await optimizeVehicleImageAsset(assetId);
    await finishJob(jobId, "DONE");
    return { state: "READY" as const, assetId, reused: false, optimization };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка генерації master-зображення.";
    await getSqlPool().query(
      `UPDATE public."VehicleImageLibraryAsset" SET "status"='ERROR',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
      [assetId, message.slice(0, 4000)],
    ).catch(() => undefined);
    await finishJob(jobId, "FAILED", message.slice(0, 4000));
    throw error;
  }
}

export async function generateVehicleGenerationImage(generationId: string, options: { force?: boolean } = {}) {
  const id = generationId.trim();
  if (!id) throw new Error("Не вказано покоління для генерації.");

  const generations = await listGenerations();
  const row = generations.find((item) => item.id === id);
  if (!row) throw new Error("Покоління не знайдено у активному довіднику ТОП-100.");

  const config = await getOpenAIVehicleImageConfig();
  if (!config) throw new Error("OpenAI API не налаштовано.");

  const pool = getSqlPool();
  const client = await pool.connect();
  const lockName = `vehicle-generation-manual:${id}`;
  let locked = false;
  try {
    const lockResult = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockName]);
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) throw new Error("Це покоління вже генерується. Спробуйте ще раз після завершення.");

    const result = await generateMaster(row, config.apiKey, { force: options.force === true });
    return {
      generationId: row.id,
      rank: row.rank,
      make: row.make,
      model: row.model,
      generation: row.generationLabel,
      fromYear: row.fromYear,
      toYear: row.toYear,
      assetId: result.assetId,
      reused: result.reused,
      promptVersion: PROMPT_VERSION,
      modelName: CAMPAIGN_MODEL,
      quality: CAMPAIGN_QUALITY,
      imageSize: CAMPAIGN_SIZE,
    };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined);
    client.release();
  }
}

function publicState(state: VehicleGenerationImageCampaignState) {
  return {
    campaignId: state.campaignId,
    status: state.status,
    budgetUsd: state.budgetUsd,
    reservePerAttemptUsd: state.reservePerAttemptUsd,
    reservedUsd: Number(state.reservedUsd.toFixed(4)),
    attempts: state.attempts,
    generated: state.generated,
    failed: state.failed,
    skipped: state.skipped,
    model: state.model,
    quality: state.quality,
    imageSize: state.imageSize,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    lastGenerationId: state.lastGenerationId || null,
    lastError: state.lastError || null,
  };
}

export async function getGenerationCampaignStatus(campaignId: string, token: string) {
  const state = await loadCampaign(campaignId);
  if (!state || !tokenMatches(token, state.tokenHash)) return null;
  const generations = await listGenerations();
  return { ...publicState(state), eligibleGenerations: generations.length };
}

export async function runGenerationCampaignBatch(campaignId: string, token: string, requestedBatch = 3) {
  const pool = getSqlPool();
  const client = await pool.connect();
  const lockName = `vehicle-generation-campaign:${campaignId}`;
  let locked = false;
  try {
    const lockResult = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [lockName]);
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) return { ok: true, busy: true };

    const state = await loadCampaign(campaignId);
    if (!state || !tokenMatches(token, state.tokenHash)) return null;
    if (state.status !== "ACTIVE") return { ok: true, state: publicState(state), processed: [] };

    const config = await getOpenAIVehicleImageConfig();
    if (!config) {
      state.status = "PAUSED";
      state.lastError = "OpenAI API не налаштовано.";
      await saveCampaign(state);
      return { ok: true, state: publicState(state), processed: [] };
    }

    const batchSize = Math.max(1, Math.min(4, Math.trunc(requestedBatch || 3)));
    const generations = await listGenerations();
    const completed = new Set(state.completedGenerationIds);
    const failed = new Set(state.failedGenerationIds);
    const processed: Array<{ generationId: string; rank: number; make: string; model: string; generation: string; state: string; assetId?: string; error?: string }> = [];
    let attemptsThisRun = 0;
    let pendingRemaining = false;

    for (const row of generations) {
      if (completed.has(row.id) || failed.has(row.id)) continue;
      const identity = identityForGeneration(row);
      const prior = await existingMaster(identity);
      if (prior?.status === "READY") {
        completed.add(row.id);
        state.completedGenerationIds = Array.from(completed);
        state.skipped += 1;
        continue;
      }

      if (attemptsThisRun >= batchSize) {
        pendingRemaining = true;
        continue;
      }

      if (state.reservedUsd + state.reservePerAttemptUsd > state.budgetUsd + 1e-9) {
        state.status = "BUDGET_EXHAUSTED";
        break;
      }

      state.attempts += 1;
      attemptsThisRun += 1;
      state.reservedUsd = Number((state.reservedUsd + state.reservePerAttemptUsd).toFixed(4));
      state.lastGenerationId = row.id;
      state.lastError = null;
      await saveCampaign(state);

      try {
        const result = await generateMaster(row, config.apiKey);
        state.generated += result.reused ? 0 : 1;
        state.skipped += result.reused ? 1 : 0;
        completed.add(row.id);
        state.completedGenerationIds = Array.from(completed);
        processed.push({ generationId: row.id, rank: row.rank, make: row.make, model: row.model, generation: row.generationLabel, state: result.reused ? "REUSED" : "READY", assetId: result.assetId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "generation failed";
        state.failed += 1;
        failed.add(row.id);
        state.failedGenerationIds = Array.from(failed);
        state.lastError = message.slice(0, 1000);
        processed.push({ generationId: row.id, rank: row.rank, make: row.make, model: row.model, generation: row.generationLabel, state: "FAILED", error: message.slice(0, 300) });
      }
      await saveCampaign(state);
    }

    if (state.status === "ACTIVE" && !pendingRemaining) {
      const unresolved = generations.some((row) => !completed.has(row.id) && !failed.has(row.id));
      if (!unresolved) state.status = "COMPLETED";
    }
    await saveCampaign(state);
    return { ok: true, state: publicState(state), eligibleGenerations: generations.length, processed };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined);
    client.release();
  }
}
