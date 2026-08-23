import { NextRequest, NextResponse } from "next/server";
import { saveIntegrationCredential, recordIntegrationTest } from "@/src/services/integration-credentials.service";
import { bmPartsAdapter } from "@/src/services/suppliers/bm-parts.adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QA_KEY = "ITyW9EktUxG4SGmroCNZDGY0_nXMOaonGphUJNh7yqM";

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });
  if (request.headers.get("x-qa-key") !== QA_KEY) return new NextResponse(null, { status: 403 });

  const body = await request.json().catch(() => null) as { apiKey?: string } | null;
  const apiKey = body?.apiKey?.trim() || "";
  if (apiKey.length < 20 || apiKey.length > 512) {
    return NextResponse.json({ ok: false, error: "Invalid token shape" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  await saveIntegrationCredential("BM_PARTS", { apiKey, baseUrl: "https://api.bm.parts" });
  const connection = await bmPartsAdapter.testConnection();
  await recordIntegrationTest("BM_PARTS", connection).catch(() => undefined);

  let search: { ok: boolean; offerCount: number; withPrice: number; withStock: number } = { ok: false, offerCount: 0, withPrice: 0, withStock: 0 };
  if (connection.ok) {
    try {
      const offers = await bmPartsAdapter.search("W712/95", 5);
      search = {
        ok: true,
        offerCount: offers.length,
        withPrice: offers.filter((offer) => typeof offer.purchasePrice === "number" && Number.isFinite(offer.purchasePrice)).length,
        withStock: offers.filter((offer) => offer.available || offer.stock.length > 0).length,
      };
    } catch {
      search = { ok: false, offerCount: 0, withPrice: 0, withStock: 0 };
    }
  }

  return NextResponse.json({
    ok: connection.ok,
    connection: {
      ok: connection.ok,
      state: connection.state,
      message: connection.message,
      latencyMs: connection.latencyMs ?? null,
    },
    search,
  }, { status: 200, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
