import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import {
  enqueueVehicleImageGeneration,
  getOpenAIVehicleImageConfig,
} from "./openai-library.service";
import { generateVehicleImageInBackground } from "./vehicle-image-background.service";

const MAX_SCAN = 160;
const DEFAULT_ENQUEUE_LIMIT = 8;
const MAX_ENQUEUE_LIMIT = 24;
const STALE_PROCESSING_MINUTES = 15;

type QueueJob = {
  id: string;
  vehicleId: string;
  assetId: string;
  theme: string;
  libraryKey: string;
};

function safeLimit(value: number | undefined) {
  return Math.max(1, Math.min(MAX_ENQUEUE_LIMIT, Math.trunc(value || DEFAULT_ENQUEUE_LIMIT)));
}

/**
 * Finds current CRM vehicles and registers only missing images in the shared
 * library queue. It does not call OpenAI and is safe to run repeatedly.
 */
export async function enqueueMissingVehicleImages(limit?: number) {
  const config = await getOpenAIVehicleImageConfig();
  if (!config) return { configured: false, scanned: 0, queued: 0, alreadyQueued: 0, skipped: 0 };
  if (!config.autoGenerate) return { configured: true, autoGenerate: false, scanned: 0, queued: 0, alreadyQueued: 0, skipped: 0 };

  const rows = await getPrisma().vehicle.findMany({
    where: {
      NOT: { id: { startsWith: "demo_" } },
      brand: { not: null },
      model: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_SCAN,
    select: { id: true },
  });

  const target = safeLimit(limit);
  let queued = 0;
  let alreadyQueued = 0;
  let skipped = 0;
  let scanned = 0;

  for (const row of rows) {
    if (queued >= target) break;
    scanned += 1;
    try {
      const result = await enqueueVehicleImageGeneration(row.id);
      if (result.queued) queued += 1;
      else if (result.state === "GENERATING") alreadyQueued += 1;
      else skipped += 1;
    } catch (error) {
      skipped += 1;
      console.warn("vehicle image queue registration failed", {
        vehicleId: row.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return { configured: true, scanned, queued, alreadyQueued, skipped, target };
}

async function recoverStaleQueueJobs() {
  await getSqlPool().query(
    `UPDATE public."VehicleImageGenerationJob"
        SET "status"='QUEUED',"startedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "status"='PROCESSING'
        AND "assetId" IS NOT NULL
        AND "startedAt" < CURRENT_TIMESTAMP - ($1::text || ' minutes')::interval
        AND EXISTS (
          SELECT 1 FROM public."VehicleImageLibraryAsset" asset
           WHERE asset."id"="VehicleImageGenerationJob"."assetId"
             AND asset."status" IN ('QUEUED','GENERATING')
        )`,
    [STALE_PROCESSING_MINUTES],
  );
}

async function claimNextQueueJob(): Promise<QueueJob | null> {
  const pool = getSqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vehicle-image-queue-worker'))");
    const result = await client.query<QueueJob>(
      `SELECT job."id",job."vehicleId",job."assetId",asset."theme",job."libraryKey"
         FROM public."VehicleImageGenerationJob" job
         JOIN public."VehicleImageLibraryAsset" asset ON asset."id"=job."assetId"
        WHERE job."status"='QUEUED'
          AND asset."status"='QUEUED'
          AND job."vehicleId" IS NOT NULL
        ORDER BY job."requestedAt" ASC, job."createdAt" ASC
        LIMIT 1
        FOR UPDATE OF job SKIP LOCKED`,
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }

    await client.query(
      `UPDATE public."VehicleImageGenerationJob"
          SET "status"='PROCESSING',"attempts"="attempts"+1,"startedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "id"=$1`,
      [row.id],
    );
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function completeQueueJob(jobId: string, status: "DONE" | "FAILED", errorMessage?: string | null) {
  await getSqlPool().query(
    `UPDATE public."VehicleImageGenerationJob"
        SET "status"=$2,"errorMessage"=$3,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1`,
    [jobId, status, errorMessage?.slice(0, 4000) || null],
  ).catch(() => undefined);
}

/**
 * Processes one queued library item. A database lock guarantees that multiple
 * cron invocations cannot send the same library key to OpenAI simultaneously.
 */
export async function processNextQueuedVehicleImage() {
  await recoverStaleQueueJobs();
  const job = await claimNextQueueJob();
  if (!job) return { processed: false as const, reason: "EMPTY" as const };

  try {
    const result = await generateVehicleImageInBackground(job.vehicleId, { themePaint: job.theme });
    await completeQueueJob(job.id, "DONE");
    return { processed: true as const, jobId: job.id, vehicleId: job.vehicleId, assetId: job.assetId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка обробки черги зображень.";
    await completeQueueJob(job.id, "FAILED", message);
    return { processed: true as const, jobId: job.id, vehicleId: job.vehicleId, assetId: job.assetId, error: message };
  }
}
