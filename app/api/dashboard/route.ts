import { NextResponse } from "next/server";
import { LeadStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getVehicleLifecycleMap } from "@/src/services/vehicle-lifecycle.service";

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
  const now = new Date();
  const { from, to } = kyivDayRange(now);
  const [appointments, leadCounts] = await Promise.all([
    prisma.serviceAppointment.findMany({ where: { plannedStartAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, include: { post: true, mechanic: true }, orderBy: [{ priority: "desc" }, { plannedStartAt: "asc" }] }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const leadMap = Object.fromEntries(leadCounts.map((x)=>[x.status,x._count._all]));
  const vehicleIds = appointments.map((item) => item.vehicleId).filter((value): value is string => Boolean(value));
  const lifecycleMap = await getVehicleLifecycleMap(vehicleIds, now);
  const lifecycleFor = (vehicleId: string | null) => vehicleId ? lifecycleMap.get(vehicleId) || null : null;
  const countLifecycle = (...codes: string[]) => appointments.filter((item) => {
    const lifecycle = lifecycleFor(item.vehicleId);
    return lifecycle && codes.includes(lifecycle.code);
  }).length;
  const noShow = appointments.filter((item) => item.status === "NO_SHOW").length;

  const attention = appointments.filter((item) => {
    const lifecycle = lifecycleFor(item.vehicleId);
    if (item.status === "NO_SHOW") return true;
    if (!lifecycle) return false;
    return lifecycle.flags.includes("NEEDS_ATTENTION") || [
      "DIAGNOSTIC_COMPLETED",
      "MANAGER_REVIEW",
      "CLIENT_DECISION",
      "WAITING_APPROVAL",
      "WAITING_PARTS",
      "QUALITY_CONTROL",
      "WAITING_PAYMENT",
      "READY_FOR_PICKUP",
    ].includes(lifecycle.code);
  }).slice(0, 8).map((item)=>{
    const lifecycle = lifecycleFor(item.vehicleId);
    return {
      id:item.id,
      appointmentId:item.id,
      clientId:item.clientId,
      vehicleId:item.vehicleId,
      workOrderId:item.workOrderId,
      plate:item.plateNumber||"БЕЗ НОМЕРА",
      vehicle:item.vehicleLabel||"Автомобіль",
      status:item.status,
      lifecycle: lifecycle ? { code: lifecycle.code, label: lifecycle.label, flags: lifecycle.flags } : null,
      problem:item.problem,
      plannedStartAt:item.plannedStartAt,
      post:item.post?.name||null,
      mechanic:item.mechanic?.name||null,
    };
  });

  return NextResponse.json({
    ok: true,
    range: { from, to },
    kpis: {
      carsToday: appointments.length,
      inRepair: countLifecycle("IN_REPAIR"),
      postsOccupied: new Set(appointments.filter((item)=>item.postId&&lifecycleFor(item.vehicleId)?.code==="IN_REPAIR").map((item)=>item.postId)).size,
      booked: countLifecycle("PLANNED"),
      noShow,
      revenue: null,
      grossProfit: null,
    },
    pipeline: {
      newLeads: (leadMap[LeadStatus.NEW]||0),
      booked: countLifecycle("PLANNED"),
      diagnostics: countLifecycle("IN_WORK", "DIAGNOSTIC_COMPLETED", "MANAGER_REVIEW"),
      approval: countLifecycle("CLIENT_DECISION", "WAITING_APPROVAL"),
      waitingParts: countLifecycle("PARTS_SELECTION", "WAITING_PARTS"),
      inRepair: countLifecycle("READY_FOR_REPAIR", "IN_REPAIR"),
      qcReady: countLifecycle("QUALITY_CONTROL", "WAITING_PAYMENT", "READY_FOR_PICKUP"),
    },
    blockers: {
      approval: countLifecycle("CLIENT_DECISION", "WAITING_APPROVAL"),
      waitingParts: countLifecycle("WAITING_PARTS"),
      noShow,
    },
    attention,
  }, { headers: { "Cache-Control": "no-store" } });
}
