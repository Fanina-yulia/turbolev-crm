import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone } from "@/src/lib/phone";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getSafeBinotelEmployees } from "@/src/services/binotel-employees.service";
import { getBinotelService } from "@/src/services/binotel.service";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function findCallId(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCallId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as JsonRecord;
  for (const key of ["generalCallID", "generalCallId", "callID", "callId"]) {
    const candidate = object[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      const result = String(candidate).trim();
      if (result) return result;
    }
  }
  for (const nested of Object.values(object)) {
    const found = findCallId(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

async function controllableCall(callId: string, userId: string, internalNumber: string) {
  const call = await getPrisma().callHistory.findUnique({
    where: { binotelCallId: callId },
    select: {
      id: true,
      binotelCallId: true,
      internalNumber: true,
      managerId: true,
      endedAt: true,
      status: true,
    },
  });
  if (!call) return { error: NextResponse.json({ ok: false, error: "CALL_NOT_FOUND" }, { status: 404 }) } as const;
  if (call.endedAt) return { error: NextResponse.json({ ok: false, error: "CALL_ALREADY_ENDED" }, { status: 409 }) } as const;
  const ownCall = call.managerId === userId || Boolean(internalNumber && call.internalNumber === internalNumber);
  if (!ownCall) return { error: NextResponse.json({ ok: false, error: "CALL_CONTROL_FORBIDDEN" }, { status: 403 }) } as const;
  return { call } as const;
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_WRITE, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;
  if (!access.context.user) {
    return NextResponse.json({ ok: false, error: "CRM_USER_REQUIRED" }, { status: 403 });
  }

  const authenticatedUserId = access.context.user.id;

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "call").trim().toLowerCase();
    const user = await getPrisma().user.findUnique({
      where: { id: authenticatedUserId },
      select: { id: true, name: true, internalNumber: true },
    });
    const internalNumber = user?.internalNumber?.trim() || "";
    if (!internalNumber) {
      return NextResponse.json({
        ok: false,
        error: "INTERNAL_NUMBER_REQUIRED",
        message: "Спочатку прив'яжіть ваш внутрішній номер Binotel до користувача CRM.",
      }, { status: 409 });
    }

    const service = getBinotelService();

    if (action === "hangup" || action === "transfer") {
      const callId = String(body?.callId || body?.generalCallID || "").trim();
      if (!callId) return NextResponse.json({ ok: false, error: "CALL_ID_REQUIRED" }, { status: 400 });
      const controlled = await controllableCall(callId, authenticatedUserId, internalNumber);
      if ("error" in controlled) return controlled.error;

      if (action === "hangup") {
        await service.hangupCall(callId);
        await writeAuditEvent({
          entityType: "Telephony",
          entityId: callId,
          action: "BINOTEL_HANGUP_CALL",
          metadata: { internalNumber, provider: "BINOTEL" },
        });
        return NextResponse.json({ ok: true, provider: "BINOTEL", action: "hangup", callId });
      }

      const targetInternalNumber = String(body?.targetInternalNumber || "").replace(/\D/g, "");
      if (!targetInternalNumber) {
        return NextResponse.json({ ok: false, error: "TRANSFER_TARGET_REQUIRED" }, { status: 400 });
      }
      if (targetInternalNumber === internalNumber) {
        return NextResponse.json({ ok: false, error: "TRANSFER_TARGET_IS_SELF" }, { status: 400 });
      }
      const targets = await getSafeBinotelEmployees();
      const target = targets.find((employee) => employee.internalNumber === targetInternalNumber);
      if (!target) {
        return NextResponse.json({ ok: false, error: "TRANSFER_TARGET_NOT_FOUND" }, { status: 400 });
      }

      await service.transferCall(callId, targetInternalNumber);
      await writeAuditEvent({
        entityType: "Telephony",
        entityId: callId,
        action: "BINOTEL_ATTENDED_TRANSFER",
        metadata: {
          internalNumber,
          targetInternalNumber,
          targetName: target.name || null,
          provider: "BINOTEL",
        },
      });
      return NextResponse.json({
        ok: true,
        provider: "BINOTEL",
        action: "transfer",
        callId,
        targetInternalNumber,
        targetName: target.name || null,
      });
    }

    const externalNumber = normalizePhone(String(body?.phone || body?.externalNumber || ""));
    if (!externalNumber) {
      return NextResponse.json({ ok: false, error: "Вкажіть номер телефону клієнта." }, { status: 400 });
    }

    // async=true is intentional: Binotel can ring the employee line for up to 30s,
    // while the CRM REST timeout is shorter. We only need confirmation that Binotel
    // accepted the command; subsequent state arrives through webhook/reconciliation.
    const providerResponse = await service.sendCall({ internalNumber, externalNumber, async: true });
    const callId = findCallId(providerResponse);

    await writeAuditEvent({
      entityType: "Telephony",
      entityId: callId || `outgoing:${Date.now()}`,
      action: "BINOTEL_CLICK_TO_CALL",
      metadata: { externalNumber, internalNumber, provider: "BINOTEL", async: true },
    });

    return NextResponse.json({
      ok: true,
      provider: "BINOTEL",
      initiated: true,
      async: true,
      callId,
      externalNumber,
      internalNumber,
    });
  } catch (error) {
    console.error("POST /api/telephony/call failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Binotel не зміг виконати команду дзвінка.",
    }, { status: 502 });
  }
}
