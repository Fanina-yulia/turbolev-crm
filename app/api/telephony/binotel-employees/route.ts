import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getSafeBinotelEmployees } from "@/src/services/binotel-employees.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  try {
    const employees = await getSafeBinotelEmployees();
    return NextResponse.json({
      ok: true,
      employees,
      total: employees.length,
      linked: employees.filter((item) => item.crmUser?.internalNumber === item.internalNumber).length,
      suggestedByEmail: employees.filter((item) => item.crmUser?.match === "EMAIL" && !item.crmUser.internalNumber).length,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET Binotel employees failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося отримати співробітників Binotel",
    }, { status: 502 });
  }
}
