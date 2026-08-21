import { NextResponse } from "next/server";
import { LeadStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { listStationAttentionVehicles } from "@/src/services/station-vehicle-attention.service";

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
  const [appointments, leadCounts, diagnostics, workOrderGroups, attention] = await Promise.all([
    prisma.serviceAppointment.findMany({ where: { plannedStartAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, include: { post: true, mechanic: true }, orderBy: [{ priority: "desc" }, { plannedStartAt: "asc" }] }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.diagnosticRequest.groupBy({ by: ["status"], where: { status: { in: ["PENDING","IN_PROGRESS"] } }, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ["status"], where: { closedAt: null }, _count: { _all: true } }),
    listStationAttentionVehicles(),
  ]);
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
