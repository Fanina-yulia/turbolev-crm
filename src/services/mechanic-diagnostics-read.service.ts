import {
  DiagnosticCheckState,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
  PlannerAppointmentStatus,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import {
  getMechanicByUserId,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";

const ACTIVE_APPOINTMENT_EXCLUSIONS: PlannerAppointmentStatus[] = [
  PlannerAppointmentStatus.CANCELLED,
  PlannerAppointmentStatus.NO_SHOW,
  PlannerAppointmentStatus.RESERVE,
  PlannerAppointmentStatus.COMPLETED,
];

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function counts<T extends { state: DiagnosticCheckState }>(rows: T[]) {
  return {
    total: rows.length,
    checked: rows.filter((row) => row.state !== DiagnosticCheckState.NOT_CHECKED).length,
    ok: rows.filter((row) => row.state === DiagnosticCheckState.OK).length,
    attention: rows.filter((row) => row.state === DiagnosticCheckState.ATTENTION).length,
    defect: rows.filter((row) => row.state === DiagnosticCheckState.DEFECT).length,
  };
}

function hasChassisIntent(problem: string | null | undefined) {
  return /(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test((problem || "").toLocaleLowerCase("uk-UA"));
}

async function assertMechanicReadAccess(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const [assignment, diagnostic] = await Promise.all([
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticRequest.findUnique({
      where: { id: diagnosticRequestId },
      select: { id: true, vehicleId: true, leadId: true },
    }),
  ]);

  if (!diagnostic) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  }

  if (assignment) {
    if (assignment.mechanicId !== mechanic.id) {
      throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
    }
    return { mechanic, diagnostic };
  }

  // Compatibility for older records: verify access from an active appointment, but do not
  // backfill or mutate DiagnosticAssignment during a GET request.
  const appointment = await prisma.serviceAppointment.findFirst({
    where: {
      mechanicId: mechanic.id,
      status: { notIn: ACTIVE_APPOINTMENT_EXCLUSIONS },
      OR: [
        ...(diagnostic.vehicleId ? [{ vehicleId: diagnostic.vehicleId }] : []),
        ...(diagnostic.leadId ? [{ leadId: diagnostic.leadId }] : []),
      ],
    },
    select: { id: true },
  });

  if (!appointment) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
  }

  return { mechanic, diagnostic };
}

export async function listMechanicDiagnosticsReadOnly(userId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      mechanicId: mechanic.id,
      status: { notIn: ACTIVE_APPOINTMENT_EXCLUSIONS },
    },
    select: {
      id: true,
      leadId: true,
      vehicleId: true,
      plannedStartAt: true,
      plannedEndAt: true,
      problem: true,
      post: { select: { name: true } },
    },
    orderBy: { plannedStartAt: "asc" },
    take: 40,
  });

  const vehicleIds = Array.from(new Set(appointments.flatMap((row) => row.vehicleId ? [row.vehicleId] : [])));
  const leadIds = Array.from(new Set(appointments.flatMap((row) => row.leadId ? [row.leadId] : [])));
  if (!appointments.length || (!vehicleIds.length && !leadIds.length)) {
    return { mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location }, items: [] };
  }

  const diagnostics = await prisma.diagnosticRequest.findMany({
    where: {
      status: { not: DiagnosticRequestStatus.CANCELLED },
      OR: [
        ...(vehicleIds.length ? [{ vehicleId: { in: vehicleIds } }] : []),
        ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []),
      ],
    },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const diagnosticByAppointment = new Map<string, string>();
  for (const appointment of appointments) {
    const diagnostic = diagnostics.find((row) => Boolean(appointment.leadId && row.leadId === appointment.leadId))
      || diagnostics.find((row) => Boolean(appointment.vehicleId && row.vehicleId === appointment.vehicleId));
    if (diagnostic) diagnosticByAppointment.set(appointment.id, diagnostic.id);
  }

  const ids = Array.from(new Set(diagnosticByAppointment.values()));
  const reviews = ids.length
    ? await prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } })
    : [];
  const byId = new Map(diagnostics.map((row) => [row.id, row]));
  const reviewById = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));

  const items = appointments.flatMap((appointment) => {
    const id = diagnosticByAppointment.get(appointment.id);
    const row = id ? byId.get(id) : undefined;
    if (!row) return [];
    const review = reviewById.get(row.id);
    const workflowState = review?.state === DiagnosticReviewState.SUBMITTED
      ? "SUBMITTED"
      : review?.state === DiagnosticReviewState.RETURNED
        ? "RETURNED"
        : row.status;
    return [{
      id: row.id,
      status: row.status,
      workflowState,
      reviewState: review?.state || DiagnosticReviewState.DRAFT,
      plannedStartAt: appointment.plannedStartAt,
      plannedEndAt: appointment.plannedEndAt,
      post: appointment.post?.name || null,
      problem: appointment.problem || row.lead?.need || null,
      vehicle: { ...row.vehicle, label: vehicleLabel(row.vehicle) },
      client: row.client,
    }];
  });

  return { mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location }, items };
}

export async function getMechanicDiagnosticMode(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const { mechanic } = await assertMechanicReadAccess(userId, diagnosticRequestId);
  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    include: {
      lead: { select: { need: true, comment: true } },
      vehicle: { select: { id: true, plateNumber: true } },
    },
  });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);

  const inspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { templateId: true },
  });
  const templateIds = Array.from(new Set(inspections.map((row) => row.templateId)));
  const templates = templateIds.length
    ? await prisma.diagnosticTemplate.findMany({ where: { id: { in: templateIds } }, select: { name: true } })
    : [];
  const templateNames = templates.map((row) => row.name);

  let problem = diagnostic.lead?.need || diagnostic.lead?.comment || null;
  if (!problem) {
    const appointment = await prisma.serviceAppointment.findFirst({
      where: {
        mechanicId: mechanic.id,
        status: { notIn: ACTIVE_APPOINTMENT_EXCLUSIONS },
        OR: [
          ...(diagnostic.vehicleId ? [{ vehicleId: diagnostic.vehicleId }] : []),
          ...(diagnostic.leadId ? [{ leadId: diagnostic.leadId }] : []),
        ],
      },
      select: { problem: true },
      orderBy: { plannedStartAt: "desc" },
    });
    problem = appointment?.problem || null;
  }

  const mode = templateNames.length > 0
    ? (templateNames.some((name) => /матриця ходової/iu.test(name)) ? "MATRIX" : "LEGACY")
    : (hasChassisIntent(problem) ? "MATRIX" : "LEGACY");

  return { mode, problem, templateNames, plateNumber: diagnostic.vehicle?.plateNumber || null };
}

export async function getStructuredDiagnosticForMechanicReadOnly(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  await assertMechanicReadAccess(userId, diagnosticRequestId);

  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true } },
      workOrder: { select: { id: true, status: true } },
    },
  });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);

  const [assignment, review, inspections, availableTemplates] = await Promise.all([
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId }, orderBy: { createdAt: "asc" } }),
    prisma.diagnosticTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const templateIds = inspections.map((row) => row.templateId);
  const templates = templateIds.length ? await prisma.diagnosticTemplate.findMany({ where: { id: { in: templateIds } } }) : [];
  const sections = templateIds.length ? await prisma.diagnosticTemplateSection.findMany({ where: { templateId: { in: templateIds } }, orderBy: { sortOrder: "asc" } }) : [];
  const items = sections.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sections.map((row) => row.id) } }, orderBy: { sortOrder: "asc" } }) : [];
  const checks = inspections.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspections.map((row) => row.id) } } }) : [];
  const findings = checks.length ? await prisma.diagnosticFinding.findMany({ where: { checkId: { in: checks.map((row) => row.id) } } }) : [];
  const media = findings.length ? await prisma.diagnosticMedia.findMany({
    where: { findingId: { in: findings.map((row) => row.id) } },
    select: { id: true, findingId: true, fileName: true, mimeType: true, fileSize: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  }) : [];

  const findingByCheck = new Map(findings.map((row) => [row.checkId, row]));
  const mediaByFinding = new Map<string, typeof media>();
  for (const row of media) mediaByFinding.set(row.findingId, [...(mediaByFinding.get(row.findingId) || []), row]);
  const checkByPair = new Map(checks.map((row) => [`${row.inspectionId}:${row.templateItemId}`, row]));
  const templateById = new Map(templates.map((row) => [row.id, row]));

  const inspectionView = inspections.map((inspection) => {
    const sectionView = sections
      .filter((section) => section.templateId === inspection.templateId)
      .map((section) => {
        const rows = items.filter((item) => item.sectionId === section.id).map((item) => {
          const check = checkByPair.get(`${inspection.id}:${item.id}`);
          const finding = check ? findingByCheck.get(check.id) : undefined;
          return {
            id: check?.id || null,
            templateItemId: item.id,
            name: item.name,
            position: item.position,
            measurementUnit: item.measurementUnit,
            state: check?.state || DiagnosticCheckState.NOT_CHECKED,
            measurementValue: check?.measurementValue?.toString() || null,
            measurementText: check?.measurementText || null,
            note: check?.note || null,
            finding: finding ? {
              id: finding.id,
              action: finding.action,
              urgency: finding.urgency,
              findingText: finding.findingText,
              suggestedWorkName: finding.suggestedWorkName,
              suggestedPartName: finding.suggestedPartName,
              media: mediaByFinding.get(finding.id) || [],
            } : null,
          };
        });
        return { id: section.id, code: section.code, name: section.name, items: rows, counts: counts(rows) };
      });
    const flat = sectionView.flatMap((section) => section.items);
    return {
      id: inspection.id,
      templateId: inspection.templateId,
      templateName: templateById.get(inspection.templateId)?.name || "Діагностика",
      status: inspection.status,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      sections: sectionView,
      counts: counts(flat),
    };
  });

  const all = inspectionView.flatMap((inspection) => inspection.sections.flatMap((section) => section.items));
  return {
    diagnostic: {
      id: diagnostic.id,
      status: diagnostic.status,
      workflowState: review?.state === DiagnosticReviewState.SUBMITTED
        ? "SUBMITTED"
        : review?.state === DiagnosticReviewState.RETURNED
          ? "RETURNED"
          : diagnostic.status,
      technicalConclusion: diagnostic.technicalConclusion,
      confirmedAt: diagnostic.confirmedAt,
      client: diagnostic.client,
      vehicle: { ...diagnostic.vehicle, label: vehicleLabel(diagnostic.vehicle) },
      problem: diagnostic.lead?.need || diagnostic.lead?.comment || null,
      workOrder: diagnostic.workOrder,
      assignment,
      review: review || {
        state: DiagnosticReviewState.DRAFT,
        submittedAt: null,
        returnedAt: null,
        confirmedAt: null,
        mechanicComment: null,
        managerComment: null,
      },
    },
    inspections: inspectionView,
    availableTemplates: availableTemplates.map((template) => ({
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      added: inspections.some((inspection) => inspection.templateId === template.id),
    })),
    counts: counts(all),
    canSubmit: inspections.length > 0 && all.length > 0 && all.every((row) => row.state !== DiagnosticCheckState.NOT_CHECKED),
  };
}
