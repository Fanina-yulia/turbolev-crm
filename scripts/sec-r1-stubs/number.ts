export function parseWorkOrderNumber(value: string) { const n = Number(value.replace(/\D/g, "")); return Number.isFinite(n) && n > 0 ? n : null; }
