import {
  previewUniqueTradeShadowSearch,
  type UniqueTradeShadowPreview,
} from "@/src/services/supplier-unique-trade-shadow-ingestion.service";

const FIXED_QA_QUERY = "0986494596";
const FIXED_QA_LIMIT = 20;

type QuantityMode = "EXACT" | "BAND" | "BOOLEAN_ONLY" | "UNKNOWN";

export type UniqueTradeQAPreviewSummary = {
  status: "OK";
  environment: "preview";
  provider: "UNIQUE_TRADE";
  sanitized: true;
  writeMode: "READ_ONLY";
  fixedQueryFingerprint: string | null;
  offerCount: number;
  recordCount: number;
  recordsWithIdentityCandidates: number;
  identityCoverageRatio: number;
  warehouseCount: number;
  quantityModes: Record<QuantityMode, number>;
  providerDeclaredComplete: boolean;
  providerOrderingEvidence: boolean;
  rawQueryStored: boolean;
  identityResolutionMode: "BATCH" | "UNKNOWN";
  durationMs: number;
};

function safeMetadataString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function summarizeUniqueTradeQAPreview(
  preview: UniqueTradeShadowPreview,
  durationMs: number,
): UniqueTradeQAPreviewSummary {
  const quantityModes: Record<QuantityMode, number> = {
    EXACT: 0,
    BAND: 0,
    BOOLEAN_ONLY: 0,
    UNKNOWN: 0,
  };
  const warehouseKeys = new Set<string>();

  for (const record of preview.batch.records) {
    const mode = record.normalized.quantityMode;
    if (mode === "EXACT" || mode === "BAND" || mode === "BOOLEAN_ONLY" || mode === "UNKNOWN") {
      quantityModes[mode] += 1;
    }
    if (record.normalized.warehouseKey) warehouseKeys.add(record.normalized.warehouseKey);
  }

  const metadata = preview.batch.metadata ?? {};
  const queryHash = safeMetadataString(metadata.queryHash);
  const fixedQueryFingerprint = queryHash && /^[a-f0-9]{24}$/.test(queryHash) ? queryHash : null;
  const identityMode = safeMetadataString(metadata.identityResolutionMode);

  return {
    status: "OK",
    environment: "preview",
    provider: "UNIQUE_TRADE",
    sanitized: true,
    writeMode: "READ_ONLY",
    fixedQueryFingerprint,
    offerCount: preview.offerCount,
    recordCount: preview.recordCount,
    recordsWithIdentityCandidates: preview.recordsWithIdentityCandidates,
    identityCoverageRatio: ratio(preview.recordsWithIdentityCandidates, preview.recordCount),
    warehouseCount: warehouseKeys.size,
    quantityModes,
    providerDeclaredComplete: preview.batch.providerDeclaredComplete === true,
    providerOrderingEvidence: metadata.providerOrderingEvidence === true,
    rawQueryStored: metadata.rawQueryStored === true,
    identityResolutionMode: identityMode === "BATCH" ? "BATCH" : "UNKNOWN",
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

export async function runUniqueTradeQAPreview(): Promise<UniqueTradeQAPreviewSummary> {
  const startedAt = Date.now();
  const preview = await previewUniqueTradeShadowSearch(FIXED_QA_QUERY, FIXED_QA_LIMIT);
  return summarizeUniqueTradeQAPreview(preview, Date.now() - startedAt);
}

export const UNIQUE_TRADE_QA_PREVIEW_POLICY = {
  fixedQuery: true,
  acceptsUserQuery: false,
  previewOnly: true,
  sanitizedOutput: true,
  persistenceAllowed: false,
  supplierOrderAllowed: false,
  rawPayloadAllowed: false,
  purchasePriceAllowed: false,
} as const;
