import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { listActiveMechanicAssignments } from "@/src/services/mechanic-assignments.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const context = await getAccessContext(request);
    if (!context.authenticated) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (context.provisioningState !== "ACTIVE" || !context.user) {
      return NextResponse.json({ ok: false, error: "ACCESS_PROFILE_INACTIVE" }, { status: 403 });
    }
    if (!hasPermission(context, PERMISSIONS.OVERVIEW_READ)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    if (!context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: context.user.id, isActive: true },
      select: { id: true, name: true },
    });

    if (!mechanic) {
      return NextResponse.json({ ok: true, linked: false, items: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const rows = await listActiveMechanicAssignments(mechanic.id);
    const uniqueVehicleRows = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = row.vehicleId ? `vehicle:${row.vehicleId}` : `case:${row.caseKey}`;
      if (!uniqueVehicleRows.has(key)) uniqueVehicleRows.set(key, row);
    }

    return NextResponse.json({
      ok: true,
      linked: true,
      mechanic: { id: mechanic.id, name: mechanic.name },
      items: [...uniqueVehicleRows.values()].map((row) => ({
        id: row.id,
        caseKey: row.caseKey,
        vehicleId: row.vehicleId,
        workOrderId: row.workOrderId,
        appointmentStatus: row.appointmentStatus,
        workOrderStatus: row.workOrderStatus,
        vehicle: row.vehicleLabel || "Автомобіль",
        plate: row.plateNumber || "—",
        problem: row.problem,
        plannedStartAt: row.plannedStartAt,
        plannedEndAt: row.plannedEndAt,
        post: row.postName,
        updatedAt: row.updatedAt,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/cabinet/mechanic/assigned-vehicles failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "ASSIGNED_VEHICLES_LOAD_FAILED" }, { status: 500 });
  }
}
