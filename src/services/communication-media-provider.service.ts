import { getIntegrationCredential } from "@/src/services/integration-credentials.service";
import { refreshOlxTokens } from "@/src/services/olx-communications.service";

const DEFAULT_GRAPH_VERSION = "v26.0";
const OLX_PARTNER_BASE = "https://www.olx.ua/api/partner";

type JsonObject = Record<string, unknown>;

export type ProviderImageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  providerUrl: string;
};

type MetaTarget = {
  channel: "FACEBOOK" | "INSTAGRAM";
  integrationAccountId?: string | null;
  externalParticipantId?: string | null;
  metadata?: unknown;
};

type OlxTarget = {
  externalId?: string | null;
  externalThreadId?: string | null;
};

function asRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function graphVersion() {
  const configured = process.env.META_GRAPH_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_VERSION;
}

function metaTargetFields(target: MetaTarget) {
  const metadata = asRecord(target.metadata);
  return {
    accountId: target.integrationAccountId || asString(metadata?.accountId),
    participantId: target.externalParticipantId || asString(metadata?.participantId),
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function providerError(provider: string, payload: unknown, status: number) {
  const body = asRecord(payload);
  const nested = asRecord(body?.error);
  const message = asString(nested?.message)
    || asString(nested?.detail)
    || asString(body?.error_description)
    || asString(body?.message)
    || `${provider} API HTTP ${status}`;
  const code = nested?.code !== undefined
    ? String(nested.code)
    : asString(body?.error) || `HTTP_${status}`;
  return Object.assign(new Error(message), { code: String(code) });
}

export async function sendMetaImageMessage(target: MetaTarget, attachment: ProviderImageAttachment) {
  if (!attachment.type.startsWith("image/")) {
    throw Object.assign(new Error("Meta: зараз підтримується відправка зображень."), { code: "META_ATTACHMENT_TYPE_NOT_SUPPORTED" });
  }
  const config = await getIntegrationCredential("META");
  const token = config?.pageAccessToken || "";
  if (!token) throw Object.assign(new Error("Meta Page access token не налаштований"), { code: "META_NOT_CONFIGURED" });

  const { accountId, participantId } = metaTargetFields(target);
  if (!accountId || !participantId) {
    throw Object.assign(new Error("У звернення немає Meta account/participant ID."), { code: "META_TARGET_MISSING" });
  }

  const response = await fetchWithTimeout(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      recipient: { id: participantId },
      ...(target.channel === "FACEBOOK" ? { messaging_type: "RESPONSE" } : {}),
      message: {
        attachment: {
          type: "image",
          payload: { url: attachment.providerUrl },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError("Meta", payload, response.status);
  const body = asRecord(payload);
  return {
    providerMessageId: asString(body?.message_id),
    providerPayload: payload,
  };
}

async function olxRequestWithToken(path: string, body: unknown, accessToken: string) {
  return fetchWithTimeout(`${OLX_PARTNER_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: "2.0",
      "Accept-Language": "uk",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function sendOlxImageMessage(target: OlxTarget, text: string, attachments: ProviderImageAttachment[]) {
  const threadId = target.externalThreadId || target.externalId;
  if (!threadId || !/^\d+$/.test(threadId)) {
    throw Object.assign(new Error("У звернення немає OLX thread ID. Запустіть синхронізацію OLX."), { code: "OLX_THREAD_MISSING" });
  }
  const config = await getIntegrationCredential("OLX");
  let token = config?.accessToken || "";
  if (!token && config?.refreshToken) token = await refreshOlxTokens();
  if (!token) throw Object.assign(new Error("OLX не авторизований. Підключіть акаунт через OAuth."), { code: "OLX_NOT_AUTHORIZED" });

  const payloadBody = {
    text: text.trim() || attachments.map((item) => `📎 ${item.name}`).join(" "),
    attachments: attachments.map((item) => ({ url: item.providerUrl })),
  };

  let response = await olxRequestWithToken(`/threads/${threadId}/messages`, payloadBody, token);
  if (response.status === 401) {
    token = await refreshOlxTokens();
    response = await olxRequestWithToken(`/threads/${threadId}/messages`, payloadBody, token);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) {
      throw Object.assign(providerError("OLX", payload, response.status), { code: "OLX_RATE_LIMITED", retryAfter: response.headers.get("retry-after") });
    }
    throw providerError("OLX", payload, response.status);
  }
  const body = asRecord(payload);
  return {
    providerMessageId: body?.id !== undefined ? String(body.id) : null,
    providerPayload: payload,
  };
}
