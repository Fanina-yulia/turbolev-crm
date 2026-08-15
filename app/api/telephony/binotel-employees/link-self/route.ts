import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getSafeBinotelEmployees } from "@/src/services/binotel-employees.service";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;
  if (!access.context.user) {
    return NextResponse.json({ ok: false, error: "CRM_USER_REQUIRED" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const internalNumber = String(body?.internalNumber || "").replace(/\D/g, "");
    if (!internalNumber) {
      return NextResponse.json({ ok: false, error: "Вкажіть внутрішній номер Binotel." }, { status: 400 });
    }

    const employees = await getSafeBinotelEmployees();
    const employee = employees.find((item) => item.internalNumber === internalNumber);
    if (!employee) {
      return NextResponse.json({ ok: false, error: "Цього внутрішнього номера немає у поточному списку Binotel." }, { status: 422 });
    }

    const prisma = getPrisma();
    const conflict = await prisma.user.findFirst({
      where: { internalNumber, id: { not: access.context.user.id } },
      select: { id: true, name: true },
    });
    if (conflict) {
      return NextResponse.json({ ok: false, error: `Внутрішній номер уже прив'язаний до ${conflict.name}.` }, { status: 409 });
    }

    const user = await prisma.user.update({
      where: { id: access.context.user.id },
      data: { internalNumber },
      select: { id: true, name: true, email: true, internalNumber: true },
    });

    await writeAuditEvent({
      entityType: "User",
      entityId: user.id,
      action: "BINOTEL_INTERNAL_NUMBER_LINKED",
      metadata: { internalNumber, providerEmployeeId: employee.providerId },
    });

    return NextResponse.json({ ok: true, user, employee });
  } catch (error) {
    console.error("POST Binotel self-link failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося прив'язати внутрішній номер." }, { status: 500 });
  }
}
