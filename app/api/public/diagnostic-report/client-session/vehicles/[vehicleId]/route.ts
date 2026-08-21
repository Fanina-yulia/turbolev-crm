import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  ClientPortalSessionError,
  resolveClientPortalSession,
} from "@/src/services/client-portal-session.service";
import { getClientVehiclePortalDetail } from "@/src/services/client-portal-vehicle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const session = await resolveClientPortalSession(request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null);
    if (!session) return NextResponse.json({ ok: false, message: "Сесія особистого кабінету завершилась." }, { status: 401 });
    const { vehicleId } = await context.params;
    const detail = await getClientVehiclePortalDetail(session.clientId, vehicleId);
    return NextResponse.json({ ok: true, detail }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof ClientPortalSessionError;
    return NextResponse.json(
      { ok: false, message: known ? error.message : "Не вдалося завантажити автомобіль." },
      { status: known ? error.status : 500 },
    );
  }
}
