import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { deactivatePersonnelV2, PersonnelV2Error, savePersonnelV2 } from "@/src/services/personnel-v2.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof PersonnelV2Error) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  console.error("Personnel v2 API failed", error);
  return NextResponse.json({ ok: false, error: "PERSONNEL_V2_FAILED", message: "Не вдалося зберегти працівника." }, { status: 500 });
}

async function save(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json();
    const result = await savePersonnelV2(body, access.context, access.grantedScope);
    return NextResponse.json({ ok: true, id: result.employee.id, userId: result.user?.id || null, roles: result.assignments });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) { return save(request); }
export async function PUT(request: NextRequest) { return save(request); }

export async function DELETE(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return NextResponse.json({ ok: false, error: "EMPLOYEE_ID_REQUIRED", message: "Не вказано працівника." }, { status: 400 });
    await deactivatePersonnelV2(id, access.context, access.grantedScope);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
