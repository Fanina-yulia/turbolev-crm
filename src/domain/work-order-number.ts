const WORK_ORDER_PREFIX = "ЗН";
const WORK_ORDER_DIGITS = 6;

export function formatWorkOrderNumber(value: number | null | undefined) {
  if (!Number.isSafeInteger(value) || !value || value < 1) return `${WORK_ORDER_PREFIX}-—`;
  return `${WORK_ORDER_PREFIX}-${String(value).padStart(WORK_ORDER_DIGITS, "0")}`;
}

export function parseWorkOrderNumber(input: string) {
  const normalized = input.trim().toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^(?:ЗН|ZN)?[-№#]?0*(\d+)$/u);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
