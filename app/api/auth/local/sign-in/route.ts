import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { createLocalSessionToken, LOCAL_AUTH_COOKIE, normalizeCrmLogin, verifyCrmPassword } from "@/src/security/local-credentials";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const login = normalizeCrmLogin(body?.login);
    const password = typeof body?.password === "string" ? body.password : "";
    const rememberMe = body?.rememberMe !== false;
    const invalid = () => NextResponse.json(
      { ok: false, error: "INVALID_CREDENTIALS", message: "Невірний логін або пароль." },
      { status: 401 },
    );

    if (!login || !password) return invalid();

    const prisma = getPrisma();
    const employee = await prisma.employeeProfile.findFirst({
      where: { crmLogin: { equals: login, mode: "insensitive" } },
      select: {
        id: true,
        isActive: true,
        crmPasswordHash: true,
        user: { select: { id: true, isActive: true, name: true } },
      },
    });

    if (!employee?.user?.id || !employee.isActive || !employee.user.isActive || !verifyCrmPassword(password, employee.crmPasswordHash)) {
      await writeAuditEvent({
        entityType: "Security",
        entityId: login || "unknown",
        action: "SECURITY_LOCAL_SIGN_IN_FAILED",
        after: { loginProvided: Boolean(login) },
      }).catch(() => undefined);
      return invalid();
    }

    const session = createLocalSessionToken(employee.user.id, employee.crmPasswordHash!, rememberMe);
    await prisma.user.update({
      where: { id: employee.user.id },
      data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
    });
    await writeAuditEvent({
      entityType: "User",
      entityId: employee.user.id,
      action: "SECURITY_LOCAL_SIGN_IN",
      after: { employeeId: employee.id },
    }).catch(() => undefined);

    const response = NextResponse.json({ ok: true, user: { id: employee.user.id, name: employee.user.name } });
    response.cookies.set(LOCAL_AUTH_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: session.maxAge,
    });
    return response;
  } catch (error) {
    console.error("POST /api/auth/local/sign-in", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "LOCAL_SIGN_IN_FAILED", message: "Не вдалося виконати вхід." }, { status: 500 });
  }
}
