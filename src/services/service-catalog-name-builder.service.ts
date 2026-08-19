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
  existing?: string[] | null;
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
  const candidates = [
    ...(input.existing || []),
    displayName,
    internalName,
    code,
    externalServiceId,
    part,
    [part, position].filter(Boolean).join(" "),
    [part, side].filter(Boolean).join(" "),
    [part, operation].filter(Boolean).join(" "),
    [part, position, side].filter(Boolean).join(" "),
    [part, position, side, operation].filter(Boolean).join(" "),
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
    if (result.length >= 30) break;
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
