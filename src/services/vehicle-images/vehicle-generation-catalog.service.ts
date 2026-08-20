import "server-only";

import { getSqlPool } from "@/src/lib/sql";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_RESOLUTION_CONFIDENCE = 85;

export type VehicleGenerationCandidate = {
  id: string;
  make: string;
  model: string;
  generationCode: string;
  generationLabel: string;
  fromYear: number;
  toYear: number;
  confidence: number;
  verificationStatus: string;
};

export type VehicleGenerationResolution =
  | { state: "RESOLVED"; generation: VehicleGenerationCandidate }
  | { state: "AMBIGUOUS"; candidates: VehicleGenerationCandidate[] }
  | { state: "NO_MATCH"; candidates: [] };

export type VehicleModelPopularityRow = {
  id: string;
  rank: number;
  make: string;
  model: string;
  normalizedMake: string;
  normalizedModel: string;
  vehicleCount: string;
  coveragePct: string;
  firstReliableYear: number | null;
  lastReliableYear: number | null;
  topYears: Array<{ year: number; count: number }>;
  sourceTotalRows: string;
  status: string;
  refreshedAt: Date;
  generationCount: number;
  generationStatus: "READY" | "NEEDS_REVIEW";
};

type CachedResolution = { expiresAt: number; value: VehicleGenerationResolution };
const resolutionCache = new Map<string, CachedResolution>();

function clean(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKC")
    .trim()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ");
}

function upper(value: string | null | undefined) {
  return clean(value).toLocaleUpperCase("uk-UA");
}

export function normalizeVehicleGenerationIdentity(makeInput: string | null | undefined, modelInput: string | null | undefined) {
  let make = upper(makeInput);
  let model = upper(modelInput);

  if (make === "VW") make = "VOLKSWAGEN";
  if (make === "ŠKODA") make = "SKODA";
  if (make === "MERCEDES BENZ") make = "MERCEDES-BENZ";

  // Common MVS rows duplicate model inside the make field, e.g. "DAEWOO LANOS / LANOS".
  if (model && make.endsWith(` ${model}`)) make = make.slice(0, -(model.length + 1)).trim();

  // Registry variants that are actually generation/trim labels of one canonical model.
  if (make === "SKODA" && (model === "OCTAVIA A5" || model === "OCTAVIA TOUR")) model = "OCTAVIA";
  if (make === "MERCEDES-BENZ" && /^SPRINTER\b/.test(model)) model = "SPRINTER";
  if (make === "TOYOTA" && model === "RAV 4") model = "RAV4";
  if (make === "NISSAN" && model === "X TRAIL") model = "X-TRAIL";

  return {
    make,
    model,
    normalizedMake: make.toLocaleLowerCase("uk-UA"),
    normalizedModel: model.toLocaleLowerCase("uk-UA"),
  };
}

function tableMissing(error: unknown) {
  return error instanceof Error && /VehicleModelPopularity|VehicleGenerationReference|VehicleRegistryCompact|does not exist|42P01/i.test(error.message);
}

export async function resolveVehicleGeneration(input: { make: string | null | undefined; model: string | null | undefined; year: number | null | undefined }): Promise<VehicleGenerationResolution> {
  const identity = normalizeVehicleGenerationIdentity(input.make, input.model);
  const year = Number.isInteger(input.year) ? Number(input.year) : null;
  if (!identity.make || !identity.model || year == null) return { state: "NO_MATCH", candidates: [] };

  const cacheKey = `${identity.normalizedMake}|${identity.normalizedModel}|${year}`;
  const cached = resolutionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: VehicleGenerationResolution;
  try {
    const result = await getSqlPool().query(
      `SELECT "id","make","model","generationCode","generationLabel","fromYear","toYear","confidence","verificationStatus"
         FROM public."VehicleGenerationReference"
        WHERE "normalizedMake"=$1
          AND "normalizedModel"=$2
          AND "isActive"=TRUE
          AND "verificationStatus" IN ('VERIFIED','CURATED')
          AND "confidence">=$4
          AND $3 BETWEEN "fromYear" AND "toYear"
        ORDER BY "confidence" DESC,"fromYear" DESC`,
      [identity.normalizedMake, identity.normalizedModel, year, MIN_RESOLUTION_CONFIDENCE],
    );
    const candidates = result.rows.map((row) => ({
      id: String(row.id),
      make: String(row.make),
      model: String(row.model),
      generationCode: String(row.generationCode),
      generationLabel: String(row.generationLabel),
      fromYear: Number(row.fromYear),
      toYear: Number(row.toYear),
      confidence: Number(row.confidence),
      verificationStatus: String(row.verificationStatus),
    } satisfies VehicleGenerationCandidate));

    // A transition model-year can legitimately be present in two generations depending on market/build date.
    // Never guess in that case: keep the existing model-year-specific image identity.
    if (candidates.length === 1) value = { state: "RESOLVED", generation: candidates[0] };
    else if (candidates.length > 1) value = { state: "AMBIGUOUS", candidates };
    else value = { state: "NO_MATCH", candidates: [] };
  } catch (error) {
    if (!tableMissing(error)) throw error;
    value = { state: "NO_MATCH", candidates: [] };
  }

  resolutionCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  if (resolutionCache.size > 5000) {
    const first = resolutionCache.keys().next().value as string | undefined;
    if (first) resolutionCache.delete(first);
  }
  return value;
}

export async function refreshTopVehicleModelPopularity(limit = 100) {
  const safeLimit = Math.max(10, Math.min(250, Math.trunc(limit)));
  const pool = getSqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE public."VehicleModelPopularity" SET "status"='INACTIVE',"updatedAt"=CURRENT_TIMESTAMP WHERE "status"='ACTIVE'`);
    const result = await client.query(
      `WITH raw AS MATERIALIZED (
         SELECT
           upper(regexp_replace(trim("brand"), '\\s+', ' ', 'g')) AS raw_make,
           upper(regexp_replace(trim("model"), '\\s+', ' ', 'g')) AS raw_model,
           "makeYear"::int AS make_year
         FROM public."VehicleRegistryCompact"
         WHERE trim(COALESCE("brand",''))<>'' AND trim(COALESCE("model",''))<>''
       ), normalized AS MATERIALIZED (
         SELECT
           CASE
             WHEN base_make='VW' THEN 'VOLKSWAGEN'
             WHEN base_make='ŠKODA' THEN 'SKODA'
             WHEN base_make='MERCEDES BENZ' THEN 'MERCEDES-BENZ'
             ELSE base_make
           END AS make,
           CASE
             WHEN base_make IN ('SKODA','ŠKODA') AND raw_model IN ('OCTAVIA A5','OCTAVIA TOUR') THEN 'OCTAVIA'
             WHEN base_make IN ('MERCEDES-BENZ','MERCEDES BENZ') AND raw_model LIKE 'SPRINTER %' THEN 'SPRINTER'
             WHEN base_make='TOYOTA' AND raw_model='RAV 4' THEN 'RAV4'
             WHEN base_make='NISSAN' AND raw_model='X TRAIL' THEN 'X-TRAIL'
             ELSE raw_model
           END AS model,
           make_year
         FROM (
           SELECT raw_make,raw_model,make_year,
             CASE WHEN raw_make LIKE '% ' || raw_model
                  THEN trim(left(raw_make, length(raw_make)-length(raw_model)))
                  ELSE raw_make END AS base_make
           FROM raw
         ) x
       ), counts AS MATERIALIZED (
         SELECT make,model,count(*)::bigint AS vehicle_count
         FROM normalized GROUP BY make,model
       ), totals AS (
         SELECT sum(vehicle_count)::bigint AS total_rows FROM counts
       ), ranked AS (
         SELECT make,model,vehicle_count,row_number() OVER (ORDER BY vehicle_count DESC,make,model) AS rank
         FROM counts
       ), year_counts AS MATERIALIZED (
         SELECT make,model,make_year,count(*)::bigint AS year_count
         FROM normalized
         WHERE make_year BETWEEN 1950 AND 2035
         GROUP BY make,model,make_year
       ), reliable AS (
         SELECT make,model,
                min(make_year) FILTER (WHERE year_count>=500) AS first_reliable_year,
                max(make_year) FILTER (WHERE year_count>=500) AS last_reliable_year
         FROM year_counts GROUP BY make,model
       ), year_ranked AS (
         SELECT make,model,make_year,year_count,
                row_number() OVER (PARTITION BY make,model ORDER BY year_count DESC,make_year DESC) AS rn
         FROM year_counts
       ), top_years AS (
         SELECT make,model,
                jsonb_agg(jsonb_build_object('year',make_year,'count',year_count) ORDER BY year_count DESC,make_year DESC) AS top_years
         FROM year_ranked WHERE rn<=5 GROUP BY make,model
       ), selected AS (
         SELECT r.rank,r.make,r.model,r.vehicle_count,t.total_rows,
                rel.first_reliable_year,rel.last_reliable_year,COALESCE(y.top_years,'[]'::jsonb) AS top_years
         FROM ranked r CROSS JOIN totals t
         LEFT JOIN reliable rel USING(make,model)
         LEFT JOIN top_years y USING(make,model)
         WHERE r.rank<=$1
       )
       INSERT INTO public."VehicleModelPopularity"
         ("id","rank","make","model","normalizedMake","normalizedModel","vehicleCount","coveragePct","firstReliableYear","lastReliableYear","topYears","sourceTotalRows","status","refreshedAt","createdAt","updatedAt")
       SELECT
         'model:' || md5(lower(make)||'|'||lower(model)),rank,make,model,lower(make),lower(model),vehicle_count,
         CASE WHEN total_rows>0 THEN round((vehicle_count::numeric*100)/total_rows,4) ELSE 0 END,
         first_reliable_year,last_reliable_year,top_years,total_rows,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
       FROM selected
       ON CONFLICT ("normalizedMake","normalizedModel") DO UPDATE SET
         "rank"=EXCLUDED."rank","make"=EXCLUDED."make","model"=EXCLUDED."model","vehicleCount"=EXCLUDED."vehicleCount",
         "coveragePct"=EXCLUDED."coveragePct","firstReliableYear"=EXCLUDED."firstReliableYear","lastReliableYear"=EXCLUDED."lastReliableYear",
         "topYears"=EXCLUDED."topYears","sourceTotalRows"=EXCLUDED."sourceTotalRows","status"='ACTIVE',
         "refreshedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
       RETURNING "id"`,
      [safeLimit],
    );
    await client.query("COMMIT");
    return { refreshed: result.rowCount ?? 0, limit: safeLimit };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listVehicleGenerationCatalog(limit = 100): Promise<VehicleModelPopularityRow[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  try {
    const result = await getSqlPool().query(
      `SELECT p."id",p."rank",p."make",p."model",p."normalizedMake",p."normalizedModel",p."vehicleCount",p."coveragePct",
              p."firstReliableYear",p."lastReliableYear",p."topYears",p."sourceTotalRows",p."status",p."refreshedAt",
              count(g."id") FILTER (WHERE g."isActive"=TRUE AND g."verificationStatus" IN ('VERIFIED','CURATED') AND g."confidence">=$2)::int AS "generationCount"
         FROM public."VehicleModelPopularity" p
         LEFT JOIN public."VehicleGenerationReference" g
           ON g."normalizedMake"=p."normalizedMake" AND g."normalizedModel"=p."normalizedModel"
        WHERE p."status"='ACTIVE' AND p."rank"<=$1
        GROUP BY p."id",p."rank",p."make",p."model",p."normalizedMake",p."normalizedModel",p."vehicleCount",p."coveragePct",
                 p."firstReliableYear",p."lastReliableYear",p."topYears",p."sourceTotalRows",p."status",p."refreshedAt"
        ORDER BY p."rank" ASC`,
      [safeLimit, MIN_RESOLUTION_CONFIDENCE],
    );
    return result.rows.map((row) => ({
      ...row,
      rank: Number(row.rank),
      vehicleCount: String(row.vehicleCount),
      coveragePct: String(row.coveragePct),
      firstReliableYear: row.firstReliableYear == null ? null : Number(row.firstReliableYear),
      lastReliableYear: row.lastReliableYear == null ? null : Number(row.lastReliableYear),
      topYears: Array.isArray(row.topYears) ? row.topYears.map((item) => ({ year: Number(item.year), count: Number(item.count) })) : [],
      sourceTotalRows: String(row.sourceTotalRows),
      generationCount: Number(row.generationCount || 0),
      generationStatus: Number(row.generationCount || 0) > 0 ? "READY" : "NEEDS_REVIEW",
    })) as VehicleModelPopularityRow[];
  } catch (error) {
    if (tableMissing(error)) return [];
    throw error;
  }
}

export async function getVehicleGenerationCatalogStats() {
  try {
    const result = await getSqlPool().query(
      `WITH active AS (
         SELECT * FROM public."VehicleModelPopularity" WHERE "status"='ACTIVE' AND "rank"<=100
       ), mapped AS (
         SELECT DISTINCT "normalizedMake","normalizedModel"
         FROM public."VehicleGenerationReference"
         WHERE "isActive"=TRUE AND "verificationStatus" IN ('VERIFIED','CURATED') AND "confidence">=$1
       )
       SELECT
         count(*)::int AS "models",
         count(*) FILTER (WHERE m."normalizedMake" IS NOT NULL)::int AS "mappedModels",
         COALESCE(sum(a."vehicleCount"),0)::bigint AS "vehiclesInTop100",
         COALESCE(sum(a."vehicleCount") FILTER (WHERE m."normalizedMake" IS NOT NULL),0)::bigint AS "vehiclesWithGenerationMap",
         COALESCE(max(a."sourceTotalRows"),0)::bigint AS "sourceTotalRows",
         COALESCE(sum(a."coveragePct"),0)::numeric AS "top100CoveragePct",
         COALESCE(sum(a."coveragePct") FILTER (WHERE m."normalizedMake" IS NOT NULL),0)::numeric AS "mappedCoveragePct"
       FROM active a
       LEFT JOIN mapped m USING("normalizedMake","normalizedModel")`,
      [MIN_RESOLUTION_CONFIDENCE],
    );
    const row = result.rows[0] || {};
    const generations = await getSqlPool().query(
      `SELECT count(*)::int AS count FROM public."VehicleGenerationReference" WHERE "isActive"=TRUE AND "verificationStatus" IN ('VERIFIED','CURATED') AND "confidence">=$1`,
      [MIN_RESOLUTION_CONFIDENCE],
    );
    return {
      models: Number(row.models || 0),
      mappedModels: Number(row.mappedModels || 0),
      generations: Number(generations.rows[0]?.count || 0),
      vehiclesInTop100: String(row.vehiclesInTop100 || 0),
      vehiclesWithGenerationMap: String(row.vehiclesWithGenerationMap || 0),
      sourceTotalRows: String(row.sourceTotalRows || 0),
      top100CoveragePct: Number(row.top100CoveragePct || 0),
      mappedCoveragePct: Number(row.mappedCoveragePct || 0),
    };
  } catch (error) {
    if (tableMissing(error)) return { models: 0, mappedModels: 0, generations: 0, vehiclesInTop100: "0", vehiclesWithGenerationMap: "0", sourceTotalRows: "0", top100CoveragePct: 0, mappedCoveragePct: 0 };
    throw error;
  }
}

export async function listGenerationReferencesForModel(make: string, model: string) {
  const identity = normalizeVehicleGenerationIdentity(make, model);
  if (!identity.make || !identity.model) return [];
  try {
    const result = await getSqlPool().query(
      `SELECT "id","make","model","generationCode","generationLabel","fromYear","toYear","confidence","verificationStatus","sourceLabel","sourceUrl","notes","isActive"
         FROM public."VehicleGenerationReference"
        WHERE "normalizedMake"=$1 AND "normalizedModel"=$2
        ORDER BY "fromYear" ASC,"toYear" ASC`,
      [identity.normalizedMake, identity.normalizedModel],
    );
    return result.rows;
  } catch (error) {
    if (tableMissing(error)) return [];
    throw error;
  }
}
