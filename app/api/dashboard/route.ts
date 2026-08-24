import { NextResponse } from "next/server";
import { LeadStatus } from "@/src/generated/prisma/client";
import {
  handleDashboardBatchPost,
  handleDashboardConfigGet,
  handleDashboardConfigPost,
  handleDashboardConfigPut,
} from "@/src/dashboard-builder/dashboard-api";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { listStationAttentionVehicles } from "@/src/services/station-vehicle-attention.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dashboardMode(request: Request) {
  return new URL(request.url).searchParams.get("mode");
}

function kyivDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p)=>p.type==="year")?.value); const month = Number(parts.find((p)=>p.type==="month")?.value); const day = Number(parts.find((p)=>p.type==="day")?.value);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(now).find((p)=>p.type==="timeZoneName")?.value || "GMT+3";
  const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/); const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 180;
  const from = new Date(Date.UTC(year, month - 1, day, 0, -offset)); const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function GET(request: Request) {
  if (dashboardMode(request) === "config") return handleDashboardConfigGet(request);

  const access = await authorize(PERMISSIONS.OVERVIEW_READ, { strict: true, request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  const { from, to } = kyivDayRange();
  const scopedLocationIds = access.grantedScope === "ALL" ? null : access.context.locationIds;
  const locationWhere = scopedLocationIds === null ? {} : { locationId: { in: scopedLocationIds } };

  const appointments = await prisma.serviceAppointment.findMany({
    where: { plannedStartAt: { gte: from, lt: to }, status: { not: "CANCELLED" }, ...locationWhere },
    include: { post: true, mechanic: true },
    orderBy: [{ priority: "desc" }, { plannedStartAt: "asc" }],
  });

  const leadIds = [...new Set(appointments.map((row) => row.leadId).filter((value): value is string => Boolean(value)))];
  const workOrderIds = [...new Set(appointments.map((row) => row.workOrderId).filter((value): value is string => Boolean(value)))];

  let diagnosticRequestIds: string[] | null = null;
  if (scopedLocationIds !== null) {
    const assignments = scopedLocationIds.length
      ? await prisma.diagnosticAssignment.findMany({
          where: { locationId: { in: scopedLocationIds } },
          select: { diagnosticRequestId: true },
          take: 5000,
        })
      : [];
    diagnosticRequestIds = [...new Set(assignments.map((row) => row.diagnosticRequestId))];
  }

  const [leadCounts, diagnostics, workOrderGroups, attentionRaw] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: scopedLocationIds === null ? undefined : { id: { in: leadIds } },
      _count: { _all: true },
    }),
    prisma.diagnosticRequest.groupBy({
      by: ["status"],
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        ...(diagnosticRequestIds === null ? {} : { id: { in: diagnosticRequestIds } }),
      },
      _count: { _all: true },
    }),
    prisma.workOrder.groupBy({
      by: ["status"],
      where: {
        closedAt: null,
        ...(scopedLocationIds === null ? {} : { id: { in: workOrderIds } }),
      },
      _count: { _all: true },
    }),
    listStationAttentionVehicles(),
  ]);

  let attention = attentionRaw;
  if (scopedLocationIds !== null) {
    const attentionIds = attentionRaw.map((row) => row.appointmentId);
    const allowedRows = attentionIds.length && scopedLocationIds.length
      ? await prisma.serviceAppointment.findMany({
          where: { id: { in: attentionIds }, locationId: { in: scopedLocationIds } },
          select: { id: true },
          take: 500,
        })
      : [];
    const allowedIds = new Set(allowedRows.map((row) => row.id));
    attention = attentionRaw.filter((row) => allowedIds.has(row.appointmentId));
  }

  const leadMap = Object.fromEntries(leadCounts.map((x)=>[x.status,x._count._all]));
  const diagnosticMap = Object.fromEntries(diagnostics.map((x)=>[x.status,x._count._all]));
  const workMap = Object.fromEntries(workOrderGroups.map((x)=>[x.status,x._count._all]));
  const countStatus = (...statuses: string[]) => appointments.filter((x)=>statuses.includes(x.status)).length;
  const attentionCountStatus = (...statuses: string[]) => attention.filter((x)=>statuses.includes(x.status)).length;
  const attentionHasIssue = (code:string) => attention.filter((x)=>x.issues.some((issue)=>issue.code===code)).length;

  return NextResponse.json({
    ok: true,
    range: { from, to },
    kpis: {
      carsToday: appointments.length,
      inRepair: countStatus("IN_REPAIR"),
      postsOccupied: new Set(appointments.filter((x)=>x.status==="IN_REPAIR"&&x.postId).map((x)=>x.postId)).size,
      booked: countStatus("BOOKED"),
      noShow: countStatus("NO_SHOW"),
      revenue: null,
      grossProfit: null,
    },
    pipeline: {
      newLeads: (leadMap[LeadStatus.NEW]||0),
      booked: (leadMap[LeadStatus.BOOKED]||0),
      diagnostics: (diagnosticMap.PENDING||0)+(diagnosticMap.IN_PROGRESS||0),
      approval: (workMap.WAITING_APPROVAL||0)+countStatus("WAITING_APPROVAL"),
      waitingParts: countStatus("WAITING_PARTS"),
      inRepair: countStatus("IN_REPAIR"),
      qcReady: countStatus("WAITING_QC","READY_FOR_PICKUP"),
    },
    blockers: {
      approval: attentionCountStatus("WAITING_APPROVAL"),
      waitingParts: attentionCountStatus("WAITING_PARTS"),
      noShow: attentionCountStatus("NO_SHOW") + attentionHasIssue("MISSED_ARRIVAL"),
    },
    attention,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (dashboardMode(request) === "config") return handleDashboardConfigPut(request);
  return NextResponse.json({ ok: false, error: "UNSUPPORTED_DASHBOARD_MODE" }, { status: 400 });
}

export async function POST(request: Request) {
  const mode = dashboardMode(request);
  if (mode === "config") return handleDashboardConfigPost(request);
  if (mode === "batch") return handleDashboardBatchPost(request);
  return NextResponse.json({ ok: false, error: "UNSUPPORTED_DASHBOARD_MODE" }, { status: 400 });
}
