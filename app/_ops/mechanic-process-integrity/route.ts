import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPECTED_REF = "ops/mechanic-integrity-audit-20261006";

type ConflictRow = {
  appointmentId: string;
  vehicle: string;
  plate: string | null;
  purpose: string | null;
  status: string;
  workOrderId: string | null;
  diagnosticRequestId: string;
};

type HighlanderRow = {
  appointmentId: string;
  vehicle: string;
  plate: string | null;
  purpose: string | null;
  status: string;
  plannedStartAt: Date;
  hasDiagnosticLink: boolean;
  hasWorkOrder: boolean;
};

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== EXPECTED_REF) {
    return new NextResponse("Not found", { status: 404 });
  }

  const prisma = getPrisma();

  const [totalAppointments, totalLinks, beforeConflicts, beforeNullPurpose] = await Promise.all([
    prisma.serviceAppointment.count(),
    prisma.diagnosticVisitLink.count(),
    prisma.$queryRaw<ConflictRow[]>`
      SELECT
        a.id AS "appointmentId",
        trim(coalesce(v."brand",'') || ' ' || coalesce(v."model",'')) AS vehicle,
        coalesce(v."plateNumber", a."plateNumber") AS plate,
        a."purpose"::text AS purpose,
        a."status"::text AS status,
        a."workOrderId" AS "workOrderId",
        dvl."diagnosticRequestId" AS "diagnosticRequestId"
      FROM "ServiceAppointment" a
      JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
      LEFT JOIN "Vehicle" v ON v.id = a."vehicleId"
      WHERE a."purpose" IS DISTINCT FROM 'DIAGNOSTICS'::"AppointmentPurpose"
      ORDER BY a."plannedStartAt" DESC
    `,
    prisma.serviceAppointment.count({ where: { purpose: null } }),
  ]);

  const corrected = await prisma.$transaction(async (tx) => {
    const linkedToDiagnostic = await tx.$executeRaw`
      UPDATE "ServiceAppointment" AS a
      SET "purpose" = 'DIAGNOSTICS'::"AppointmentPurpose"
      WHERE EXISTS (
        SELECT 1 FROM "DiagnosticVisitLink" dvl
        WHERE dvl."appointmentId" = a.id
      )
      AND a."purpose" IS DISTINCT FROM 'DIAGNOSTICS'::"AppointmentPurpose"
    `;

    const legacyDiagnostics = await tx.$executeRaw`
      UPDATE "ServiceAppointment" AS a
      SET "purpose" = 'DIAGNOSTICS'::"AppointmentPurpose"
      WHERE a."purpose" IS NULL
        AND (a."source" = 'WALK_IN' OR a."status" = 'DIAGNOSTICS')
    `;

    const legacyRepairs = await tx.$executeRaw`
      UPDATE "ServiceAppointment" AS a
      SET "purpose" = 'REPAIR'::"AppointmentPurpose"
      WHERE a."purpose" IS NULL
        AND a."workOrderId" IS NOT NULL
        AND a."source" IS DISTINCT FROM 'WALK_IN'
        AND a."status" IS DISTINCT FROM 'DIAGNOSTICS'
        AND NOT EXISTS (
          SELECT 1 FROM "DiagnosticVisitLink" dvl
          WHERE dvl."appointmentId" = a.id
        )
    `;

    return { linkedToDiagnostic, legacyDiagnostics, legacyRepairs };
  });

  const [afterConflicts, afterNullPurpose, highlander] = await Promise.all([
    prisma.$queryRaw<ConflictRow[]>`
      SELECT
        a.id AS "appointmentId",
        trim(coalesce(v."brand",'') || ' ' || coalesce(v."model",'')) AS vehicle,
        coalesce(v."plateNumber", a."plateNumber") AS plate,
        a."purpose"::text AS purpose,
        a."status"::text AS status,
        a."workOrderId" AS "workOrderId",
        dvl."diagnosticRequestId" AS "diagnosticRequestId"
      FROM "ServiceAppointment" a
      JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
      LEFT JOIN "Vehicle" v ON v.id = a."vehicleId"
      WHERE a."purpose" IS DISTINCT FROM 'DIAGNOSTICS'::"AppointmentPurpose"
      ORDER BY a."plannedStartAt" DESC
    `,
    prisma.serviceAppointment.count({ where: { purpose: null } }),
    prisma.$queryRaw<HighlanderRow[]>`
      SELECT
        a.id AS "appointmentId",
        trim(coalesce(v."brand",'') || ' ' || coalesce(v."model",'')) AS vehicle,
        coalesce(v."plateNumber", a."plateNumber") AS plate,
        a."purpose"::text AS purpose,
        a."status"::text AS status,
        a."plannedStartAt" AS "plannedStartAt",
        (dvl.id IS NOT NULL) AS "hasDiagnosticLink",
        (a."workOrderId" IS NOT NULL) AS "hasWorkOrder"
      FROM "ServiceAppointment" a
      LEFT JOIN "Vehicle" v ON v.id = a."vehicleId"
      LEFT JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
      WHERE lower(coalesce(v."brand",'')) = 'toyota'
        AND lower(coalesce(v."model",'')) LIKE '%highlander%'
      ORDER BY a."plannedStartAt" DESC
    `,
  ]);

  return NextResponse.json({
    ok: afterConflicts.length === 0,
    audited: {
      totalAppointments,
      totalDiagnosticLinks: totalLinks,
      beforeConflictCount: beforeConflicts.length,
      beforeNullPurpose,
      afterConflictCount: afterConflicts.length,
      afterNullPurpose,
    },
    corrected,
    correctedConflicts: beforeConflicts,
    remainingConflicts: afterConflicts,
    toyotaHighlander: highlander.map((row) => ({
      ...row,
      plannedStartAt: row.plannedStartAt.toISOString(),
    })),
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
