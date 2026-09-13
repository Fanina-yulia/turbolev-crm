import {
  findPartTerminologyMatches,
  resolvePartTerminology,
  type PartTerminologyDefinition,
} from "@/src/services/parts-terminology.service";

export type ServiceNameParts = {
  part?: string | null;
  position?: string | null;
  side?: string | null;
  operation?: string | null;
};

type AliasInput = ServiceNameParts & {
  displayName?: string | null;
  internalName?: string | null;
  code?: string | null;
  externalServiceId?: string | null;
  canonicalCode?: string | null;
  partAliases?: string[] | null;
  existing?: string[] | null;
};

export type ServiceNameNormalization = ServiceNameParts & {
  canonicalPartCode: string | null;
  displayName: string;
};

function clean(value: string | null | undefined, max = 180) {
  return (value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase("uk-UA") + value.slice(1);
}

function normalized(value: string) {
  return value.toLocaleLowerCase("uk-UA").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

type ExtractedOperation = {
  subject: string;
  operation: string | null;
};

const OPERATION_PREFIXES: Array<[RegExp, string]> = [
  [/^(?:зняття|снятие)\s*(?:[/\\-]|\s+(?:і|та)\s+)\s*(?:встановлення|установлення|установка)\s+/iu, "демонтаж/монтаж"],
  [/^(?:демонтаж)\s*[/\\-]\s*(?:монтаж)\s+/iu, "демонтаж/монтаж"],
  [/^(?:повна|полная)\s+(?:заміна|замена)\s+/iu, "повна заміна"],
  [/^(?:часткова|частичная)\s+(?:заміна|замена)\s+/iu, "часткова заміна"],
  [/^ремонт\s*[/\\-]\s*(?:заміна|замена)\s+/iu, "ремонт / заміна"],
  [/^(?:заміна|замена)\s+/iu, "заміна"],
  [/^(?:встановлення|установка|установлення)\s+/iu, "монтаж"],
  [/^(?:зняття|снятие)\s+/iu, "демонтаж"],
  [/^(?:перепресування|перепрессовка|перепрессування)\s+/iu, "перепресування"],
  [/^(?:обслуговування|обслуживание)\s+/iu, "обслуговування"],
  [/^(?:діагностика|диагностика)\s+/iu, "діагностика"],
  [/^(?:огляд|осмотр)\s+/iu, "огляд"],
  [/^(?:прокачування|прокачка)\s+/iu, "прокачування"],
  [/^(?:опресування|опрессовка)\s+/iu, "опресування"],
  [/^(?:висвердлювання|высверливание)\s+/iu, "висвердлювання"],
  [/^(?:відновлення|восстановление)\s+/iu, "відновлення"],
  [/^(?:зрізання|срезание)\s+/iu, "зрізання"],
  [/^(?:робота з пресом|работа с прессом)\s+/iu, "робота з пресом"],
  [/^(?:доплата)\s+/iu, "доплата"],
];

const TRAILING_OPERATIONS: Array<[RegExp, string]> = [
  [/(?:демонтаж\s*[/\\-]\s*монтаж|зняття\s*[/\\-]\s*встановлення|снятие\s*[/\\-]\s*установка)$/iu, "демонтаж/монтаж"],
  [/(?:повна|полная)\s+(?:заміна|замена)$/iu, "повна заміна"],
  [/(?:часткова|частичная)\s+(?:заміна|замена)$/iu, "часткова заміна"],
  [/(?:ремонт\s*[/\\-]\s*(?:заміна|замена)|(?:заміна|замена)\s*[/\\-]\s*ремонт)$/iu, "ремонт / заміна"],
  [/(?:заміна|замена)$/iu, "заміна"],
  [/(?:монтаж|установка|встановлення)$/iu, "монтаж"],
  [/(?:демонтаж|зняття|снятие)$/iu, "демонтаж"],
  [/(?:обслуговування|обслуживание)$/iu, "обслуговування"],
  [/(?:діагностика|диагностика)$/iu, "діагностика"],
  [/(?:ремонт)$/iu, "ремонт"],
];

function extractOperation(value: string): ExtractedOperation {
  const source = clean(value, 1000);
  for (const [pattern, operation] of OPERATION_PREFIXES) {
    const match = pattern.exec(source);
    if (match) return { subject: clean(source.slice(match[0].length)), operation };
  }

  for (const [pattern, operation] of TRAILING_OPERATIONS) {
    const match = pattern.exec(source);
    if (!match) continue;
    const subject = clean(source.slice(0, match.index).replace(/[—–-]\s*$/, ""));
    if (subject) return { subject, operation };
  }

  return { subject: source, operation: null };
}

function terminologyMatches(value: string) {
  const matches = findPartTerminologyMatches(value);
  const byCode = new Map<string, { definition: PartTerminologyDefinition; matchedAlias: string }>();
  for (const match of matches) {
    if (!byCode.has(match.definition.code)) byCode.set(match.definition.code, { definition: match.definition, matchedAlias: match.normalizedAlias });
  }
  return [...byCode.values()];
}

function resolveCanonicalDefinition(source: string, explicitPart: string) {
  if (explicitPart) {
    const explicit = resolvePartTerminology({ query: explicitPart, partName: explicitPart });
    if (explicit.definition) return explicit.definition;
  }
  const matches = terminologyMatches(source);
  if (matches.length === 1) return matches[0].definition;
  const ranked = matches.sort((left, right) => right.matchedAlias.length - left.matchedAlias.length);
  return ranked[0] && ranked[1] && ranked[0].matchedAlias.length >= ranked[1].matchedAlias.length + 6
    ? ranked[0].definition
    : null;
}

function isPluralPart(definition: PartTerminologyDefinition) {
  return /(?:колодки|диски|втулки|патрубки|підвіси|хомути|гальмівні)/iu.test(definition.canonicalName);
}

function axisLabel(definition: PartTerminologyDefinition, axis: "FRONT" | "REAR" | null) {
  if (!axis) return "";
  if (isPluralPart(definition)) return axis === "FRONT" ? "передні" : "задні";
  return axis === "FRONT" ? "передній" : "задній";
}

function subPositionLabel(value: string | null) {
  if (value === "UPPER") return "верхній";
  if (value === "LOWER") return "нижній";
  if (value === "FRONT") return "передній";
  if (value === "REAR") return "задній";
  return "";
}

function operationLabel(value: string | null | undefined) {
  return clean(value, 180).toLocaleLowerCase("uk-UA");
}

/**
 * Converts an imported source name to the searchable detail → position →
 * operation shape. The source name is never discarded: the caller keeps it
 * in internalName/originalData and adds it to search aliases.
 */
export function normalizeServiceCatalogName(input: {
  sourceName?: string | null;
  part?: string | null;
  position?: string | null;
  side?: string | null;
  operation?: string | null;
}): ServiceNameNormalization {
  const sourceName = clean(input.sourceName, 1000);
  const extracted = extractOperation(sourceName);
  const explicitPart = clean(input.part, 180);
  const subject = explicitPart || extracted.subject;
  const definition = resolveCanonicalDefinition(sourceName, explicitPart);
  const resolution = resolvePartTerminology({
    query: sourceName,
    partName: explicitPart || undefined,
    side: input.side || undefined,
    position: input.position || undefined,
  });
  const canonicalPart = definition?.canonicalName || explicitPart || extracted.subject;
  const axis = resolution.attributes.axis;
  const subPosition = resolution.attributes.subPosition;
  const position = clean(input.position)
    || (definition ? [axisLabel(definition, axis), subPositionLabel(subPosition)]
      .filter((value, index, values) => value && values.indexOf(value) === index).join(" ") : "");
  const side = clean(input.side, 40)
    || (resolution.attributes.side === "LEFT" ? "лівий" : resolution.attributes.side === "RIGHT" ? "правий" : "");
  const operation = operationLabel(input.operation) || operationLabel(extracted.operation);
  const displayName = canonicalPart && operation
    ? buildServiceDisplayName({ part: canonicalPart, position, side, operation })
    : sourceName || buildServiceDisplayName({ part: canonicalPart, position, side, operation });

  return {
    part: canonicalPart || null,
    position: position || null,
    side: side || null,
    operation: operation || null,
    canonicalPartCode: definition?.code || null,
    displayName,
  };
}

export function buildServiceDisplayName(parts: ServiceNameParts) {
  const part = clean(parts.part);
  const position = clean(parts.position);
  const side = clean(parts.side, 40);
  const operation = clean(parts.operation);
  const subject = [part, position, side].filter(Boolean).join(" ");
  if (!subject) return operation ? capitalize(operation) : "";
  return `${capitalize(subject)}${operation ? ` — ${operation.toLocaleLowerCase("uk-UA")}` : ""}`;
}

export function buildServiceSearchAliases(input: AliasInput) {
  const part = clean(input.part);
  const position = clean(input.position);
  const side = clean(input.side, 40);
  const operation = clean(input.operation);
  const displayName = clean(input.displayName, 1000);
  const internalName = clean(input.internalName, 1000);
  const code = clean(input.code, 64);
  const externalServiceId = clean(input.externalServiceId, 64);
  const canonicalCode = clean(input.canonicalCode, 80);
  const definition = resolvePartTerminology({ query: part, partName: part }).definition;
  const partAliases = unique([...(input.partAliases || []), ...(definition?.aliases || []), definition?.canonicalName || ""]);
  const positionalAliases = partAliases.flatMap((alias) => [
    [alias, position].filter(Boolean).join(" "),
    [alias, side].filter(Boolean).join(" "),
    [alias, position, side].filter(Boolean).join(" "),
    [alias, operation].filter(Boolean).join(" "),
  ]);
  const candidates = [
    ...(input.existing || []),
    displayName,
    internalName,
    ...partAliases,
    ...positionalAliases,
    part,
    [part, position].filter(Boolean).join(" "),
    [part, side].filter(Boolean).join(" "),
    [part, operation].filter(Boolean).join(" "),
    [part, position, side].filter(Boolean).join(" "),
    [part, position, side, operation].filter(Boolean).join(" "),
    canonicalCode,
    code,
    externalServiceId,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of candidates) {
    const cleaned = clean(value, 1000);
    if (!cleaned) continue;
    const key = normalized(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= 40) break;
  }
  return result;
}

export function bodySideLabel(value: string | null | undefined) {
  return value === "LEFT" ? "лівий" : value === "RIGHT" ? "правий" : "";
}

export function calculatorOperationLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    REPLACE_NO_PAINT: "заміна без фарбування",
    REPLACE_WITH_PAINT: "заміна з фарбуванням",
    PAINT_NO_REPAIR: "фарбування без ремонту",
    LIGHT_REPAIR: "легкий ремонт",
    LIGHT_REPAIR_PAINT: "легкий ремонт з фарбуванням",
    COMPLEX_REPAIR: "складний ремонт",
    COMPLEX_REPAIR_PAINT: "складний ремонт з фарбуванням",
  };
  return value ? labels[value] || "" : "";
}
