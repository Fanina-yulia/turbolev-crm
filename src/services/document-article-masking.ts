/**
 * Masks the last three numeric characters of an article for customer-facing
 * documents while keeping separators and any letter suffix intact.
 */
export function maskDocumentArticle(value: string | number | null | undefined) {
  const source = String(value ?? "").trim();
  if (!source) return "";

  const digitIndexes = [...source].flatMap((character, index) => /[0-9]/.test(character) ? [index] : []);
  if (!digitIndexes.length) return source;

  const maskedIndexes = new Set(digitIndexes.slice(-3));
  return [...source].map((character, index) => maskedIndexes.has(index) ? "#" : character).join("");
}
