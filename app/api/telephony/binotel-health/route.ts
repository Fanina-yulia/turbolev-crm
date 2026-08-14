import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const apiKeyConfigured = Boolean(process.env.BINOTEL_API_KEY?.trim());
  const apiSecretConfigured = Boolean(process.env.BINOTEL_API_SECRET?.trim());
  const restConfigured = apiKeyConfigured && apiSecretConfigured;
  const webhookTokenConfigured = Boolean(process.env.BINOTEL_WEBHOOK_TOKEN?.trim());
  const websocketConfigured = Boolean(
    process.env.BINOTEL_WS_KEY?.trim() && process.env.BINOTEL_WS_SECRET?.trim(),
  );
  const companyIdConfigured = Boolean(process.env.BINOTEL_COMPANY_ID?.trim());

  const missing: string[] = [];
  if (!databaseConfigured) missing.push("DATABASE_URL");
  if (!apiKeyConfigured) missing.push("BINOTEL_API_KEY");
  if (!apiSecretConfigured) missing.push("BINOTEL_API_SECRET");
  if (!webhookTokenConfigured) missing.push("BINOTEL_WEBHOOK_TOKEN");

  return NextResponse.json({
    ok: databaseConfigured && restConfigured && webhookTokenConfigured,
    integration: "binotel",
    apiVersion: process.env.BINOTEL_API_VERSION?.trim() || "4.0",
    databaseConfigured,
    restConfigured,
    webhookTokenConfigured,
    websocketConfigured,
    companyIdConfigured,
    webhookPath: "/api/telephony/binotel-webhook",
    migrationConnectionConfigured: Boolean(
      process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim(),
    ),
    missing,
    optionalMissing: [
      ...(!companyIdConfigured ? ["BINOTEL_COMPANY_ID"] : []),
      ...(!websocketConfigured ? ["BINOTEL_WS_KEY / BINOTEL_WS_SECRET"] : []),
    ],
  });
}
