import {
  DiagnosticInspectionStatus,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { DIAGNOSTIC_TEMPLATE_SEEDS } from "@/src/services/diagnostic-template-seeds";
import {
  ensureDefaultDiagnosticTemplates,
  getMechanicByUserId,
  getStructuredDiagnosticForMechanic,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";

function requestedTemplateCode(problem: string | null | undefined) {
  const text = (problem || "").toLocaleLowerCase("uk-UA");
  if (/(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test(text)) return "SUSPENSION_MATRIX";
  if (/(гальм|колод|супорт|гальмів|тормоз|диск)/u.test(text)) return "BRAKES";
  if (/(комп'ют|компют|check engine|помилк|електрон|діагностик.*двиг)/u.test(text)) return "COMPUTER_DIAGNOSTICS";
  return "BASIC_INSPECTION";
}

async function appointmentProblem(input: { vehicleId: string | null; mechanicId: string }) {
  if (!input.vehicleId) return null;
  const appointment = await getPrisma().serviceAppointment.findFirst({
    where: {
      vehicleId: input.vehicleId,
      mechanicId: input.mechanicId,
      status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] },
    },
    orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "desc" }],
    select: { problem: true },
  });
  return appointment?.problem || null;
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
    let problem = [diagnostic.lead?.need, diagnostic.lead?.comment].filter(Boolean).join(" · ");
    if (!problem) problem = await appointmentProblem({ vehicleId: diagnostic.vehicleId, mechanicId: mechanic.id }) || "";
    const code = requestedTemplateCode(problem);
    const template = await prisma.diagnosticTemplate.findFirst({ where: { code, isActive: true } });
    if (!template) throw new StructuredDiagnosticError("TEMPLATE_NOT_FOUND", "Шаблон діагностики не знайдено.", 404);

    const seed = DIAGNOSTIC_TEMPLATE_SEEDS.find((item) => item.code === code);
    const currentSectionCodes = seed?.sections.map((section) => section.code) ?? [];
    const sections = await prisma.diagnosticTemplateSection.findMany({
      where: {
        templateId: template.id,
        ...(currentSectionCodes.length ? { code: { in: currentSectionCodes } } : {}),
      },
      select: { id: true, code: true },
    });
    const seedItemCodes = new Set(seed?.sections.flatMap((section) => section.items.map((item) => `${section.code}:${item.code}`)) ?? []);
    const sectionCodeById = new Map(sections.map((section) => [section.id, section.code]));
    const items = sections.length
      ? (await prisma.diagnosticTemplateItem.findMany({
          where: { sectionId: { in: sections.map((item) => item.id) } },
          select: { id: true, code: true, sectionId: true },
        })).filter((item) => !seedItemCodes.size || seedItemCodes.has(`${sectionCodeById.get(item.sectionId)}:${item.code}`))
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

  // Шаблон може змінитися, поки діагностика вже в роботі. Додаємо нові
  // пункти до активного огляду, не скидаючи вже зроблені механіком відмітки.
  const activeInspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { id: true, templateId: true },
  });
  if (activeInspections.length) {
    const templates = await prisma.diagnosticTemplate.findMany({
      where: { id: { in: Array.from(new Set(activeInspections.map((inspection) => inspection.templateId))) } },
      select: { id: true, code: true },
    });
    const templateCodeById = new Map(templates.map((template) => [template.id, template.code]));

    for (const inspection of activeInspections) {
      const code = templateCodeById.get(inspection.templateId);
      const seed = DIAGNOSTIC_TEMPLATE_SEEDS.find((item) => item.code === code);
      if (!seed) continue;
      const currentSectionCodes = seed.sections.map((section) => section.code);
      const sections = await prisma.diagnosticTemplateSection.findMany({
        where: { templateId: inspection.templateId, code: { in: currentSectionCodes } },
        select: { id: true, code: true },
      });
      if (!sections.length) continue;
      const sectionCodeById = new Map(sections.map((section) => [section.id, section.code]));
      const seedItemCodes = new Set(seed.sections.flatMap((section) => section.items.map((item) => `${section.code}:${item.code}`)));
      const items = (await prisma.diagnosticTemplateItem.findMany({
        where: { sectionId: { in: sections.map((section) => section.id) } },
        select: { id: true, code: true, sectionId: true },
      })).filter((item) => seedItemCodes.has(`${sectionCodeById.get(item.sectionId)}:${item.code}`));
      if (items.length) {
        await prisma.diagnosticCheck.createMany({
          data: items.map((item) => ({ inspectionId: inspection.id, templateItemId: item.id })),
          skipDuplicates: true,
        });
      }
    }
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
