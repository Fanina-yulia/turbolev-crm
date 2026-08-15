import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const source = process.env.INTEGRATIONS_MASTER_KEY?.trim() || process.env.DATABASE_URL?.trim();
  if (!source) throw new Error("Server encryption key is unavailable");
  return createHash("sha256").update(`turbolev-camera-v1:${source}`, "utf8").digest();
}

export function encryptCameraPassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptCameraPassword(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Unsupported camera credential payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskCameraUid(uid: string) {
  const normalized = uid.trim().toUpperCase();
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 4)}${"•".repeat(Math.min(8, normalized.length - 8))}${normalized.slice(-4)}`;
}
