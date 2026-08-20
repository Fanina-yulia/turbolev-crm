import type { EmployeeDocumentContract, PersonnelItemContract } from "./crm-core";
import { isRecord, parsePersonnelItem } from "./crm-core.parsers";

export type PersonnelDocumentItem = EmployeeDocumentContract & { id: string };

export type PersonnelDirectoryItem = PersonnelItemContract & {
  employmentType: string | null;
  documents: PersonnelDocumentItem[];
};

export type PersonnelCatalogRole = {
  code: string;
  name: string;
  category: string | null;
  economicsMode: string;
  requiresLocation: boolean;
  description: string | null;
};

export type PersonnelCatalog = {
  roles: PersonnelCatalogRole[];
  locations: Array<{ id: string; name: string }>;
};

export type PersonnelListPayload = {
  ok: true;
  items: PersonnelDirectoryItem[];
};

export type PersonnelSavePayload = {
  ok: true;
  id: string;
};

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseArrayStrict<T>(value: unknown, parser: (item: unknown) => T | null) {
  if (!Array.isArray(value)) return null;
  const result: T[] = [];
  for (const item of value) {
    const parsed = parser(item);
    if (!parsed) return null;
    result.push(parsed);
  }
  return result;
}

export function payloadMessage(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback;
  const message = requiredString(value.message);
  if (message) return message;
  const error = requiredString(value.error);
  return error || fallback;
}

export function parsePersonnelDirectoryItem(value: unknown): PersonnelDirectoryItem | null {
  if (!isRecord(value)) return null;
  const base = parsePersonnelItem(value);
  if (!base) return null;
  const documents = parseArrayStrict(value.documents, (item): PersonnelDocumentItem | null => {
    if (!isRecord(item)) return null;
    const id = requiredString(item.id);
    const parsed = base.documents.find((document) => document.id === id);
    return id && parsed ? { ...parsed, id } : null;
  });
  if (!documents) return null;
  return {
    ...base,
    employmentType: nullableString(value.employmentType),
    documents,
  };
}

export function parsePersonnelListPayload(value: unknown): PersonnelListPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const items = parseArrayStrict(value.items, parsePersonnelDirectoryItem);
  return items ? { ok: true, items } : null;
}

function parseCatalogRole(value: unknown): PersonnelCatalogRole | null {
  if (!isRecord(value)) return null;
  const code = requiredString(value.code);
  const name = requiredString(value.name);
  const economicsMode = requiredString(value.economicsMode);
  if (!code || !name || !economicsMode || typeof value.requiresLocation !== "boolean") return null;
  return {
    code,
    name,
    category: nullableString(value.category),
    economicsMode,
    requiresLocation: value.requiresLocation,
    description: nullableString(value.description),
  };
}

function parseCatalogLocation(value: unknown) {
  if (!isRecord(value)) return null;
  const id = requiredString(value.id);
  const name = requiredString(value.name);
  return id && name ? { id, name } : null;
}

export function parsePersonnelCatalogPayload(value: unknown): (PersonnelCatalog & { ok: true }) | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const roles = parseArrayStrict(value.roles, parseCatalogRole);
  const locations = parseArrayStrict(value.locations, parseCatalogLocation);
  return roles && locations ? { ok: true, roles, locations } : null;
}

export function parsePersonnelSavePayload(value: unknown): PersonnelSavePayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const id = requiredString(value.id);
  return id ? { ok: true, id } : null;
}

export function parsePersonnelOkPayload(value: unknown) {
  return isRecord(value) && value.ok === true ? { ok: true as const } : null;
}
