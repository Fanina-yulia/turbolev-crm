import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";

export const LOCAL_AUTH_COOKIE = "turbolev_local_session";
const PASSWORD_PREFIX = "scrypt-v1";
const DEFAULT_SESSION_SECONDS = 12 * 60 * 60;
const REMEMBER_SESSION_SECONDS = 30 * 24 * 60 * 60;

export function normalizeCrmLogin(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validCrmLogin(value: string) {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
}

export function hashCrmPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${PASSWORD_PREFIX}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyCrmPassword(password: string, encoded: string | null | undefined) {
  if (!encoded) return false;
  const [prefix, saltText, hashText] = encoded.split("$");
  if (prefix !== PASSWORD_PREFIX || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sessionSignature(userId: string, expiresAt: number, passwordHash: string) {
  return createHmac("sha256", passwordHash).update(`${userId}.${expiresAt}`).digest("base64url");
}

export function createLocalSessionToken(userId: string, passwordHash: string, rememberMe = true) {
  const maxAge = rememberMe ? REMEMBER_SESSION_SECONDS : DEFAULT_SESSION_SECONDS;
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
  const signature = sessionSignature(userId, expiresAt, passwordHash);
  return { token: `${userId}.${expiresAt}.${signature}`, maxAge, expiresAt };
}

function cookieValue(headers: Headers, name: string) {
  const source = headers.get("cookie") || "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getLocalSessionUserId(headers: Headers) {
  const token = cookieValue(headers, LOCAL_AUTH_COOKIE);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresText, signature] = parts;
  const expiresAt = Number(expiresText);
  if (!userId || !signature || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;

  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      employeeProfile: { select: { isActive: true, crmPasswordHash: true } },
    },
  });
  const passwordHash = user?.employeeProfile?.crmPasswordHash || null;
  if (!user?.isActive || user.employeeProfile?.isActive === false || !passwordHash) return null;

  const expected = sessionSignature(userId, expiresAt, passwordHash);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return userId;
}
