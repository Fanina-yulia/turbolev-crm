import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  ClientPortalSessionError,
  resolveClientPortalSession,
} from "@/src/services/client-portal-session.service";
import {
  listClientVehicleMessages,
  sendClientVehicleMessage,
} from "@/src/services/client-portal-vehicle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sessionFor(request: NextRequest) {
  return resolveClientPortalSession(request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null);
}

export async function GET(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const session = await sessionFor(request);
    if (!session) return NextResponse.json({ ok: false, message: "Сесія особистого кабінету завершилась." }, { status: 401 });
    const { vehicleId } = await context.params;
    const chat = await listClientVehicleMessages(session.clientId, vehicleId);
    return NextResponse.json({ ok: true, chat }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof ClientPortalSessionError;
    return NextResponse.json({ ok: false, message: known ? error.message : "Не вдалося завантажити чат." }, { status: known ? error.status : 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ vehicleId: string }> }) {
  try {
    const session = await sessionFor(request);
    if (!session) return NextResponse.json({ ok: false, message: "Сесія особистого кабінету завершилась." }, { status: 401 });
    const { vehicleId } = await context.params;
    const body = await request.json().catch(() => null) as { text?: string; workOrderId?: string | null } | null;
    const message = await sendClientVehicleMessage(session.clientId, vehicleId, body?.text || "", body?.workOrderId || null);
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    const known = error instanceof ClientPortalSessionError;
    return NextResponse.json({ ok: false, message: known ? error.message : "Не вдалося надіслати повідомлення." }, { status: known ? error.status : 500 });
  }
}
