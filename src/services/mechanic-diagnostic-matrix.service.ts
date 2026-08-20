import {
  DiagnosticInspectionStatus,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  ensureDefaultDiagnosticTemplates,
  getMechanicByUserId,
  getStructuredDiagnosticForMechanic,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";

function requestedTemplateCode(problem: string | null | undefined) {
  const text = (problem || "").toLocaleLowerCase("uk-UA");
  if (/(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test(text)) return "SUSPENSION";
  if (/(гальм|колод|супорт|гальмів|тормоз|диск)/u.test(text)) return "BRAKES";
  if (/(комп'ют|компют|check engine|помилк|електрон|діагностик.*двиг)/u.test(text)) return "COMPUTER_DIAGNOSTICS";
  return "BASIC_INSPECTION";
}

export async function startMechanicDiagnosticByType(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  if (!assignment || assignment.mechanicId !== mechanic.id) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
  }

  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    include: { lead: { select: { need: true, comment: true } } },
  });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  if (
    diagnostic.status === DiagnosticRequestStatus.CONFIRMED
    || diagnostic.status === DiagnosticRequestStatus.CANCELLED
  ) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  }

  const review = await prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } });
  if (review?.state === DiagnosticReviewState.SUBMITTED || review?.state === DiagnosticReviewState.CONFIRMED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  }

  await ensureDefaultDiagnosticTemplates();
  const inspectionCount = await prisma.diagnosticInspection.count({ where: { diagnosticRequestId } });

  if (!inspectionCount) {
    const problem = [diagnostic.lead?.need, diagnostic.lead?.comment].filter(Boolean).join(" · ");
    const code = requestedTemplateCode(problem);
    const template = await prisma.diagnosticTemplate.findFirst({ where: { code, isActive: true } });
    if (!template) throw new StructuredDiagnosticError("TEMPLATE_NOT_FOUND", "Шаблон діагностики не знайдено.", 404);

    const sections = await prisma.diagnosticTemplateSection.findMany({
      where: { templateId: template.id },
      select: { id: true },
    });
    const items = sections.length
      ? await prisma.diagnosticTemplateItem.findMany({
          where: { sectionId: { in: sections.map((item) => item.id) } },
          select: { id: true },
        })
      : [];

    await prisma.$transaction(async (tx) => {
      const inspection = await tx.diagnosticInspection.create({
        data: {
          diagnosticRequestId,
          templateId: template.id,
          mechanicId: mechanic.id,
          status: DiagnosticInspectionStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });
      if (items.length) {
        await tx.diagnosticCheck.createMany({
          data: items.map((item) => ({ inspectionId: inspection.id, templateItemId: item.id })),
          skipDuplicates: true,
        });
      }
    });
  }

  if (diagnostic.status === DiagnosticRequestStatus.PENDING) {
    await prisma.diagnosticRequest.update({
      where: { id: diagnosticRequestId },
      data: { status: DiagnosticRequestStatus.IN_PROGRESS },
    });
    await prisma.auditEvent.create({
      data: {
        actorName: mechanic.name,
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "STATUS_PENDING_TO_IN_PROGRESS",
        metadata: toPrismaJson({ source: "MECHANIC_DIAGNOSTIC_MATRIX" }),
      },
    }).catch(() => undefined);
  }

  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}