import { NextResponse } from "next/server";
import { getOwnSalaryOverview } from "@/src/services/payroll-self.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorize(PERMISSIONS.PAYROLL_SELF_READ, { strict: true, request, minimumScope: "SELF" });
  if (!auth.allowed) return auth.response!;

  const employeeId = auth.context.user?.employeeId;
  if (!employeeId) {
    return NextResponse.json({ ok: false, error: "EMPLOYEE_PROFILE_NOT_LINKED" }, { status: 404 });
  }

  try {
    const overview = await getOwnSalaryOverview({ employeeId });
    return NextResponse.json({ ok: true, ...overview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/me/compensation", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "COMPENSATION_READ_FAILED" }, { status: 500 });
  }
}
