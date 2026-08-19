import { NextRequest, NextResponse } from "next/server";
import { exchangeMetaAuthorizationCode, verifyIntegrationOAuthState } from "@/src/services/integration-oauth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const target = new URL("/", request.nextUrl.origin);
  target.searchParams.set("integration", "meta");
  const error = request.nextUrl.searchParams.get("error") || request.nextUrl.searchParams.get("error_reason") || "";
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  if (error) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", error);
    return NextResponse.redirect(target);
  }
  if (!code || !state || !verifyIntegrationOAuthState(state, "META")) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", "invalid_oauth_state");
    return NextResponse.redirect(target);
  }
  try {
    const callbackUrl = new URL("/api/integrations/meta/callback", request.nextUrl.origin).toString();
    const result = await exchangeMetaAuthorizationCode(code, callbackUrl);
    target.searchParams.set("integrationStatus", "connected");
    if (result.subscriptionWarning) target.searchParams.set("integrationMessage", `Meta авторизовано, але webhook subscription потребує перевірки: ${result.subscriptionWarning.slice(0, 140)}`);
    return NextResponse.redirect(target);
  } catch (exchangeError) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", exchangeError instanceof Error ? exchangeError.message.slice(0, 160) : "oauth_failed");
    return NextResponse.redirect(target);
  }
}
