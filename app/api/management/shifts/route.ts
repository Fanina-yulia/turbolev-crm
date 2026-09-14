import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext } from "@/src/security/access-context";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["ON_SHIFT", "DAY_OFF", "VACATION", "SICK", "ABSENT", "LATE", "PARTIAL_SHIFT"]);

function role(context: Awaited<ReturnType<typeof getAccessContext>>) {
  const roles = new Set(context.roles.map((item) => item.code));
  if (roles.has("OWNER")) return "OWNER";
  if (roles.has("EXECUTIVE_DIRECTOR")) return "EXECUTIVE_DIRECTOR";
  if (roles.has("STATION_MANAGER")) return "STATION_MANAGER";
  return null;
}

function authorized(context: Awaited<ReturnType<typeof getAccessContext>>) {
  return context.provisioningState === "ACTIVE" && Boolean(context.user) && Boolean(role(context));
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function minute(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1440 ? parsed : Number.NaN;
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (!authorized(context)) return NextResponse.json({ ok: false, error: context.authenticated ? "Немає доступу." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  const currentRole = role(context)!;
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const requestedLocation = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ ok: false, error: "from/to у форматі YYYY-MM-DD обов'язкові." }, { status: 400 });
  if (currentRole === "STATION_MANAGER" && requestedLocation && !context.locationIds.includes(requestedLocation)) return NextResponse.json({ ok: false, error: "Немає доступу до цієї станції." }, { status: 403 });
  const locations = currentRole === "STATION_MANAGER" ? context.locationIds : requestedLocation ? [requestedLocation] : null;
  const rows = await getPrisma().employeeShift.findMany({
    where: { day: { gte: dateOnly(from), lte: dateOnly(to) }, ...(locations ? { locationId: { in: locations } } : {}) },
    orderBy: [{ day: "asc" }, { employeeId: "asc" }],
  });
  return NextResponse.json({ ok: true, shifts: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const context = await getAccessContext(request);
  if (!authorized(context) || !context.user) return NextResponse.json({ ok: false, error: context.authenticated ? "Немає доступу." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  const currentRole = role(context)!;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Некоректний JSON." }, { status: 400 });
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim() : "";
  const locationId = typeof body.locationId === "string" ? body.locationId.trim() : "";
  const day = typeof body.day === "string" ? body.day.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const action = typeof body.action === "string" ? body.action : "UPSERT";
  if (!employeeId || !locationId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ ok: false, error: "employeeId, locationId і day обов'язкові." }, { status: 400 });
  if (currentRole === "STATION_MANAGER" && !context.locationIds.includes(locationId)) return NextResponse.json({ ok: false, error: "Немає доступу до цієї станції." }, { status: 403 });

  const prisma = getPrisma();
  const assignment = await prisma.employeeRoleAssignment.findFirst({
    where: { employeeId, locationId, startsAt: { lte: dateOnly(day) }, OR: [{ endsAt: null }, { endsAt: { gt: dateOnly(day) } }] },
    select: { id: true },
  });
  if (!assignment) return NextResponse.json({ ok: false, error: "Працівник не призначений на цю станцію в цю дату." }, { status: 409 });

  if (action === "DELETE") {
    const existing = await prisma.employeeShift.findUnique({ where: { employeeId_locationId_day: { employeeId, locationId, day: dateOnly(day) } } });
    if (existing) {
      await prisma.$transaction([
        prisma.employeeShift.delete({ where: { id: existing.id } }),
        prisma.auditEvent.create({ data: { actorId: context.user.id, actorName: context.user.name, entityType: "EmployeeShift", entityId: existing.id, action: "EMPLOYEE_SHIFT_DELETED", before: toPrismaJson(existing), metadata: toPrismaJson({ employeeId, locationId, day }) } }),
      ]);
    }
    return NextResponse.json({ ok: true });
  }

  if (!STATUSES.has(status)) return NextResponse.json({ ok: false, error: "Некоректний статус зміни." }, { status: 400 });
  const startMinute = minute(body.startMinute);
  const endMinute = minute(body.endMinute);
  if (Number.isNaN(startMinute) || Number.isNaN(endMinute) || (startMinute != null && endMinute != null && endMinute <= startMinute)) return NextResponse.json({ ok: false, error: "Некоректний час зміни." }, { status: 400 });
  const existing = await prisma.employeeShift.findUnique({ where: { employeeId_locationId_day: { employeeId, locationId, day: dateOnly(day) } } });
  const shift = await prisma.employeeShift.upsert({
    where: { employeeId_locationId_day: { employeeId, locationId, day: dateOnly(day) } },
    update: { status: status as never, startMinute, endMinute, note: typeof body.note === "string" ? body.note.trim() || null : null },
    create: { employeeId, locationId, day: dateOnly(day), status: status as never, startMinute, endMinute, note: typeof body.note === "string" ? body.note.trim() || null : null, createdById: context.user.id },
  });
  await prisma.auditEvent.create({ data: { actorId: context.user.id, actorName: context.user.name, entityType: "EmployeeShift", entityId: shift.id, action: existing ? "EMPLOYEE_SHIFT_UPDATED" : "EMPLOYEE_SHIFT_CREATED", before: existing ? toPrismaJson(existing) : undefined, after: toPrismaJson(shift), metadata: toPrismaJson({ employeeId, locationId, day, role: currentRole }) } });
  return NextResponse.json({ ok: true, shift });
}
