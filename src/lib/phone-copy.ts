export type PhoneCandidate = {
  raw: string;
  value: string;
  start: number;
  end: number;
};

const UKRAINIAN_PHONE = /(?<!\d)(?:\+?\s*38[\s().-]*)?\(?0\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/g;
const INTERNATIONAL_PHONE = /(?<![\d+])\+\s*\d{1,3}(?:[\s().-]*\d){7,12}(?!\d)/g;

export function normalizePhoneForClipboard(raw: string) {
  const decoded = raw.trim().replace(/^tel:/i, "").split(/[?;]/, 1)[0] || "";
  const digits = decoded.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.length === 12 && digits.startsWith("380")) return `+${digits}`;
  return decoded.trim().startsWith("+") ? `+${digits}` : digits;
}

function candidatesForPattern(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  const matches: PhoneCandidate[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const value = normalizePhoneForClipboard(match[0]);
    if (!value) continue;
    matches.push({ raw: match[0].trim(), value, start: match.index, end: match.index + match[0].length });
  }

  return matches;
}

export function extractPhoneCandidates(text: string) {
  const candidates = [
    ...candidatesForPattern(text, UKRAINIAN_PHONE),
    ...candidatesForPattern(text, INTERNATIONAL_PHONE),
  ].sort((left, right) => left.start - right.start || right.end - left.end);

  return candidates.filter((candidate, index) => !candidates.some((other, otherIndex) => (
    otherIndex < index
    && other.start <= candidate.start
    && other.end >= candidate.end
  )));
}

export function phoneCandidateAtOffset(text: string, offset: number) {
  return extractPhoneCandidates(text).find((candidate) => offset >= candidate.start && offset <= candidate.end) || null;
}
