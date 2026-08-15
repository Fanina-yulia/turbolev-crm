import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getSecurityCatalog } from "@/src/security/security-admin.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const catalog = await getSecurityCatalog();
    return NextResponse.json({ ok: true, ...catalog }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/security/access-catalog", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "SECURITY_CATALOG_FAILED" }, { status: 500 });
  }
}
