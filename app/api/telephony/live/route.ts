import { NextRequest, NextResponse } from "next/server";
import { CallType } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;
  if (!access.context.user) {
    return NextResponse.json({ ok: false, error: "CRM_USER_REQUIRED" }, { status: 403 });
  }

  try {
    const prisma = getPrisma();
    const now = Date.now();
    const recentFrom = new Date(now - 3 * 60 * 1000);
    const terminalFrom = new Date(now - 75 * 1000);

    const [user, calls] = await Promise.all([
      prisma.user.findUnique({
        where: { id: access.context.user.id },
        select: { id: true, name: true, internalNumber: true },
      }),
      prisma.callHistory.findMany({
        where: {
          type: CallType.INCOMING,
          startedAt: { gte: recentFrom },
          OR: [
            { endedAt: null },
            { endedAt: { gte: terminalFrom } },
          ],
        },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              vehicles: {
                select: { id: true, brand: true, model: true, plateNumber: true, vin: true },
                orderBy: { updatedAt: "desc" },
                take: 1,
              },
            },
          },
          lead: { select: { id: true, name: true, carBrand: true, carModel: true, plateNumber: true } },
          workOrder: { select: { id: true, status: true } },
          manager: { select: { id: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      currentUser: {
        id: user?.id || access.context.user.id,
        name: user?.name || access.context.user.name,
        internalNumber: user?.internalNumber || null,
        clickToCallReady: Boolean(user?.internalNumber),
      },
      calls: calls.map((call) => {
        const vehicle = call.client?.vehicles[0] || null;
        return {
          id: call.id,
          callId: call.binotelCallId,
          phone: call.externalNumber,
          internalNumber: call.internalNumber,
          phase: !call.endedAt ? (call.answeredAt ? "ANSWERED" : "RINGING") : (call.status || "COMPLETED"),
          status: call.status,
          startedAt: call.startedAt,
          answeredAt: call.answeredAt,
          endedAt: call.endedAt,
          duration: call.duration,
          recordingAvailable: Boolean(call.recordingUrl),
          client: call.client ? { id: call.client.id, name: call.client.name } : null,
          lead: call.lead ? { id: call.lead.id, name: call.lead.name } : null,
          vehicle: vehicle ? {
            id: vehicle.id,
            brand: vehicle.brand,
            model: vehicle.model,
            plateNumber: vehicle.plateNumber,
            vin: vehicle.vin,
          } : call.lead && (call.lead.carBrand || call.lead.carModel || call.lead.plateNumber) ? {
            id: null,
            brand: call.lead.carBrand,
            model: call.lead.carModel,
            plateNumber: call.lead.plateNumber,
            vin: null,
          } : null,
          workOrder: call.workOrder,
          manager: call.manager,
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/telephony/live failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося отримати live-дзвінки." }, { status: 500 });
  }
}
