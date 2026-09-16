import { NextResponse } from "next/server";
import { getVisitFinancialState } from "@/src/services/visit-financial-state.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.CLIENTS_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;

  const { searchParams } = new URL(request.url);
  const appointmentId = searchParams.get("appointmentId")?.trim() || null;
  const vehicleId = searchParams.get("vehicleId")?.trim() || null;
  if (!appointmentId && !vehicleId) {
    return NextResponse.json({ ok: false, error: "Передайте appointmentId або vehicleId." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const state = await getVisitFinancialState({ appointmentId, vehicleId });
    return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle visit financial state GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити фінансовий стан візиту." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
