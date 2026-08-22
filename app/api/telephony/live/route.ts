import { NextRequest, NextResponse } from "next/server";
import { CallType } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  claimBinotelHeavyApiSlot,
  extractBinotelCallDetails,
  isBinotelReconciliationInProgress,
  summarizeBinotelCall,
} from "@/src/services/binotel-history.service";
import { getBinotelService } from "@/src/services/binotel.service";
import { processBinotelWebhook } from "@/src/services/binotel-webhook.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OnlineSyncState = {
  expiresAt: number;
  promise: Promise<void> | null;
};

const globalOnlineSync = globalThis as typeof globalThis & {
  __turboLevBinotelOnlineSync?: OnlineSyncState;
};

function onlineSyncState(): OnlineSyncState {
  if (!globalOnlineSync.__turboLevBinotelOnlineSync) {
    globalOnlineSync.__turboLevBinotelOnlineSync = { expiresAt: 0, promise: null };
  }
  return globalOnlineSync.__turboLevBinotelOnlineSync;
}

async function syncOnlineIncomingCalls() {
  const state = onlineSyncState();
  const now = Date.now();
  if (state.promise) return state.promise;
  if (now < state.expiresAt) return;

  // Local debounce avoids needless Neon checks inside one warm instance. The
  // provider-safe gate below coordinates every Vercel instance and browser tab.
  state.expiresAt = now + 4_000;
  state.promise = (async () => {
    try {
      if (await isBinotelReconciliationInProgress()) {
        state.expiresAt = Date.now() + 5_000;
        return;
      }

      const providerSlot = await claimBinotelHeavyApiSlot();
      if (!providerSlot) {
        state.expiresAt = Date.now() + 3_000;
        return;
      }

      const response = await getBinotelService().getOnlineCalls();
      const details = extractBinotelCallDetails(response);

      for (const detail of details) {
        const summary = summarizeBinotelCall(detail);
        if (!summary || summary.callType !== 0 || !summary.externalNumber) continue;

        const disposition = (summary.disposition || "").toUpperCase();
        const answered = summary.billsec > 0 || disposition === "ANSWER" || disposition === "TRANSFER";

        await processBinotelWebhook({
          requestType: answered ? "answeredTheCall" : "incomingCall",
          callDetails: detail,
        }).catch((error) => {
          console.warn("Binotel online call could not be mirrored into live feed", {
            callId: summary.callId,
            error: error instanceof Error ? error.message : "unknown error",
          });
        });
      }
    } catch (error) {
      // Webhook remains the primary realtime channel. Online REST is only a fallback,
      // so a provider/rate-limit failure must never take the CRM live endpoint down.
      console.warn("Binotel online-calls fallback unavailable", {
        error: error instanceof Error ? error.message : "unknown error",
      });
      state.expiresAt = Date.now() + 12_000;
    }
  })().finally(() => {
    state.promise = null;
  });

  return state.promise;
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, {
    request,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  const shadowAnonymous = !access.context.user
    && access.shadowBypass
    && access.context.enforcementMode === "SHADOW";

  if (!access.context.user && !shadowAnonymous) {
    return NextResponse.json({ ok: false, error: "CRM_USER_REQUIRED" }, { status: 403 });
  }

  try {
    // Binotel PUSH is the primary realtime source. Until provider delivery is reliable,
    // mirror active incoming calls from stats/online-calls through a distributed REST gate.
    await syncOnlineIncomingCalls();

    const prisma = getPrisma();
    const now = Date.now();
    const recentFrom = new Date(now - 3 * 60 * 1000);
    const terminalFrom = new Date(now - 75 * 1000);

    const user = access.context.user
      ? await prisma.user.findUnique({
          where: { id: access.context.user.id },
          select: { id: true, name: true, internalNumber: true },
        })
      : null;
    const userId = user?.id || access.context.user?.id || null;
    const internalNumber = user?.internalNumber?.trim() || null;

    const visibilityFilter = userId
      ? {
          OR: [
            { type: CallType.INCOMING },
            {
              type: CallType.OUTGOING,
              OR: [
                { managerId: userId },
                ...(internalNumber ? [{ internalNumber }] : []),
              ],
            },
          ],
        }
      : { type: CallType.INCOMING };

    const calls = await prisma.callHistory.findMany({
      where: {
        startedAt: { gte: recentFrom },
        AND: [
          {
            OR: [
              { endedAt: null },
              { endedAt: { gte: terminalFrom } },
            ],
          },
          visibilityFilter,
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
    });

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      authMode: shadowAnonymous ? "SHADOW_INBOUND_ONLY" : "AUTHENTICATED",
      realtimeSources: ["WEBHOOK", "ONLINE_CALLS_FALLBACK"],
      currentUser: userId ? {
        id: userId,
        name: user?.name || access.context.user?.name || "CRM user",
        internalNumber,
        clickToCallReady: Boolean(internalNumber),
      } : null,
      calls: calls.map((call) => {
        const vehicle = call.client?.vehicles[0] || null;
        return {
          id: call.id,
          callId: call.binotelCallId,
          phone: call.externalNumber,
          internalNumber: call.internalNumber,
          type: call.type,
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
