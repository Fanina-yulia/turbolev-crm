import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  claimBinotelReconciliationBucket,
  finishBinotelReconciliationBucket,
  getBinotelHistoryForPhone,
  reconcileRecentBinotelHistory,
} from "@/src/services/binotel-history.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  try {
    const phone = request.nextUrl.searchParams.get("phone")?.trim() || "";
    if (!phone) return NextResponse.json({ ok: false, error: "PHONE_REQUIRED" }, { status: 400 });
    const calls = await getBinotelHistoryForPhone(phone);
    return NextResponse.json({ ok: true, phone, calls }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/communications/binotel-history failed", error);
    return NextResponse.json({ ok: false, error: "BINOTEL_HISTORY_FAILED" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_WRITE, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  const claim = await claimBinotelReconciliationBucket(30);
  if (!claim.claimed) {
    return NextResponse.json({ ok: true, skipped: true, reason: "RECENTLY_RECONCILED" });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const lookbackMinutes = Number(body?.lookbackMinutes || 90);
    const result = await reconcileRecentBinotelHistory(lookbackMinutes);
    await finishBinotelReconciliationBucket(claim.externalEventId, "PROCESSED", {
      ...result,
      source: "REST_RECONCILIATION",
    });
    return NextResponse.json({ ok: true, skipped: false, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await finishBinotelReconciliationBucket(claim.externalEventId, "ERROR", { error: message });
    console.error("POST /api/communications/binotel-history failed", error);
    return NextResponse.json({ ok: false, error: "BINOTEL_RECONCILIATION_FAILED" }, { status: 502 });
  }
}
