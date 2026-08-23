import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

// QA-only: report auth state without logging credential values or provider payloads.
function decryptPayload(value, source) {
  const [version, ivRaw, tagRaw, encryptedRaw] = String(value || "").split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Unsupported credential payload");
  const key = createHash("sha256").update(`turbolev-integrations-v1:${source}`, "utf8").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(decrypted);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const keySource = process.env.INTEGRATIONS_MASTER_KEY?.trim() || databaseUrl;
if (!databaseUrl || !keySource) throw new Error("[bm-parts-probe] database/encryption environment unavailable");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  const result = await pool.query(
    `SELECT "encryptedPayload" FROM public."IntegrationCredential" WHERE "provider"='BM_PARTS' LIMIT 1`,
  );
  if (!result.rowCount) {
    console.log("[bm-parts-probe] configured=false reason=credential-record-missing");
  } else {
    const values = decryptPayload(result.rows[0].encryptedPayload, keySource);
    const apiKey = typeof values.apiKey === "string" ? values.apiKey.trim() : "";
    const baseUrl = typeof values.baseUrl === "string" && values.baseUrl.trim()
      ? values.baseUrl.trim().replace(/\/$/, "")
      : "https://api.bm.parts";
    if (!apiKey) {
      console.log("[bm-parts-probe] configured=false reason=api-key-missing");
    } else {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch(`${baseUrl}/profile/me`, {
          headers: {
            Accept: "application/json",
            Authorization: apiKey,
            "User-Agent": "TurboLEV-CRM/0.4.0",
          },
          cache: "no-store",
          signal: controller.signal,
        });
        const remaining = response.headers.get("x-ratelimit-remaining") || "n/a";
        const limit = response.headers.get("x-ratelimit-limit") || "n/a";
        console.log(`[bm-parts-probe] configured=true http=${response.status} ok=${response.ok} rate=${remaining}/${limit}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  }
} finally {
  await pool.end();
}
