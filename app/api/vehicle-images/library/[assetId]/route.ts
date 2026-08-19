import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  approveVehicleImageLibraryAsset,
  getVehicleImageLibraryAdminAsset,
  regenerateVehicleImageLibraryAsset,
  replaceVehicleImageLibraryAsset,
} from "@/src/services/vehicle-images/vehicle-image-library-admin.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 100;

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function allow(request: NextRequest) {
  if (!sameOrigin(request)) return { access: null, response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return { access, response: access.response! };
  return { access, response: null };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const permission = await allow(request);
  if (permission.response) return permission.response;
  const { assetId } = await context.params;

  try {
    const body = await request.json().catch(() => ({})) as { action?: string };
    if (body.action === "approve") {
      const asset = await approveVehicleImageLibraryAsset(assetId, permission.access?.context.user?.id ?? null);
      return NextResponse.json({ ok: true, asset }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "regenerate") {
      const generation = await regenerateVehicleImageLibraryAsset(assetId);
      const asset = await getVehicleImageLibraryAdminAsset(assetId);
      return NextResponse.json({ ok: true, generation, asset }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: false, error: "Невідома дія." }, { status: 400 });
  } catch (error) {
    console.error("vehicle image library PATCH failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося оновити зображення." },
      { status: 422 },
    );
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const permission = await allow(request);
  if (permission.response) return permission.response;
  const { assetId } = await context.params;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Оберіть PNG-файл." }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const asset = await replaceVehicleImageLibraryAsset(
      assetId,
      bytes,
      file.type || "application/octet-stream",
      permission.access?.context.user?.id ?? null,
    );
    return NextResponse.json({ ok: true, asset }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle image library replacement failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося замінити зображення." },
      { status: 422 },
    );
  }
}
