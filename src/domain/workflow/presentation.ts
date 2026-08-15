import { getWorkflowCatalog, getWorkflowDefinition } from "./engine";
import type { WorkflowEntity, WorkflowRole } from "./types";

export const WORKFLOW_PRESENTATION_SETTING_KEY = "workflow_presentation_v1";

export type WorkflowStatusPresentationOverride = {
  label?: string;
  color?: string;
  sortOrder?: number;
  slaMinutes?: number | null;
  visibleRoles?: WorkflowRole[];
  responsibleRoles?: WorkflowRole[];
};

export type WorkflowPresentationSettings = {
  version: 1;
  statuses: Partial<Record<WorkflowEntity, Record<string, WorkflowStatusPresentationOverride>>>;
};

export type EffectiveWorkflowStatusPresentation = {
  label: string;
  color: string | null;
  sortOrder: number;
  slaMinutes: number | null;
  visibleRoles: WorkflowRole[];
  responsibleRoles: WorkflowRole[];
  overridden: boolean;
};

const catalog = getWorkflowCatalog();
const roleCodes = new Set<WorkflowRole>(Object.keys(catalog.roles) as WorkflowRole[]);
const entityCodes = new Set<WorkflowEntity>(catalog.entities.map((item) => item.entity));

export const EMPTY_WORKFLOW_PRESENTATION: WorkflowPresentationSettings = { version: 1, statuses: {} };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim().replace(/\s+/g, " ").slice(0, 100);
  return label || undefined;
}

function cleanColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const color = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : undefined;
}

function cleanSortOrder(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(0, Math.min(9990, Math.round(number)));
}

function cleanSlaMinutes(value: unknown): number | null | undefined {
  if (value === null || value === "" || value === undefined) return value === undefined ? undefined : null;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.max(1, Math.min(43200, Math.round(number)));
}

function cleanRoles(value: unknown): WorkflowRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase() as WorkflowRole)
    .filter((item) => roleCodes.has(item))));
}

export function isWorkflowEntity(value: string): value is WorkflowEntity {
  return entityCodes.has(value as WorkflowEntity);
}

export function assertEditableWorkflowStatus(entity: WorkflowEntity, status: string) {
  const definition = getWorkflowDefinition(entity);
  const statusDefinition = definition.statuses.find((item) => item.code === status);
  if (!statusDefinition) throw new Error("UNKNOWN_WORKFLOW_STATUS");
  if (statusDefinition.legacy || statusDefinition.compatibilityOnly) throw new Error("WORKFLOW_STATUS_NOT_EDITABLE");
  return statusDefinition;
}

export function normalizeWorkflowStatusPresentationOverride(
  entity: WorkflowEntity,
  status: string,
  input: unknown,
): WorkflowStatusPresentationOverride {
  assertEditableWorkflowStatus(entity, status);
  const row = asRecord(input);
  const result: WorkflowStatusPresentationOverride = {};
  const label = cleanLabel(row.label);
  const color = cleanColor(row.color);
  const sortOrder = cleanSortOrder(row.sortOrder);
  const slaMinutes = cleanSlaMinutes(row.slaMinutes);
  const visibleRoles = cleanRoles(row.visibleRoles);
  const responsibleRoles = cleanRoles(row.responsibleRoles);
  if (label !== undefined) result.label = label;
  if (color !== undefined) result.color = color;
  if (sortOrder !== undefined) result.sortOrder = sortOrder;
  if (slaMinutes !== undefined) result.slaMinutes = slaMinutes;
  if (visibleRoles !== undefined) result.visibleRoles = visibleRoles;
  if (responsibleRoles !== undefined) result.responsibleRoles = responsibleRoles;
  return result;
}

export function normalizeWorkflowPresentation(input: unknown): WorkflowPresentationSettings {
  const root = asRecord(input);
  const rawStatuses = asRecord(root.statuses);
  const statuses: WorkflowPresentationSettings["statuses"] = {};

  for (const [rawEntity, rawEntityStatuses] of Object.entries(rawStatuses)) {
    const entity = rawEntity.trim().toUpperCase();
    if (!isWorkflowEntity(entity)) continue;
    const definition = getWorkflowDefinition(entity);
    const entityStatuses: Record<string, WorkflowStatusPresentationOverride> = {};
    for (const [statusCode, rawOverride] of Object.entries(asRecord(rawEntityStatuses))) {
      const status = definition.statuses.find((item) => item.code === statusCode);
      if (!status || status.legacy || status.compatibilityOnly) continue;
      const row = asRecord(rawOverride);
      const override: WorkflowStatusPresentationOverride = {};
      const label = cleanLabel(row.label);
      const color = cleanColor(row.color);
      const sortOrder = cleanSortOrder(row.sortOrder);
      const slaMinutes = cleanSlaMinutes(row.slaMinutes);
      const visibleRoles = cleanRoles(row.visibleRoles);
      const responsibleRoles = cleanRoles(row.responsibleRoles);
      if (label !== undefined) override.label = label;
      if (color !== undefined) override.color = color;
      if (sortOrder !== undefined) override.sortOrder = sortOrder;
      if (slaMinutes !== undefined) override.slaMinutes = slaMinutes;
      if (visibleRoles !== undefined) override.visibleRoles = visibleRoles;
      if (responsibleRoles !== undefined) override.responsibleRoles = responsibleRoles;
      if (Object.keys(override).length) entityStatuses[statusCode] = override;
    }
    if (Object.keys(entityStatuses).length) statuses[entity] = entityStatuses;
  }

  return { version: 1, statuses };
}

export function getEffectiveWorkflowStatusPresentation(
  entity: WorkflowEntity,
  status: string,
  settings: WorkflowPresentationSettings,
): EffectiveWorkflowStatusPresentation {
  const definition = getWorkflowDefinition(entity);
  const canonical = definition.statuses.find((item) => item.code === status);
  if (!canonical) throw new Error("UNKNOWN_WORKFLOW_STATUS");
  const override = settings.statuses[entity]?.[status];
  return {
    label: override?.label ?? canonical.label,
    color: override?.color ?? null,
    sortOrder: override?.sortOrder ?? canonical.sortOrder,
    slaMinutes: override?.slaMinutes ?? null,
    visibleRoles: override?.visibleRoles ? [...override.visibleRoles] : (Object.keys(catalog.roles) as WorkflowRole[]),
    responsibleRoles: override?.responsibleRoles ? [...override.responsibleRoles] : [...(canonical.responsibleRoles ?? [])],
    overridden: Boolean(override && Object.keys(override).length),
  };
}
