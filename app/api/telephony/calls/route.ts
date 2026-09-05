import { NextRequest, NextResponse } from "next/server";
import { PRIMARY_BINOTEL_PBX_NUMBER } from "@/src/domain/binotel-config";
import { CallStatus, CallType, Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone } from "@/src/lib/phone";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (endOfDay) date.setHours(23, 59, 59, 999);
    else date.setHours(0, 0, 0, 0);
  }
  return date;
}

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  try {
    const params = request.nextUrl.searchParams;
    const clientId = params.get("clientId")?.trim() || "";
    const q = params.get("q")?.trim() || "";
    const directionRaw = params.get("direction")?.trim().toUpperCase() || "";
    const statusRaw = params.get("status")?.trim().toUpperCase() || "";
    const managerId = params.get("managerId")?.trim() || "";
    const hasRecording = params.get("hasRecording") === "true";
    const from = asDate(params.get("from"));
    const to = asDate(params.get("to"), true);
    const page = positiveInt(params.get("page"), 1, 10_000);
    const take = positiveInt(params.get("take"), 40, 100);

    const direction = Object.values(CallType).includes(directionRaw as CallType) ? directionRaw as CallType : null;
    const status = Object.values(CallStatus).includes(statusRaw as CallStatus) ? statusRaw as CallStatus : null;

    const where: Prisma.CallHistoryWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(direction ? { type: direction } : {}),
      ...(status ? { status } : {}),
      ...(managerId ? { managerId } : {}),
      ...(hasRecording ? { status: CallStatus.ANSWERED, endedAt: { not: null } } : {}),
      ...((from || to) ? {
        OR: [
          { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
          { startedAt: null, createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
        ],
      } : {}),
      ...(q ? {
        AND: [
          {
            OR: [
              { externalNumber: { contains: q, mode: "insensitive" } },
              { internalNumber: { contains: q, mode: "insensitive" } },
              { client: { is: { name: { contains: q, mode: "insensitive" } } } },
              { client: { is: { phone: { contains: q, mode: "insensitive" } } } },
              { manager: { is: { name: { contains: q, mode: "insensitive" } } } },
            ],
          },
        ],
      } : {}),
    };

    const prisma = getPrisma();
    const primaryBinotelLine = normalizePhone(PRIMARY_BINOTEL_PBX_NUMBER);
    const primaryLineCalls = await prisma.$queryRaw<Array<{ binotelCallId: string }>>(Prisma.sql`
      SELECT "binotelCallId"
      FROM "CallHistory"
      WHERE COALESCE(
        NULLIF("rawPayload"->>'pbxNumber',''),
        NULLIF("rawPayload"->'payload'->>'pbxNumber',''),
        NULLIF("rawPayload"->'payload'->'pbxNumberData'->>'number',''),
        NULLIF("rawPayload"->'payload'->'callDetails'->'pbxNumberData'->>'number',''),
        ${PRIMARY_BINOTEL_PBX_NUMBER}
      ) IN (${PRIMARY_BINOTEL_PBX_NUMBER}, ${primaryBinotelLine})
    `);
    const primaryLineCallIds = [...new Set(primaryLineCalls.map((call) => call.binotelCallId))];
    where.binotelCallId = { in: primaryLineCallIds };

    const [total, calls, managers] = await Promise.all([
      prisma.callHistory.count({ where }),
      prisma.callHistory.findMany({
        where,
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * take,
        take,
        select: {
          id: true,
          binotelCallId: true,
          externalNumber: true,
          internalNumber: true,
          type: true,
          status: true,
          duration: true,
          startedAt: true,
          answeredAt: true,
          endedAt: true,
          createdAt: true,
          clientId: true,
          workOrderId: true,
          managerId: true,
          client: { select: { id: true, name: true, phone: true } },
          manager: { select: { id: true, name: true, internalNumber: true } },
        },
      }),
      prisma.user.findMany({
        where: { isActive: true, managedCalls: { some: { binotelCallId: { in: primaryLineCallIds } } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, internalNumber: true },
        take: 100,
      }),
    ]);

    const items = calls.map((call) => ({
      id: call.id,
      callId: call.binotelCallId,
      externalNumber: call.externalNumber,
      internalNumber: call.internalNumber,
      direction: call.type,
      status: call.status,
      duration: call.duration,
      startedAt: (call.startedAt || call.createdAt).toISOString(),
      answeredAt: call.answeredAt?.toISOString() || null,
      endedAt: call.endedAt?.toISOString() || null,
      clientId: call.clientId,
      workOrderId: call.workOrderId,
      managerId: call.managerId,
      client: call.client,
      manager: call.manager,
      recordingEligible: call.status === CallStatus.ANSWERED && Boolean(call.endedAt),
    }));

    return NextResponse.json({
      ok: true,
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / take)),
      take,
      managers,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/telephony/calls failed", error);
    return NextResponse.json({ ok: false, error: "CALL_HISTORY_FAILED" }, { status: 500 });
  }
}
