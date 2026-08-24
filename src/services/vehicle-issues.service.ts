import { VehicleIssueStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";

const ACTIVE_STATUSES: VehicleIssueStatus[] = [
  VehicleIssueStatus.OPEN,
  VehicleIssueStatus.DECISION_REQUIRED,
  VehicleIssueStatus.QUOTED,
  VehicleIssueStatus.WAITING_CUSTOMER,
  VehicleIssueStatus.APPROVED,
  VehicleIssueStatus.WAITING_PARTS,
  VehicleIssueStatus.READY_FOR_REPAIR,
  VehicleIssueStatus.IN_REPAIR,
  VehicleIssueStatus.DEFERRED,
];
const TERMINAL_STATUSES: VehicleIssueStatus[] = [VehicleIssueStatus.RESOLVED, VehicleIssueStatus.DISMISSED];

export class VehicleIssueError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "VehicleIssueError";
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function findingIdFromSource(sourceEntity: string | null, sourceEntityId: string | null) {
  if (sourceEntity !== "DIAGNOSTIC_FINDING" || !sourceEntityId) return null;
  if (sourceEntityId.endsWith(":LABOR")) return sourceEntityId.slice(0, -6);
  if (sourceEntityId.endsWith(":PART")) return sourceEntityId.slice(0, -5);
  return sourceEntityId;
}

async function loadIssueLineStates(workOrderId: string) {
  const prisma = getPrisma();
  const lines = await prisma.workOrderLine.findMany({
    where: { workOrderId, sourceEntity: "DIAGNOSTIC_FINDING" },
    select: { id: true, status: true, sourceEntity: true, sourceEntityId: true, metadata: true },
  });

  const unresolvedFindingIds = Array.from(new Set(lines.flatMap((line) => {
    const metadata = jsonRecord(line.metadata);
    if (clean(metadata.vehicleIssueId, 160)) return [];
    const findingId = findingIdFromSource(line.sourceEntity, line.sourceEntityId);
    return findingId ? [findingId] : [];
  })));
  const fallbackIssues = unresolvedFindingIds.length
    ? await prisma.vehicleIssue.findMany({
        where: { sourceFindingId: { in: unresolvedFindingIds } },
        select: { id: true, sourceFindingId: true },
      })
    : [];
  const issueByFinding = new Map(fallbackIssues.flatMap((issue) => issue.sourceFindingId ? [[issue.sourceFindingId, issue.id] as const] : []));
  const states = new Map<string, string[]>();

  for (const line of lines) {
    const metadata = jsonRecord(line.metadata);
    const findingId = findingIdFromSource(line.sourceEntity, line.sourceEntityId);
    const metadataIssueId = clean(metadata.vehicleIssueId, 160) || null;
    const issueId = metadataIssueId || (findingId ? issueByFinding.get(findingId) || null : null);
    if (!issueId) continue;
    const current = states.get(issueId) || [];
    current.push(line.status);
    states.set(issueId, current);

    if (!metadataIssueId) {
      await prisma.workOrderLine.update({
        where: { id: line.id },
        data: {
          metadata: toPrismaJson({
            ...metadata,
            vehicleIssueId: issueId,
            findingId: clean(metadata.findingId, 160) || findingId,
          }),
        },
      });
    }
  }

  return states;
}

export async function syncVehicleIssuesFromDiagnostic(diagnosticRequestId: string) {
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const vehicleId = view.diagnostic.vehicle.id;
  const detectedAt = view.diagnostic.review.confirmedAt ? new Date(view.diagnostic.review.confirmedAt) : new Date();
  const prisma = getPrisma();
  let created = 0;
  let updated = 0;

  for (const inspection of view.inspections) {
    for (const section of inspection.sections) {
      for (const item of section.items) {
        if (item.state !== "ATTENTION" && item.state !== "DEFECT") continue;
        const finding = item.finding;
        if (!finding?.id) continue;

        const title = clean(item.name, 240) || "Виявлена несправність";
        const description = clean(finding.findingText || item.note, 1000) || null;
        const sourceTemplateItemId = clean(item.templateItemId, 160) || null;
        const sourcePosition = clean(item.position, 120) || null;

        const byFinding = await prisma.vehicleIssue.findUnique({ where: { sourceFindingId: finding.id } });
        if (byFinding) {
          await prisma.vehicleIssue.update({
            where: { id: byFinding.id },
            data: {
              sourceDiagnosticId: diagnosticRequestId,
              title,
              description,
              action: finding.action || null,
              urgency: finding.urgency || null,
              suggestedWorkName: finding.suggestedWorkName || null,
              suggestedPartName: finding.suggestedPartName || null,
              lastDetectedAt: detectedAt,
            },
          });
          updated += 1;
          continue;
        }

        const reusable = sourceTemplateItemId
          ? await prisma.vehicleIssue.findFirst({
              where: {
                vehicleId,
                sourceTemplateItemId,
                sourcePosition,
                status: { in: ACTIVE_STATUSES },
              },
              orderBy: { lastDetectedAt: "desc" },
            })
          : null;

        if (reusable) {
          await prisma.vehicleIssue.update({
            where: { id: reusable.id },
            data: {
              sourceFindingId: finding.id,
              sourceDiagnosticId: diagnosticRequestId,
              title,
              description,
              action: finding.action || null,
              urgency: finding.urgency || null,
              suggestedWorkName: finding.suggestedWorkName || null,
              suggestedPartName: finding.suggestedPartName || null,
              lastDetectedAt: detectedAt,
              status: reusable.status === VehicleIssueStatus.OPEN ? VehicleIssueStatus.DECISION_REQUIRED : reusable.status,
            },
          });
          updated += 1;
          continue;
        }

        await prisma.vehicleIssue.create({
          data: {
            vehicleId,
            sourceFindingId: finding.id,
            sourceDiagnosticId: diagnosticRequestId,
            sourceTemplateItemId,
            sourcePosition,
            title,
            description,
            action: finding.action || null,
            urgency: finding.urgency || null,
            suggestedWorkName: finding.suggestedWorkName || null,
            suggestedPartName: finding.suggestedPartName || null,
            status: VehicleIssueStatus.DECISION_REQUIRED,
            firstDetectedAt: detectedAt,
            lastDetectedAt: detectedAt,
          },
        });
        created += 1;
      }
    }
  }

  return { vehicleId, created, updated };
}

export async function listVehicleIssues(vehicleId: string, scope: "active" | "resolved" | "all" = "active") {
  const prisma = getPrisma();
  const status = scope === "active"
    ? { in: ACTIVE_STATUSES }
    : scope === "resolved"
      ? { in: [VehicleIssueStatus.RESOLVED, VehicleIssueStatus.DISMISSED] }
      : undefined;
  return prisma.vehicleIssue.findMany({
    where: { vehicleId, ...(status ? { status } : {}) },
    orderBy: [{ status: "asc" }, { lastDetectedAt: "desc" }],
    take: 250,
  });
}

export async function updateVehicleIssue(input: {
  issueId: string;
  action: "DEFER" | "DISMISS" | "REOPEN";
  comment?: string | null;
  deferredUntil?: string | null;
  userId?: string | null;
}) {
  const prisma = getPrisma();
  const issue = await prisma.vehicleIssue.findUnique({ where: { id: input.issueId } });
  if (!issue) throw new VehicleIssueError("NOT_FOUND", "Проблему автомобіля не знайдено.", 404);
  const comment = clean(input.comment, 1000) || null;

  if (input.action === "DEFER") {
    return prisma.vehicleIssue.update({
      where: { id: issue.id },
      data: {
        status: VehicleIssueStatus.DEFERRED,
        deferredUntil: input.deferredUntil ? new Date(input.deferredUntil) : null,
        resolutionNote: comment,
      },
    });
  }
  if (input.action === "DISMISS") {
    if (!comment) throw new VehicleIssueError("COMMENT_REQUIRED", "Вкажіть причину відхилення проблеми.");
    return prisma.vehicleIssue.update({
      where: { id: issue.id },
      data: {
        status: VehicleIssueStatus.DISMISSED,
        resolvedAt: new Date(),
        resolvedByUserId: input.userId || null,
        resolutionNote: comment,
      },
    });
  }
  return prisma.vehicleIssue.update({
    where: { id: issue.id },
    data: {
      status: VehicleIssueStatus.DECISION_REQUIRED,
      deferredUntil: null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNote: comment,
    },
  });
}

export async function reconcileWorkOrderIssueLinks(workOrderId: string) {
  const prisma = getPrisma();
  const states = await loadIssueLineStates(workOrderId);
  const activeIssueIds = Array.from(states.entries())
    .filter(([, lineStates]) => lineStates.some((status) => status !== "CANCELLED"))
    .map(([issueId]) => issueId);

  if (activeIssueIds.length) {
    await prisma.vehicleIssue.updateMany({
      where: { id: { in: activeIssueIds }, status: { notIn: TERMINAL_STATUSES } },
      data: { workOrderId },
    });
    await prisma.vehicleIssue.updateMany({
      where: { id: { in: activeIssueIds }, status: { in: [VehicleIssueStatus.OPEN, VehicleIssueStatus.DECISION_REQUIRED] } },
      data: { status: VehicleIssueStatus.QUOTED },
    });
  }

  const detached = await prisma.vehicleIssue.findMany({
    where: {
      workOrderId,
      status: { notIn: TERMINAL_STATUSES },
      ...(activeIssueIds.length ? { id: { notIn: activeIssueIds } } : {}),
    },
    select: { id: true, status: true },
  });
  const deferredIds = detached.filter((issue) => issue.status === VehicleIssueStatus.DEFERRED).map((issue) => issue.id);
  const resetIds = detached.filter((issue) => issue.status !== VehicleIssueStatus.DEFERRED).map((issue) => issue.id);
  if (deferredIds.length) {
    await prisma.vehicleIssue.updateMany({ where: { id: { in: deferredIds } }, data: { workOrderId: null } });
  }
  if (resetIds.length) {
    await prisma.vehicleIssue.updateMany({
      where: { id: { in: resetIds } },
      data: { workOrderId: null, status: VehicleIssueStatus.DECISION_REQUIRED },
    });
  }

  return { linked: activeIssueIds.length, detached: detached.length };
}

export async function markDiagnosticIssuesQuoted(diagnosticRequestId: string, workOrderId: string) {
  await syncVehicleIssuesFromDiagnostic(diagnosticRequestId);
  return reconcileWorkOrderIssueLinks(workOrderId);
}

export async function markWorkOrderIssues(workOrderId: string, status: VehicleIssueStatus) {
  const prisma = getPrisma();
  await reconcileWorkOrderIssueLinks(workOrderId);
  const states = await loadIssueLineStates(workOrderId);
  const activeEntries = Array.from(states.entries()).filter(([, lineStates]) => lineStates.some((lineStatus) => lineStatus !== "CANCELLED"));
  const targetIssueIds = status === VehicleIssueStatus.RESOLVED
    ? activeEntries
        .filter(([, lineStates]) => {
          const activeLineStates = lineStates.filter((lineStatus) => lineStatus !== "CANCELLED");
          return activeLineStates.length > 0 && activeLineStates.every((lineStatus) => lineStatus === "COMPLETED");
        })
        .map(([issueId]) => issueId)
    : activeEntries.map(([issueId]) => issueId);

  if (!targetIssueIds.length) {
    return { count: 0, linked: activeEntries.length, skippedIncomplete: status === VehicleIssueStatus.RESOLVED ? activeEntries.length : 0 };
  }

  const result = await prisma.vehicleIssue.updateMany({
    where: {
      id: { in: targetIssueIds },
      workOrderId,
      status: status === VehicleIssueStatus.RESOLVED
        ? { notIn: [VehicleIssueStatus.RESOLVED, VehicleIssueStatus.DISMISSED] }
        : { notIn: [VehicleIssueStatus.RESOLVED, VehicleIssueStatus.DISMISSED, VehicleIssueStatus.DEFERRED] },
    },
    data: {
      status,
      ...(status === VehicleIssueStatus.RESOLVED ? {
        resolvedAt: new Date(),
        resolutionNote: "Усунено після виконання пов’язаних робіт і успішного контролю якості.",
      } : {}),
    },
  });

  return {
    count: result.count,
    linked: activeEntries.length,
    skippedIncomplete: status === VehicleIssueStatus.RESOLVED ? activeEntries.length - targetIssueIds.length : 0,
  };
}
