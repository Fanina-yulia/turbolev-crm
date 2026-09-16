import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPlannerAppointmentFinancialSummary } from "@/src/services/planner-financial-summary.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbidden(message = "Цей запис не входить до Вашого доступу.") {
  return NextResponse.json({ status: "FORBIDDEN", message }, { status: 403 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(PERMISSIONS.PLANNER_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  const { id } = await context.params;
  const result = await getPlannerAppointmentFinancialSummary(id);
  if (!result) {
    return NextResponse.json({ status: "NOT_FOUND", message: "Запис планувальника не знайдено." }, { status: 404 });
  }

  if (access.grantedScope !== "ALL" && !access.context.locationIds.includes(result.appointment.locationId)) {
    return forbidden();
  }

  if (access.grantedScope === "ASSIGNED") {
    const userId = access.context.user?.id;
    if (!userId || !result.appointment.mechanicId) return forbidden("Цей запис не належить до Ваших призначених робіт.");
    const mechanic = await getPrisma().serviceMechanic.findFirst({
      where: { id: result.appointment.mechanicId, userId, isActive: true },
      select: { id: true },
    });
    if (!mechanic) return forbidden("Цей запис не належить до Ваших призначених робіт.");
  }

  return NextResponse.json(
    { status: "OK", summary: result.summary },
    { headers: { "Cache-Control": "no-store" } },
  );
}
