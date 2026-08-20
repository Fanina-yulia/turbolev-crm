import { NextResponse } from "next/server";
import {
  clientPortalErrorResponse,
  getClientPortalMessages,
  sendClientPortalMessage,
} from "@/src/services/client-portal.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ token: string }> };

function fail(error: unknown, operation: string) {
  const known = clientPortalErrorResponse(error);
  if (known) return NextResponse.json(known.body, { status: known.status });
  console.error(operation, error);
  return NextResponse.json({ ok: false, error: "CLIENT_PORTAL_MESSAGE_FAILED", message: "Не вдалося оновити чат." }, { status: 500 });
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    const chat = await getClientPortalMessages(token);
    return NextResponse.json({ ok: true, chat }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error, "GET client portal messages failed");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  try {
    const body = await request.json().catch(() => null) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text : "";
    const message = await sendClientPortalMessage(token, text);
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    return fail(error, "POST client portal message failed");
  }
}
