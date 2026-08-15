import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { proxyNeonAuthRequest } from "@/src/security/neon-auth-transport";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.clone().json();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "INVALID_EMAIL", message: "Вкажіть коректний email." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: "WEAK_PASSWORD", message: "Пароль має містити щонайменше 8 символів." }, { status: 400 });
    }

    const prisma = getPrisma();
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        isActive: true,
        accessRoles: { some: { isActive: true, role: { isActive: true } } },
      },
      select: { id: true, name: true, authUserId: true },
    });
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "ACCESS_NOT_PROVISIONED", message: "Ця пошта ще не додана адміністратором Turbo LEV." },
        { status: 403 },
      );
    }
    if (user.authUserId) {
      return NextResponse.json(
        { ok: false, error: "ACCOUNT_ALREADY_LINKED", message: "Обліковий запис уже активований. Використайте звичайний вхід." },
        { status: 409 },
      );
    }

    const forwarded = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ email, password, name: user.name }),
    });
    const authResponse = await proxyNeonAuthRequest(forwarded, ["sign-up", "email"]);
    if (!authResponse.ok) return authResponse;

    const payload = asRecord(await authResponse.clone().json().catch(() => null));
    const authUser = asRecord(payload?.user);
    const authUserId = typeof authUser?.id === "string" ? authUser.id : null;
    if (!authUserId) {
      console.error("POST /api/auth/activate missing auth user id");
      return NextResponse.json({ ok: false, error: "AUTH_IDENTITY_LINK_FAILED" }, { status: 502 });
    }

    const linked = await prisma.user.updateMany({
      where: { id: user.id, authUserId: null, isActive: true },
      data: { authUserId, lastLoginAt: new Date(), lastSeenAt: new Date() },
    });
    if (linked.count !== 1) {
      console.error("POST /api/auth/activate CRM link race", { userId: user.id });
      return NextResponse.json({ ok: false, error: "AUTH_IDENTITY_LINK_CONFLICT" }, { status: 409 });
    }

    await writeAuditEvent({
      entityType: "User",
      entityId: user.id,
      action: "SECURITY_AUTH_ACCOUNT_ACTIVATED",
      after: { email, authLinked: true },
    }).catch(() => undefined);

    return authResponse;
  } catch (error) {
    console.error("POST /api/auth/activate", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "ACCOUNT_ACTIVATION_FAILED" }, { status: 500 });
  }
}
