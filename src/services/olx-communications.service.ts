import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";
import {
  getIntegrationCredential,
  saveIntegrationCredential,
} from "@/src/services/integration-credentials.service";

const OLX_ORIGIN = "https://www.olx.ua";
const OLX_PARTNER_BASE = `${OLX_ORIGIN}/api/partner`;
const OLX_TOKEN_URL = `${OLX_ORIGIN}/api/open/oauth/token`;
const OLX_AUTHORIZE_URL = `${OLX_ORIGIN}/oauth/authorize`;
const OLX_SCOPE = "v2 read write";

type JsonObject = Record<string, unknown>;

type OlxThread = {
  id: number;
  advert_id?: number;
  interlocutor_id?: number;
  total_count?: number;
  unread_count?: number;
  created_at?: string;
  is_favourite?: boolean;
};

type OlxMessage = {
  id: number;
  thread_id?: number;
  created_at?: string;
  type?: "sent" | "received" | string;
  text?: string;
  is_read?: boolean;
  attachments?: unknown;
};

export type OlxDeliveryTarget = {
  externalId?: string | null;
  externalThreadId?: string | null;
};

function asRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return Array.isArray(record?.data) ? record.data : [];
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function stateSecret() {
  const source = process.env.INTEGRATIONS_MASTER_KEY?.trim() || process.env.DATABASE_URL?.trim();
  if (!source) throw new Error("Server secret is unavailable for OLX OAuth state");
  return source;
}

function signState(payload: string) {
  return createHmac("sha256", stateSecret()).update(payload, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createOlxOAuthState() {
  const payload = Buffer.from(JSON.stringify({
    ts: Date.now(),
    nonce: randomBytes(18).toString("base64url"),
  }), "utf8").toString("base64url");
  return `${payload}.${signState(payload)}`;
}

export function verifyOlxOAuthState(state: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !safeEqual(signature, signState(payload))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { ts?: number };
    return typeof parsed.ts === "number" && Date.now() - parsed.ts < 10 * 60 * 1000 && parsed.ts <= Date.now() + 60_000;
  } catch {
    return false;
  }
}

export async function buildOlxAuthorizationUrl(callbackUrl: string) {
  const config = await getIntegrationCredential("OLX");
  const clientId = config?.clientId || "";
  if (!clientId) throw new Error("OLX Client ID не налаштований");
  const url = new URL(OLX_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OLX_SCOPE);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", createOlxOAuthState());
  return url.toString();
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function apiError(payload: unknown, status: number) {
  const body = asRecord(payload);
  const error = asRecord(body?.error);
  const message = asString(error?.detail)
    || asString(error?.message)
    || asString(body?.error_description)
    || asString(body?.message)
    || `OLX API HTTP ${status}`;
  const code = asString(body?.error) || asString(error?.status) || `HTTP_${status}`;
  return Object.assign(new Error(message), { code: String(code) });
}

async function requestToken(values: Record<string, string>) {
  const body = new URLSearchParams(values);
  const response = await fetchWithTimeout(OLX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(payload, response.status);
  const data = asRecord(payload);
  const accessToken = asString(data?.access_token);
  const refreshToken = asString(data?.refresh_token);
  if (!accessToken) throw new Error("OLX не повернув access_token");
  return {
    accessToken,
    refreshToken,
    expiresIn: asNumber(data?.expires_in),
    scope: asString(data?.scope),
    raw: payload,
  };
}

export async function exchangeOlxAuthorizationCode(code: string, callbackUrl: string) {
  const config = await getIntegrationCredential("OLX");
  const clientId = config?.clientId || "";
  const clientSecret = config?.clientSecret || "";
  if (!clientId || !clientSecret) throw new Error("OLX Client ID / Client secret не налаштовані");
  const tokens = await requestToken({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    scope: OLX_SCOPE,
    redirect_uri: callbackUrl,
  });
  await saveIntegrationCredential("OLX", {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || config?.refreshToken || "",
  });
  return tokens;
}

export async function refreshOlxTokens() {
  const config = await getIntegrationCredential("OLX");
  const clientId = config?.clientId || "";
  const clientSecret = config?.clientSecret || "";
  const refreshToken = config?.refreshToken || "";
  if (!clientId || !clientSecret || !refreshToken) {
    throw Object.assign(new Error("OLX refresh token відсутній. Потрібно перепідключити OLX."), { code: "OLX_REAUTH_REQUIRED" });
  }
  const tokens = await requestToken({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  await saveIntegrationCredential("OLX", {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || refreshToken,
  });
  return tokens.accessToken;
}

async function partnerRequest(path: string, init?: RequestInit, retryAuth = true) {
  const config = await getIntegrationCredential("OLX");
  let token = config?.accessToken || "";
  if (!token && config?.refreshToken) token = await refreshOlxTokens();
  if (!token) throw Object.assign(new Error("OLX не авторизований. Підключіть акаунт через OAuth."), { code: "OLX_NOT_AUTHORIZED" });

  const execute = (accessToken: string) => fetchWithTimeout(`${OLX_PARTNER_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Accept-Language": "uk",
      Version: "2.0",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });

  let response = await execute(token);
  if (response.status === 401 && retryAuth) {
    token = await refreshOlxTokens();
    response = await execute(token);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      throw Object.assign(apiError(payload, response.status), { code: "OLX_RATE_LIMITED", retryAfter });
    }
    throw apiError(payload, response.status);
  }
  return payload;
}

export async function testOlxConnection() {
  try {
    const payload = await partnerRequest("/users/me");
    const user = asRecord(payload);
    return {
      ok: true,
      message: "З'єднання з OLX працює.",
      userId: asNumber(user?.id),
      name: asString(user?.name),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Не вдалося підключитися до OLX.",
      code: typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : null,
    };
  }
}

function parseOlxDate(value: unknown) {
  const raw = asString(value);
  if (!raw) return new Date();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function threadSubject(thread: OlxThread) {
  return thread.advert_id ? `OLX · Оголошення #${thread.advert_id}` : "OLX повідомлення";
}

async function upsertOlxThread(thread: OlxThread, messages: OlxMessage[]) {
  const pool = getSqlPool();
  const client = await pool.connect();
  const latest = [...messages].sort((a, b) => parseOlxDate(a.created_at).getTime() - parseOlxDate(b.created_at).getTime()).at(-1);
  const latestAt = latest ? parseOlxDate(latest.created_at) : parseOlxDate(thread.created_at);
  const preview = asString(latest?.text) || threadSubject(thread);
  const externalThreadId = String(thread.id);
  const interlocutorId = thread.interlocutor_id ? String(thread.interlocutor_id) : null;
  const metadata = {
    provider: "OLX",
    threadId: thread.id,
    advertId: thread.advert_id ?? null,
    interlocutorId: thread.interlocutor_id ?? null,
    totalCount: thread.total_count ?? messages.length,
    unreadCount: thread.unread_count ?? 0,
    isFavourite: thread.is_favourite ?? false,
  };

  try {
    await client.query("BEGIN");
    const inquiryResult = await client.query<{ id: string }>(
      `INSERT INTO "CommunicationInquiry"
       ("id","externalId","channel","state","handle","subject","preview","unread","answered","receivedAt","sourceDetail","metadata","integrationAccountId","externalThreadId","externalParticipantId","lastInboundAt","lastOutboundAt","lastSyncedAt")
       VALUES ($1,$2,'OLX','NEW',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NULL,$2,$11,$12,$13,CURRENT_TIMESTAMP)
       ON CONFLICT ("channel","externalId") DO UPDATE SET
         "handle"=COALESCE(EXCLUDED."handle","CommunicationInquiry"."handle"),
         "subject"=EXCLUDED."subject",
         "preview"=EXCLUDED."preview",
         "unread"=EXCLUDED."unread",
         "answered"=EXCLUDED."answered",
         "receivedAt"=GREATEST("CommunicationInquiry"."receivedAt",EXCLUDED."receivedAt"),
         "sourceDetail"=EXCLUDED."sourceDetail",
         "metadata"=EXCLUDED."metadata",
         "externalThreadId"=EXCLUDED."externalThreadId",
         "externalParticipantId"=EXCLUDED."externalParticipantId",
         "lastInboundAt"=GREATEST("CommunicationInquiry"."lastInboundAt",EXCLUDED."lastInboundAt"),
         "lastOutboundAt"=GREATEST("CommunicationInquiry"."lastOutboundAt",EXCLUDED."lastOutboundAt"),
         "lastSyncedAt"=CURRENT_TIMESTAMP,
         "updatedAt"=CURRENT_TIMESTAMP
       RETURNING "id"`,
      [
        makeId("inq"),
        externalThreadId,
        interlocutorId ? `olx:${interlocutorId}` : null,
        threadSubject(thread),
        preview,
        (thread.unread_count || 0) > 0,
        latest?.type === "sent",
        latestAt,
        thread.advert_id ? `OLX advert #${thread.advert_id}` : "OLX",
        JSON.stringify(metadata),
        interlocutorId,
        messages.filter((message) => message.type === "received").map((message) => parseOlxDate(message.created_at)).sort((a, b) => b.getTime() - a.getTime())[0] || null,
        messages.filter((message) => message.type === "sent").map((message) => parseOlxDate(message.created_at)).sort((a, b) => b.getTime() - a.getTime())[0] || null,
      ],
    );
    const inquiryId = inquiryResult.rows[0].id;

    for (const message of messages) {
      const externalMessageId = String(message.id);
      const direction = message.type === "sent" ? "OUT" : "IN";
      const deliveryStatus = direction === "OUT" ? (message.is_read ? "READ" : "SENT") : "RECEIVED";
      const text = asString(message.text) || "📎 OLX вкладення";
      await client.query(
        `INSERT INTO "CommunicationMessage"
         ("id","inquiryId","externalId","direction","text","sentAt","metadata","providerMessageId","deliveryStatus","attachments","providerPayload")
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$3,$8,$9::jsonb,$10::jsonb)
         ON CONFLICT ("inquiryId","externalId") DO UPDATE SET
           "text"=EXCLUDED."text",
           "deliveryStatus"=EXCLUDED."deliveryStatus",
           "attachments"=EXCLUDED."attachments",
           "providerPayload"=EXCLUDED."providerPayload"`,
        [
          makeId("msg"),
          inquiryId,
          externalMessageId,
          direction,
          text,
          parseOlxDate(message.created_at),
          JSON.stringify({ provider: "OLX", isRead: message.is_read ?? false }),
          deliveryStatus,
          JSON.stringify(message.attachments ?? []),
          JSON.stringify(message),
        ],
      );
    }

    if (interlocutorId) {
      await client.query(
        `INSERT INTO "ExternalContactIdentity" ("id","provider","channel","externalUserId","handle","metadata")
         VALUES ($1,'OLX','OLX',$2,$3,$4::jsonb)
         ON CONFLICT ("provider","externalUserId") DO UPDATE SET
           "handle"=EXCLUDED."handle",
           "metadata"=EXCLUDED."metadata",
           "updatedAt"=CURRENT_TIMESTAMP`,
        [makeId("ext"), interlocutorId, `olx:${interlocutorId}`, JSON.stringify(metadata)],
      );
    }

    await client.query("COMMIT");
    return { inquiryId, messages: messages.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setSyncState(status: string, error?: string | null, metadata?: unknown) {
  const pool = getSqlPool();
  await pool.query(
    `INSERT INTO "CommunicationSyncState" ("provider","lastSyncedAt","lastSuccessAt","status","error","metadata")
     VALUES ('OLX',CURRENT_TIMESTAMP,CASE WHEN $1='READY' THEN CURRENT_TIMESTAMP ELSE NULL END,$1,$2,$3::jsonb)
     ON CONFLICT ("provider") DO UPDATE SET
       "lastSyncedAt"=CURRENT_TIMESTAMP,
       "lastSuccessAt"=CASE WHEN EXCLUDED."status"='READY' THEN CURRENT_TIMESTAMP ELSE "CommunicationSyncState"."lastSuccessAt" END,
       "status"=EXCLUDED."status",
       "error"=EXCLUDED."error",
       "metadata"=EXCLUDED."metadata",
       "updatedAt"=CURRENT_TIMESTAMP`,
    [status, error || null, JSON.stringify(metadata ?? {})],
  );
}

export async function syncOlxInbox() {
  await setSyncState("SYNCING").catch(() => undefined);
  try {
    const mePayload = await partnerRequest("/users/me");
    const me = asRecord(mePayload);
    const accountId = me?.id !== undefined ? String(me.id) : null;
    if (accountId) {
      const pool = getSqlPool();
      await pool.query(
        `INSERT INTO "CommunicationAccount" ("id","provider","channel","externalAccountId","displayName","metadata")
         VALUES ($1,'OLX','OLX',$2,$3,$4::jsonb)
         ON CONFLICT ("provider","externalAccountId") DO UPDATE SET
           "displayName"=COALESCE(EXCLUDED."displayName","CommunicationAccount"."displayName"),
           "metadata"=EXCLUDED."metadata",
           "isActive"=TRUE,
           "updatedAt"=CURRENT_TIMESTAMP`,
        [makeId("acct"), accountId, asString(me?.name), JSON.stringify(mePayload ?? {})],
      );
    }

    const threadsPayload = await partnerRequest("/threads?offset=0&limit=100");
    const threads = asArray(threadsPayload)
      .map(asRecord)
      .filter((item): item is JsonObject => Boolean(item))
      .map((item) => ({
        id: asNumber(item.id) || 0,
        advert_id: asNumber(item.advert_id) || undefined,
        interlocutor_id: asNumber(item.interlocutor_id) || undefined,
        total_count: asNumber(item.total_count) || undefined,
        unread_count: asNumber(item.unread_count) || 0,
        created_at: asString(item.created_at) || undefined,
        is_favourite: item.is_favourite === true,
      }))
      .filter((thread) => thread.id > 0);

    let messageCount = 0;
    for (const thread of threads) {
      const messagesPayload = await partnerRequest(`/threads/${thread.id}/messages`);
      const messages = asArray(messagesPayload)
        .map(asRecord)
        .filter((item): item is JsonObject => Boolean(item))
        .map((item) => ({
          id: asNumber(item.id) || 0,
          thread_id: asNumber(item.thread_id) || thread.id,
          created_at: asString(item.created_at) || undefined,
          type: asString(item.type) || undefined,
          text: asString(item.text) || undefined,
          is_read: item.is_read === true,
          attachments: item.attachments,
        }))
        .filter((message) => message.id > 0);
      await upsertOlxThread(thread, messages);
      messageCount += messages.length;
    }

    const result = { ok: true, threads: threads.length, messages: messageCount, accountId };
    await setSyncState("READY", null, result);
    return result;
  } catch (error) {
    await setSyncState("ERROR", error instanceof Error ? error.message : "OLX sync failed").catch(() => undefined);
    throw error;
  }
}

export async function sendOlxTextMessage(target: OlxDeliveryTarget, text: string) {
  const threadId = target.externalThreadId || target.externalId;
  if (!threadId || !/^\d+$/.test(threadId)) {
    throw Object.assign(new Error("У звернення немає OLX thread ID. Запустіть синхронізацію OLX."), { code: "OLX_THREAD_MISSING" });
  }
  const payload = await partnerRequest(`/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  const body = asRecord(payload);
  return {
    providerMessageId: body?.id !== undefined ? String(body.id) : null,
    providerPayload: payload,
  };
}

export async function markOlxThreadRead(target: OlxDeliveryTarget) {
  const threadId = target.externalThreadId || target.externalId;
  if (!threadId || !/^\d+$/.test(threadId)) return false;
  await partnerRequest(`/threads/${threadId}/commands`, {
    method: "POST",
    body: JSON.stringify({ command: "mark-as-read" }),
  });
  return true;
}
