import { NextRequest, NextResponse } from "next/server";
import {
  createTelegramClientLink,
  getTelegramClientState,
  unlinkTelegramClient,
} from "@/src/services/telegram.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(PERMISSIONS.CLIENTS_READ, { strict: true, request });
  if (!access.allowed) return access.response!;
  const { id } = await context.params;
  try {
    return NextResponse.json({ ok: true, ...(await getTelegramClientState(id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET client Telegram failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося перевірити Telegram" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(PERMISSIONS.CLIENTS_WRITE, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  try {
    const link = await createTelegramClientLink(id);
    return NextResponse.json({ ok: true, link });
  } catch (error) {
    console.error("POST client Telegram failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося створити Telegram-посилання" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(PERMISSIONS.CLIENTS_WRITE, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  try {
    await unlinkTelegramClient(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE client Telegram failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося відключити Telegram" }, { status: 500 });
  }
}
