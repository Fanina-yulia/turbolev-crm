import {
  DiagnosticCheckState,
  DiagnosticFindingAction,
  DiagnosticInspectionStatus,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
  DiagnosticUrgency,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { DIAGNOSTIC_TEMPLATE_SEEDS } from "@/src/services/diagnostic-template-seeds";
import { resolveDiagnosticWorkflowState } from "@/src/services/diagnostic-workflow.service";

export class StructuredDiagnosticError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "StructuredDiagnosticError"; this.code = code; this.status = status; }
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}
function closed(status: DiagnosticRequestStatus) { return status === DiagnosticRequestStatus.CONFIRMED || status === DiagnosticRequestStatus.CANCELLED; }
function reviewLocked(state: DiagnosticReviewState) { return state === DiagnosticReviewState.SUBMITTED || state === DiagnosticReviewState.CONFIRMED; }
function counts<T extends { state: DiagnosticCheckState }>(rows: T[]) {
  return { total: rows.length, checked: rows.filter((row) => row.state !== DiagnosticCheckState.NOT_CHECKED).length, ok: rows.filter((row) => row.state === DiagnosticCheckState.OK).length, attention: rows.filter((row) => row.state === DiagnosticCheckState.ATTENTION).length, defect: rows.filter((row) => row.state === DiagnosticCheckState.DEFECT).length };
}

export async function ensureDefaultDiagnosticTemplates() {
  const prisma = getPrisma();
  for (const seed of DIAGNOSTIC_TEMPLATE_SEEDS) {
    const template = await prisma.diagnosticTemplate.upsert({ where: { code: seed.code }, create: { code: seed.code, name: seed.name, description: seed.description, isDefault: Boolean(seed.isDefault), isActive: true, sortOrder: seed.sortOrder }, update: { name: seed.name, description: seed.description, isDefault: Boolean(seed.isDefault), isActive: true, sortOrder: seed.sortOrder } });
    for (let s = 0; s < seed.sections.length; s += 1) {
      const seedSection = seed.sections[s];
      const section = await prisma.diagnosticTemplateSection.upsert({ where: { templateId_code: { templateId: template.id, code: seedSection.code } }, create: { templateId: template.id, code: seedSection.code, name: seedSection.name, sortOrder: (s + 1) * 10 }, update: { name: seedSection.name, sortOrder: (s + 1) * 10 } });
      for (let i = 0; i < seedSection.items.length; i += 1) {
        const item = seedSection.items[i];
        await prisma.diagnosticTemplateItem.upsert({ where: { sectionId_code: { sectionId: section.id, code: item.code } }, create: { sectionId: section.id, code: item.code, name: item.name, position: item.position || null, measurementUnit: item.unit || null, suggestedWorkName: item.work || null, suggestedPartName: item.part || null, sortOrder: (i + 1) * 10 }, update: { name: item.name, position: item.position || null, measurementUnit: item.unit || null, suggestedWorkName: item.work || null, suggestedPartName: item.part || null, sortOrder: (i + 1) * 10 } });
      }
    }
  }
}

export async function getMechanicByUserId(userId: string) {
  const mechanic = await getPrisma().serviceMechanic.findFirst({ where: { userId, isActive: true }, include: { location: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } });
  if (!mechanic) throw new StructuredDiagnosticError("MECHANIC_NOT_LINKED", "Профіль користувача не прив’язаний до ресурсу автомеханіка.", 403);
  return mechanic;
}

export async function upsertDiagnosticAssignment(input: { diagnosticRequestId: string; locationId?: string | null; mechanicId?: string | null }) {
  return getPrisma().diagnosticAssignment.upsert({ where: { diagnosticRequestId: input.diagnosticRequestId }, create: { diagnosticRequestId: input.diagnosticRequestId, locationId: input.locationId || null, mechanicId: input.mechanicId || null }, update: { locationId: input.locationId || null, mechanicId: input.mechanicId || null } });
}

async function ensureReview(diagnosticRequestId: string) {
  return getPrisma().diagnosticReview.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId }, update: {} });
}

async function backfillAssignmentsForMechanic(userId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const appointments = await prisma.serviceAppointment.findMany({
    where: { mechanicId: mechanic.id, status: { notIn: ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] } },
    select: { id: true, locationId: true, mechanicId: true, leadId: true, plannedStartAt: true, plannedEndAt: true, problem: true, post: { select: { name: true } } },
    orderBy: { plannedStartAt: "asc" },
    take: 40,
  });
  const links = await prisma.diagnosticVisitLink.findMany({
    where: { appointmentId: { in: appointments.map((row) => row.id) } },
    select: { appointmentId: true, diagnosticRequestId: true },
  });
  const diagnosticByAppointment = new Map(links.map((row) => [row.appointmentId, row.diagnosticRequestId]));
  const legacyAppointments = appointments.filter((row) => !diagnosticByAppointment.has(row.id) && row.leadId);
  const leadIds = Array.from(new Set(legacyAppointments.flatMap((row) => row.leadId ? [row.leadId] : [])));
  const diagnostics = leadIds.length
    ? await prisma.diagnosticRequest.findMany({
        where: { status: { not: DiagnosticRequestStatus.CANCELLED }, leadId: { in: leadIds } },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
    : [];
  for (const appointment of legacyAppointments) {
    const diagnostic = diagnostics.find((row) => row.leadId === appointment.leadId);
    if (diagnostic) diagnosticByAppointment.set(appointment.id, diagnostic.id);
  }
  for (const appointment of appointments) {
    const diagnosticId = diagnosticByAppointment.get(appointment.id);
    if (!diagnosticId) continue;
    await prisma.diagnosticAssignment.upsert({
      where: { diagnosticRequestId: diagnosticId },
      create: { diagnosticRequestId: diagnosticId, locationId: appointment.locationId, mechanicId: mechanic.id },
      update: { locationId: appointment.locationId, mechanicId: mechanic.id },
    });
    await ensureReview(diagnosticId);
  }
  return { mechanic, appointments, diagnosticByAppointment };
}

export async function listMechanicDiagnostics(userId: string) {
  const prisma = getPrisma();
  await ensureDefaultDiagnosticTemplates();
  const { mechanic, appointments, diagnosticByAppointment } = await backfillAssignmentsForMechanic(userId);
  const ids = Array.from(new Set(diagnosticByAppointment.values()));
  const diagnostics = ids.length ? await prisma.diagnosticRequest.findMany({ where: { id: { in: ids } }, include: { client: { select: { id: true, name: true, phone: true } }, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } }, lead: { select: { id: true, need: true, comment: true } } } }) : [];
  const reviews = ids.length ? await prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } }) : [];
  const byId = new Map(diagnostics.map((row) => [row.id, row])); const reviewById = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));
  const items = appointments.flatMap((appointment) => {
    const id = diagnosticByAppointment.get(appointment.id); const row = id ? byId.get(id) : undefined; if (!row) return [];
    const review = reviewById.get(row.id); const workflowState = resolveDiagnosticWorkflowState(row.status, review?.state);
    return [{ id: row.id, status: row.status, workflowState, reviewState: review?.state || DiagnosticReviewState.DRAFT, plannedStartAt: appointment.plannedStartAt, plannedEndAt: appointment.plannedEndAt, post: appointment.post?.name || null, problem: appointment.problem || row.lead?.need || null, vehicle: { ...row.vehicle, label: vehicleLabel(row.vehicle) }, client: row.client }];
  });
  return { mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location }, items };
}

async function assertMechanicDiagnostic(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma(); const mechanic = await getMechanicByUserId(userId);
  let assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  if (!assignment) { await backfillAssignmentsForMechanic(userId); assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }); }
  if (!assignment || assignment.mechanicId !== mechanic.id) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
  return { mechanic, assignment };
}

async function createInspection(diagnosticRequestId: string, templateId: string, mechanicId: string | null) {
  const prisma = getPrisma();
  const existing = await prisma.diagnosticInspection.findUnique({ where: { diagnosticRequestId_templateId: { diagnosticRequestId, templateId } } }); if (existing) return existing;
  const template = await prisma.diagnosticTemplate.findFirst({ where: { id: templateId, isActive: true } }); if (!template) throw new StructuredDiagnosticError("TEMPLATE_NOT_FOUND", "Шаблон діагностики не знайдено.", 404);
  const sections = await prisma.diagnosticTemplateSection.findMany({ where: { templateId }, select: { id: true } }); const items = sections.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sections.map((row) => row.id) } }, select: { id: true } }) : [];
  return prisma.$transaction(async (tx) => { const inspection = await tx.diagnosticInspection.create({ data: { diagnosticRequestId, templateId, mechanicId, status: DiagnosticInspectionStatus.IN_PROGRESS, startedAt: new Date() } }); if (items.length) await tx.diagnosticCheck.createMany({ data: items.map((item) => ({ inspectionId: inspection.id, templateItemId: item.id })), skipDuplicates: true }); return inspection; });
}

export async function startStructuredDiagnostic(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma(); const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId); const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId } });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404); if (closed(diagnostic.status)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  const review = await ensureReview(diagnosticRequestId); if (review.state === DiagnosticReviewState.SUBMITTED) throw new StructuredDiagnosticError("DIAGNOSTIC_SUBMITTED", "Діагностика вже передана сервіс-менеджеру.", 409);
  if (diagnostic.status === DiagnosticRequestStatus.PENDING) { await prisma.diagnosticRequest.update({ where: { id: diagnosticRequestId }, data: { status: DiagnosticRequestStatus.IN_PROGRESS } }); await prisma.auditEvent.create({ data: { actorName: mechanic.name, entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "STATUS_PENDING_TO_IN_PROGRESS", metadata: toPrismaJson({ source: "MECHANIC_MOBILE" }) } }).catch(() => undefined); }
  if (!(await prisma.diagnosticInspection.count({ where: { diagnosticRequestId } }))) { await ensureDefaultDiagnosticTemplates(); const template = await prisma.diagnosticTemplate.findFirst({ where: { isDefault: true, isActive: true }, orderBy: { sortOrder: "asc" } }); if (template) await createInspection(diagnosticRequestId, template.id, mechanic.id); }
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function addTemplateForMechanic(userId: string, diagnosticRequestId: string, templateId: string) {
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId); const review = await ensureReview(diagnosticRequestId); if (reviewLocked(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Після передачі сервіс-менеджеру склад діагностики змінювати не можна.", 409); await createInspection(diagnosticRequestId, templateId, mechanic.id); return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function getStructuredDiagnosticForMechanic(userId: string, diagnosticRequestId: string) { await assertMechanicDiagnostic(userId, diagnosticRequestId); return getStructuredDiagnostic(diagnosticRequestId); }

export async function getStructuredDiagnostic(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId }, include: { client: { select: { id: true, name: true, phone: true } }, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true, engineName: true, engineVolumeCm3: true, fuelType: true, driveType: true, bodyType: true, updatedAt: true } }, lead: { select: { id: true, need: true, comment: true } }, workOrder: { select: { id: true, status: true } } } });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  const [assignment, review, inspections, availableTemplates] = await Promise.all([prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }), prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }), prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId }, orderBy: { createdAt: "asc" } }), prisma.diagnosticTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })]);
  const mechanic = assignment?.mechanicId
    ? await prisma.serviceMechanic.findUnique({ where: { id: assignment.mechanicId }, select: { id: true, name: true } })
    : null;
  const templateIds = inspections.map((row) => row.templateId); const templates = templateIds.length ? await prisma.diagnosticTemplate.findMany({ where: { id: { in: templateIds } } }) : []; const sections = templateIds.length ? await prisma.diagnosticTemplateSection.findMany({ where: { templateId: { in: templateIds } }, orderBy: { sortOrder: "asc" } }) : []; const items = sections.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sections.map((row) => row.id) } }, orderBy: { sortOrder: "asc" } }) : [];
  const checks = inspections.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspections.map((row) => row.id) } } }) : []; const findings = checks.length ? await prisma.diagnosticFinding.findMany({ where: { checkId: { in: checks.map((row) => row.id) } } }) : []; const media = findings.length ? await prisma.diagnosticMedia.findMany({ where: { findingId: { in: findings.map((row) => row.id) } }, select: { id: true, findingId: true, fileName: true, mimeType: true, fileSize: true, createdAt: true }, orderBy: { createdAt: "asc" } }) : [];
  const findingByCheck = new Map(findings.map((row) => [row.checkId, row])); const mediaByFinding = new Map<string, typeof media>(); for (const row of media) mediaByFinding.set(row.findingId, [...(mediaByFinding.get(row.findingId) || []), row]); const checkByPair = new Map(checks.map((row) => [`${row.inspectionId}:${row.templateItemId}`, row])); const templateById = new Map(templates.map((row) => [row.id, row]));
  const inspectionView = inspections.map((inspection) => {
    const sectionView = sections
      .filter((section) => section.templateId === inspection.templateId)
      .flatMap((section) => {
        const rows = items.filter((item) => item.sectionId === section.id).flatMap((item) => {
          const check = checkByPair.get(`${inspection.id}:${item.id}`);
          // Template items without a persisted check are not part of this
          // inspection. This commonly happens when applicability removes
          // combustion-only rows from an electric vehicle diagnostic.
          if (!check) return [];
          const finding = findingByCheck.get(check.id);
          return [{
            id: check.id,
            templateItemId: item.id,
            name: item.name,
            position: item.position,
            measurementUnit: item.measurementUnit,
            state: check.state,
            measurementValue: check.measurementValue?.toString() || null,
            measurementText: check.measurementText || null,
            note: check.note || null,
            finding: finding ? {
              id: finding.id,
              action: finding.action,
              urgency: finding.urgency,
              findingText: finding.findingText,
              suggestedWorkName: finding.suggestedWorkName,
              suggestedPartName: finding.suggestedPartName,
              media: mediaByFinding.get(finding.id) || [],
            } : null,
          }];
        });
        return rows.length
          ? [{ id: section.id, code: section.code, name: section.name, items: rows, counts: counts(rows) }]
          : [];
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
    return { diagnostic: { id: diagnostic.id, status: diagnostic.status, createdAt: diagnostic.createdAt, updatedAt: diagnostic.updatedAt, workflowState: resolveDiagnosticWorkflowState(diagnostic.status, review?.state), technicalConclusion: diagnostic.technicalConclusion, confirmedAt: diagnostic.confirmedAt, client: diagnostic.client, vehicle: { ...diagnostic.vehicle, label: vehicleLabel(diagnostic.vehicle) }, problem: diagnostic.lead?.need || diagnostic.lead?.comment || null, workOrder: diagnostic.workOrder, assignment, mechanic, review: review || { state: DiagnosticReviewState.DRAFT, submittedAt: null, returnedAt: null, confirmedAt: null, mechanicComment: null, managerComment: null } }, inspections: inspectionView, availableTemplates: availableTemplates.map((template) => ({ id: template.id, code: template.code, name: template.name, description: template.description, added: inspections.some((inspection) => inspection.templateId === template.id) })), counts: counts(all), canSubmit: inspections.length > 0 && all.length > 0 };
}

async function refreshInspection(inspectionId: string) { const prisma = getPrisma(); const checks = await prisma.diagnosticCheck.findMany({ where: { inspectionId }, select: { state: true } }); const complete = checks.length > 0 && checks.every((row) => row.state !== DiagnosticCheckState.NOT_CHECKED); await prisma.diagnosticInspection.update({ where: { id: inspectionId }, data: complete ? { status: DiagnosticInspectionStatus.COMPLETED, completedAt: new Date() } : { status: DiagnosticInspectionStatus.IN_PROGRESS, startedAt: new Date(), completedAt: null } }); }

export async function updateDiagnosticCheck(userId: string, diagnosticRequestId: string, checkId: string, input: { state: string; measurementValue?: string | number | null; measurementText?: string | null; note?: string | null; action?: string | null; urgency?: string | null; findingText?: string | null }) {
  const prisma = getPrisma(); await assertMechanicDiagnostic(userId, diagnosticRequestId); const review = await ensureReview(diagnosticRequestId); if (reviewLocked(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  const state = Object.values(DiagnosticCheckState).find((value) => value === String(input.state || "").toUpperCase()); if (!state) throw new StructuredDiagnosticError("INVALID_CHECK_STATE", "Оберіть коректний стан перевірки."); const check = await prisma.diagnosticCheck.findUnique({ where: { id: checkId } }); if (!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Пункт перевірки не знайдено.", 404); const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } }); if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("CHECK_SCOPE_MISMATCH", "Пункт не належить цій діагностиці.", 403); const item = await prisma.diagnosticTemplateItem.findUnique({ where: { id: check.templateItemId } });
  const measurementValue = input.measurementValue === "" || input.measurementValue == null ? null : Number(input.measurementValue); if (measurementValue !== null && !Number.isFinite(measurementValue)) throw new StructuredDiagnosticError("INVALID_MEASUREMENT", "Вкажіть коректний числовий замір."); const action = Object.values(DiagnosticFindingAction).find((value) => value === String(input.action || "NONE").toUpperCase()) || DiagnosticFindingAction.NONE; const urgency = Object.values(DiagnosticUrgency).find((value) => value === String(input.urgency || "INFO").toUpperCase()) || DiagnosticUrgency.INFO;
  await prisma.$transaction(async (tx) => { await tx.diagnosticCheck.update({ where: { id: checkId }, data: { state, measurementValue, measurementText: typeof input.measurementText === "string" ? input.measurementText.trim().slice(0,160) || null : null, note: typeof input.note === "string" ? input.note.trim().slice(0,4000) || null : null, checkedAt: state === DiagnosticCheckState.NOT_CHECKED ? null : new Date() } }); const problem = state === DiagnosticCheckState.ATTENTION || state === DiagnosticCheckState.DEFECT; if (problem) await tx.diagnosticFinding.upsert({ where: { checkId }, create: { checkId, action, urgency, findingText: typeof input.findingText === "string" ? input.findingText.trim().slice(0,4000) || null : null, suggestedWorkName: item?.suggestedWorkName || null, suggestedPartName: item?.suggestedPartName || null }, update: { action, urgency, findingText: typeof input.findingText === "string" ? input.findingText.trim().slice(0,4000) || null : null, suggestedWorkName: item?.suggestedWorkName || undefined, suggestedPartName: item?.suggestedPartName || undefined } }); else { const finding = await tx.diagnosticFinding.findUnique({ where: { checkId } }); if (finding) { await tx.diagnosticMedia.deleteMany({ where: { findingId: finding.id } }); await tx.diagnosticFinding.delete({ where: { id: finding.id } }); } } }); await refreshInspection(inspection.id); return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function setDiagnosticSectionAllOk(userId: string, diagnosticRequestId: string, inspectionId: string, sectionId: string) {
  const prisma = getPrisma(); await assertMechanicDiagnostic(userId, diagnosticRequestId); const review = await ensureReview(diagnosticRequestId); if (reviewLocked(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409); const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: inspectionId } }); if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("INSPECTION_SCOPE_MISMATCH", "Секція не належить цій діагностиці.", 403); const itemIds = (await prisma.diagnosticTemplateItem.findMany({ where: { sectionId }, select: { id: true } })).map((row) => row.id); const checks = itemIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId, templateItemId: { in: itemIds } }, select: { id: true } }) : []; const ids = checks.map((row) => row.id);
  await prisma.$transaction(async (tx) => { if (ids.length) await tx.diagnosticCheck.updateMany({ where: { id: { in: ids } }, data: { state: DiagnosticCheckState.OK, checkedAt: new Date(), note: null, measurementValue: null, measurementText: null } }); const findings = ids.length ? await tx.diagnosticFinding.findMany({ where: { checkId: { in: ids } }, select: { id: true } }) : []; if (findings.length) await tx.diagnosticMedia.deleteMany({ where: { findingId: { in: findings.map((row) => row.id) } } }); if (ids.length) await tx.diagnosticFinding.deleteMany({ where: { checkId: { in: ids } } }); }); await refreshInspection(inspectionId); return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function submitStructuredDiagnostic(userId: string, diagnosticRequestId: string, mechanicComment?: string | null) {
  const prisma = getPrisma(); const { mechanic, assignment } = await assertMechanicDiagnostic(userId, diagnosticRequestId); const view = await getStructuredDiagnostic(diagnosticRequestId); if (!view.canSubmit) throw new StructuredDiagnosticError("DIAGNOSTIC_INCOMPLETE", "Перед передачею сервіс-менеджеру перевірте всі пункти.", 409); if (closed(view.diagnostic.status)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409); const now = new Date();
  await prisma.$transaction(async (tx) => { await tx.diagnosticAssignment.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId, locationId: assignment.locationId || mechanic.locationId, mechanicId: mechanic.id }, update: { locationId: assignment.locationId || mechanic.locationId, mechanicId: mechanic.id } }); await tx.diagnosticInspection.updateMany({ where: { diagnosticRequestId }, data: { status: DiagnosticInspectionStatus.COMPLETED, completedAt: now } }); await tx.diagnosticReview.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId, state: DiagnosticReviewState.SUBMITTED, submittedAt: now, mechanicComment: mechanicComment?.trim().slice(0,4000) || null }, update: { state: DiagnosticReviewState.SUBMITTED, submittedAt: now, returnedAt: null, mechanicComment: mechanicComment?.trim().slice(0,4000) || null } }); await tx.auditEvent.create({ data: { actorName: mechanic.name, entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "DIAGNOSTIC_SUBMITTED", metadata: toPrismaJson({ source:"MECHANIC_MOBILE", counts:view.counts }) } }); }); return getStructuredDiagnostic(diagnosticRequestId);
}

async function restoreAppointmentAfterDiagnosticReturn(
  tx: import("@/src/generated/prisma/client").Prisma.TransactionClient,
  diagnosticRequestId: string,
  reviewerUserId: string,
) {
  const link = await tx.diagnosticVisitLink.findUnique({
    where: { diagnosticRequestId },
    select: { appointmentId: true },
  });
  if (!link) return null;

  const appointment = await tx.serviceAppointment.findUnique({
    where: { id: link.appointmentId },
    select: { id: true, status: true },
  });
  if (!appointment || appointment.status !== "WAITING_CALCULATION") return null;

  const updated = await tx.serviceAppointment.update({
    where: { id: appointment.id },
    data: { status: "DIAGNOSTICS" },
    select: { id: true, status: true },
  });
  await tx.auditEvent.create({
    data: {
      actorId: reviewerUserId,
      actorName: "CRM / Сервіс-менеджер",
      entityType: "ServiceAppointment",
      entityId: appointment.id,
      action: "DIAGNOSTIC_RETURNED_APPOINTMENT_TO_DIAGNOSTICS",
      metadata: toPrismaJson({ diagnosticRequestId, from: appointment.status, to: updated.status }),
    },
  });
  return { id: updated.id, from: appointment.status, to: updated.status };
}

export async function updateMechanicDiagnosticComment(diagnosticRequestId: string, mechanicComment: string | null, actorName = "CRM") {
  const prisma = getPrisma();
  const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId }, select: { id: true, status: true } });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностичну карту не знайдено.", 404);
  if (diagnostic.status === DiagnosticRequestStatus.CANCELLED) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Скасовану діагностичну карту не можна редагувати.", 409);
  const normalized = typeof mechanicComment === "string" ? mechanicComment.trim().slice(0, 4000) || null : null;
  await prisma.$transaction(async (tx) => {
    const before = await tx.diagnosticReview.findUnique({ where: { diagnosticRequestId } });
    const after = await tx.diagnosticReview.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId, mechanicComment: normalized }, update: { mechanicComment: normalized } });
    await tx.auditEvent.create({ data: { actorName: actorName.trim().slice(0, 160) || "CRM", entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "UPDATE_MECHANIC_COMMENT", before: toPrismaJson(before), after: toPrismaJson(after) } });
  });
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function returnStructuredDiagnostic(diagnosticRequestId: string, reviewerUserId: string, managerComment?: string | null) {
  const prisma = getPrisma();
  const review = await ensureReview(diagnosticRequestId);
  if (review.state !== DiagnosticReviewState.SUBMITTED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_SUBMITTED", "Повернути можна лише діагностику, передану на перевірку.", 409);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticReview.update({
      where: { diagnosticRequestId },
      data: {
        state: DiagnosticReviewState.RETURNED,
        returnedAt: now,
        reviewerUserId,
        managerComment: managerComment?.trim().slice(0, 4000) || null,
      },
    });
    await tx.diagnosticInspection.updateMany({
      where: { diagnosticRequestId },
      data: { status: DiagnosticInspectionStatus.IN_PROGRESS, completedAt: null },
    });
    await tx.auditEvent.create({
      data: {
        actorId: reviewerUserId,
        actorName: "CRM / Сервіс-менеджер",
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "DIAGNOSTIC_RETURNED_TO_MECHANIC",
        metadata: toPrismaJson({ reviewerUserId, managerComment: managerComment || null }),
      },
    });
    await restoreAppointmentAfterDiagnosticReturn(tx, diagnosticRequestId, reviewerUserId);
  });
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function markStructuredDiagnosticConfirmed(diagnosticRequestId: string, reviewerUserId?: string | null) { const now = new Date(); return getPrisma().diagnosticReview.upsert({ where:{diagnosticRequestId}, create:{diagnosticRequestId,state:DiagnosticReviewState.CONFIRMED,confirmedAt:now,reviewerUserId:reviewerUserId||null}, update:{state:DiagnosticReviewState.CONFIRMED,confirmedAt:now,reviewerUserId:reviewerUserId||undefined} }); }

export async function buildStructuredTechnicalConclusion(diagnosticRequestId: string) {
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const findings = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding ? [{ section: section.name, item }] : [])));
  if (!findings.length) return view.counts.total ? "За результатами структурованої діагностики критичних дефектів не виявлено." : null;
  const action: Record<string, string> = { NONE: "потребує оцінки", REPLACE: "замінити", REPAIR: "ремонтувати", ADJUST: "відрегулювати", CLEAN: "очистити / обслужити", ADDITIONAL_DIAGNOSTICS: "провести додаткову діагностику" };
  const priority: Record<string, string> = { INFO: "рекомендація", CRITICAL: "критично" };
  return findings.map(({ section, item }) => {
    const priorityText = priority[item.finding?.urgency || ""];
    return `${section} — ${item.name}: ${item.finding?.findingText || item.note || (item.state === DiagnosticCheckState.DEFECT ? "виявлено дефект" : "потребує уваги")}. Дія: ${action[item.finding?.action || "NONE"]}.${priorityText ? ` Пріоритет: ${priorityText}.` : ""}`;
  }).join("\n");
}

export async function getDiagnosticMedia(mediaId: string) { return getPrisma().diagnosticMedia.findUnique({ where:{id:mediaId} }); }

export async function addDiagnosticMedia(userId: string, diagnosticRequestId: string, checkId: string, file: { name: string; type: string; size: number; data: Uint8Array<ArrayBuffer> }) {
  const prisma=getPrisma(); await assertMechanicDiagnostic(userId,diagnosticRequestId); const review=await ensureReview(diagnosticRequestId); if(reviewLocked(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED","Після передачі на перевірку фото змінювати не можна.",409); const check=await prisma.diagnosticCheck.findUnique({where:{id:checkId}}); if(!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND","Пункт перевірки не знайдено.",404); const inspection=await prisma.diagnosticInspection.findUnique({where:{id:check.inspectionId}}); if(!inspection||inspection.diagnosticRequestId!==diagnosticRequestId) throw new StructuredDiagnosticError("CHECK_SCOPE_MISMATCH","Пункт не належить цій діагностиці.",403); if(check.state!==DiagnosticCheckState.ATTENTION&&check.state!==DiagnosticCheckState.DEFECT) throw new StructuredDiagnosticError("FINDING_REQUIRED","Фото дефекту можна додати після вибору «Увага» або «Дефект»."); const finding=await prisma.diagnosticFinding.upsert({where:{checkId},create:{checkId},update:{}}); const media=await prisma.diagnosticMedia.create({data:{findingId:finding.id,fileName:file.name.slice(0,240)||"diagnostic-photo.jpg",mimeType:file.type,fileSize:file.size,fileData:file.data}}); return {id:media.id,fileName:media.fileName,mimeType:media.mimeType,fileSize:media.fileSize,createdAt:media.createdAt};
}
