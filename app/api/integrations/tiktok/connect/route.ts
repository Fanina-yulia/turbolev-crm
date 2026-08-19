import { NextRequest, NextResponse } from "next/server";
import { buildTikTokAuthorizationUrl } from "@/src/services/integration-oauth.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  const callbackUrl = new URL("/api/integrations/tiktok/callback", request.nextUrl.origin).toString();
  try {
    const authorizationUrl = await buildTikTokAuthorizationUrl(callbackUrl);
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "TikTok connection setup failed" }, { status: 422 });
  }
}
