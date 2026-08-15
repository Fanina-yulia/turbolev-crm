import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPersonnelAccessCatalog, PersonnelAccessError } from "@/src/services/personnel-access.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, {
    request,
    strict: true,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  try {
    const catalog = await getPersonnelAccessCatalog(access.context, access.grantedScope);
    return NextResponse.json({ ok: true, ...catalog }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PersonnelAccessError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET /api/personnel/access-catalog", error);
    return NextResponse.json({ ok: false, error: "PERSONNEL_ACCESS_CATALOG_FAILED" }, { status: 500 });
  }
}
