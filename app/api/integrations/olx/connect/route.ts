import { NextRequest, NextResponse } from "next/server";
import { buildOlxAuthorizationUrl } from "@/src/services/olx-communications.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const callbackUrl = new URL("/api/integrations/olx/callback", request.nextUrl.origin).toString();
    const authorizationUrl = await buildOlxAuthorizationUrl(callbackUrl);
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Не вдалося почати OLX OAuth",
    }, { status: 422 });
  }
}
