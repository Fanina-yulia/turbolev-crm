import { createDecipheriv, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { saveIntegrationCredential, recordIntegrationTest } from "@/src/services/integration-credentials.service";
import { bmPartsAdapter } from "@/src/services/suppliers/bm-parts.adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QA_KEY = "ITyW9EktUxG4SGmroCNZDGY0_nXMOaonGphUJNh7yqM";
const STAGE_PREFIX = "bmstage.v1.";

function decodeStage(value: string) {
  if (!value.startsWith(STAGE_PREFIX)) throw new Error("BM Parts stage payload missing");
  const [, , ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("BM Parts stage payload invalid");
  const key = createHash("sha256").update(`bm-parts-staging:${QA_KEY}`, "utf8").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8").trim();
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") return new NextResponse(null, { status: 404 });
  if (request.nextUrl.searchParams.get("nonce") !== QA_KEY) return new NextResponse(null, { status: 403 });

  const pool = getSqlPool();
  const staged = await pool.query(
    `SELECT "lastTestMessage" FROM public."IntegrationCredential" WHERE "provider"='BM_PARTS' LIMIT 1`,
  );
  const encoded = staged.rowCount ? String(staged.rows[0].lastTestMessage || "") : "";
  const apiKey = decodeStage(encoded);
  if (apiKey.length < 20 || apiKey.length > 512) throw new Error("BM Parts token shape invalid");

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
