import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateCameraIngestToken() {
  return randomBytes(32).toString("base64url");
}

export function hashCameraIngestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyCameraIngestToken(token: string, expectedHash: string | null | undefined) {
  if (!token || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(hashCameraIngestToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
