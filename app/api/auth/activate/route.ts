import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { proxyNeonAuthRequest } from "@/src/security/neon-auth-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const user = await getPrisma().user.findFirst({
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
    return proxyNeonAuthRequest(forwarded, ["sign-up", "email"]);
  } catch (error) {
    console.error("POST /api/auth/activate", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "ACCOUNT_ACTIVATION_FAILED" }, { status: 500 });
  }
}
