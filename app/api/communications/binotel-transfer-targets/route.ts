import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getSafeBinotelEmployees } from "@/src/services/binotel-employees.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  try {
    const employees = await getSafeBinotelEmployees();
    const targets = employees.map((employee) => ({
      internalNumber: employee.internalNumber,
      name: employee.name || employee.crmUser?.name || null,
      email: employee.email || employee.crmUser?.email || null,
    }));
    return NextResponse.json({ ok: true, targets }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/communications/binotel-transfer-targets failed", error);
    return NextResponse.json({ ok: false, error: "BINOTEL_TRANSFER_TARGETS_FAILED" }, { status: 502 });
  }
}
