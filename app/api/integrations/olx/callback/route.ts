import { NextRequest, NextResponse } from "next/server";
import {
  exchangeOlxAuthorizationCode,
  syncOlxInbox,
  testOlxConnection,
  verifyOlxOAuthState,
} from "@/src/services/olx-communications.service";
import { saveIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const error = request.nextUrl.searchParams.get("error") || "";
  const target = new URL("/", request.nextUrl.origin);
  target.searchParams.set("section", "settings");
  target.searchParams.set("settingsTab", "integrations");
  target.searchParams.set("integration", "olx");

  if (error) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", error);
    return NextResponse.redirect(target);
  }
  if (!code || !state || !verifyOlxOAuthState(state)) {
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", "invalid_oauth_state");
    return NextResponse.redirect(target);
  }

  try {
    const callbackUrl = new URL("/api/integrations/olx/callback", request.nextUrl.origin).toString();
    const tokens = await exchangeOlxAuthorizationCode(code, callbackUrl);
    const profile = await testOlxConnection().catch(() => ({ ok: false, userId: null, name: null }));
    await saveIntegrationCredential("OLX", {
      externalAccountId: profile.userId ? String(profile.userId) : "",
      externalAccountName: profile.name || "OLX",
      scopes: tokens.scope || "v2 read write",
      tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : "",
    });
    await syncOlxInbox().catch((syncError) => console.warn("Initial OLX sync failed", syncError));
    target.searchParams.set("integrationStatus", "connected");
    return NextResponse.redirect(target);
  } catch (exchangeError) {
    console.error("OLX OAuth callback failed", exchangeError);
    target.searchParams.set("integrationStatus", "error");
    target.searchParams.set("integrationMessage", exchangeError instanceof Error ? exchangeError.message.slice(0, 160) : "oauth_failed");
    return NextResponse.redirect(target);
  }
}
