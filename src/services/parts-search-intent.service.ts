import { resolvePartTerminology } from "@/src/services/parts-terminology.service";

export type PartSearchIntentInput = {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  genericArticleId?: string | null;
  axis?: string | null;
  side?: string | null;
  subPosition?: string | null;
  position?: string | null;
};

export type PartSearchIntentResolution = {
  query: string;
  partName: string;
  canonicalCode: string | null;
  genericArticleId: string | null;
  axis: string | null;
  side: string | null;
  subPosition: string | null;
  position: string | null;
  metadataConflict: boolean;
  suppliedCanonicalCode: string | null;
  textCanonicalCode: string | null;
  source: "METADATA" | "TEXT" | "TEXT_OVERRIDE" | "UNKNOWN";
  reason: string;
};

const AXLE_SCOPED_PARTS = new Set([
  "BRAKE_PAD",
]);

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function code(value: unknown) {
  return clean(value, 100).toUpperCase() || null;
}

/**
 * Reconciles picker metadata with the human-readable requested part.
 * A stale finding/catalog code must never silently override a strong textual
 * part-family match (for example BRAKE_PAD text with STABILIZER_BUSHING metadata).
 */
export function resolvePartSearchIntent(input: PartSearchIntentInput): PartSearchIntentResolution {
  const query = clean(input.query);
  const rawPartName = clean(input.partName) || query;
  const suppliedCanonicalCode = code(input.canonicalCode);

  // Intentionally omit canonicalCode/genericArticleId here. This resolution is
  // independent evidence derived from what the user actually asked to find.
  const textual = resolvePartTerminology({
    query,
    partName: rawPartName,
    axis: input.axis,
    side: input.side,
    subPosition: input.subPosition,
    position: input.position,
  });
  const textCanonicalCode = code(textual.definition?.code);
  const strongText = Boolean(textCanonicalCode && textual.confidence !== "LOW");
  const metadataConflict = Boolean(
    suppliedCanonicalCode
    && strongText
    && textCanonicalCode
    && suppliedCanonicalCode !== textCanonicalCode
  );

  const canonicalCode = metadataConflict
    ? textCanonicalCode
    : suppliedCanonicalCode || textCanonicalCode || null;
  const genericArticleId = metadataConflict ? null : clean(input.genericArticleId, 180) || null;
  const axis = code(input.axis) || textual.attributes.axis || null;
  const inferredSide = code(input.side) || textual.attributes.side || null;
  const subPosition = code(input.subPosition) || textual.attributes.subPosition || null;
  const axleScoped = Boolean(canonicalCode && AXLE_SCOPED_PARTS.has(canonicalCode));
  const side = axleScoped ? null : inferredSide;
  const position = clean(input.position, 120) || axis || null;
  const partName = metadataConflict && textual.definition?.canonicalName
    ? textual.definition.canonicalName
    : rawPartName || textual.definition?.canonicalName || "Деталь";

  const source: PartSearchIntentResolution["source"] = metadataConflict
    ? "TEXT_OVERRIDE"
    : suppliedCanonicalCode
      ? "METADATA"
      : textCanonicalCode
        ? "TEXT"
        : "UNKNOWN";
  const reason = metadataConflict
    ? `Конфлікт search intent: текст визначає ${textCanonicalCode}, metadata передав ${suppliedCanonicalCode}. Для пошуку використано текстову канонічну групу.`
    : canonicalCode
      ? `Search intent узгоджено як ${canonicalCode}.`
      : "Канонічну групу не визначено; пошук залишено у режимі ручної перевірки.";

  return {
    query,
    partName,
    canonicalCode,
    genericArticleId,
    axis,
    side,
    subPosition,
    position,
    metadataConflict,
    suppliedCanonicalCode,
    textCanonicalCode,
    source,
    reason,
  };
}
