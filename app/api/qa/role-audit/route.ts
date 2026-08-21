import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { createLocalSessionToken, LOCAL_AUTH_COOKIE } from "@/src/security/local-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROD = "https://turbolev-crm.vercel.app";
const ALLOWED_ROLES = new Set([
  "OWNER","EXECUTIVE_DIRECTOR","STATION_MANAGER","SERVICE_ADVISOR","MECHANIC",
  "PARTS_SPECIALIST","WAREHOUSE_KEEPER","HEAD_OF_SALES","SALES","ACCOUNTANT",
  "MARKETING_DIRECTOR","MARKETER","HR_MANAGER","ADMINISTRATOR","CRM_ADMIN",
]);

const probes = [
  ["home", "/"],
  ["me", "/api/auth/me"],
  ["dashboard", "/api/dashboard"],
  ["inquiries", "/api/inquiries?limit=5"],
  ["clients", "/api/clients?limit=5"],
  ["planner", "/api/planner?from=2026-08-21T00%3A00%3A00.000Z&to=2026-08-22T00%3A00%3A00.000Z"],
  ["diagnostics", "/api/diagnostics"],
  ["workOrders", "/api/work-orders"],
  ["procurement", "/api/procurement"],
  ["finance", "/api/finance/summary"],
  ["analytics", "/api/analytics?from=2026-08-01&to=2026-08-21"],
  ["personnel", "/api/personnel/v2"],
  ["security", "/api/security/config"],
  ["audit", "/api/audit?limit=5"],
] as const;

function jsonSummary(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    ok: typeof row.ok === "boolean" ? row.ok : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
    error: typeof row.error === "string" ? row.error : undefined,
    message: typeof row.message === "string" ? row.message.slice(0, 180) : undefined,
    provisioningState: typeof row.provisioningState === "string" ? row.provisioningState : undefined,
    keys: Object.keys(row).slice(0, 12),
  };
}

async function probe(cookie: string, label: string, path: string) {
  const started = Date.now();
  try {
    const response = await fetch(`${PROD}${path}`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        Cookie: cookie,
        Accept: path.startsWith("/api/") ? "application/json" : "text/html",
        "User-Agent": "TurboLEV-QA-Role-Audit/2026-08-21",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    let summary: unknown = null;
    if (contentType.includes("application/json")) {
      summary = jsonSummary(await response.json().catch(() => null));
    } else {
      const text = await response.text().catch(() => "");
      summary = {
        titlePresent: text.includes("Turbo LEV CRM"),
        signInPresent: text.includes("Увійти") || text.includes("auth/sign-in"),
        mechanicCabinetHint: text.includes("MechanicLiveCabinet") || text.includes("Кабінет механіка"),
        bytes: text.length,
      };
    }
    return {
      label,
      path,
      status: response.status,
      redirect: response.headers.get("location"),
      ms: Date.now() - started,
      summary,
    };
  } catch (error) {
    return { label, path, status: 0, redirect: null, ms: Date.now() - started, summary: { error: error instanceof Error ? error.message : "fetch failed" } };
  }
}

export async function GET(request: Request) {
  const role = new URL(request.url).searchParams.get("role")?.trim().toUpperCase() || "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ ok: false, error: "ROLE_REQUIRED", allowedRoles: [...ALLOWED_ROLES] }, { status: 400 });
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: `qa_role_${role.toLowerCase()}` },
    select: {
      id: true,
      name: true,
      isActive: true,
      employeeProfile: { select: { isActive: true, crmLogin: true, crmPasswordHash: true } },
      accessRoles: {
        where: { isActive: true },
        select: { isPrimary: true, locationId: true, role: { select: { code: true, name: true } } },
      },
    },
  });
  const hash = user?.employeeProfile?.crmPasswordHash || null;
  if (!user || !user.isActive || user.employeeProfile?.isActive === false || !hash) {
    return NextResponse.json({ ok: false, error: "QA_USER_NOT_READY", role }, { status: 409 });
  }

  const session = createLocalSessionToken(user.id, hash, false);
  const cookie = `${LOCAL_AUTH_COOKIE}=${encodeURIComponent(session.token)}`;
  const results = await Promise.all(probes.map(([label, path]) => probe(cookie, label, path)));
  const failures = results.filter((item) => item.status >= 500 || item.status === 0);

  return NextResponse.json({
    ok: failures.length === 0,
    role,
    user: { id: user.id, name: user.name, crmLogin: user.employeeProfile?.crmLogin || null },
    accessRoles: user.accessRoles,
    testedAt: new Date().toISOString(),
    productionBase: PROD,
    failures: failures.length,
    results,
  }, { headers: { "Cache-Control": "no-store" } });
}
