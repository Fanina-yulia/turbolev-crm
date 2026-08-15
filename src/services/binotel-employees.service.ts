import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { getBinotelService } from "@/src/services/binotel.service";

type JsonRecord = Record<string, unknown>;

export type BinotelEmployee = {
  providerId: string | null;
  internalNumber: string;
  name: string | null;
  email: string | null;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(obj: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" || typeof value === "number") {
      const result = String(value).trim();
      if (result) return result;
    }
  }
  return null;
}

function normalizeInternal(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\D/g, "");
  return normalized && normalized.length <= 8 ? normalized : null;
}

function candidate(obj: JsonRecord): BinotelEmployee | null {
  const internalNumber = normalizeInternal(text(obj, [
    "internalNumber",
    "internalPhone",
    "extension",
    "shortNumber",
    "internalAdditionalData",
  ]));
  if (!internalNumber) return null;

  const name = text(obj, ["name", "fullName", "employeeName", "displayName"]);
  const email = text(obj, ["email", "employeeEmail", "mail"])?.toLowerCase() || null;
  const providerId = text(obj, ["id", "employeeID", "employeeId", "userID", "userId"]);
  return { providerId, internalNumber, name, email };
}

function walk(value: unknown, out: BinotelEmployee[], depth = 0) {
  if (depth > 5 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out, depth + 1);
    return;
  }
  const obj = record(value);
  if (!obj) return;
  const found = candidate(obj);
  if (found) out.push(found);
  for (const nested of Object.values(obj)) {
    if (nested && typeof nested === "object") walk(nested, out, depth + 1);
  }
}

export async function getSafeBinotelEmployees() {
  const raw = await getBinotelService().testConnection();
  const found: BinotelEmployee[] = [];
  walk(raw, found);

  const unique = new Map<string, BinotelEmployee>();
  for (const employee of found) {
    const previous = unique.get(employee.internalNumber);
    if (!previous || (!previous.email && employee.email) || (!previous.name && employee.name)) {
      unique.set(employee.internalNumber, employee);
    }
  }

  const employees = [...unique.values()].sort((a, b) =>
    a.internalNumber.localeCompare(b.internalNumber, "uk", { numeric: true }),
  );

  const users = await getPrisma().user.findMany({
    where: { isActive: true },
    select: { id: true, name: true, email: true, internalNumber: true },
    orderBy: { name: "asc" },
  });

  return employees.map((employee) => {
    const byNumber = users.find((user) => user.internalNumber === employee.internalNumber);
    const byEmail = employee.email
      ? users.find((user) => user.email?.trim().toLowerCase() === employee.email)
      : undefined;
    const linked = byNumber || byEmail || null;
    return {
      ...employee,
      crmUser: linked ? {
        id: linked.id,
        name: linked.name,
        email: linked.email,
        internalNumber: linked.internalNumber,
        match: byNumber ? "INTERNAL_NUMBER" as const : "EMAIL" as const,
      } : null,
    };
  });
}
