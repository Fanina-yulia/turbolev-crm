const CYRILLIC_TO_LATIN: Record<string, string> = {
  "А": "A",
  "В": "B",
  "С": "C",
  "Е": "E",
  "Н": "H",
  "І": "I",
  "К": "K",
  "М": "M",
  "О": "O",
  "Р": "P",
  "Т": "T",
  "Х": "X",
  "У": "Y",
};

/**
 * Canonical form for Ukrainian registration plates.
 * Visually identical Cyrillic and Latin plate letters are treated as the same symbol.
 * Example: "КА 7584 СІ" and "KA7584CI" both become "KA7584CI".
 */
export function normalizeRegistrationPlate(value: string) {
  const compact = value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
  return [...compact]
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("")
    .slice(0, 10);
}

/**
 * Canonical human-readable form used by every CRM plate surface.
 * Standard Ukrainian plates are rendered as "AA 1234 BB".
 */
export function formatRegistrationPlate(value?: string | null) {
  const normalized = normalizeRegistrationPlate(value || "");
  const standard = normalized.match(/^([A-Z]{2})(\d{4})([A-Z]{2})$/);
  return standard ? `${standard[1]} ${standard[2]} ${standard[3]}` : normalized || "—";
}
