import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { listVehicleImageLibraryAdmin } from "@/src/services/vehicle-images/vehicle-image-library-admin.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(250, Math.trunc(parsed))) : 250;
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const assets = await listVehicleImageLibraryAdmin(clamp(request.nextUrl.searchParams.get("limit")));
    return NextResponse.json(
      { ok: true, assets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image library GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити бібліотеку зображень авто." }, { status: 500 });
  }
}
