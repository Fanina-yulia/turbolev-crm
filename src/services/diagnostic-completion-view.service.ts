import { DiagnosticCheckState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import type { DiagnosticCompletion } from "@/src/services/diagnostic-completeness.service";

type ViewItem = {
  id?: string | null;
  templateItemId: string;
  state: DiagnosticCheckState | string;
};

type ViewSection = {
  code: string;
  items: ViewItem[];
};

type ViewInspection = {
  sections: ViewSection[];
};

const EMPTY_COMPLETION: DiagnosticCompletion = {
  canSubmit: false,
  total: 0,
  checked: 0,
  requiredTotal: 0,
  requiredChecked: 0,
  requiredRemaining: 0,
  optionalTotal: 0,
  optionalRemaining: 0,
  autoFillRemaining: 0,
};

/**
 * Uses the checks + section codes already loaded for the mechanic diagnostic view.
 * Only `isRequired` metadata is fetched, reducing the previous completion calculation
 * from multiple repeat reads (inspections/checks/items/sections) to one small query.
 */
export async function getCompletionFromMechanicView(inspections: ViewInspection[]): Promise<DiagnosticCompletion> {
  const rows = inspections.flatMap((inspection) => inspection.sections.flatMap((section) =>
    section.items
      .filter((item) => Boolean(item.id))
      .map((item) => ({ ...item, sectionCode: section.code })),
  ));
  if (!rows.length) return EMPTY_COMPLETION;

  const itemIds = Array.from(new Set(rows.map((item) => item.templateItemId).filter(Boolean)));
  const requiredMeta = itemIds.length
    ? await getPrisma().diagnosticTemplateItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, isRequired: true },
      })
    : [];
  const requiredById = new Map(requiredMeta.map((item) => [item.id, item.isRequired]));
  const isChecked = (state: DiagnosticCheckState | string) => state !== DiagnosticCheckState.NOT_CHECKED && state !== "NOT_CHECKED";

  const required = rows.filter((item) => requiredById.get(item.templateItemId) !== false);
  const optional = rows.filter((item) => requiredById.get(item.templateItemId) === false);
  const requiredChecked = required.filter((item) => isChecked(item.state)).length;
  const optionalChecked = optional.filter((item) => isChecked(item.state)).length;
  // Mechanics mark only problems. Unmarked checks are saved as OK on submit,
  // so an untouched check must never disable the completion action.
  const requiredBlocking: typeof required = [];
  const autoFillRemaining = required.filter((item) => !isChecked(item.state)).length;

  return {
    canSubmit: requiredBlocking.length === 0,
    total: rows.length,
    checked: requiredChecked + optionalChecked,
    requiredTotal: required.length,
    requiredChecked,
    requiredRemaining: requiredBlocking.length,
    optionalTotal: optional.length,
    optionalRemaining: optional.length - optionalChecked,
    autoFillRemaining,
  };
}
