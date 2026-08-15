import { getPrisma } from "@/src/lib/prisma";
import {
  EMPTY_WORKFLOW_PRESENTATION,
  WORKFLOW_PRESENTATION_SETTING_KEY,
  isWorkflowEntity,
  normalizeWorkflowPresentation,
  normalizeWorkflowStatusPresentationOverride,
  type WorkflowPresentationSettings,
  type WorkflowStatusPresentationOverride,
} from "@/src/domain/workflow/presentation";

type SettingRow = { value: unknown };

export async function loadWorkflowPresentationSettings(): Promise<WorkflowPresentationSettings> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<SettingRow[]>(
    `SELECT "value" FROM "CrmSetting" WHERE "key"=$1 LIMIT 1`,
    WORKFLOW_PRESENTATION_SETTING_KEY,
  );
  return rows[0] ? normalizeWorkflowPresentation(rows[0].value) : EMPTY_WORKFLOW_PRESENTATION;
}

export async function saveWorkflowPresentationSettings(settings: WorkflowPresentationSettings) {
  const prisma = getPrisma();
  const normalized = normalizeWorkflowPresentation(settings);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CrmSetting" ("key","value","updatedAt") VALUES ($1,$2::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value", "updatedAt"=CURRENT_TIMESTAMP`,
    WORKFLOW_PRESENTATION_SETTING_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
}

export async function updateWorkflowStatusPresentation(
  rawEntity: string,
  rawStatus: string,
  input: unknown,
): Promise<{ settings: WorkflowPresentationSettings; override: WorkflowStatusPresentationOverride }> {
  const entity = rawEntity.trim().toUpperCase();
  const status = rawStatus.trim().toUpperCase();
  if (!isWorkflowEntity(entity)) throw new Error("UNKNOWN_WORKFLOW_ENTITY");
  const override = normalizeWorkflowStatusPresentationOverride(entity, status, input);
  const current = await loadWorkflowPresentationSettings();
  const nextStatuses = { ...current.statuses };
  const currentEntity = { ...(nextStatuses[entity] ?? {}) };
  if (Object.keys(override).length) currentEntity[status] = override;
  else delete currentEntity[status];
  if (Object.keys(currentEntity).length) nextStatuses[entity] = currentEntity;
  else delete nextStatuses[entity];
  const settings = await saveWorkflowPresentationSettings({ version: 1, statuses: nextStatuses });
  return { settings, override };
}

export async function resetWorkflowStatusPresentation(rawEntity: string, rawStatus: string) {
  const entity = rawEntity.trim().toUpperCase();
  const status = rawStatus.trim().toUpperCase();
  if (!isWorkflowEntity(entity)) throw new Error("UNKNOWN_WORKFLOW_ENTITY");
  normalizeWorkflowStatusPresentationOverride(entity, status, {});
  const current = await loadWorkflowPresentationSettings();
  const nextStatuses = { ...current.statuses };
  const currentEntity = { ...(nextStatuses[entity] ?? {}) };
  delete currentEntity[status];
  if (Object.keys(currentEntity).length) nextStatuses[entity] = currentEntity;
  else delete nextStatuses[entity];
  return saveWorkflowPresentationSettings({ version: 1, statuses: nextStatuses });
}

export function workflowPresentationErrorMessage(code: string) {
  if (code === "UNKNOWN_WORKFLOW_ENTITY") return "Невідома сутність процесу.";
  if (code === "UNKNOWN_WORKFLOW_STATUS") return "Невідомий статус.";
  if (code === "WORKFLOW_STATUS_NOT_EDITABLE") return "Legacy/bridge статуси не редагуються.";
  return "Не вдалося зберегти налаштування статусу.";
}
