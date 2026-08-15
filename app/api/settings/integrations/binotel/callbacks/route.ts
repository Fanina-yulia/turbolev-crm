import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  const credentials = await getIntegrationCredential("BINOTEL").catch(() => null);
  const token = credentials?.webhookToken?.trim() || "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "BINOTEL_WEBHOOK_TOKEN_MISSING" }, { status: 409 });
  }

  const origin = request.nextUrl.origin.replace(/\/$/, "");
  const base = `${origin}/api/telephony/binotel-webhook`;
  const callback = (event: string) => `${base}?event=${encodeURIComponent(event)}&token=${encodeURIComponent(token)}`;

  return NextResponse.json({
    ok: true,
    callbacks: {
      incomingCall: callback("incomingCall"),
      answeredTheCall: callback("answeredTheCall"),
      hangupTheCall: callback("hangupTheCall"),
    },
    note: "Ці URL містять секретний webhook token. Передавайте їх лише в налаштування Binotel або техпідтримці Binotel.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
