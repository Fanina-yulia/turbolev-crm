export function normalizePhone(input: unknown): string {
  if (input === null || input === undefined) return "";

  const raw = String(input).trim();
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  // International prefix 00XXXXXXXX -> XXXXXXXX.
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Ukrainian national format 0XXXXXXXXX -> 380XXXXXXXXX.
  if (digits.length === 10 && digits.startsWith("0")) {
    digits = `38${digits}`;
  }

  // Canonical CRM key contains digits only. This is the value stored in
  // phoneNormalized and used for deduplication/matching.
  return digits;
}

export function phoneVariants(input: unknown): string[] {
  const normalized = normalizePhone(input);
  if (!normalized) return [];

  const variants = new Set<string>([normalized, `+${normalized}`]);

  if (normalized.length === 12 && normalized.startsWith("380")) {
    variants.add(`0${normalized.slice(3)}`);
  }

  return [...variants];
}
