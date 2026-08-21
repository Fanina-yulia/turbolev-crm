import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { createLocalSessionToken, hashCrmPassword, LOCAL_AUTH_COOKIE } from "@/src/security/local-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const QA_TOKEN = "pgkYMaxGfmStDa1UbUZvsLPkScKdl8kGTnk_sBhAwjw";
const QA_PASSWORD = "QaTurboLev!2026";
const QA_REASON = "TEMP_QA_SECURITY_SMOKE_20260821";

const READ_PROBES = [
  ["clients", "/api/clients?limit=1"],
  ["dashboard", "/api/dashboard"],
  ["planner", "/api/planner"],
  ["diagnostics", "/api/diagnostics?limit=1"],
  ["workOrders", "/api/work-orders?limit=1"],
  ["finance", "/api/finance/summary"],
  ["payments", "/api/payments"],
  ["analytics", "/api/analytics"],
  ["analyticsFinance", "/api/analytics/finance"],
  ["analyticsDiagnostics", "/api/analytics/diagnostics"],
  ["analyticsParts", "/api/analytics/parts"],
  ["procurement", "/api/procurement"],
] as const;

const WRITE_PROBES = [
  ["plannerWrite", "/api/planner", "POST", {}],
  ["workOrderWrite", "/api/work-orders/qa-security-missing", "PATCH", { status: "IN_REPAIR" }],
  ["financeAccountWrite", "/api/finance/accounts", "POST", {}],
  ["paymentWrite", "/api/work-orders/qa-security-missing/payments", "POST", {}],
  ["procurementWrite", "/api/procurement", "POST", {}],
] as const;

async function probe(origin: string, cookie: string, path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      cookie,
      "content-type": "application/json",
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return {
    status: response.status,
    error: typeof body?.error === "string" ? body.error : null,
    permitted: typeof body?.permitted === "boolean" ? body.permitted : null,
    emptyScope: typeof body?.emptyScope === "boolean" ? body.emptyScope : null,
  };
}

async function cleanup(userId: string, employeeId: string) {
  const prisma = getPrisma();
  await prisma.userAccessRole.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.userPermissionOverride.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.employeeProfile.deleteMany({ where: { id: employeeId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("token") !== QA_TOKEN) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const roleCode = (request.nextUrl.searchParams.get("role") || "").trim().toUpperCase();
  if (!roleCode) return NextResponse.json({ ok: false, error: "ROLE_REQUIRED" }, { status: 400 });

  const prisma = getPrisma();
  const role = await prisma.accessRole.findUnique({ where: { code: roleCode }, select: { id: true, code: true, name: true } });
  if (!role) return NextResponse.json({ ok: false, error: "ROLE_NOT_FOUND" }, { status: 404 });

  const suffix = randomUUID();
  const userId = `qa_sec_user_${suffix}`;
  const employeeId = `qa_sec_employee_${suffix}`;
  const assignmentId = `qa_sec_role_${suffix}`;
  const passwordHash = hashCrmPassword(QA_PASSWORD);
  const login = `qa.sec.${suffix.replaceAll("-", "").slice(0, 20)}`;
  const locationId = "loc_glevakha";

  try {
    await prisma.user.create({
      data: { id: userId, name: `QA ${role.code}`, isActive: true },
    });
    await prisma.employeeProfile.create({
      data: {
        id: employeeId,
        userId,
        firstName: "QA",
        lastName: role.code,
        position: "Security smoke",
        crmLogin: login,
        crmPasswordHash: passwordHash,
        isActive: true,
      },
    });
    await prisma.userAccessRole.create({
      data: {
        id: assignmentId,
        userId,
        roleId: role.id,
        locationId,
        isPrimary: true,
        isActive: true,
        startsAt: new Date(Date.now() - 60_000),
        reason: QA_REASON,
      },
    });

    const session = createLocalSessionToken(userId, passwordHash, false);
    const cookie = `${LOCAL_AUTH_COOKIE}=${encodeURIComponent(session.token)}`;
    const origin = request.nextUrl.origin;
    const results: Record<string, unknown> = {};

    for (const [name, path] of READ_PROBES) {
      results[name] = await probe(origin, cookie, path);
    }
    for (const [name, path, method, body] of WRITE_PROBES) {
      results[name] = await probe(origin, cookie, path, { method, body: JSON.stringify(body) });
    }

    return NextResponse.json({ ok: true, role: role.code, results }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    await cleanup(userId, employeeId);
  }
}
