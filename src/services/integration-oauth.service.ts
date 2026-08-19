import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  getIntegrationCredential,
  saveIntegrationCredential,
  type IntegrationProvider,
} from "@/src/services/integration-credentials.service";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v26.0";
const META_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "leads_retrieval",
].join(",");
const TIKTOK_SCOPES = "user.info.basic";

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function stateSecret() {
  const source = process.env.INTEGRATIONS_MASTER_KEY?.trim() || process.env.DATABASE_URL?.trim();
  if (!source) throw new Error("Server secret is unavailable for OAuth state");
  return source;
}
function stateSignature(payload: string) {
  return createHmac("sha256", stateSecret()).update(payload, "utf8").digest("base64url");
}
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createIntegrationOAuthState(provider: "META" | "TIKTOK") {
  const payload = Buffer.from(JSON.stringify({
    provider,
    ts: Date.now(),
    nonce: randomBytes(20).toString("base64url"),
  }), "utf8").toString("base64url");
  return `${payload}.${stateSignature(payload)}`;
}

export function verifyIntegrationOAuthState(state: string, provider: "META" | "TIKTOK") {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !safeEqual(signature, stateSignature(payload))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { provider?: string; ts?: number };
    return parsed.provider === provider && typeof parsed.ts === "number" && parsed.ts <= Date.now() + 60_000 && Date.now() - parsed.ts < 10 * 60 * 1000;
  } catch { return false; }
}

async function jsonFetch(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const body = record(payload); const error = record(body?.error);
      throw new Error(text(error?.message) || text(body?.message) || `Provider HTTP ${response.status}` || "Provider request failed");
    }
    return payload;
  } finally { clearTimeout(timer); }
}

export async function buildMetaAuthorizationUrl(callbackUrl: string) {
  const config = await getIntegrationCredential("META");
  if (!config?.appId || !config?.appSecret) throw new Error("Спочатку збережіть Meta App ID та App Secret");
  const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", createIntegrationOAuthState("META"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES);
  return url.toString();
}

export async function exchangeMetaAuthorizationCode(code: string, callbackUrl: string) {
  const config = await getIntegrationCredential("META");
  if (!config?.appId || !config?.appSecret) throw new Error("Meta App credentials відсутні");

  const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", config.appId);
  tokenUrl.searchParams.set("client_secret", config.appSecret);
  tokenUrl.searchParams.set("redirect_uri", callbackUrl);
  tokenUrl.searchParams.set("code", code);
  const tokenPayload = record(await jsonFetch(tokenUrl.toString())) || {};
  const userAccessToken = text(tokenPayload.access_token);
  if (!userAccessToken) throw new Error("Meta не повернула access token");

  const accountsUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts`);
  accountsUrl.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account");
  accountsUrl.searchParams.set("access_token", userAccessToken);
  const accountsPayload = record(await jsonFetch(accountsUrl.toString())) || {};
  const pages = Array.isArray(accountsPayload.data) ? accountsPayload.data.map(record).filter(Boolean) as JsonObject[] : [];
  const page = pages[0] || null;
  const pageId = text(page?.id);
  const pageName = text(page?.name);
  const pageAccessToken = text(page?.access_token);
  const instagram = record(page?.instagram_business_account);
  const instagramAccountId = text(instagram?.id);
  let instagramAccountName = "";

  if (instagramAccountId && pageAccessToken) {
    const igUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(instagramAccountId)}`);
    igUrl.searchParams.set("fields", "id,username,name");
    igUrl.searchParams.set("access_token", pageAccessToken);
    const ig = record(await jsonFetch(igUrl.toString()).catch(() => ({})));
    instagramAccountName = text(ig?.username) || text(ig?.name) || "";
  }

  let subscriptionWarning = "";
  if (pageId && pageAccessToken) {
    const subscribeUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`);
    subscribeUrl.searchParams.set("subscribed_fields", "messages,messaging_postbacks,message_deliveries,message_reads,leadgen");
    subscribeUrl.searchParams.set("access_token", pageAccessToken);
    try { await jsonFetch(subscribeUrl.toString(), { method: "POST" }); }
    catch (error) { subscriptionWarning = error instanceof Error ? error.message : "Webhook subscription requires manual review"; }
  }

  const expiresIn = number(tokenPayload.expires_in);
  await saveIntegrationCredential("META", {
    userAccessToken,
    pageAccessToken: pageAccessToken || "",
    pageId: pageId || "",
    pageName: pageName || "",
    instagramAccountId: instagramAccountId || "",
    instagramAccountName,
    externalAccountId: pageId || instagramAccountId || "",
    externalAccountName: pageName || instagramAccountName || "Meta",
    scopes: META_SCOPES,
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : "",
  });

  return { pageId, pageName, instagramAccountId, instagramAccountName, subscriptionWarning, pageCount: pages.length };
}

export async function buildTikTokAuthorizationUrl(callbackUrl: string) {
  const config = await getIntegrationCredential("TIKTOK");
  if (!config?.clientKey || !config?.clientSecret) throw new Error("Спочатку збережіть TikTok Client Key та Client Secret");
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TIKTOK_SCOPES);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", createIntegrationOAuthState("TIKTOK"));
  return url.toString();
}

export async function exchangeTikTokAuthorizationCode(code: string, callbackUrl: string) {
  const config = await getIntegrationCredential("TIKTOK");
  if (!config?.clientKey || !config?.clientSecret) throw new Error("TikTok credentials відсутні");
  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl,
  });
  const payload = record(await jsonFetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  })) || {};
  const accessToken = text(payload.access_token);
  if (!accessToken) throw new Error(text(payload.error_description) || "TikTok не повернув access token");
  const refreshToken = text(payload.refresh_token) || "";
  const openId = text(payload.open_id) || "";
  const expiresIn = number(payload.expires_in);
  const refreshExpiresIn = number(payload.refresh_expires_in);
  const scopes = text(payload.scope) || TIKTOK_SCOPES;

  let displayName = "";
  try {
    const info = record(await jsonFetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }));
    const data = record(info?.data); const user = record(data?.user);
    displayName = text(user?.display_name) || "";
  } catch { /* token is still valid even if profile scope/data is unavailable */ }

  await saveIntegrationCredential("TIKTOK", {
    accessToken,
    refreshToken,
    openId,
    externalAccountId: openId,
    externalAccountName: displayName || "TikTok",
    scopes,
    tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : "",
    refreshTokenExpiresAt: refreshExpiresIn ? new Date(Date.now() + refreshExpiresIn * 1000).toISOString() : "",
  });
  return { openId, displayName, scopes };
}

export async function testTikTokConnection() {
  const config = await getIntegrationCredential("TIKTOK");
  if (!config?.accessToken) return { ok: false, message: "TikTok app налаштований, але акаунт ще не авторизований." };
  try {
    const payload = record(await jsonFetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
      headers: { Authorization: `Bearer ${config.accessToken}`, Accept: "application/json" },
    }));
    const data = record(payload?.data); const user = record(data?.user);
    return { ok: true, message: `TikTok підключено${text(user?.display_name) ? `: ${text(user?.display_name)}` : ""}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "TikTok token недійсний." };
  }
}

export function isOAuthProvider(provider: IntegrationProvider) {
  return provider === "META" || provider === "TIKTOK" || provider === "OLX";
}
