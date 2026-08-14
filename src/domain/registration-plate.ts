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
