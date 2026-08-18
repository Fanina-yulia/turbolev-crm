import type { Prisma } from "@/src/generated/prisma/client";

function isPrismaInputJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => item === null || isPrismaInputJsonValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).every((item) => item === null || isPrismaInputJsonValue(item));
  }
  return false;
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Value is not JSON serializable");
  }
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable");

  const parsed: unknown = JSON.parse(serialized);
  if (!isPrismaInputJsonValue(parsed)) {
    throw new TypeError("Serialized value is not a valid Prisma JSON value");
  }
  return parsed;
}
