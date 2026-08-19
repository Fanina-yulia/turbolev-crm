import { NextResponse } from "next/server";
import { LeadStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function kyivDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p)=>p.type==="year")?.value); const month = Number(parts.find((p)=>p.type==="month")?.value); const day = Number(parts.find((p)=>p.type==="day")?.value);
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(now).find((p)=>p.type==="timeZoneName")?.value || "GMT+3";
  const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/); const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 180;
  const from = new Date(Date.UTC(year, month - 1, day, 0, -offset)); const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function GET() {
  const prisma = getPrisma();
  const { from, to } = kyivDayRange();
  const [appointments, leadCounts, diagnostics, workOrderGroups] = await Promise.all([
    prisma.serviceAppointment.findMany({ where: { plannedStartAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, include: { post: true, mechanic: true }, orderBy: [{ priority: "desc" }, { plannedStartAt: "asc" }] }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.diagnosticRequest.groupBy({ by: ["status"], where: { status: { in: ["PENDING","IN_PROGRESS"] } }, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["status"], where: { closedAt: null }, _count: { _all: true } }),
  ]);
  const leadMap = Object.fromEntries(leadCounts.map((x)=>[x.status,x._count._all]));
  const diagnosticMap = Object.fromEntries(diagnostics.map((x)=>[x.status,x._count._all]));
  const workMap = Object.fromEntries(workOrderGroups.map((x)=>[x.status,x._count._all]));
  const countStatus = (...statuses: string[]) => appointments.filter((x)=>statuses.includes(x.status)).length;
  const attention = appointments.filter((x)=>["BOOKED","WAITING_APPROVAL","WAITING_PARTS","IN_REPAIR","WAITING_QC","READY_FOR_PICKUP","NO_SHOW"].includes(x.status)).slice(0, 8).map((x)=>({
    id:x.id,
    appointmentId:x.id,
    clientId:x.clientId,
    vehicleId:x.vehicleId,
    workOrderId:x.workOrderId,
    plate:x.plateNumber||"БЕЗ НОМЕРА",
    vehicle:x.vehicleLabel||"Автомобіль",
    status:x.status,
    problem:x.problem,
    plannedStartAt:x.plannedStartAt,
    post:x.post?.name||null,
    mechanic:x.mechanic?.name||null,
  }));

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
      approval: countStatus("WAITING_APPROVAL"),
      waitingParts: countStatus("WAITING_PARTS"),
      noShow: countStatus("NO_SHOW"),
    },
    attention,
  }, { headers: { "Cache-Control": "no-store" } });
}
