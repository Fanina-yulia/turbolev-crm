import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const SCOPES = new Set(["SELF", "ASSIGNED", "TEAM", "LOCATION", "ALL"]);
const EFFECTS = new Set(["ALLOW", "DENY"]);

export async function PUT(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { request, strict: true });
  if (!access.allowed) return access.response!;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const raw = Array.isArray(body.overrides) ? body.overrides : [];
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id },
      include: { accessRoles: { where: { isActive: true }, include: { role: { select: { code: true } } } } },
    });
    if (!user) return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
    const isOwner = user.accessRoles.some((item) => item.role.code === "OWNER");
    const normalized = raw.map((item: any) => ({
      code: String(item?.code || "").trim().toUpperCase(),
      effect: String(item?.effect || "ALLOW").trim().toUpperCase(),
      scope: String(item?.scope || "ALL").trim().toUpperCase(),
      locationId: item?.locationId ? String(item.locationId) : null,
      reason: item?.reason ? String(item.reason).trim().slice(0, 240) : null,
      expiresAt: item?.expiresAt ? new Date(item.expiresAt) : null,
    })).filter((item: any) => item.code);
    for (const item of normalized) {
      if (!SCOPES.has(item.scope)) return NextResponse.json({ ok: false, error: "INVALID_SCOPE", message: `Некоректний scope для ${item.code}.` }, { status: 400 });
      if (!EFFECTS.has(item.effect)) return NextResponse.json({ ok: false, error: "INVALID_EFFECT" }, { status: 400 });
      if (item.expiresAt && Number.isNaN(item.expiresAt.getTime())) return NextResponse.json({ ok: false, error: "INVALID_EXPIRY" }, { status: 400 });
      if (isOwner && item.code === PERMISSIONS.SECURITY_ACCESS_MANAGE && item.effect === "DENY") {
        return NextResponse.json({ ok: false, error: "OWNER_SECURITY_DENY_FORBIDDEN", message: "Не можна заборонити OWNER керування доступами." }, { status: 409 });
      }
    }
    const permissions = await prisma.permission.findMany({ where: { code: { in: normalized.map((item: any) => item.code) } }, select: { id: true, code: true } });
    const permissionByCode = new Map(permissions.map((item) => [item.code, item.id]));
    const missing = normalized.filter((item: any) => !permissionByCode.has(item.code)).map((item: any) => item.code);
    if (missing.length) return NextResponse.json({ ok: false, error: "UNKNOWN_PERMISSION", message: missing.join(", ") }, { status: 400 });
    const locationIds = Array.from(new Set(normalized.map((item: any) => item.locationId).filter(Boolean))) as string[];
    if (locationIds.length) {
      const count = await prisma.serviceLocation.count({ where: { id: { in: locationIds }, isActive: true } });
      if (count !== locationIds.length) return NextResponse.json({ ok: false, error: "LOCATION_NOT_FOUND" }, { status: 400 });
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.updateMany({ where: { userId: id, isActive: true }, data: { isActive: false } });
      for (const item of normalized) {
        await tx.userPermissionOverride.create({
          data: {
            userId: id,
            permissionId: permissionByCode.get(item.code)!,
            effect: item.effect as "ALLOW" | "DENY",
            scope: item.scope as "SELF" | "ASSIGNED" | "TEAM" | "LOCATION" | "ALL",
            locationId: item.locationId,
            reason: item.reason,
            startsAt: now,
            expiresAt: item.expiresAt,
            isActive: true,
          },
        });
      }
    });
    await writeAuditEvent({ entityType: "User", entityId: id, action: "SECURITY_OVERRIDES_REPLACED", after: { overrides: normalized } });
    return NextResponse.json({ ok: true, count: normalized.length });
  } catch (error) {
    console.error("PUT /api/security/users/[id]/overrides", error);
    return NextResponse.json({ ok: false, error: "SECURITY_OVERRIDES_UPDATE_FAILED" }, { status: 500 });
  }
}
