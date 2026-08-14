import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const required = [
    "BINOTEL_COMPANY_ID",
    "BINOTEL_API_KEY",
    "BINOTEL_API_SECRET",
    "BINOTEL_WS_KEY",
    "BINOTEL_WS_SECRET",
  ] as const;

  const missing = required.filter((name) => !process.env[name]?.trim());

  return NextResponse.json(
    {
      ok: missing.length === 0,
      integration: "binotel",
      apiVersion: process.env.BINOTEL_API_VERSION?.trim() || "4.0",
      websocketConfigured: Boolean(
        process.env.BINOTEL_WS_KEY?.trim() && process.env.BINOTEL_WS_SECRET?.trim(),
      ),
      databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
      missing,
    },
    { status: missing.length === 0 ? 200 : 503 },
  );
}
