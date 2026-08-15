import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePhone } from "@/src/lib/phone";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
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

  try {
    const body = await request.json().catch(() => ({}));
    const externalNumber = normalizePhone(String(body?.phone || body?.externalNumber || ""));
    if (!externalNumber) {
      return NextResponse.json({ ok: false, error: "Вкажіть номер телефону клієнта." }, { status: 400 });
    }

    const user = await getPrisma().user.findUnique({
      where: { id: access.context.user.id },
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

    const providerResponse = await getBinotelService().sendCall({ internalNumber, externalNumber });
    const callId = findCallId(providerResponse);

    await writeAuditEvent({
      entityType: "Telephony",
      entityId: callId || `outgoing:${Date.now()}`,
      action: "BINOTEL_CLICK_TO_CALL",
      metadata: { externalNumber, internalNumber, provider: "BINOTEL" },
    });

    return NextResponse.json({
      ok: true,
      provider: "BINOTEL",
      initiated: true,
      callId,
      externalNumber,
      internalNumber,
    });
  } catch (error) {
    console.error("POST /api/telephony/call failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Binotel не зміг розпочати дзвінок.",
    }, { status: 502 });
  }
}
