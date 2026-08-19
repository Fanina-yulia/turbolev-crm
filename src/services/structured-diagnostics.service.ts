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

export class StructuredDiagnosticError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "StructuredDiagnosticError";
    this.code = code;
    this.status = status;
  }
}

type SeedItem = { code: string; name: string; position?: string; unit?: string; work?: string; part?: string };
type SeedSection = { code: string; name: string; items: SeedItem[] };
type SeedTemplate = { code: string; name: string; description: string; isDefault?: boolean; sortOrder: number; sections: SeedSection[] };

const TEMPLATE_SEEDS: SeedTemplate[] = [
  {
    code: "BASIC_INSPECTION", name: "Базовий комплексний огляд", description: "Швидкий обов’язковий огляд перед поглибленою діагностикою.", isDefault: true, sortOrder: 10,
    sections: [
      { code: "VISUAL", name: "Візуальний огляд", items: [
        { code: "LEAKS", name: "Підтікання технічних рідин" }, { code: "BELTS_HOSES", name: "Ремені та патрубки" }, { code: "LIGHTS", name: "Зовнішнє освітлення" },
      ] },
      { code: "FLUIDS", name: "Рідини", items: [
        { code: "ENGINE_OIL", name: "Рівень/стан моторної оливи" }, { code: "COOLANT", name: "Охолоджувальна рідина" }, { code: "BRAKE_FLUID", name: "Гальмівна рідина", work: "Заміна гальмівної рідини" },
      ] },
      { code: "TYRES", name: "Шини та колеса", items: [
        { code: "TYRE_FL", name: "Передня ліва шина", position: "Передня ліва", unit: "мм" }, { code: "TYRE_FR", name: "Передня права шина", position: "Передня права", unit: "мм" }, { code: "TYRE_RL", name: "Задня ліва шина", position: "Задня ліва", unit: "мм" }, { code: "TYRE_RR", name: "Задня права шина", position: "Задня права", unit: "мм" },
      ] },
      { code: "BATTERY", name: "АКБ / зарядка", items: [
        { code: "BATTERY_VOLTAGE", name: "Напруга АКБ", unit: "V" }, { code: "CHARGING", name: "Напруга заряджання", unit: "V" },
      ] },
    ],
  },
  {
    code: "SUSPENSION", name: "Комплексна діагностика ходової", description: "Передня/задня ходова, рульове керування та стабілізація.", sortOrder: 20,
    sections: [
      { code: "FRONT", name: "Передня ходова", items: [
        { code: "SHOCK_FL", name: "Лівий амортизатор", position: "Передній лівий", work: "Заміна переднього амортизатора", part: "Амортизатор передній" },
        { code: "SHOCK_FR", name: "Правий амортизатор", position: "Передній правий", work: "Заміна переднього амортизатора", part: "Амортизатор передній" },
        { code: "BALL_FL", name: "Ліва кульова опора", position: "Передня ліва", work: "Заміна кульової опори", part: "Кульова опора" },
        { code: "BALL_FR", name: "Права кульова опора", position: "Передня права", work: "Заміна кульової опори", part: "Кульова опора" },
        { code: "STAB_LINK_FL", name: "Ліва стійка стабілізатора", position: "Передня ліва", work: "Заміна стійки стабілізатора", part: "Стійка стабілізатора" },
        { code: "STAB_LINK_FR", name: "Права стійка стабілізатора", position: "Передня права", work: "Заміна стійки стабілізатора", part: "Стійка стабілізатора" },
        { code: "STAB_BUSH", name: "Втулки стабілізатора", work: "Заміна втулок стабілізатора", part: "Втулки стабілізатора" },
      ] },
      { code: "STEERING", name: "Рульове керування", items: [
        { code: "TIE_FL", name: "Лівий рульовий наконечник", position: "Передній лівий", work: "Заміна рульового наконечника", part: "Рульовий наконечник" },
        { code: "TIE_FR", name: "Правий рульовий наконечник", position: "Передній правий", work: "Заміна рульового наконечника", part: "Рульовий наконечник" },
        { code: "RACK", name: "Рульова рейка", work: "Ремонт / заміна рульової рейки", part: "Рульова рейка" },
      ] },
      { code: "REAR", name: "Задня ходова", items: [
        { code: "SHOCK_RL", name: "Лівий задній амортизатор", position: "Задній лівий", work: "Заміна заднього амортизатора", part: "Амортизатор задній" },
        { code: "SHOCK_RR", name: "Правий задній амортизатор", position: "Задній правий", work: "Заміна заднього амортизатора", part: "Амортизатор задній" },
        { code: "BUSH_REAR", name: "Сайлентблоки задньої підвіски", work: "Заміна сайлентблока", part: "Сайлентблок" },
      ] },
    ],
  },
  {
    code: "BRAKES", name: "Гальмівна система", description: "Колодки, диски, шланги та гальмівна рідина.", sortOrder: 30,
    sections: [
      { code: "FRONT_BRAKES", name: "Передні гальма", items: [
        { code: "PADS_FRONT", name: "Передні колодки", unit: "мм", work: "Заміна передніх гальмівних колодок", part: "Передні гальмівні колодки" },
        { code: "DISC_FL", name: "Лівий передній диск", position: "Передній лівий", unit: "мм", work: "Заміна передніх гальмівних дисків", part: "Передній гальмівний диск" },
        { code: "DISC_FR", name: "Правий передній диск", position: "Передній правий", unit: "мм", work: "Заміна передніх гальмівних дисків", part: "Передній гальмівний диск" },
      ] },
      { code: "REAR_BRAKES", name: "Задні гальма", items: [
        { code: "PADS_REAR", name: "Задні колодки", unit: "мм", work: "Заміна задніх гальмівних колодок", part: "Задні гальмівні колодки" }, { code: "DISC_REAR", name: "Задні диски / барабани", unit: "мм", work: "Ремонт задньої гальмівної системи" },
      ] },
      { code: "HYDRAULICS", name: "Гідравліка", items: [
        { code: "HOSES", name: "Гальмівні шланги", part: "Гальмівний шланг" }, { code: "FLUID", name: "Стан гальмівної рідини", work: "Заміна гальмівної рідини" },
      ] },
    ],
  },
  {
    code: "COMPUTER_DIAGNOSTICS", name: "Комп’ютерна діагностика", description: "Зчитування помилок, контрольні параметри та електроживлення.", sortOrder: 40,
    sections: [
      { code: "DTC", name: "Коди несправностей", items: [
        { code: "ENGINE_DTC", name: "ЕБУ двигуна" }, { code: "ABS_DTC", name: "ABS / ESP" }, { code: "AIRBAG_DTC", name: "SRS / Airbag" }, { code: "BODY_DTC", name: "Кузовна електроніка" },
      ] },
      { code: "LIVE", name: "Контрольні параметри", items: [
        { code: "BATTERY", name: "Напруга бортмережі", unit: "V" }, { code: "CHARGE", name: "Напруга генератора", unit: "V" }, { code: "LIVE_DATA", name: "Ключові live-data параметри" },
      ] },
    ],
  },
];

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}
function isClosedDiagnostic(status: DiagnosticRequestStatus) {
  return status === DiagnosticRequestStatus.CONFIRMED || status === DiagnosticRequestStatus.CANCELLED;
}
function isLockedReview(state: DiagnosticReviewState) {
  return state === DiagnosticReviewState.SUBMITTED || state === DiagnosticReviewState.CONFIRMED;
}

export async function ensureDefaultDiagnosticTemplates() {
  const prisma = getPrisma();
  for (const seed of TEMPLATE_SEEDS) {
    const template = await prisma.diagnosticTemplate.upsert({
      where: { code: seed.code },
      create: { code: seed.code, name: seed.name, description: seed.description, isDefault: Boolean(seed.isDefault), isActive: true, sortOrder: seed.sortOrder },
      update: { name: seed.name, description: seed.description, isDefault: Boolean(seed.isDefault), isActive: true, sortOrder: seed.sortOrder },
    });
    for (let s = 0; s < seed.sections.length; s += 1) {
      const sectionSeed = seed.sections[s];
      const section = await prisma.diagnosticTemplateSection.upsert({
        where: { templateId_code: { templateId: template.id, code: sectionSeed.code } },
        create: { templateId: template.id, code: sectionSeed.code, name: sectionSeed.name, sortOrder: (s + 1) * 10 },
        update: { name: sectionSeed.name, sortOrder: (s + 1) * 10 },
      });
      for (let i = 0; i < sectionSeed.items.length; i += 1) {
        const item = sectionSeed.items[i];
        await prisma.diagnosticTemplateItem.upsert({
          where: { sectionId_code: { sectionId: section.id, code: item.code } },
          create: { sectionId: section.id, code: item.code, name: item.name, position: item.position || null, measurementUnit: item.unit || null, suggestedWorkName: item.work || null, suggestedPartName: item.part || null, sortOrder: (i + 1) * 10 },
          update: { name: item.name, position: item.position || null, measurementUnit: item.unit || null, suggestedWorkName: item.work || null, suggestedPartName: item.part || null, sortOrder: (i + 1) * 10 },
        });
      }
    }
  }
}

export async function getMechanicByUserId(userId: string) {
  const prisma = getPrisma();
  const mechanic = await prisma.serviceMechanic.findFirst({ where: { userId, isActive: true }, include: { location: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } });
  if (!mechanic) throw new StructuredDiagnosticError("MECHANIC_NOT_LINKED", "Профіль користувача не прив’язаний до ресурсу автомеханіка.", 403);
  return mechanic;
}

export async function upsertDiagnosticAssignment(input: { diagnosticRequestId: string; locationId?: string | null; mechanicId?: string | null }) {
  const prisma = getPrisma();
  return prisma.diagnosticAssignment.upsert({
    where: { diagnosticRequestId: input.diagnosticRequestId },
    create: { diagnosticRequestId: input.diagnosticRequestId, locationId: input.locationId || null, mechanicId: input.mechanicId || null },
    update: { locationId: input.locationId || null, mechanicId: input.mechanicId || null },
  });
}

async function ensureReview(diagnosticRequestId: string) {
  return getPrisma().diagnosticReview.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId }, update: {} });
}

async function backfillAssignmentsForMechanic(userId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const appointments = await prisma.serviceAppointment.findMany({
    where: { mechanicId: mechanic.id, status: { notIn: ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] } },
    select: { id: true, locationId: true, mechanicId: true, leadId: true, vehicleId: true, plannedStartAt: true, plannedEndAt: true, problem: true, post: { select: { name: true } } },
    orderBy: { plannedStartAt: "asc" }, take: 40,
  });
  const vehicleIds = appointments.flatMap((row) => row.vehicleId ? [row.vehicleId] : []);
  const leadIds = appointments.flatMap((row) => row.leadId ? [row.leadId] : []);
  const diagnostics = appointments.length ? await prisma.diagnosticRequest.findMany({
    where: { status: { not: DiagnosticRequestStatus.CANCELLED }, OR: [{ vehicleId: { in: vehicleIds } }, { leadId: { in: leadIds } }] },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  }) : [];
  const diagnosticByAppointment = new Map<string, string>();
  for (const appointment of appointments) {
    const diagnostic = diagnostics.find((row) => Boolean(appointment.leadId && row.leadId === appointment.leadId)) || diagnostics.find((row) => Boolean(appointment.vehicleId && row.vehicleId === appointment.vehicleId));
    if (!diagnostic) continue;
    diagnosticByAppointment.set(appointment.id, diagnostic.id);
    await prisma.diagnosticAssignment.upsert({
      where: { diagnosticRequestId: diagnostic.id },
      create: { diagnosticRequestId: diagnostic.id, locationId: appointment.locationId, mechanicId: mechanic.id },
      update: { locationId: appointment.locationId, mechanicId: mechanic.id },
    });
    await ensureReview(diagnostic.id);
  }
  return { mechanic, appointments, diagnosticByAppointment };
}

export async function listMechanicDiagnostics(userId: string) {
  const prisma = getPrisma();
  await ensureDefaultDiagnosticTemplates();
  const { mechanic, appointments, diagnosticByAppointment } = await backfillAssignmentsForMechanic(userId);
  const ids = Array.from(new Set(diagnosticByAppointment.values()));
  const diagnostics = ids.length ? await prisma.diagnosticRequest.findMany({
    where: { id: { in: ids } },
    include: { client: { select: { id: true, name: true, phone: true } }, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } }, lead: { select: { id: true, need: true, comment: true } } },
  }) : [];
  const reviews = ids.length ? await prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } }) : [];
  const byId = new Map(diagnostics.map((row) => [row.id, row]));
  const reviewById = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));
  const items = appointments.flatMap((appointment) => {
    const id = diagnosticByAppointment.get(appointment.id);
    const row = id ? byId.get(id) : undefined;
    if (!row) return [];
    const review = reviewById.get(row.id);
    const workflowState = review?.state === DiagnosticReviewState.SUBMITTED ? "SUBMITTED" : review?.state === DiagnosticReviewState.RETURNED ? "RETURNED" : row.status;
    return [{ id: row.id, status: row.status, workflowState, reviewState: review?.state || DiagnosticReviewState.DRAFT, plannedStartAt: appointment.plannedStartAt, plannedEndAt: appointment.plannedEndAt, post: appointment.post?.name || null, problem: appointment.problem || row.lead?.need || null, vehicle: { ...row.vehicle, label: vehicleLabel(row.vehicle) }, client: row.client }];
  });
  return { mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location }, items };
}

async function assertMechanicDiagnostic(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  let assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  if (!assignment) { await backfillAssignmentsForMechanic(userId); assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }); }
  if (!assignment || assignment.mechanicId !== mechanic.id) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
  return { mechanic, assignment };
}

async function loadTemplateStructure(templateIds: string[]) {
  const prisma = getPrisma();
  const templates = templateIds.length ? await prisma.diagnosticTemplate.findMany({ where: { id: { in: templateIds } }, orderBy: { sortOrder: "asc" } }) : [];
  const sections = templateIds.length ? await prisma.diagnosticTemplateSection.findMany({ where: { templateId: { in: templateIds } }, orderBy: [{ templateId: "asc" }, { sortOrder: "asc" }] }) : [];
  const sectionIds = sections.map((row) => row.id);
  const items = sectionIds.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: [{ sectionId: "asc" }, { sortOrder: "asc" }] }) : [];
  return { templates, sections, items };
}

export async function createDiagnosticInspection(diagnosticRequestId: string, templateId: string, mechanicId: string | null) {
  const prisma = getPrisma();
  const existing = await prisma.diagnosticInspection.findUnique({ where: { diagnosticRequestId_templateId: { diagnosticRequestId, templateId } } });
  if (existing) return existing;
  const template = await prisma.diagnosticTemplate.findFirst({ where: { id: templateId, isActive: true } });
  if (!template) throw new StructuredDiagnosticError("TEMPLATE_NOT_FOUND", "Шаблон діагностики не знайдено.", 404);
  const sections = await prisma.diagnosticTemplateSection.findMany({ where: { templateId }, select: { id: true } });
  const items = sections.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sections.map((row) => row.id) } }, select: { id: true } }) : [];
  return prisma.$transaction(async (tx) => {
    const inspection = await tx.diagnosticInspection.create({ data: { diagnosticRequestId, templateId, mechanicId, status: DiagnosticInspectionStatus.IN_PROGRESS, startedAt: new Date() } });
    if (items.length) await tx.diagnosticCheck.createMany({ data: items.map((item) => ({ inspectionId: inspection.id, templateItemId: item.id })), skipDuplicates: true });
    return inspection;
  });
}

async function ensureDefaultInspection(diagnosticRequestId: string, mechanicId: string) {
  const prisma = getPrisma();
  if (await prisma.diagnosticInspection.count({ where: { diagnosticRequestId } })) return;
  await ensureDefaultDiagnosticTemplates();
  const template = await prisma.diagnosticTemplate.findFirst({ where: { isDefault: true, isActive: true }, orderBy: { sortOrder: "asc" } });
  if (template) await createDiagnosticInspection(diagnosticRequestId, template.id, mechanicId);
}

export async function startStructuredDiagnostic(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId } });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  if (isClosedDiagnostic(diagnostic.status)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  const review = await ensureReview(diagnosticRequestId);
  if (review.state === DiagnosticReviewState.SUBMITTED) throw new StructuredDiagnosticError("DIAGNOSTIC_SUBMITTED", "Діагностика вже передана сервіс-менеджеру.", 409);
  if (diagnostic.status === DiagnosticRequestStatus.PENDING) {
    await prisma.diagnosticRequest.update({ where: { id: diagnosticRequestId }, data: { status: DiagnosticRequestStatus.IN_PROGRESS } });
    await prisma.auditEvent.create({ data: { actorName: mechanic.name, entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "STATUS_PENDING_TO_IN_PROGRESS", metadata: toPrismaJson({ source: "MECHANIC_MOBILE" }) } }).catch(() => undefined);
  }
  await ensureDefaultInspection(diagnosticRequestId, mechanic.id);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function addTemplateForMechanic(userId: string, diagnosticRequestId: string, templateId: string) {
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if (isLockedReview(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Після передачі сервіс-менеджеру склад діагностики змінювати не можна.", 409);
  await createDiagnosticInspection(diagnosticRequestId, templateId, mechanic.id);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function getStructuredDiagnosticForMechanic(userId: string, diagnosticRequestId: string) {
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function getStructuredDiagnostic(diagnosticRequestId: string) {
  const prisma = getPrisma();
  await ensureDefaultDiagnosticTemplates();
  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    include: { client: { select: { id: true, name: true, phone: true } }, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } }, lead: { select: { id: true, need: true, comment: true } }, workOrder: { select: { id: true, status: true } } },
  });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  const [assignment, review, inspections, availableTemplates] = await Promise.all([
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId }, orderBy: { createdAt: "asc" } }),
    prisma.diagnosticTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const structure = await loadTemplateStructure(inspections.map((row) => row.templateId));
  const inspectionIds = inspections.map((row) => row.id);
  const checks = inspectionIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspectionIds } } }) : [];
  const findings = checks.length ? await prisma.diagnosticFinding.findMany({ where: { checkId: { in: checks.map((row) => row.id) } } }) : [];
  const media = findings.length ? await prisma.diagnosticMedia.findMany({ where: { findingId: { in: findings.map((row) => row.id) } }, select: { id: true, findingId: true, fileName: true, mimeType: true, fileSize: true, createdAt: true }, orderBy: { createdAt: "asc" } }) : [];

  const findingByCheck = new Map(findings.map((row) => [row.checkId, row]));
  const mediaByFinding = new Map<string, typeof media>();
  for (const row of media) mediaByFinding.set(row.findingId, [...(mediaByFinding.get(row.findingId) || []), row]);
  const checksByInspection = new Map<string, typeof checks>();
  for (const row of checks) checksByInspection.set(row.inspectionId, [...(checksByInspection.get(row.inspectionId) || []), row]);
  const sectionsByTemplate = new Map<string, typeof structure.sections>();
  for (const row of structure.sections) sectionsByTemplate.set(row.templateId, [...(sectionsByTemplate.get(row.templateId) || []), row]);
  const itemsBySection = new Map<string, typeof structure.items>();
  for (const row of structure.items) itemsBySection.set(row.sectionId, [...(itemsBySection.get(row.sectionId) || []), row]);
  const templateById = new Map(structure.templates.map((row) => [row.id, row]));

  const inspectionView = inspections.map((inspection) => {
    const checkByItem = new Map((checksByInspection.get(inspection.id) || []).map((row) => [row.templateItemId, row]));
    const sections = (sectionsByTemplate.get(inspection.templateId) || []).map((section) => {
      const rows = (itemsBySection.get(section.id) || []).map((item) => {
        const check = checkByItem.get(item.id);
        const finding = check ? findingByCheck.get(check.id) : undefined;
        return { id: check?.id || null, templateItemId: item.id, name: item.name, position: item.position, measurementUnit: item.measurementUnit, state: check?.state || DiagnosticCheckState.NOT_CHECKED, measurementValue: check?.measurementValue?.toString() || null, measurementText: check?.measurementText || null, note: check?.note || null, finding: finding ? { id: finding.id, action: finding.action, urgency: finding.urgency, findingText: finding.findingText, suggestedWorkName: finding.suggestedWorkName, suggestedPartName: finding.suggestedPartName, media: mediaByFinding.get(finding.id) || [] } : null };
      });
      return { id: section.id, code: section.code, name: section.name, items: rows, counts: countChecks(rows) };
    });
    const flat = sections.flatMap((section) => section.items);
    return { id: inspection.id, templateId: inspection.templateId, templateName: templateById.get(inspection.templateId)?.name || "Діагностика", status: inspection.status, startedAt: inspection.startedAt, completedAt: inspection.completedAt, sections, counts: countChecks(flat) };
  });
  const allItems = inspectionView.flatMap((inspection) => inspection.sections.flatMap((section) => section.items));
  return {
    diagnostic: { id: diagnostic.id, status: diagnostic.status, workflowState: review?.state === DiagnosticReviewState.SUBMITTED ? "SUBMITTED" : review?.state === DiagnosticReviewState.RETURNED ? "RETURNED" : diagnostic.status, technicalConclusion: diagnostic.technicalConclusion, confirmedAt: diagnostic.confirmedAt, client: diagnostic.client, vehicle: { ...diagnostic.vehicle, label: vehicleLabel(diagnostic.vehicle) }, problem: diagnostic.lead?.need || diagnostic.lead?.comment || null, workOrder: diagnostic.workOrder, assignment, review: review || { state: DiagnosticReviewState.DRAFT, submittedAt: null, returnedAt: null, confirmedAt: null, mechanicComment: null, managerComment: null } },
    inspections: inspectionView,
    availableTemplates: availableTemplates.map((template) => ({ id: template.id, code: template.code, name: template.name, description: template.description, added: inspections.some((inspection) => inspection.templateId === template.id) })),
    counts: countChecks(allItems),
    canSubmit: inspections.length > 0 && allItems.length > 0 && allItems.every((row) => row.state !== DiagnosticCheckState.NOT_CHECKED),
  };
}

function countChecks<T extends { state: DiagnosticCheckState }>(rows: T[]) {
  return { total: rows.length, checked: rows.filter((row) => row.state !== DiagnosticCheckState.NOT_CHECKED).length, ok: rows.filter((row) => row.state === DiagnosticCheckState.OK).length, attention: rows.filter((row) => row.state === DiagnosticCheckState.ATTENTION).length, defect: rows.filter((row) => row.state === DiagnosticCheckState.DEFECT).length };
}

async function refreshInspectionCompletion(inspectionId: string) {
  const prisma = getPrisma();
  const checks = await prisma.diagnosticCheck.findMany({ where: { inspectionId }, select: { state: true } });
  const complete = checks.length > 0 && checks.every((row) => row.state !== DiagnosticCheckState.NOT_CHECKED);
  await prisma.diagnosticInspection.update({ where: { id: inspectionId }, data: complete ? { status: DiagnosticInspectionStatus.COMPLETED, completedAt: new Date() } : { status: DiagnosticInspectionStatus.IN_PROGRESS, startedAt: new Date(), completedAt: null } });
}

export async function updateDiagnosticCheck(userId: string, diagnosticRequestId: string, checkId: string, input: { state: string; measurementValue?: string | number | null; measurementText?: string | null; note?: string | null; action?: string | null; urgency?: string | null; findingText?: string | null }) {
  const prisma = getPrisma();
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if (isLockedReview(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  const state = Object.values(DiagnosticCheckState).find((value) => value === String(input.state || "").toUpperCase());
  if (!state) throw new StructuredDiagnosticError("INVALID_CHECK_STATE", "Оберіть коректний стан перевірки.");
  const check = await prisma.diagnosticCheck.findUnique({ where: { id: checkId } });
  if (!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Пункт перевірки не знайдено.", 404);
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("CHECK_SCOPE_MISMATCH", "Пункт не належить цій діагностиці.", 403);
  const item = await prisma.diagnosticTemplateItem.findUnique({ where: { id: check.templateItemId } });
  const measurementValue = input.measurementValue === "" || input.measurementValue == null ? null : Number(input.measurementValue);
  if (measurementValue !== null && !Number.isFinite(measurementValue)) throw new StructuredDiagnosticError("INVALID_MEASUREMENT", "Вкажіть коректне числове значення заміру.");
  const action = Object.values(DiagnosticFindingAction).find((value) => value === String(input.action || "NONE").toUpperCase()) || DiagnosticFindingAction.NONE;
  const urgency = Object.values(DiagnosticUrgency).find((value) => value === String(input.urgency || "INFO").toUpperCase()) || DiagnosticUrgency.INFO;
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticCheck.update({ where: { id: checkId }, data: { state, measurementValue, measurementText: typeof input.measurementText === "string" ? input.measurementText.trim().slice(0, 160) || null : null, note: typeof input.note === "string" ? input.note.trim().slice(0, 4000) || null : null, checkedAt: state === DiagnosticCheckState.NOT_CHECKED ? null : new Date() } });
    const problem = state === DiagnosticCheckState.ATTENTION || state === DiagnosticCheckState.DEFECT;
    if (problem) {
      await tx.diagnosticFinding.upsert({ where: { checkId }, create: { checkId, action, urgency, findingText: typeof input.findingText === "string" ? input.findingText.trim().slice(0, 4000) || null : null, suggestedWorkName: item?.suggestedWorkName || null, suggestedPartName: item?.suggestedPartName || null }, update: { action, urgency, findingText: typeof input.findingText === "string" ? input.findingText.trim().slice(0, 4000) || null : null, suggestedWorkName: item?.suggestedWorkName || undefined, suggestedPartName: item?.suggestedPartName || undefined } });
    } else {
      const finding = await tx.diagnosticFinding.findUnique({ where: { checkId } });
      if (finding) { await tx.diagnosticMedia.deleteMany({ where: { findingId: finding.id } }); await tx.diagnosticFinding.delete({ where: { id: finding.id } }); }
    }
  });
  await refreshInspectionCompletion(inspection.id);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function setDiagnosticSectionAllOk(userId: string, diagnosticRequestId: string, inspectionId: string, sectionId: string) {
  const prisma = getPrisma();
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if (isLockedReview(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("INSPECTION_SCOPE_MISMATCH", "Секція не належить цій діагностиці.", 403);
  const itemIds = (await prisma.diagnosticTemplateItem.findMany({ where: { sectionId }, select: { id: true } })).map((row) => row.id);
  const checks = itemIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId, templateItemId: { in: itemIds } }, select: { id: true } }) : [];
  await prisma.$transaction(async (tx) => {
    const checkIds = checks.map((row) => row.id);
    if (checkIds.length) await tx.diagnosticCheck.updateMany({ where: { id: { in: checkIds } }, data: { state: DiagnosticCheckState.OK, checkedAt: new Date(), note: null, measurementValue: null, measurementText: null } });
    const findings = checkIds.length ? await tx.diagnosticFinding.findMany({ where: { checkId: { in: checkIds } }, select: { id: true } }) : [];
    if (findings.length) await tx.diagnosticMedia.deleteMany({ where: { findingId: { in: findings.map((row) => row.id) } } });
    if (checkIds.length) await tx.diagnosticFinding.deleteMany({ where: { checkId: { in: checkIds } } });
  });
  await refreshInspectionCompletion(inspectionId);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function submitStructuredDiagnostic(userId: string, diagnosticRequestId: string, mechanicComment?: string | null) {
  const prisma = getPrisma();
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  if (!view.canSubmit) throw new StructuredDiagnosticError("DIAGNOSTIC_INCOMPLETE", "Перед передачею сервіс-менеджеру перевірте всі обов’язкові пункти.", 409);
  if (isClosedDiagnostic(view.diagnostic.status)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticInspection.updateMany({ where: { diagnosticRequestId }, data: { status: DiagnosticInspectionStatus.COMPLETED, completedAt: now } });
    await tx.diagnosticReview.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId, state: DiagnosticReviewState.SUBMITTED, submittedAt: now, mechanicComment: mechanicComment?.trim().slice(0, 4000) || null }, update: { state: DiagnosticReviewState.SUBMITTED, submittedAt: now, returnedAt: null, mechanicComment: mechanicComment?.trim().slice(0, 4000) || null } });
    await tx.auditEvent.create({ data: { actorName: mechanic.name, entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "DIAGNOSTIC_SUBMITTED", metadata: toPrismaJson({ source: "MECHANIC_MOBILE", counts: view.counts }) } });
  });
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function returnStructuredDiagnostic(diagnosticRequestId: string, reviewerUserId: string, managerComment?: string | null) {
  const prisma = getPrisma();
  const review = await ensureReview(diagnosticRequestId);
  if (review.state !== DiagnosticReviewState.SUBMITTED) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_SUBMITTED", "Повернути можна лише діагностику, передану на перевірку.", 409);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticReview.update({ where: { diagnosticRequestId }, data: { state: DiagnosticReviewState.RETURNED, returnedAt: now, reviewerUserId, managerComment: managerComment?.trim().slice(0, 4000) || null } });
    await tx.diagnosticInspection.updateMany({ where: { diagnosticRequestId }, data: { status: DiagnosticInspectionStatus.IN_PROGRESS, completedAt: null } });
    await tx.auditEvent.create({ data: { actorName: "CRM / Сервіс-менеджер", entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "DIAGNOSTIC_RETURNED_TO_MECHANIC", metadata: toPrismaJson({ reviewerUserId, managerComment: managerComment || null }) } });
  });
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function markStructuredDiagnosticConfirmed(diagnosticRequestId: string, reviewerUserId?: string | null) {
  const now = new Date();
  return getPrisma().diagnosticReview.upsert({ where: { diagnosticRequestId }, create: { diagnosticRequestId, state: DiagnosticReviewState.CONFIRMED, confirmedAt: now, reviewerUserId: reviewerUserId || null }, update: { state: DiagnosticReviewState.CONFIRMED, confirmedAt: now, reviewerUserId: reviewerUserId || undefined } });
}

export async function buildStructuredTechnicalConclusion(diagnosticRequestId: string) {
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const findings = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding ? [{ section: section.name, item }] : [])));
  if (!findings.length) return view.counts.total ? "За результатами структурованої діагностики критичних дефектів не виявлено." : null;
  const actions: Record<string, string> = { NONE: "потребує оцінки", REPLACE: "замінити", REPAIR: "ремонтувати", ADJUST: "відрегулювати", CLEAN: "очистити / обслужити", ADDITIONAL_DIAGNOSTICS: "провести додаткову діагностику" };
  const urgency: Record<string, string> = { INFO: "рекомендація", SOON: "найближчим часом", CRITICAL: "критично" };
  return findings.map(({ section, item }) => `${section} — ${item.name}: ${item.finding?.findingText || item.note || (item.state === DiagnosticCheckState.DEFECT ? "виявлено дефект" : "потребує уваги")}. Дія: ${actions[item.finding?.action || "NONE"] || item.finding?.action}. Терміновість: ${urgency[item.finding?.urgency || "INFO"] || item.finding?.urgency}.`).join("\n");
}

export async function getDiagnosticMedia(mediaId: string) {
  return getPrisma().diagnosticMedia.findUnique({ where: { id: mediaId } });
}

export async function addDiagnosticMedia(userId: string, diagnosticRequestId: string, checkId: string, file: { name: string; type: string; size: number; data: Buffer }) {
  const prisma = getPrisma();
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if (isLockedReview(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Після передачі на перевірку фото змінювати не можна.", 409);
  const check = await prisma.diagnosticCheck.findUnique({ where: { id: checkId } });
  if (!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Пункт перевірки не знайдено.", 404);
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("CHECK_SCOPE_MISMATCH", "Пункт не належить цій діагностиці.", 403);
  const problem = check.state === DiagnosticCheckState.ATTENTION || check.state === DiagnosticCheckState.DEFECT;
  if (!problem) throw new StructuredDiagnosticError("FINDING_REQUIRED", "Фото дефекту можна додати після вибору «Увага» або «Дефект».");
  const finding = await prisma.diagnosticFinding.upsert({ where: { checkId }, create: { checkId }, update: {} });
  const media = await prisma.diagnosticMedia.create({ data: { findingId: finding.id, fileName: file.name.slice(0, 240) || "diagnostic-photo.jpg", mimeType: file.type, fileSize: file.size, fileData: file.data } });
  return { id: media.id, fileName: media.fileName, mimeType: media.mimeType, fileSize: media.fileSize, createdAt: media.createdAt };
}
