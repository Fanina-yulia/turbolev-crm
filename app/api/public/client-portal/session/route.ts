import { NextRequest, NextResponse } from "next/server";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  CLIENT_PORTAL_SESSION_DAYS,
  ClientPortalSessionError,
  createClientPortalSessionFromShareToken,
  revokeClientPortalSession,
} from "@/src/services/client-portal-session.service";
import { DiagnosticReportError } from "@/src/services/diagnostic-report.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { shareToken?: string } | null;
    const shareToken = body?.shareToken?.trim() || "";
    if (!shareToken) {
      return NextResponse.json({ ok: false, message: "Захищене посилання відсутнє." }, { status: 400 });
    }

    const session = await createClientPortalSessionFromShareToken(
      shareToken,
      request.headers.get("user-agent"),
    );
    const response = NextResponse.json({
      ok: true,
      redirectTo: `/my?vehicle=${encodeURIComponent(session.vehicleId)}`,
      expiresAt: session.expiresAt.toISOString(),
    });
    response.cookies.set(CLIENT_PORTAL_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CLIENT_PORTAL_SESSION_DAYS * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    const known = error instanceof ClientPortalSessionError || error instanceof DiagnosticReportError;
    return NextResponse.json(
      { ok: false, message: known ? error.message : "Не вдалося активувати особистий кабінет." },
      { status: known ? error.status : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(CLIENT_PORTAL_SESSION_COOKIE)?.value || null;
  await revokeClientPortalSession(token).catch(() => undefined);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CLIENT_PORTAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
