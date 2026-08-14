import { NextResponse } from "next/server";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const config = await getIntegrationCredential("BINOTEL").catch(() => null);
  const apiKeyConfigured = Boolean(config?.apiKey);
  const apiSecretConfigured = Boolean(config?.apiSecret);
  const restConfigured = apiKeyConfigured && apiSecretConfigured;
  const webhookTokenConfigured = Boolean(config?.webhookToken);
  const websocketConfigured = Boolean(config?.wsKey && config?.wsSecret);
  const companyIdConfigured = Boolean(config?.companyId);
  const source = config?.__source || null;

  const missing: string[] = [];
  if (!databaseConfigured) missing.push("DATABASE_URL");
  if (!apiKeyConfigured) missing.push("API key");
  if (!apiSecretConfigured) missing.push("API secret");
  if (!webhookTokenConfigured) missing.push("Webhook token");

  return NextResponse.json({
    ok: databaseConfigured && restConfigured && webhookTokenConfigured,
    integration: "binotel",
    configuredVia: source,
    apiVersion: process.env.BINOTEL_API_VERSION?.trim() || "4.0",
    databaseConfigured,
    restConfigured,
    webhookTokenConfigured,
    websocketConfigured,
    companyIdConfigured,
    webhookPath: "/api/telephony/binotel-webhook",
    missing,
    optionalMissing: [
      ...(!companyIdConfigured ? ["Company ID"] : []),
      ...(!websocketConfigured ? ["WebSocket key / secret"] : []),
    ],
  });
}
