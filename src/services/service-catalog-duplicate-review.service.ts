import type { ParsedCatalogWorkbook } from "@/src/services/service-catalog-import.service";

function nameKey(value: string) {
  return value
    .toLocaleLowerCase("uk-UA")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyDuplicateNameReview(parsed: ParsedCatalogWorkbook): ParsedCatalogWorkbook {
  if (parsed.format !== "MS_MASTER") return parsed;

  const groups = new Map<string, typeof parsed.rows>();
  for (const row of parsed.rows) {
    const normalized = nameKey(row.internalName);
    if (!normalized) continue;
    const group = groups.get(normalized) ?? [];
    group.push(row);
    groups.set(normalized, group);
  }

  let duplicateGroups = 0;
  let downgradedRows = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    duplicateGroups += 1;
    const ids = group.map((item) => item.externalServiceId).join(", ");
    const reason = `Дубль назви послуги (IDs ${ids})`;
    for (const row of group) {
      if (row.reviewStatus === "READY") {
        row.reviewStatus = "NEEDS_REVIEW";
        downgradedRows += 1;
      }
      if (!row.reviewReason?.includes(reason)) {
        row.reviewReason = row.reviewReason ? `${row.reviewReason}; ${reason}` : reason;
      }
    }
  }

  if (!duplicateGroups) return parsed;

  parsed.stats.ready = parsed.rows.filter((row) => row.reviewStatus === "READY").length;
  parsed.stats.needsReview = parsed.rows.filter((row) => row.reviewStatus === "NEEDS_REVIEW").length;
  parsed.stats.quarantined = parsed.rows.filter((row) => row.reviewStatus === "QUARANTINED").length;
  parsed.warnings.push(`${duplicateGroups} груп однакових назв (${downgradedRows} додаткових позицій) спрямовано на ручну перевірку; stable externalServiceId збережено.`);
  return parsed;
}
