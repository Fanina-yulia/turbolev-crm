import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { runUniqueTradeQAPreview } from "@/src/services/supplier-unique-trade-shadow-preview-qa.service";

export const runtime = "nodejs";
export const maxDuration = 30;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET(request: Request) {
  // Production and non-Vercel environments must not expose this QA surface at all.
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404, headers: RESPONSE_HEADERS });
  }

  const access = await authorizeScopedLocation(PERMISSIONS.PARTS_READ, request, null);
  if (!access.ok) return access.response;

  try {
    const summary = await runUniqueTradeQAPreview();
    return NextResponse.json(summary, { headers: RESPONSE_HEADERS });
  } catch (error) {
    console.error("unique-trade-qa-preview failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        status: "ERROR",
        environment: "preview",
        provider: "UNIQUE_TRADE",
        sanitized: true,
        writeMode: "READ_ONLY",
        code: "PREVIEW_EXECUTION_FAILED",
      },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
