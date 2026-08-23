import { NextResponse } from "next/server";
import { bmPartsAdapter } from "@/src/services/suppliers/bm-parts.adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const started = Date.now();
  try {
    const result = await bmPartsAdapter.testConnection();
    return NextResponse.json(
      {
        provider: "BM_PARTS",
        ok: result.ok,
        state: result.state,
        message: result.message,
        latencyMs: result.latencyMs ?? Date.now() - started,
        checkedAt: result.checkedAt,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        provider: "BM_PARTS",
        ok: false,
        state: "ERROR",
        message: error instanceof Error ? error.message : "BM Parts probe failed",
        latencyMs: Date.now() - started,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
        },
      },
    );
  }
}
