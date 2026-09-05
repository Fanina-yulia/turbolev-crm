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
  manualPartId: string | null;
  kind: "LABOR" | "PART";
  description: string;
  article: string | null;
  brand: string | null;
  position: string | null;
  quantity: number;
  note: string | null;
  inspection: string;
  section: string;
  checkName: string;
  action: string;
  urgency: string;
  imported: boolean;
  lineId: string | null;
  sourceEntity: string;
  sourceEntityId: string;
};

const SOURCE_ENTITY = "DIAGNOSTIC_FINDING";
const MANUAL_SOURCE_ENTITY = "DIAGNOSTIC_MANUAL_PART";

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

  const automaticCandidates = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => {
    const finding = item.finding;
    if (!finding?.id) return [];
    const common = {
      findingId: finding.id,
      manualPartId: null,
      inspection: inspection.templateName,
      section: section.name,
      checkName: item.name,
      action: finding.action,
      urgency: finding.urgency,
    };
    const rows: Array<Omit<Suggestion, "imported" | "lineId">> = [];
    if (finding.suggestedWorkName?.trim()) rows.push({ ...common, key: `${finding.id}:LABOR`, kind: "LABOR", description: finding.suggestedWorkName.trim(), article: null, brand: null, position: item.position, quantity: 1, note: finding.findingText || item.note || null, sourceEntity: SOURCE_ENTITY, sourceEntityId: `${finding.id}:LABOR` });
    const partName = finding.suggestedPartName?.trim() || (finding.action === "REPLACE" ? item.name?.trim() : "");
    if (partName) rows.push({ ...common, key: `${finding.id}:PART`, kind: "PART", description: partName, article: null, brand: null, position: item.position, quantity: 1, note: finding.findingText || item.note || null, sourceEntity: SOURCE_ENTITY, sourceEntityId: `${finding.id}:PART` });
    return rows;
  })));

  const manualParts = await prisma.diagnosticPartRecommendation.findMany({
    where: { diagnosticRequestId, status: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const manualCandidates: Array<Omit<Suggestion, "imported" | "lineId">> = manualParts.map((part) => ({
    key: `manual:${part.id}`,
    findingId: part.findingId || "",
    manualPartId: part.id,
    kind: "PART",
    description: part.name,
    article: part.article,
    brand: part.brand,
    position: part.position,
    quantity: Number(part.quantity),
    note: part.note,
    inspection: "Ручна рекомендація",
    section: part.position || "Додано сервіс-менеджером",
    checkName: part.name,
    action: "REPLACE",
    urgency: "INFO",
    sourceEntity: MANUAL_SOURCE_ENTITY,
    sourceEntityId: part.id,
  }));
  const candidates = [...automaticCandidates, ...manualCandidates];
  const automaticKeys = automaticCandidates.map((item) => item.sourceEntityId);
  const manualKeys = manualCandidates.map((item) => item.sourceEntityId);
  const existing = automaticKeys.length || manualKeys.length ? await prisma.workOrderLine.findMany({
    where: {
      workOrderId: view.diagnostic.workOrder.id,
      OR: [
        ...(automaticKeys.length ? [{ sourceEntity: SOURCE_ENTITY, sourceEntityId: { in: automaticKeys } }] : []),
        ...(manualKeys.length ? [{ sourceEntity: MANUAL_SOURCE_ENTITY, sourceEntityId: { in: manualKeys } }] : []),
      ],
      status: { not: "CANCELLED" },
    },
    select: { id: true, sourceEntityId: true },
  }) : [];
  const existingByKey = new Map(existing.flatMap((line) => line.sourceEntityId ? [[line.sourceEntityId, line.id] as const] : []));
  const suggestions: Suggestion[] = candidates.map((item) => ({ ...item, imported: existingByKey.has(item.sourceEntityId), lineId: existingByKey.get(item.sourceEntityId) || null }));

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
  const findingIds = Array.from(new Set(pending.map((item) => item.findingId).filter(Boolean)));
  const issueRows = findingIds.length
    ? await prisma.vehicleIssue.findMany({
        where: { sourceFindingId: { in: findingIds } },
        select: { id: true, sourceFindingId: true },
      })
    : [];
  const issueByFinding = new Map(issueRows.flatMap((issue) => issue.sourceFindingId ? [[issue.sourceFindingId, issue.id] as const] : []));

  for (const suggestion of pending) {
    const duplicate = await prisma.workOrderLine.findFirst({
      where: {
        workOrderId: workOrder.id,
        sourceEntity: suggestion.sourceEntity,
        sourceEntityId: suggestion.sourceEntityId,
        status: { not: "CANCELLED" },
      },
      select: { id: true },
    });
    if (duplicate) continue;

    const result = await createWorkOrderLine(workOrder.id, {
      type: suggestion.kind,
      status: "DRAFT",
      description: suggestion.description,
      article: suggestion.article,
      brand: suggestion.brand,
      unit: suggestion.kind === "LABOR" ? "робота" : "шт",
      plannedQuantity: suggestion.quantity,
      plannedUnitPrice: 0,
      plannedUnitCost: 0,
      sourceEntity: suggestion.sourceEntity,
      sourceEntityId: suggestion.sourceEntityId,
      metadata: {
        source: suggestion.manualPartId ? "DIAGNOSTIC_MANUAL_PART" : "DIAGNOSTIC_RECOMMENDATION",
        diagnosticRequestId,
        findingId: suggestion.findingId || null,
        manualPartId: suggestion.manualPartId,
        vehicleIssueId: suggestion.findingId ? issueByFinding.get(suggestion.findingId) || null : null,
        inspection: suggestion.inspection,
        section: suggestion.section,
        checkName: suggestion.checkName,
        action: suggestion.action,
        urgency: suggestion.urgency,
        position: suggestion.position,
        note: suggestion.note,
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
