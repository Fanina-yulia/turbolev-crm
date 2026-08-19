import { NextRequest, NextResponse } from "next/server";
import { exchangeTikTokAuthorizationCode, verifyIntegrationOAuthState } from "@/src/services/integration-oauth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const target = new URL("/", request.nextUrl.origin);
  target.searchParams.set("integration", "tiktok");
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const error = request.nextUrl.searchParams.get("error") || request.nextUrl.searchParams.get("error_description") || "";
  if (error) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", error);
    return NextResponse.redirect(target);
  }
  if (!code || !state || !verifyIntegrationOAuthState(state, "TIKTOK")) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", "invalid_oauth_state");
    return NextResponse.redirect(target);
  }
  try {
    const callbackUrl = new URL("/api/integrations/tiktok/callback", request.nextUrl.origin).toString();
    await exchangeTikTokAuthorizationCode(code, callbackUrl);
    target.searchParams.set("integrationStatus", "connected");
    return NextResponse.redirect(target);
  } catch (exchangeError) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", exchangeError instanceof Error ? exchangeError.message.slice(0, 160) : "oauth_failed");
    return NextResponse.redirect(target);
  }
}
