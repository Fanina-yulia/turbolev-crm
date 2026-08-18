import { NextResponse } from "next/server";
import { LeadStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { createPlannerAppointment, normalizeAppointmentPayload } from "@/src/services/planner.service";
import { LeadNotFoundError, updateLead } from "@/src/services/leads.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.LEADS_WRITE, { request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  let createdAppointmentId: string | null = null;

  try {
    const { id } = await context.params;
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new LeadNotFoundError(id);

    const body = await request.json() as Record<string, unknown>;
    const appointmentInput = normalizeAppointmentPayload({
      ...body,
      leadId: id,
      customerName: body.customerName ?? lead.name,
      phone: body.phone ?? lead.phone,
      vehicleLabel: body.vehicleLabel ?? [lead.carBrand, lead.carModel, lead.carYear].filter(Boolean).join(" "),
      plateNumber: body.plateNumber ?? lead.plateNumber,
      problem: body.problem ?? lead.need,
      estimatedAmount: body.estimatedAmount ?? (lead.preliminaryAmount == null ? null : Number(lead.preliminaryAmount)),
      status: "BOOKED",
      source: "LEAD",
    });

    const created = await createPlannerAppointment(appointmentInput);
    if (!created.ok) {
      return NextResponse.json(
        { ok: false, error: `Конфлікт: ${created.conflict.resource} уже зайнятий у цей час.`, conflict: created.conflict },
        { status: 409 },
      );
    }

    createdAppointmentId = created.appointment.id;
    const updatedLead = await updateLead(
      id,
      {
        status: LeadStatus.BOOKED,
        nextAction: "Підтвердити заїзд клієнта",
        nextContactAt: null,
      },
      access.context.user?.name || "CRM",
    );

    return NextResponse.json({ ok: true, lead: updatedLead, appointment: created.appointment }, { status: 201 });
  } catch (error) {
    if (createdAppointmentId) {
      try {
        await prisma.serviceAppointment.delete({ where: { id: createdAppointmentId } });
      } catch (rollbackError) {
        console.error("POST /api/leads/[id]/book rollback failed", {
          appointmentId: createdAppointmentId,
          message: rollbackError instanceof Error ? rollbackError.message : "unknown error",
        });
      }
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "Некоректний JSON у запиті." }, { status: 400 });
    }
    if (error instanceof LeadNotFoundError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    }

    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_TIME_RANGE") {
      return NextResponse.json({ ok: false, error: "Некоректний час запису." }, { status: 422 });
    }
    if (code === "LOCATION_REQUIRED") {
      return NextResponse.json({ ok: false, error: "Оберіть локацію СТО." }, { status: 422 });
    }

    console.error("POST /api/leads/[id]/book failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Не вдалося записати лід у Планувальник." }, { status: 500 });
  }
}
