import {
  DiagnosticInspectionStatus,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { DIAGNOSTIC_TEMPLATE_SEEDS } from "@/src/services/diagnostic-template-seeds";
import { ensureExtendedDiagnosticMatrix } from "@/src/services/extended-diagnostic-matrix.service";
import {
  getVehicleDiagnosticProfile,
  isDiagnosticItemApplicable,
  removeUnapplicableUncheckedChecks,
} from "@/src/services/vehicle-diagnostic-applicability.service";
import {
  ensureDefaultDiagnosticTemplates,
  getMechanicByUserId,
  getStructuredDiagnosticForMechanic,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";

const DEFAULT_DIAGNOSTIC_TEMPLATE_CODE = "SUSPENSION_MATRIX";

async function currentTemplateItems(templateId: string, code: string, profile: Awaited<ReturnType<typeof getVehicleDiagnosticProfile>>) {
  const prisma = getPrisma();
  const seed = DIAGNOSTIC_TEMPLATE_SEEDS.find((item) => item.code === code);
  const currentSectionCodes = seed?.sections.map((section) => section.code) ?? [];
  const sections = await prisma.diagnosticTemplateSection.findMany({
    where: {
      templateId,
      ...(currentSectionCodes.length ? { code: { in: currentSectionCodes } } : {}),
    },
    select: { id: true, code: true },
  });
  if (!sections.length) return [];

  const seedItemCodes = new Set(
    seed?.sections.flatMap((section) => section.items.map((item) => `${section.code}:${item.code}`)) ?? [],
  );
  const sectionCodeById = new Map(sections.map((section) => [section.id, section.code]));
  return (await prisma.diagnosticTemplateItem.findMany({
    where: { sectionId: { in: sections.map((section) => section.id) } },
    select: { id: true, code: true, sectionId: true },
  })).filter((item) => {
    const sectionCode = sectionCodeById.get(item.sectionId) || "";
    const seeded = !seedItemCodes.size || seedItemCodes.has(`${sectionCode}:${item.code}`);
    return seeded && isDiagnosticItemApplicable(profile, sectionCode, item.code);
  });
}

async function ensureBaselineMatrixInspection(input: {
  diagnosticRequestId: string;
  mechanicId: string;
  profile: Awaited<ReturnType<typeof getVehicleDiagnosticProfile>>;
}) {
  const prisma = getPrisma();
  const template = await prisma.diagnosticTemplate.findFirst({
    where: { code: DEFAULT_DIAGNOSTIC_TEMPLATE_CODE, isActive: true },
  });
  if (!template) {
    throw new StructuredDiagnosticError("TEMPLATE_NOT_FOUND", "Шаблон діагностики ходової не знайдено.", 404);
  }

  let inspection = await prisma.diagnosticInspection.findUnique({
    where: {
      diagnosticRequestId_templateId: {
        diagnosticRequestId: input.diagnosticRequestId,
        templateId: template.id,
      },
    },
  });

  if (!inspection) {
    const items = await currentTemplateItems(template.id, DEFAULT_DIAGNOSTIC_TEMPLATE_CODE, input.profile);
    inspection = await prisma.$transaction(async (tx) => {
      const created = await tx.diagnosticInspection.create({
        data: {
          diagnosticRequestId: input.diagnosticRequestId,
          templateId: template.id,
          mechanicId: input.mechanicId,
          status: DiagnosticInspectionStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      });
      if (items.length) {
        await tx.diagnosticCheck.createMany({
          data: items.map((item) => ({ inspectionId: created.id, templateItemId: item.id })),
          skipDuplicates: true,
        });
      }
      return created;
    });
  }

  return inspection;
}

export async function startMechanicDiagnosticByType(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  if (!assignment || assignment.mechanicId !== mechanic.id) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
  }

  const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId } });
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
  const profile = await getVehicleDiagnosticProfile(diagnosticRequestId);

  // Єдиний базовий сценарій для нового запису/діагностики: повна матриця
  // ходової. Розширення матриці нижче завжди додає технічні рідини.
  // Якщо діагностика була створена раніше зі старим BASIC_INSPECTION,
  // додаємо матрицю поруч, не видаляючи вже зафіксовані історичні дані.
  await ensureBaselineMatrixInspection({
    diagnosticRequestId,
    mechanicId: mechanic.id,
    profile,
  });

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
      if (!code) continue;
      const items = await currentTemplateItems(inspection.templateId, code, profile);
      if (items.length) {
        await prisma.diagnosticCheck.createMany({
          data: items.map((item) => ({ inspectionId: inspection.id, templateItemId: item.id })),
          skipDuplicates: true,
        });
      }
    }
  }

  await ensureExtendedDiagnosticMatrix(diagnosticRequestId);
  await removeUnapplicableUncheckedChecks(diagnosticRequestId, profile);

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
        metadata: toPrismaJson({
          source: "MECHANIC_DIAGNOSTIC_MATRIX",
          defaultTemplate: DEFAULT_DIAGNOSTIC_TEMPLATE_CODE,
          vehicleProfile: profile ? {
            fuelKind: profile.fuelKind,
            driveKind: profile.driveKind,
            driveSource: profile.driveSource,
          } : null,
        }),
      },
    }).catch(() => undefined);
  }

  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}
