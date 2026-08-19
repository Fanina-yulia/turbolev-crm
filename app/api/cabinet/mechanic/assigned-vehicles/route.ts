import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type AssignedVehicleRow = {
  id: string;
  vehicleId: string | null;
  workOrderId: string | null;
  appointmentStatus: string;
  workOrderStatus: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  plannedStartAt: Date;
  plannedEndAt: Date;
  postName: string | null;
  updatedAt: Date;
};

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

    const rows = await prisma.$queryRaw<AssignedVehicleRow[]>`
      WITH ranked AS (
        SELECT
          a.id,
          a."vehicleId",
          a."workOrderId",
          a.status::text AS "appointmentStatus",
          wo.status AS "workOrderStatus",
          a."vehicleLabel",
          a."plateNumber",
          a.problem,
          a."plannedStartAt",
          a."plannedEndAt",
          p.name AS "postName",
          a."updatedAt",
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(a."vehicleId", ''), NULLIF(a."plateNumber", ''), a.id)
            ORDER BY a."updatedAt" DESC, a."plannedStartAt" DESC
          ) AS rn
        FROM "ServiceAppointment" a
        LEFT JOIN "WorkOrder" wo ON wo.id = a."workOrderId"
        LEFT JOIN "ServicePost" p ON p.id = a."postId"
        WHERE a."mechanicId" = ${mechanic.id}
          AND a.status::text NOT IN ('CANCELLED', 'RESERVE', 'NO_SHOW')
          AND (
            (a."workOrderId" IS NULL AND a.status::text <> 'COMPLETED')
            OR
            (a."workOrderId" IS NOT NULL AND (wo.id IS NULL OR wo.status NOT IN ('CLOSED', 'CANCELLED')))
          )
      )
      SELECT
        id,
        "vehicleId",
        "workOrderId",
        "appointmentStatus",
        "workOrderStatus",
        "vehicleLabel",
        "plateNumber",
        problem,
        "plannedStartAt",
        "plannedEndAt",
        "postName",
        "updatedAt"
      FROM ranked
      WHERE rn = 1
      ORDER BY
        CASE
          WHEN "workOrderStatus" = 'IN_REPAIR' OR "appointmentStatus" = 'IN_REPAIR' THEN 10
          WHEN "workOrderStatus" = 'REWORK' THEN 20
          WHEN "workOrderStatus" IN ('WAITING_PARTS', 'WAITING_APPROVAL', 'WAITING_QC', 'WAITING_PAYMENT') THEN 30
          WHEN "appointmentStatus" = 'ARRIVED' THEN 40
          WHEN "workOrderStatus" = 'READY_FOR_PICKUP' OR "appointmentStatus" = 'READY_FOR_PICKUP' THEN 80
          ELSE 60
        END,
        "plannedStartAt" ASC
    `;

    return NextResponse.json({
      ok: true,
      linked: true,
      mechanic: { id: mechanic.id, name: mechanic.name },
      items: rows.map((row) => ({
        id: row.id,
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
