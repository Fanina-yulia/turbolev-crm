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

type DefaultItem = {
  code: string;
  name: string;
  position?: string;
  unit?: string;
  work?: string;
  part?: string;
};
type DefaultSection = { code: string; name: string; items: DefaultItem[] };
type DefaultTemplate = {
  code: string;
  name: string;
  description: string;
  isDefault?: boolean;
  sortOrder: number;
  sections: DefaultSection[];
};

const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    code: "BASIC_INSPECTION",
    name: "Базовий комплексний огляд",
    description: "Швидкий обов’язковий огляд перед поглибленою діагностикою.",
    isDefault: true,
    sortOrder: 10,
    sections: [
      { code: "VISUAL", name: "Візуальний огляд", items: [
        { code: "LEAKS", name: "Підтікання технічних рідин" },
        { code: "BELTS_HOSES", name: "Ремені та патрубки" },
        { code: "LIGHTS", name: "Зовнішнє освітлення" },
      ] },
      { code: "FLUIDS", name: "Рідини", items: [
        { code: "ENGINE_OIL", name: "Рівень/стан моторної оливи" },
        { code: "COOLANT", name: "Рівень/стан охолоджувальної рідини" },
        { code: "BRAKE_FLUID", name: "Гальмівна рідина", work: "Заміна гальмівної рідини" },
      ] },
      { code: "TYRES", name: "Шини та колеса", items: [
        { code: "TYRE_FL", name: "Передня ліва шина", position: "Передня ліва", unit: "мм" },
        { code: "TYRE_FR", name: "Передня права шина", position: "Передня права", unit: "мм" },
        { code: "TYRE_RL", name: "Задня ліва шина", position: "Задня ліва", unit: "мм" },
        { code: "TYRE_RR", name: "Задня права шина", position: "Задня права", unit: "мм" },
      ] },
      { code: "BATTERY", name: "АКБ / зарядка", items: [
        { code: "BATTERY_VOLTAGE", name: "Напруга АКБ", unit: "V" },
        { code: "CHARGING", name: "Напруга заряджання", unit: "V" },
      ] },
    ],
  },
  {
    code: "SUSPENSION",
    name: "Комплексна діагностика ходової",
    description: "Передня/задня ходова, рульове керування та елементи стабілізації.",
    sortOrder: 20,
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
    code: "BRAKES",
    name: "Гальмівна система",
    description: "Колодки, диски, шланги та гальмівна рідина.",
    sortOrder: 30,
    sections: [
      { code: "FRONT_BRAKES", name: "Передні гальма", items: [
        { code: "PADS_FRONT", name: "Передні колодки", unit: "мм", work: "Заміна передніх гальмівних колодок", part: "Передні гальмівні колодки" },
        { code: "DISC_FL", name: "Лівий передній диск", position: "Передній лівий", unit: "мм", work: "Заміна передніх гальмівних дисків", part: "Передній гальмівний диск" },
        { code: "DISC_FR", name: "Правий передній диск", position: "Передній правий", unit: "мм", work: "Заміна передніх гальмівних дисків", part: "Передній гальмівний диск" },
      ] },
      { code: "REAR_BRAKES", name: "Задні гальма", items: [
        { code: "PADS_REAR", name: "Задні колодки", unit: "мм", work: "Заміна задніх гальмівних колодок", part: "Задні гальмівні колодки" },
        { code: "DISC_REAR", name: "Задні диски / барабани", unit: "мм", work: "Ремонт задньої гальмівної системи" },
      ] },
      { code: "HYDRAULICS", name: "Гідравліка", items: [
        { code: "HOSES", name: "Гальмівні шланги", part: "Гальмівний шланг" },
        { code: "FLUID", name: "Стан гальмівної рідини", work: "Заміна гальмівної рідини" },
      ] },
    ],
  },
  {
    code: "COMPUTER_DIAGNOSTICS",
    name: "Комп’ютерна діагностика",
    description: "Зчитування помилок, контрольні параметри та електроживлення.",
    sortOrder: 40,
    sections: [
      { code: "DTC", name: "Коди несправностей", items: [
        { code: "ENGINE_DTC", name: "ЕБУ двигуна" },
        { code: "ABS_DTC", name: "ABS / ESP" },
        { code: "AIRBAG_DTC", name: "SRS / Airbag" },
        { code: "BODY_DTC", name: "Кузовна електроніка" },
      ] },
      { code: "LIVE", name: "Контрольні параметри", items: [
        { code: "BATTERY", name: "Напруга бортмережі", unit: "V" },
        { code: "CHARGE", name: "Напруга генератора", unit: "V" },
        { code: "LIVE_DATA", name: "Ключові live-data параметри" },
      ] },
    ],
  },
];

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

export async function ensureDefaultDiagnosticTemplates() {
  const prisma = getPrisma();
  for (const templateDef of DEFAULT_TEMPLATES) {
    let template = await prisma.diagnosticTemplate.findUnique({ where: { code: templateDef.code } });
    if (!template) {
      template = await prisma.diagnosticTemplate.create({ data: {
        code: templateDef.code,
        name: templateDef.name,
        description: templateDef.description,
        isDefault: Boolean(templateDef.isDefault),
        isActive: true,
        sortOrder: templateDef.sortOrder,
      } });
    }
    for (let s = 0; s < templateDef.sections.length; s += 1) {
      const sectionDef = templateDef.sections[s];
      const where = { templateId_code: { templateId: template.id, code: sectionDef.code } };
      let section = await prisma.diagnosticTemplateSection.findUnique({ where });
      if (!section) {
        section = await prisma.diagnosticTemplateSection.create({ data: {
          templateId: template.id,
          code: sectionDef.code,
          name: sectionDef.name,
          sortOrder: (s + 1) * 10,
        } });
      }
      for (let i = 0; i < sectionDef.items.length; i += 1) {
        const itemDef = sectionDef.items[i];
        const itemWhere = { sectionId_code: { sectionId: section.id, code: itemDef.code } };
        const item = await prisma.diagnosticTemplateItem.findUnique({ where: itemWhere });
        if (!item) {
          await prisma.diagnosticTemplateItem.create({ data: {
            sectionId: section.id,
            code: itemDef.code,
            name: itemDef.name,
            position: itemDef.position || null,
            measurementUnit: itemDef.unit || null,
            suggestedWorkName: itemDef.work || null,
            suggestedPartName: itemDef.part || null,
            sortOrder: (i + 1) * 10,
          } });
        }
      }
    }
  }
}

export async function getMechanicByUserId(userId: string) {
  const prisma = getPrisma();
  const mechanic = await prisma.serviceMechanic.findFirst({
    where: { userId, isActive: true },
    include: { location: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!mechanic) throw new StructuredDiagnosticError("MECHANIC_NOT_LINKED", "Профіль користувача не прив’язаний до ресурсу автомеханіка.", 403);
  return mechanic;
}

export async function upsertDiagnosticAssignment(input: { diagnosticRequestId: string; locationId?: string | null; mechanicId?: string | null }) {
  const prisma = getPrisma();
  return prisma.diagnosticAssignment.upsert({
    where: { diagnosticRequestId: input.diagnosticRequestId },
    create: {
      diagnosticRequestId: input.diagnosticRequestId,
      locationId: input.locationId || null,
      mechanicId: input.mechanicId || null,
    },
    update: {
      locationId: input.locationId || null,
      mechanicId: input.mechanicId || null,
    },
  });
}

async function ensureReview(diagnosticRequestId: string) {
  const prisma = getPrisma();
  return prisma.diagnosticReview.upsert({
    where: { diagnosticRequestId },
    create: { diagnosticRequestId },
    update: {},
  });
}

async function backfillAssignmentsForMechanic(userId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      mechanicId: mechanic.id,
      status: { notIn: ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] },
      OR: [{ vehicleId: { not: null } }, { leadId: { not: null } }],
    },
    select: { id: true, locationId: true, mechanicId: true, leadId: true, vehicleId: true, plannedStartAt: true, plannedEndAt: true, problem: true, post: { select: { name: true } } },
    orderBy: { plannedStartAt: "asc" },
    take: 40,
  });
  if (!appointments.length) return { mechanic, appointments, diagnosticByAppointment: new Map<string, string>() };
  const vehicleIds = appointments.map((item) => item.vehicleId).filter((value): value is string => Boolean(value));
  const leadIds = appointments.map((item) => item.leadId).filter((value): value is string => Boolean(value));
  const diagnostics = await prisma.diagnosticRequest.findMany({
    where: {
      status: { not: DiagnosticRequestStatus.CANCELLED },
      OR: [
        ...(vehicleIds.length ? [{ vehicleId: { in: vehicleIds } }] : []),
        ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []),
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  const diagnosticByAppointment = new Map<string, string>();
  for (const appointment of appointments) {
    const diagnostic = diagnostics.find((row) => appointment.leadId && row.leadId === appointment.leadId)
      || diagnostics.find((row) => appointment.vehicleId && row.vehicleId === appointment.vehicleId);
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
  const diagnosticIds = Array.from(new Set(diagnosticByAppointment.values()));
  const [diagnostics, reviews] = await Promise.all([
    diagnosticIds.length ? prisma.diagnosticRequest.findMany({
      where: { id: { in: diagnosticIds } },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
        lead: { select: { id: true, need: true, comment: true } },
      },
    }) : [],
    diagnosticIds.length ? prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }) : [],
  ]);
  const byId = new Map(diagnostics.map((row) => [row.id, row]));
  const reviewById = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));
  const items = appointments.flatMap((appointment) => {
    const diagnosticId = diagnosticByAppointment.get(appointment.id);
    const row = diagnosticId ? byId.get(diagnosticId) : null;
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
      vehicle: {
        ...row.vehicle,
        label: vehicleLabel(row.vehicle),
      },
      client: row.client,
    }];
  });
  return { mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location }, items };
}

async function assertMechanicDiagnostic(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const mechanic = await getMechanicByUserId(userId);
  let assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  if (!assignment) {
    await backfillAssignmentsForMechanic(userId);
    assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  }
  if (!assignment || assignment.mechanicId !== mechanic.id) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена цьому автомеханіку.", 403);
  }
  return { mechanic, assignment };
}

async function loadTemplateStructure(templateIds: string[]) {
  const prisma = getPrisma();
  if (!templateIds.length) return { templates: [], sections: [], items: [] };
  const templates = await prisma.diagnosticTemplate.findMany({ where: { id: { in: templateIds } }, orderBy: { sortOrder: "asc" } });
  const sections = await prisma.diagnosticTemplateSection.findMany({ where: { templateId: { in: templateIds } }, orderBy: [{ templateId: "asc" }, { sortOrder: "asc" }] });
  const sectionIds = sections.map((section) => section.id);
  const items = sectionIds.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: [{ sectionId: "asc" }, { sortOrder: "asc" }] }) : [];
  return { templates, sections, items };
}

export async function createDiagnosticInspection(diagnosticRequestId: string, templateId: string, mechanicId: string | null) {
  const prisma = getPrisma();
  const template = await prisma.diagnosticTemplate.findFirst({ where: { id: templateId, isActive: true } });
  if (!template) throw new StructuredDiagnosticError("TEMPLATE_NOT_FOUND", "Шаблон діагностики не знайдено.", 404);
  const existing = await prisma.diagnosticInspection.findUnique({ where: { diagnosticRequestId_templateId: { diagnosticRequestId, templateId } } });
  if (existing) return existing;
  const sections = await prisma.diagnosticTemplateSection.findMany({ where: { templateId } });
  const items = sections.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sections.map((section) => section.id) } } }) : [];
  return prisma.$transaction(async (tx) => {
    const inspection = await tx.diagnosticInspection.create({ data: {
      diagnosticRequestId,
      templateId,
      mechanicId,
      status: DiagnosticInspectionStatus.IN_PROGRESS,
      startedAt: new Date(),
    } });
    if (items.length) {
      await tx.diagnosticCheck.createMany({
        data: items.map((item) => ({ inspectionId: inspection.id, templateItemId: item.id })),
        skipDuplicates: true,
      });
    }
    return inspection;
  });
}

async function ensureDefaultInspection(diagnosticRequestId: string, mechanicId: string) {
  const prisma = getPrisma();
  const count = await prisma.diagnosticInspection.count({ where: { diagnosticRequestId } });
  if (count) return;
  await ensureDefaultDiagnosticTemplates();
  const template = await prisma.diagnosticTemplate.findFirst({ where: { isDefault: true, isActive: true }, orderBy: { sortOrder: "asc" } });
  if (template) await createDiagnosticInspection(diagnosticRequestId, template.id, mechanicId);
}

export async function startStructuredDiagnostic(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId } });
  if (!diagnostic) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  if ([DiagnosticRequestStatus.CONFIRMED, DiagnosticRequestStatus.CANCELLED].includes(diagnostic.status)) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  }
  const review = await ensureReview(diagnosticRequestId);
  if (review.state === DiagnosticReviewState.SUBMITTED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_SUBMITTED", "Діагностика вже передана сервіс-менеджеру.", 409);
  }
  if (diagnostic.status === DiagnosticRequestStatus.PENDING) {
    await prisma.diagnosticRequest.update({ where: { id: diagnosticRequestId }, data: { status: DiagnosticRequestStatus.IN_PROGRESS } });
    await prisma.auditEvent.create({ data: {
      actorName: mechanic.name,
      entityType: "DiagnosticRequest",
      entityId: diagnosticRequestId,
      action: "STATUS_PENDING_TO_IN_PROGRESS",
      metadata: toPrismaJson({ source: "MECHANIC_MOBILE" }),
    } }).catch(() => undefined);
  }
  await ensureDefaultInspection(diagnosticRequestId, mechanic.id);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function addTemplateForMechanic(userId: string, diagnosticRequestId: string, templateId: string) {
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if (review.state === DiagnosticReviewState.SUBMITTED || review.state === DiagnosticReviewState.CONFIRMED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Після передачі сервіс-менеджеру склад діагностики змінювати не можна.", 409);
  }
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
  const structure = await loadTemplateStructure(inspections.map((item) => item.templateId));
  const inspectionIds = inspections.map((item) => item.id);
  const checks = inspectionIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspectionIds } } }) : [];
  const checkIds = checks.map((check) => check.id);
  const findings = checkIds.length ? await prisma.diagnosticFinding.findMany({ where: { checkId: { in: checkIds } } }) : [];
  const findingIds = findings.map((finding) => finding.id);
  const media = findingIds.length ? await prisma.diagnosticMedia.findMany({
    where: { findingId: { in: findingIds } },
    select: { id: true, findingId: true, fileName: true, mimeType: true, fileSize: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  }) : [];
  const findingByCheck = new Map(findings.map((finding) => [finding.checkId, finding]));
  const mediaByFinding = new Map<string, typeof media>();
  for (const item of media) mediaByFinding.set(item.findingId, [...(mediaByFinding.get(item.findingId) || []), item]);
  const itemById = new Map(structure.items.map((item) => [item.id, item]));
  const checksByInspection = new Map<string, typeof checks>();
  for (const check of checks) checksByInspection.set(check.inspectionId, [...(checksByInspection.get(check.inspectionId) || []), check]);
  const sectionsByTemplate = new Map<string, typeof structure.sections>();
  for (const section of structure.sections) sectionsByTemplate.set(section.templateId, [...(sectionsByTemplate.get(section.templateId) || []), section]);
  const itemsBySection = new Map<string, typeof structure.items>();
  for (const item of structure.items) itemsBySection.set(item.sectionId, [...(itemsBySection.get(item.sectionId) || []), item]);
  const templateById = new Map(structure.templates.map((template) => [template.id, template]));

  const inspectionView = inspections.map((inspection) => {
    const template = templateById.get(inspection.templateId);
    const inspectionChecks = checksByInspection.get(inspection.id) || [];
    const checkByItem = new Map(inspectionChecks.map((check) => [check.templateItemId, check]));
    const sections = (sectionsByTemplate.get(inspection.templateId) || []).map((section) => {
      const rows = (itemsBySection.get(section.id) || []).map((item) => {
        const check = checkByItem.get(item.id);
        const finding = check ? findingByCheck.get(check.id) : null;
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
      return {
        id: section.id,
        code: section.code,
        name: section.name,
        items: rows,
        counts: {
          total: rows.length,
          checked: rows.filter((row) => row.state !== DiagnosticCheckState.NOT_CHECKED).length,
          ok: rows.filter((row) => row.state === DiagnosticCheckState.OK).length,
          attention: rows.filter((row) => row.state === DiagnosticCheckState.ATTENTION).length,
          defect: rows.filter((row) => row.state === DiagnosticCheckState.DEFECT).length,
        },
      };
    });
    const flat = sections.flatMap((section) => section.items);
    return {
      id: inspection.id,
      templateId: inspection.templateId,
      templateName: template?.name || "Діагностика",
      status: inspection.status,
      startedAt: inspection.startedAt,
      completedAt: inspection.completedAt,
      sections,
      counts: {
        total: flat.length,
        checked: flat.filter((row) => row.state !== DiagnosticCheckState.NOT_CHECKED).length,
        ok: flat.filter((row) => row.state === DiagnosticCheckState.OK).length,
        attention: flat.filter((row) => row.state === DiagnosticCheckState.ATTENTION).length,
        defect: flat.filter((row) => row.state === DiagnosticCheckState.DEFECT).length,
      },
    };
  });
  const allItems = inspectionView.flatMap((inspection) => inspection.sections.flatMap((section) => section.items));
  return {
    diagnostic: {
      id: diagnostic.id,
      status: diagnostic.status,
      workflowState: review?.state === DiagnosticReviewState.SUBMITTED ? "SUBMITTED" : review?.state === DiagnosticReviewState.RETURNED ? "RETURNED" : diagnostic.status,
      technicalConclusion: diagnostic.technicalConclusion,
      confirmedAt: diagnostic.confirmedAt,
      client: diagnostic.client,
      vehicle: { ...diagnostic.vehicle, label: vehicleLabel(diagnostic.vehicle) },
      problem: diagnostic.lead?.need || diagnostic.lead?.comment || null,
      workOrder: diagnostic.workOrder,
      assignment,
      review: review || { state: DiagnosticReviewState.DRAFT, submittedAt: null, returnedAt: null, confirmedAt: null, mechanicComment: null, managerComment: null },
    },
    inspections: inspectionView,
    availableTemplates: availableTemplates.map((template) => ({ id: template.id, code: template.code, name: template.name, description: template.description, added: inspections.some((inspection) => inspection.templateId === template.id) })),
    counts: {
      total: allItems.length,
      checked: allItems.filter((row) => row.state !== DiagnosticCheckState.NOT_CHECKED).length,
      ok: allItems.filter((row) => row.state === DiagnosticCheckState.OK).length,
      attention: allItems.filter((row) => row.state === DiagnosticCheckState.ATTENTION).length,
      defect: allItems.filter((row) => row.state === DiagnosticCheckState.DEFECT).length,
    },
    canSubmit: inspections.length > 0 && allItems.length > 0 && allItems.every((row) => row.state !== DiagnosticCheckState.NOT_CHECKED),
  };
}

async function refreshInspectionCompletion(inspectionId: string) {
  const prisma = getPrisma();
  const checks = await prisma.diagnosticCheck.findMany({ where: { inspectionId }, select: { state: true } });
  const complete = checks.length > 0 && checks.every((check) => check.state !== DiagnosticCheckState.NOT_CHECKED);
  await prisma.diagnosticInspection.update({
    where: { id: inspectionId },
    data: complete
      ? { status: DiagnosticInspectionStatus.COMPLETED, completedAt: new Date() }
      : { status: DiagnosticInspectionStatus.IN_PROGRESS, startedAt: new Date(), completedAt: null },
  });
}

export async function updateDiagnosticCheck(userId: string, diagnosticRequestId: string, checkId: string, input: {
  state: string;
  measurementValue?: string | number | null;
  measurementText?: string | null;
  note?: string | null;
  action?: string | null;
  urgency?: string | null;
  findingText?: string | null;
}) {
  const prisma = getPrisma();
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if ([DiagnosticReviewState.SUBMITTED, DiagnosticReviewState.CONFIRMED].includes(review.state)) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  }
  const state = Object.values(DiagnosticCheckState).find((value) => value === String(input.state || "").toUpperCase());
  if (!state) throw new StructuredDiagnosticError("INVALID_CHECK_STATE", "Оберіть коректний стан перевірки.");
  const check = await prisma.diagnosticCheck.findUnique({ where: { id: checkId } });
  if (!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Пункт перевірки не знайдено.", 404);
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("CHECK_SCOPE_MISMATCH", "Пункт не належить цій діагностиці.", 403);
  const item = await prisma.diagnosticTemplateItem.findUnique({ where: { id: check.templateItemId } });
  const measurementValue = input.measurementValue === "" || input.measurementValue == null ? null : Number(input.measurementValue);
  if (measurementValue != null && !Number.isFinite(measurementValue)) throw new StructuredDiagnosticError("INVALID_MEASUREMENT", "Вкажіть коректне числове значення заміру.");
  const action = Object.values(DiagnosticFindingAction).find((value) => value === String(input.action || "NONE").toUpperCase()) || DiagnosticFindingAction.NONE;
  const urgency = Object.values(DiagnosticUrgency).find((value) => value === String(input.urgency || "INFO").toUpperCase()) || DiagnosticUrgency.INFO;
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticCheck.update({ where: { id: checkId }, data: {
      state,
      measurementValue,
      measurementText: typeof input.measurementText === "string" ? input.measurementText.trim().slice(0, 160) || null : null,
      note: typeof input.note === "string" ? input.note.trim().slice(0, 4000) || null : null,
      checkedAt: state === DiagnosticCheckState.NOT_CHECKED ? null : new Date(),
    } });
    if (state === DiagnosticCheckState.ATTENTION || state === DiagnosticCheckState.DEFECT) {
      await tx.diagnosticFinding.upsert({
        where: { checkId },
        create: {
          checkId,
          action,
          urgency,
          findingText: typeof input.findingText === "string" ? input.findingText.trim().slice(0, 4000) || null : null,
          suggestedWorkName: item?.suggestedWorkName || null,
          suggestedPartName: item?.suggestedPartName || null,
        },
        update: {
          action,
          urgency,
          findingText: typeof input.findingText === "string" ? input.findingText.trim().slice(0, 4000) || null : null,
          suggestedWorkName: item?.suggestedWorkName || undefined,
          suggestedPartName: item?.suggestedPartName || undefined,
        },
      });
    } else {
      const finding = await tx.diagnosticFinding.findUnique({ where: { checkId } });
      if (finding) {
        await tx.diagnosticMedia.deleteMany({ where: { findingId: finding.id } });
        await tx.diagnosticFinding.delete({ where: { id: finding.id } });
      }
    }
  });
  await refreshInspectionCompletion(inspection.id);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function setDiagnosticSectionAllOk(userId: string, diagnosticRequestId: string, inspectionId: string, sectionId: string) {
  const prisma = getPrisma();
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if ([DiagnosticReviewState.SUBMITTED, DiagnosticReviewState.CONFIRMED].includes(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("INSPECTION_SCOPE_MISMATCH", "Секція не належить цій діагностиці.", 403);
  const itemIds = (await prisma.diagnosticTemplateItem.findMany({ where: { sectionId }, select: { id: true } })).map((item) => item.id);
  const checks = itemIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId, templateItemId: { in: itemIds } }, select: { id: true } }) : [];
  await prisma.$transaction(async (tx) => {
    if (checks.length) await tx.diagnosticCheck.updateMany({ where: { id: { in: checks.map((check) => check.id) } }, data: { state: DiagnosticCheckState.OK, checkedAt: new Date(), note: null, measurementValue: null, measurementText: null } });
    const findings = checks.length ? await tx.diagnosticFinding.findMany({ where: { checkId: { in: checks.map((check) => check.id) } }, select: { id: true } }) : [];
    if (findings.length) await tx.diagnosticMedia.deleteMany({ where: { findingId: { in: findings.map((finding) => finding.id) } } });
    if (checks.length) await tx.diagnosticFinding.deleteMany({ where: { checkId: { in: checks.map((check) => check.id) } } });
  });
  await refreshInspectionCompletion(inspectionId);
  return getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
}

export async function submitStructuredDiagnostic(userId: string, diagnosticRequestId: string, mechanicComment?: string | null) {
  const prisma = getPrisma();
  const { mechanic } = await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  if (!view.canSubmit) throw new StructuredDiagnosticError("DIAGNOSTIC_INCOMPLETE", "Перед передачею сервіс-менеджеру перевірте всі обов’язкові пункти.", 409);
  if ([DiagnosticRequestStatus.CONFIRMED, DiagnosticRequestStatus.CANCELLED].includes(view.diagnostic.status)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticInspection.updateMany({ where: { diagnosticRequestId }, data: { status: DiagnosticInspectionStatus.COMPLETED, completedAt: now } });
    await tx.diagnosticReview.upsert({
      where: { diagnosticRequestId },
      create: { diagnosticRequestId, state: DiagnosticReviewState.SUBMITTED, submittedAt: now, mechanicComment: mechanicComment?.trim().slice(0, 4000) || null },
      update: { state: DiagnosticReviewState.SUBMITTED, submittedAt: now, returnedAt: null, mechanicComment: mechanicComment?.trim().slice(0, 4000) || null },
    });
    await tx.auditEvent.create({ data: {
      actorName: mechanic.name,
      entityType: "DiagnosticRequest",
      entityId: diagnosticRequestId,
      action: "DIAGNOSTIC_SUBMITTED",
      metadata: toPrismaJson({ source: "MECHANIC_MOBILE", counts: view.counts }),
    } });
  });
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function returnStructuredDiagnostic(diagnosticRequestId: string, reviewerUserId: string, managerComment?: string | null) {
  const prisma = getPrisma();
  const review = await ensureReview(diagnosticRequestId);
  if (review.state !== DiagnosticReviewState.SUBMITTED) throw new StructuredDiagnosticError("DIAGNOSTIC_NOT_SUBMITTED", "Повернути можна лише діагностику, передану на перевірку.", 409);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticReview.update({ where: { diagnosticRequestId }, data: {
      state: DiagnosticReviewState.RETURNED,
      returnedAt: now,
      reviewerUserId,
      managerComment: managerComment?.trim().slice(0, 4000) || null,
    } });
    await tx.diagnosticInspection.updateMany({ where: { diagnosticRequestId }, data: { status: DiagnosticInspectionStatus.IN_PROGRESS, completedAt: null } });
    await tx.auditEvent.create({ data: {
      actorName: "CRM / Сервіс-менеджер",
      entityType: "DiagnosticRequest",
      entityId: diagnosticRequestId,
      action: "DIAGNOSTIC_RETURNED_TO_MECHANIC",
      metadata: toPrismaJson({ reviewerUserId, managerComment: managerComment || null }),
    } });
  });
  return getStructuredDiagnostic(diagnosticRequestId);
}

export async function markStructuredDiagnosticConfirmed(diagnosticRequestId: string, reviewerUserId?: string | null) {
  const prisma = getPrisma();
  const now = new Date();
  await prisma.diagnosticReview.upsert({
    where: { diagnosticRequestId },
    create: { diagnosticRequestId, state: DiagnosticReviewState.CONFIRMED, confirmedAt: now, reviewerUserId: reviewerUserId || null },
    update: { state: DiagnosticReviewState.CONFIRMED, confirmedAt: now, reviewerUserId: reviewerUserId || undefined },
  });
}

export async function buildStructuredTechnicalConclusion(diagnosticRequestId: string) {
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const findings = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => item.finding ? [{ inspection: inspection.templateName, section: section.name, item }] : [])));
  if (!findings.length) return view.counts.total ? "За результатами структурованої діагностики критичних дефектів не виявлено." : null;
  const actionLabels: Record<string, string> = {
    NONE: "потребує оцінки",
    REPLACE: "замінити",
    REPAIR: "ремонтувати",
    ADJUST: "відрегулювати",
    CLEAN: "очистити / обслужити",
    ADDITIONAL_DIAGNOSTICS: "провести додаткову діагностику",
  };
  const urgencyLabels: Record<string, string> = { INFO: "рекомендація", SOON: "найближчим часом", CRITICAL: "критично" };
  return findings.map(({ section, item }) => {
    const finding = item.finding!;
    const description = finding.findingText || item.note || (item.state === DiagnosticCheckState.DEFECT ? "виявлено дефект" : "потребує уваги");
    return `${section} — ${item.name}: ${description}. Дія: ${actionLabels[finding.action] || finding.action}. Терміновість: ${urgencyLabels[finding.urgency] || finding.urgency}.`;
  }).join("\n");
}

export async function getDiagnosticMedia(mediaId: string) {
  const prisma = getPrisma();
  return prisma.diagnosticMedia.findUnique({ where: { id: mediaId } });
}

export async function addDiagnosticMedia(userId: string, diagnosticRequestId: string, checkId: string, file: { name: string; type: string; size: number; data: Buffer }) {
  const prisma = getPrisma();
  await assertMechanicDiagnostic(userId, diagnosticRequestId);
  const review = await ensureReview(diagnosticRequestId);
  if ([DiagnosticReviewState.SUBMITTED, DiagnosticReviewState.CONFIRMED].includes(review.state)) throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Після передачі на перевірку фото змінювати не можна.", 409);
  const check = await prisma.diagnosticCheck.findUnique({ where: { id: checkId } });
  if (!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Пункт перевірки не знайдено.", 404);
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) throw new StructuredDiagnosticError("CHECK_SCOPE_MISMATCH", "Пункт не належить цій діагностиці.", 403);
  if (![DiagnosticCheckState.ATTENTION, DiagnosticCheckState.DEFECT].includes(check.state)) throw new StructuredDiagnosticError("FINDING_REQUIRED", "Фото дефекту можна додати після вибору «Увага» або «Дефект».");
  let finding = await prisma.diagnosticFinding.findUnique({ where: { checkId } });
  if (!finding) finding = await prisma.diagnosticFinding.create({ data: { checkId } });
  const media = await prisma.diagnosticMedia.create({ data: {
    findingId: finding.id,
    fileName: file.name.slice(0, 240) || "diagnostic-photo.jpg",
    mimeType: file.type,
    fileSize: file.size,
    fileData: file.data,
  } });
  return { id: media.id, fileName: media.fileName, mimeType: media.mimeType, fileSize: media.fileSize, createdAt: media.createdAt };
}
