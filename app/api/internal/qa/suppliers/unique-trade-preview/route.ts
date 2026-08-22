import { NextResponse } from "next/server";
import { runUniqueTradeQAPreview } from "@/src/services/supplier-unique-trade-shadow-preview-qa.service";

export const runtime = "nodejs";
export const maxDuration = 30;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404, headers: RESPONSE_HEADERS });
  }

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
