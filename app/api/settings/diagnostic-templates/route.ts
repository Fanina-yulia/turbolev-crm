import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { ensureDefaultDiagnosticTemplates } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

function text(value: unknown, max = 500) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}
function int(value: unknown, fallback = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}
function bool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}
function generatedCode(prefix: string) {
  return `${prefix}_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function normalizeCode(value: unknown, prefix: string) {
  const raw = text(value, 128)?.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return raw || generatedCode(prefix);
}

async function accessFor(request: Request, write = false) {
  return authorize(write ? PERMISSIONS.SETTINGS_WRITE : PERMISSIONS.SETTINGS_READ, { request, minimumScope: "ALL" });
}

async function catalog() {
  const prisma = getPrisma();
  await ensureDefaultDiagnosticTemplates();
  const templates = await prisma.diagnosticTemplate.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
  const templateIds = templates.map((item) => item.id);
  const sections = templateIds.length ? await prisma.diagnosticTemplateSection.findMany({ where: { templateId: { in: templateIds } }, orderBy: [{ templateId: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }) : [];
  const sectionIds = sections.map((item) => item.id);
  const items = sectionIds.length ? await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: [{ sectionId: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }) : [];
  const inspections = templateIds.length ? await prisma.diagnosticInspection.groupBy({ by: ["templateId"], where: { templateId: { in: templateIds } }, _count: { _all: true } }) : [];
  const usage = new Map(inspections.map((row) => [row.templateId, row._count._all]));
  return {
    templates: templates.map((template) => ({
      ...template,
      usageCount: usage.get(template.id) || 0,
      sections: sections.filter((section) => section.templateId === template.id).map((section) => ({
        ...section,
        items: items.filter((item) => item.sectionId === section.id),
      })),
    })),
  };
}

export async function GET(request: Request) {
  const access = await accessFor(request, false);
  if (!access.allowed) return access.response!;
  try {
    return NextResponse.json({ ok: true, ...(await catalog()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET diagnostic templates settings failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_TEMPLATES_LOAD_FAILED", message: "Не вдалося завантажити шаблони діагностики." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await accessFor(request, true);
  if (!access.allowed) return access.response!;
  const prisma = getPrisma();
  const body = await request.json().catch(() => ({})) as Body;
  const action = String(body.action || "").trim().toUpperCase();
  try {
    if (action === "CREATE_TEMPLATE") {
      const name = text(body.name, 180);
      if (!name) return NextResponse.json({ ok: false, error: "NAME_REQUIRED", message: "Вкажіть назву шаблону." }, { status: 400 });
      const code = normalizeCode(body.code, "CUSTOM");
      const exists = await prisma.diagnosticTemplate.findUnique({ where: { code } });
      if (exists) return NextResponse.json({ ok: false, error: "CODE_EXISTS", message: "Такий код шаблону вже існує." }, { status: 409 });
      const isDefault = bool(body.isDefault);
      await prisma.$transaction(async (tx) => {
        if (isDefault) await tx.diagnosticTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.diagnosticTemplate.create({ data: { code, name, description: text(body.description, 3000), isDefault, isActive: body.isActive !== false, sortOrder: int(body.sortOrder, 100) } });
      });
    } else if (action === "UPDATE_TEMPLATE") {
      const id = text(body.id, 160);
      if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
      const current = await prisma.diagnosticTemplate.findUnique({ where: { id } });
      if (!current) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      const isDefault = typeof body.isDefault === "boolean" ? body.isDefault : current.isDefault;
      await prisma.$transaction(async (tx) => {
        if (isDefault) await tx.diagnosticTemplate.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
        await tx.diagnosticTemplate.update({ where: { id }, data: { name: text(body.name, 180) || current.name, description: body.description === null ? null : text(body.description, 3000) ?? current.description, isDefault, isActive: typeof body.isActive === "boolean" ? body.isActive : current.isActive, sortOrder: body.sortOrder == null ? current.sortOrder : int(body.sortOrder, current.sortOrder) } });
      });
    } else if (action === "ADD_SECTION") {
      const templateId = text(body.templateId, 160); const name = text(body.name, 180);
      if (!templateId || !name) return NextResponse.json({ ok: false, error: "SECTION_FIELDS_REQUIRED", message: "Вкажіть шаблон і назву секції." }, { status: 400 });
      const code = normalizeCode(body.code, "SECTION");
      await prisma.diagnosticTemplateSection.create({ data: { templateId, code, name, sortOrder: int(body.sortOrder, 100) } });
    } else if (action === "UPDATE_SECTION") {
      const id = text(body.id, 160); if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
      const current = await prisma.diagnosticTemplateSection.findUnique({ where: { id } }); if (!current) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      await prisma.diagnosticTemplateSection.update({ where: { id }, data: { name: text(body.name, 180) || current.name, sortOrder: body.sortOrder == null ? current.sortOrder : int(body.sortOrder, current.sortOrder) } });
    } else if (action === "ADD_ITEM") {
      const sectionId = text(body.sectionId, 160); const name = text(body.name, 220);
      if (!sectionId || !name) return NextResponse.json({ ok: false, error: "ITEM_FIELDS_REQUIRED", message: "Вкажіть секцію і назву пункту." }, { status: 400 });
      await prisma.diagnosticTemplateItem.create({ data: { sectionId, code: normalizeCode(body.code, "CHECK"), name, position: text(body.position, 80), measurementUnit: text(body.measurementUnit, 40), suggestedWorkName: text(body.suggestedWorkName, 300), suggestedPartName: text(body.suggestedPartName, 300), isRequired: body.isRequired !== false, sortOrder: int(body.sortOrder, 100) } });
    } else if (action === "UPDATE_ITEM") {
      const id = text(body.id, 160); if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
      const current = await prisma.diagnosticTemplateItem.findUnique({ where: { id } }); if (!current) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      await prisma.diagnosticTemplateItem.update({ where: { id }, data: { name: text(body.name, 220) || current.name, position: body.position === null ? null : text(body.position, 80) ?? current.position, measurementUnit: body.measurementUnit === null ? null : text(body.measurementUnit, 40) ?? current.measurementUnit, suggestedWorkName: body.suggestedWorkName === null ? null : text(body.suggestedWorkName, 300) ?? current.suggestedWorkName, suggestedPartName: body.suggestedPartName === null ? null : text(body.suggestedPartName, 300) ?? current.suggestedPartName, isRequired: typeof body.isRequired === "boolean" ? body.isRequired : current.isRequired, sortOrder: body.sortOrder == null ? current.sortOrder : int(body.sortOrder, current.sortOrder) } });
    } else if (action === "DELETE_ITEM") {
      const id = text(body.id, 160); if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
      const used = await prisma.diagnosticCheck.count({ where: { templateItemId: id } });
      if (used) return NextResponse.json({ ok: false, error: "ITEM_IN_USE", message: "Цей пункт уже використовувався у діагностиках. Змініть його назву або залиште в шаблоні для історії." }, { status: 409 });
      await prisma.diagnosticTemplateItem.delete({ where: { id } });
    } else if (action === "DELETE_SECTION") {
      const id = text(body.id, 160); if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
      const items = await prisma.diagnosticTemplateItem.findMany({ where: { sectionId: id }, select: { id: true } });
      const used = items.length ? await prisma.diagnosticCheck.count({ where: { templateItemId: { in: items.map((item) => item.id) } } }) : 0;
      if (used) return NextResponse.json({ ok: false, error: "SECTION_IN_USE", message: "Секція вже використовувалась у діагностиках і не може бути видалена." }, { status: 409 });
      await prisma.diagnosticTemplateSection.delete({ where: { id } });
    } else if (action === "DELETE_TEMPLATE") {
      const id = text(body.id, 160); if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
      const used = await prisma.diagnosticInspection.count({ where: { templateId: id } });
      if (used) return NextResponse.json({ ok: false, error: "TEMPLATE_IN_USE", message: "Шаблон уже використовувався. Його можна деактивувати, але не видалити." }, { status: 409 });
      await prisma.diagnosticTemplate.delete({ where: { id } });
    } else {
      return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
    }

    await prisma.auditEvent.create({ data: { actorName: access.context.user?.name || "CRM", entityType: "DiagnosticTemplate", entityId: text(body.id, 160) || text(body.templateId, 160) || text(body.sectionId, 160) || "settings", action: `SETTINGS_${action}` } }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...(await catalog()) });
  } catch (error) {
    console.error("POST diagnostic templates settings failed", error);
    const message = error instanceof Error && /Unique constraint/i.test(error.message) ? "Такий код уже існує в цьому шаблоні." : "Не вдалося зберегти шаблон діагностики.";
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_TEMPLATE_SAVE_FAILED", message }, { status: 500 });
  }
}
