import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { getSqlPool } from "@/src/lib/sql";
import { getOpenAIVehicleImageConfig } from "./openai-library.service";
import { optimizeVehicleImageAsset } from "./vehicle-image-background.service";
import { runGenerationCampaignBatch, type VehicleGenerationImageCampaignState } from "./vehicle-generation-image-campaign.service";

const CAMPAIGN_SETTING_PREFIX = "vehicle_image_generation_campaign:";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-image-2";
const QUALITY = "low";
const SIZE = "1536x1024";
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

type ProcessedItem = {
  generationId: string;
  rank: number;
  make: string;
  model: string;
  generation: string;
  state: string;
  assetId?: string;
  error?: string;
};

type BatchResult = {
  ok?: boolean;
  busy?: boolean;
  state?: Record<string, unknown>;
  eligibleGenerations?: number;
  processed?: ProcessedItem[];
};

type AssetRow = {
  id: string;
  libraryKey: string;
  promptText: string | null;
};

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
    model: String(raw.model || MODEL),
    quality: String(raw.quality || QUALITY),
    imageSize: String(raw.imageSize || SIZE),
    startedAt: String(raw.startedAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    completedGenerationIds: Array.isArray(raw.completedGenerationIds) ? raw.completedGenerationIds.map(String) : [],
    failedGenerationIds: Array.isArray(raw.failedGenerationIds) ? raw.failedGenerationIds.map(String) : [],
    lastGenerationId: raw.lastGenerationId == null ? null : String(raw.lastGenerationId),
    lastError: raw.lastError == null ? null : String(raw.lastError),
  };
}

async function loadCampaign(campaignId: string) {
  const result = await getSqlPool().query(`SELECT "value" FROM public."CrmSetting" WHERE "key"=$1 LIMIT 1`, [settingKey(campaignId)]);
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

function isTransparencyCompatibilityError(item: ProcessedItem) {
  return item.state === "FAILED" && /transparent background is not supported for this model/i.test(item.error || "");
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
    const nested = (payload as { error?: unknown }).error;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  }
  return fallback;
}

async function requestChromaPng(apiKey: string, prompt: string) {
  const chromaPrompt = [
    prompt,
    "Compatibility background override: render every pixel outside the vehicle as one perfectly uniform pure chroma-key magenta #FF00FF.",
    "There must be no road, floor, scenery, studio wall, gradient, texture, cast shadow or reflected background object.",
    "Do not use magenta anywhere on the vehicle. Keep a clean hard catalog separation between the vehicle and the magenta background.",
  ].join(" ");
  const response = await fetchWithTimeout(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: chromaPrompt, n: 1, size: SIZE, quality: QUALITY, output_format: "png" }),
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
  if (!bytes?.length) throw new Error("OpenAI не повернув chroma-key зображення.");
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`PNG завеликий: ${Math.ceil(bytes.length / 1024)} КБ.`);
  return bytes;
}

async function removeMagentaBackground(source: Buffer) {
  const decoded = await sharp(source, { failOn: "none" }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = decoded.data;
  const { width, height, channels } = decoded.info;
  if (!width || !height || channels !== 4) throw new Error("Не вдалося декодувати chroma-key PNG у RGBA.");

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
    } else if (distance < 132) {
      const edgeAlpha = Math.max(0, Math.min(255, Math.round(((distance - 52) / 80) * 255)));
      data[i + 3] = Math.min(originalAlpha, edgeAlpha);
      if (data[i + 3] < 245) removed += 1;
    }
  }
  if (removed / Math.max(1, width * height) < 0.08) throw new Error("OpenAI не дотримався однотонного magenta-фону; безпечне видалення неможливе.");
  const output = await sharp(data, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const metadata = await sharp(output, { failOn: "none" }).metadata();
  if (!metadata.hasAlpha) throw new Error("Після chroma-key обробки PNG не має alpha-каналу.");
  return output;
}

async function findFailedAsset(generationId: string): Promise<AssetRow | null> {
  const generation = await getSqlPool().query(
    `SELECT "make","model","fromYear","toYear" FROM public."VehicleGenerationReference" WHERE "id"=$1 LIMIT 1`,
    [generationId],
  );
  if (!generation.rowCount) return null;
  const row = generation.rows[0] as { make: string; model: string; fromYear: number; toYear: number };
  const asset = await getSqlPool().query(
    `SELECT "id","libraryKey","promptText" FROM public."VehicleImageLibraryAsset"
      WHERE lower("make")=lower($1) AND lower("model")=lower($2)
        AND "generationFrom"=$3 AND "generationTo"=$4 AND "variantKey"='theme:grey'
      ORDER BY "updatedAt" DESC LIMIT 1`,
    [row.make, row.model, row.fromYear, row.toYear],
  );
  return asset.rowCount ? asset.rows[0] as AssetRow : null;
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
    `UPDATE public."VehicleImageGenerationJob" SET "status"=$2,"errorMessage"=$3,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
    [jobId, status, errorMessage || null],
  ).catch(() => undefined);
}

async function recoverItem(campaignId: string, token: string, item: ProcessedItem) {
  const state = await loadCampaign(campaignId);
  if (!state || !tokenMatches(token, state.tokenHash)) return { recovered: false, error: "invalid campaign" };
  if (state.reservedUsd + state.reservePerAttemptUsd > state.budgetUsd + 1e-9) {
    state.status = "BUDGET_EXHAUSTED";
    await saveCampaign(state);
    return { recovered: false, error: "budget exhausted" };
  }
  const config = await getOpenAIVehicleImageConfig();
  if (!config) return { recovered: false, error: "OpenAI API not configured" };
  const asset = await findFailedAsset(item.generationId);
  if (!asset?.promptText) return { recovered: false, error: "failed asset not found" };

  state.attempts += 1;
  state.reservedUsd = Number((state.reservedUsd + state.reservePerAttemptUsd).toFixed(4));
  state.lastGenerationId = item.generationId;
  await saveCampaign(state);

  const jobId = await createJob(asset.libraryKey, asset.id);
  try {
    const chroma = await requestChromaPng(config.apiKey, asset.promptText);
    const transparent = await removeMagentaBackground(chroma);
    await getSqlPool().query(
      `UPDATE public."VehicleImageLibraryAsset"
          SET "provider"='OPENAI',"providerModel"=$2,"status"='READY',"imageMimeType"='image/png',"imageData"=$3,"imageSizeBytes"=$4,
              "lastError"=NULL,"generatedAt"=CURRENT_TIMESTAMP,"generationMode"='TOP_GENERATION_MASTER_CHROMA',"updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1`,
      [asset.id, MODEL, transparent, transparent.length],
    );
    const optimization = await optimizeVehicleImageAsset(asset.id);
    await finishJob(jobId, "DONE");

    const refreshed = await loadCampaign(campaignId);
    if (refreshed && tokenMatches(token, refreshed.tokenHash)) {
      refreshed.failedGenerationIds = refreshed.failedGenerationIds.filter((id) => id !== item.generationId);
      if (!refreshed.completedGenerationIds.includes(item.generationId)) refreshed.completedGenerationIds.push(item.generationId);
      refreshed.failed = Math.max(0, refreshed.failed - 1);
      refreshed.generated += 1;
      refreshed.lastError = null;
      if (refreshed.status === "COMPLETED" || refreshed.status === "PAUSED") refreshed.status = "ACTIVE";
      await saveCampaign(refreshed);
    }
    return { recovered: true, assetId: asset.id, optimization };
  } catch (error) {
    const message = error instanceof Error ? error.message : "chroma fallback failed";
    await getSqlPool().query(`UPDATE public."VehicleImageLibraryAsset" SET "status"='ERROR',"lastError"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [asset.id, message.slice(0, 4000)]).catch(() => undefined);
    await finishJob(jobId, "FAILED", message.slice(0, 4000));
    const refreshed = await loadCampaign(campaignId);
    if (refreshed && tokenMatches(token, refreshed.tokenHash)) {
      refreshed.lastError = message.slice(0, 1000);
      await saveCampaign(refreshed);
    }
    return { recovered: false, error: message };
  }
}

export async function runGenerationCampaignBatchWithFallback(campaignId: string, token: string, requestedBatch = 3) {
  const primary = await runGenerationCampaignBatch(campaignId, token, requestedBatch) as BatchResult | null;
  if (!primary?.processed?.length) return primary;

  const recovered: Array<{ generationId: string; recovered: boolean; assetId?: string; error?: string }> = [];
  for (const item of primary.processed) {
    if (!isTransparencyCompatibilityError(item)) continue;
    const result = await recoverItem(campaignId, token, item);
    recovered.push({ generationId: item.generationId, recovered: result.recovered, ...(result.assetId ? { assetId: result.assetId } : {}), ...(result.error ? { error: result.error } : {}) });
  }

  const finalState = await loadCampaign(campaignId);
  return {
    ...primary,
    state: finalState ? {
      campaignId: finalState.campaignId,
      status: finalState.status,
      budgetUsd: finalState.budgetUsd,
      reservePerAttemptUsd: finalState.reservePerAttemptUsd,
      reservedUsd: Number(finalState.reservedUsd.toFixed(4)),
      attempts: finalState.attempts,
      generated: finalState.generated,
      failed: finalState.failed,
      skipped: finalState.skipped,
      model: finalState.model,
      quality: finalState.quality,
      imageSize: finalState.imageSize,
      updatedAt: finalState.updatedAt,
      lastGenerationId: finalState.lastGenerationId || null,
      lastError: finalState.lastError || null,
    } : primary.state,
    recovered,
  };
}
