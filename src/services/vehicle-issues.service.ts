import { VehicleIssueStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
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

export async function markDiagnosticIssuesQuoted(diagnosticRequestId: string, workOrderId: string) {
  const prisma = getPrisma();
  return prisma.vehicleIssue.updateMany({
    where: {
      sourceDiagnosticId: diagnosticRequestId,
      status: { in: [VehicleIssueStatus.OPEN, VehicleIssueStatus.DECISION_REQUIRED, VehicleIssueStatus.DEFERRED] },
    },
    data: { status: VehicleIssueStatus.QUOTED, workOrderId },
  });
}

export async function markWorkOrderIssues(workOrderId: string, status: VehicleIssueStatus) {
  const prisma = getPrisma();
  return prisma.vehicleIssue.updateMany({
    where: {
      workOrderId,
      status: { notIn: [VehicleIssueStatus.RESOLVED, VehicleIssueStatus.DISMISSED] },
    },
    data: {
      status,
      ...(status === VehicleIssueStatus.RESOLVED ? { resolvedAt: new Date() } : {}),
    },
  });
}
