export type OeEvidenceVehicle = {
  id?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
};

export type OeEvidenceInput = {
  vehicle?: OeEvidenceVehicle | null;
  canonicalCode?: string | null;
  partName?: string | null;
  axis?: string | null;
  position?: string | null;
};

export type OeEvidenceMatch = {
  oeNumbers: string[];
  confidence: number;
  exact: false;
  source: "CURATED_OE_REFERENCE";
  sourceVersion: string;
  reason: string;
  evidenceRefs: string[];
};

type CuratedOeRow = {
  brands: string[];
  models: string[];
  yearFrom: number;
  yearTo: number;
  canonicalCode: string;
  axis: "FRONT" | "REAR" | null;
  oeNumbers: string[];
  confidence: number;
  evidenceRefs: string[];
};

const CURATED_OE_VERSION = "oe-curated-v1";

/**
 * Curated evidence is deliberately small and auditable. It is a bridge for
 * vehicles that are not yet covered by the canonical VehicleFitment import;
 * it must never pretend to be exact VIN fitment.
 */
const CURATED_OE_ROWS: CuratedOeRow[] = [
  {
    brands: ["GEELY"],
    models: ["EMGRAND X7", "EMGRAND EX7", "X7", "EX7"],
    yearFrom: 2012,
    yearTo: 2015,
    canonicalCode: "STABILIZER_BUSHING",
    axis: "REAR",
    oeNumbers: ["1014012805"],
    confidence: 88,
    evidenceRefs: [
      "GEELY_EMGRAND_X7_REAR_AXLE_CATALOG",
      "UA_PARTS_CATALOG_CROSSCHECK_1014012805",
    ],
  },
];

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeText(value: unknown) {
  return clean(value)
    .toLocaleUpperCase("uk-UA")
    .replace(/[^A-ZА-ЯІЇЄҐ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModel(value: unknown) {
  return normalizeText(value)
    .replace(/\bEX7\b/gu, "X7")
    .replace(/\bEMGRAND\s+EX7\b/gu, "EMGRAND X7");
}

export function normalizeSearchAxis(value: unknown): "FRONT" | "REAR" | null {
  const source = normalizeText(value);
  if (!source) return null;
  const front = /(?:^|\s)(?:FRONT|ПЕРЕД\w*)(?:\s|$)/u.test(source);
  const rear = /(?:^|\s)(?:REAR|ЗАД\w*)(?:\s|$)/u.test(source);
  if (front === rear) return null;
  return front ? "FRONT" : "REAR";
}

function modelMatches(actual: string, candidates: string[]) {
  const normalizedActual = normalizeModel(actual);
  if (!normalizedActual) return false;
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeModel(candidate);
    return normalizedActual === normalizedCandidate
      || normalizedActual.endsWith(` ${normalizedCandidate}`)
      || normalizedCandidate.endsWith(` ${normalizedActual}`);
  });
}

export function mergeOeNumbers(...groups: Array<Array<string | null | undefined> | null | undefined>) {
  const normalized = new Map<string, string>();
  for (const value of groups.flatMap((group) => group || [])) {
    const raw = clean(value, 120);
    if (!raw) continue;
    const key = raw.toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9]/giu, "");
    if (key && !normalized.has(key)) normalized.set(key, raw);
  }
  return [...normalized.values()];
}

export function resolveCuratedOeEvidence(input: OeEvidenceInput): OeEvidenceMatch | null {
  const vehicle = input.vehicle;
  if (!vehicle) return null;
  const brand = normalizeText(vehicle.brand);
  const model = clean(vehicle.model);
  const canonicalCode = normalizeText(input.canonicalCode);
  const year = typeof vehicle.year === "number" && Number.isFinite(vehicle.year) ? vehicle.year : null;
  const requestedAxis = normalizeSearchAxis(input.axis)
    || normalizeSearchAxis(input.position)
    || normalizeSearchAxis(input.partName);

  if (!brand || !model || !canonicalCode || year == null) return null;

  const row = CURATED_OE_ROWS.find((candidate) => (
    candidate.brands.some((candidateBrand) => normalizeText(candidateBrand) === brand)
    && modelMatches(model, candidate.models)
    && year >= candidate.yearFrom
    && year <= candidate.yearTo
    && normalizeText(candidate.canonicalCode) === canonicalCode
    && (!candidate.axis || candidate.axis === requestedAxis)
  ));
  if (!row) return null;

  return {
    oeNumbers: [...row.oeNumbers],
    confidence: row.confidence,
    exact: false,
    source: "CURATED_OE_REFERENCE",
    sourceVersion: CURATED_OE_VERSION,
    reason: `${vehicle.brand || "Авто"} ${vehicle.model || ""} ${year}: ${input.partName || input.canonicalCode || "деталь"}${requestedAxis ? ` · ${requestedAxis}` : ""} → OE ${row.oeNumbers.join(", ")}. Curated reference is model/position evidence, not exact VIN proof.`,
    evidenceRefs: [...row.evidenceRefs],
  };
}
