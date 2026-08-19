import { NextRequest, NextResponse } from "next/server";
import { buildMetaAuthorizationUrl } from "@/src/services/integration-oauth.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  try {
    const callbackUrl = new URL("/api/integrations/meta/callback", request.nextUrl.origin).toString();
    return NextResponse.redirect(await buildMetaAuthorizationUrl(callbackUrl));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося почати Meta OAuth" }, { status: 422 });
  }
}
