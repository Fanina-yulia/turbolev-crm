import { DiagnosticRequestStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";
import { createWorkOrderLine } from "@/src/services/work-order-lines.service";

export class DiagnosticCommercialHandoffError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DiagnosticCommercialHandoffError";
    this.code = code;
    this.status = status;
  }
}

type Suggestion = {
  key: string;
  findingId: string;
  kind: "LABOR" | "PART";
  description: string;
  inspection: string;
  section: string;
  checkName: string;
  action: string;
  urgency: string;
  imported: boolean;
  lineId: string | null;
};

const SOURCE_ENTITY = "DIAGNOSTIC_FINDING";

async function buildSuggestions(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  if (view.diagnostic.status !== DiagnosticRequestStatus.CONFIRMED || !view.diagnostic.workOrder) {
    throw new DiagnosticCommercialHandoffError(
      "DIAGNOSTIC_NOT_CONFIRMED",
      "Рекомендації можна перенести в кошторис після підтвердження діагностики та створення WorkOrder.",
      409,
    );
  }

  const candidates = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => {
    const finding = item.finding;
    if (!finding?.id) return [];
    const common = {
      findingId: finding.id,
      inspection: inspection.templateName,
      section: section.name,
      checkName: item.name,
      action: finding.action,
      urgency: finding.urgency,
    };
    const rows: Array<Omit<Suggestion, "imported" | "lineId">> = [];
    if (finding.suggestedWorkName?.trim()) rows.push({ ...common, key: `${finding.id}:LABOR`, kind: "LABOR", description: finding.suggestedWorkName.trim() });
    if (finding.suggestedPartName?.trim()) rows.push({ ...common, key: `${finding.id}:PART`, kind: "PART", description: finding.suggestedPartName.trim() });
    return rows;
  })));

  const keys = candidates.map((item) => item.key);
  const existing = keys.length ? await prisma.workOrderLine.findMany({
    where: {
      workOrderId: view.diagnostic.workOrder.id,
      sourceEntity: SOURCE_ENTITY,
      sourceEntityId: { in: keys },
      status: { not: "CANCELLED" },
    },
    select: { id: true, sourceEntityId: true },
  }) : [];
  const existingByKey = new Map(existing.flatMap((line) => line.sourceEntityId ? [[line.sourceEntityId, line.id] as const] : []));
  const suggestions: Suggestion[] = candidates.map((item) => ({ ...item, imported: existingByKey.has(item.key), lineId: existingByKey.get(item.key) || null }));

  return { view, workOrder: view.diagnostic.workOrder, suggestions };
}

export async function getDiagnosticCommercialHandoff(diagnosticRequestId: string) {
  const { workOrder, suggestions } = await buildSuggestions(diagnosticRequestId);
  return {
    workOrder,
    suggestions,
    counts: {
      total: suggestions.length,
      imported: suggestions.filter((item) => item.imported).length,
      pending: suggestions.filter((item) => !item.imported).length,
      labor: suggestions.filter((item) => item.kind === "LABOR").length,
      parts: suggestions.filter((item) => item.kind === "PART").length,
    },
  };
}

export async function importDiagnosticRecommendationsToEstimate(
  diagnosticRequestId: string,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  const { workOrder, suggestions } = await buildSuggestions(diagnosticRequestId);
  const pending = suggestions.filter((item) => !item.imported);
  const created: Array<{ key: string; lineId: string }> = [];

  for (const suggestion of pending) {
    const duplicate = await prisma.workOrderLine.findFirst({
      where: {
        workOrderId: workOrder.id,
        sourceEntity: SOURCE_ENTITY,
        sourceEntityId: suggestion.key,
        status: { not: "CANCELLED" },
      },
      select: { id: true },
    });
    if (duplicate) continue;

    const result = await createWorkOrderLine(workOrder.id, {
      type: suggestion.kind,
      status: "DRAFT",
      description: suggestion.description,
      unit: suggestion.kind === "LABOR" ? "робота" : "шт",
      plannedQuantity: 1,
      plannedUnitPrice: 0,
      plannedUnitCost: 0,
      sourceEntity: SOURCE_ENTITY,
      sourceEntityId: suggestion.key,
      metadata: {
        source: "DIAGNOSTIC_RECOMMENDATION",
        diagnosticRequestId,
        findingId: suggestion.findingId,
        inspection: suggestion.inspection,
        section: suggestion.section,
        checkName: suggestion.checkName,
        action: suggestion.action,
        urgency: suggestion.urgency,
      },
    }, actorName);
    created.push({ key: suggestion.key, lineId: result.line.id });
  }

  await prisma.auditEvent.create({
    data: {
      actorName,
      entityType: "DiagnosticRequest",
      entityId: diagnosticRequestId,
      action: "DIAGNOSTIC_RECOMMENDATIONS_IMPORTED_TO_ESTIMATE",
      metadata: toPrismaJson({
        workOrderId: workOrder.id,
        suggested: suggestions.length,
        created: created.length,
        alreadyImported: suggestions.length - pending.length,
        source: "STRUCTURED_DIAGNOSTIC",
      }),
    },
  });

  const refreshed = await getDiagnosticCommercialHandoff(diagnosticRequestId);
  return { ...refreshed, createdCount: created.length, created };
}
