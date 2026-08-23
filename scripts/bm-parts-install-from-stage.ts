import { createDecipheriv, createHash } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";
import { saveIntegrationCredential, recordIntegrationTest } from "@/src/services/integration-credentials.service";
import { bmPartsAdapter } from "@/src/services/suppliers/bm-parts.adapter";

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

let offerCount = 0;
let withPrice = 0;
let withStock = 0;
let searchOk = false;
if (connection.ok) {
  try {
    const offers = await bmPartsAdapter.search("W712/95", 5);
    offerCount = offers.length;
    withPrice = offers.filter((offer) => typeof offer.purchasePrice === "number" && Number.isFinite(offer.purchasePrice)).length;
    withStock = offers.filter((offer) => offer.available || offer.stock.length > 0).length;
    searchOk = true;
  } catch {
    searchOk = false;
  }
}

console.log(`[bm-parts-install] connection=${connection.ok ? "ok" : "failed"} state=${connection.state} search=${searchOk ? "ok" : "failed"} offers=${offerCount} price=${withPrice} stock=${withStock}`);
if (!connection.ok) process.exit(2);
