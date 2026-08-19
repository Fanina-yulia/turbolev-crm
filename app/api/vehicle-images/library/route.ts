import { NextRequest, NextResponse } from "next/server";
import { listVehicleImageLibrary } from "@/src/services/vehicle-images/openai-library.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(250, Math.trunc(parsed))) : 100;
}

export async function GET(request: NextRequest) {
  try {
    const assets = await listVehicleImageLibrary(clamp(request.nextUrl.searchParams.get("limit")));
    return NextResponse.json(
      { ok: true, assets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image library GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити бібліотеку зображень авто." }, { status: 500 });
  }
}
