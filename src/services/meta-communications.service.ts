import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";
import {
  ingestCommunicationInquiry,
  recordWebhookEvent,
  type CommunicationChannel,
} from "@/src/services/communications-server.service";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

const DEFAULT_GRAPH_VERSION = "v26.0";
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;

export type MetaDeliveryTarget = {
  channel: "FACEBOOK" | "INSTAGRAM";
  integrationAccountId?: string | null;
  externalParticipantId?: string | null;
  metadata?: unknown;
};

export type MetaSendResult = {
  providerMessageId: string | null;
  providerPayload: unknown;
};

function asRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function graphVersion() {
  const configured = process.env.META_GRAPH_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_GRAPH_VERSION;
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyMetaWebhookSignature(rawBody: string, signature: string | null) {
  const config = await getIntegrationCredential("META").catch(() => null);
  const appSecret = config?.appSecret || process.env.META_APP_SECRET || "";
  if (!appSecret) return false;
  if (!signature) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return secureEqual(signature, expected);
}

export async function verifyMetaWebhookToken(token: string) {
  const config = await getIntegrationCredential("META").catch(() => null);
  const expected = config?.verifyToken || process.env.META_WEBHOOK_VERIFY_TOKEN || "";
  return Boolean(expected && token && secureEqual(token, expected));
}

function channelFromObject(object: string): "FACEBOOK" | "INSTAGRAM" {
  return object.toLowerCase().includes("instagram") ? "INSTAGRAM" : "FACEBOOK";
}

function messageText(message: JsonObject) {
  const text = asString(message.text);
  const attachments = asArray(message.attachments)
    .map(asRecord)
    .filter((item): item is JsonObject => Boolean(item))
    .map((item) => {
      const type = asString(item.type) || "file";
      const payload = asRecord(item.payload);
      const url = asString(payload?.url);
      return { type, url };
    });

  if (text) return { text, attachments };
  if (attachments.length) {
    return {
      text: attachments.map((item) => item.url ? `📎 ${item.type}: ${item.url}` : `📎 ${item.type}`).join("\n"),
      attachments,
    };
  }
  return { text: "Нове повідомлення", attachments };
}

function eventDate(value: unknown) {
  const timestamp = asNumber(value);
  if (!timestamp) return new Date();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function upsertMetaIdentity(input: {
  channel: "FACEBOOK" | "INSTAGRAM";
  accountId: string;
  participantId: string;
  handle?: string | null;
  displayName?: string | null;
  metadata?: unknown;
}) {
  const pool = getSqlPool();
  const provider = `META:${input.channel}`;
  await pool.query(
    `INSERT INTO "ExternalContactIdentity" ("id","provider","channel","externalUserId","handle","displayName","metadata")
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT ("provider","externalUserId") DO UPDATE SET
       "handle"=COALESCE(EXCLUDED."handle","ExternalContactIdentity"."handle"),
       "displayName"=COALESCE(EXCLUDED."displayName","ExternalContactIdentity"."displayName"),
       "metadata"=EXCLUDED."metadata",
       "updatedAt"=CURRENT_TIMESTAMP`,
    [
      `ext_${randomUUID().replace(/-/g, "")}`,
      provider,
      input.channel,
      input.participantId,
      input.handle || null,
      input.displayName || null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  await pool.query(
    `INSERT INTO "CommunicationAccount" ("id","provider","channel","externalAccountId","metadata")
     VALUES ($1,'META',$2,$3,$4::jsonb)
     ON CONFLICT ("provider","externalAccountId") DO UPDATE SET
       "channel"=EXCLUDED."channel",
       "metadata"=EXCLUDED."metadata",
       "isActive"=TRUE,
       "updatedAt"=CURRENT_TIMESTAMP`,
    [
      `acct_${randomUUID().replace(/-/g, "")}`,
      input.channel,
      input.accountId,
      JSON.stringify({ lastWebhookAt: new Date().toISOString() }),
    ],
  );
}

async function updateDeliveryStatus(messageIds: string[], status: "SENT" | "DELIVERED" | "READ") {
  if (!messageIds.length) return;
  const pool = getSqlPool();
  await pool.query(
    `UPDATE "CommunicationMessage"
     SET "deliveryStatus"=$2,
         "metadata"=COALESCE("metadata", '{}'::jsonb) || $3::jsonb,
         "providerPayload"=COALESCE("providerPayload", '{}'::jsonb) || $4::jsonb
     WHERE ("providerMessageId" = ANY($1::text[]) OR "externalId" = ANY($1::text[]))
       AND "direction"='OUT'`,
    [
      messageIds,
      status,
      JSON.stringify({ delivery: status }),
      JSON.stringify({ metaStatusAt: new Date().toISOString(), deliveryStatus: status }),
    ],
  );
}

async function updateReadStatus(channel: CommunicationChannel, threadExternalId: string, watermark: number) {
  const pool = getSqlPool();
  const inquiry = await pool.query<{ id: string }>(
    `SELECT "id" FROM "CommunicationInquiry" WHERE "channel"=$1 AND "externalId"=$2 LIMIT 1`,
    [channel, threadExternalId],
  );
  const inquiryId = inquiry.rows[0]?.id;
  if (!inquiryId) return;
  await pool.query(
    `UPDATE "CommunicationMessage"
     SET "deliveryStatus"='READ',
         "metadata"=COALESCE("metadata", '{}'::jsonb) || $3::jsonb,
         "providerPayload"=COALESCE("providerPayload", '{}'::jsonb) || $4::jsonb
     WHERE "inquiryId"=$1 AND "direction"='OUT' AND "sentAt" <= $2`,
    [
      inquiryId,
      new Date(watermark),
      JSON.stringify({ delivery: "READ" }),
      JSON.stringify({ metaReadAt: new Date(watermark).toISOString(), deliveryStatus: "READ" }),
    ],
  );
}

export async function processMetaWebhook(rawBody: string) {
  const parsed = JSON.parse(rawBody) as unknown;
  const body = asRecord(parsed);
  if (!body) throw new Error("Meta webhook body must be an object");

  const object = asString(body.object) || "page";
  const channel = channelFromObject(object);
  let accepted = 0;
  let duplicates = 0;

  for (const rawEntry of asArray(body.entry)) {
    const entry = asRecord(rawEntry);
    if (!entry) continue;
    const entryAccountId = asString(entry.id);

    for (const rawEvent of asArray(entry.messaging)) {
      const event = asRecord(rawEvent);
      if (!event) continue;
      const sender = asRecord(event.sender);
      const recipient = asRecord(event.recipient);
      const participantId = asString(sender?.id);
      const accountId = asString(recipient?.id) || entryAccountId;
      if (!participantId || !accountId) continue;

      const threadExternalId = `meta:${accountId}:${participantId}`;
      const message = asRecord(event.message);
      const delivery = asRecord(event.delivery);
      const read = asRecord(event.read);
      const postback = asRecord(event.postback);

      if (message) {
        const mid = asString(message.mid) || `meta-${randomUUID()}`;
        const recorded = await recordWebhookEvent(channel, mid, "message", event);
        if (!recorded.inserted) duplicates += 1;

        // Reprocessing a duplicate event is intentional: CommunicationInquiry/Message have
        // provider-level unique keys, so retries are idempotent and cannot lose a message
        // when a previous attempt recorded WebhookEvent but failed before ingestion completed.
        if (message.is_echo === true) {
          await updateDeliveryStatus([mid], "SENT");
          accepted += 1;
          continue;
        }

        const receivedAt = eventDate(event.timestamp);
        const content = messageText(message);
        const metadata = {
          provider: "META",
          object,
          accountId,
          participantId,
          threadExternalId,
          attachments: content.attachments,
          quickReply: asRecord(message.quick_reply),
          raw: event,
        };
        const inquiry = await ingestCommunicationInquiry({
          channel,
          externalId: threadExternalId,
          externalMessageId: mid,
          subject: channel === "INSTAGRAM" ? "Instagram Direct" : "Facebook Messenger",
          preview: content.text,
          message: content.text,
          receivedAt,
          sourceDetail: channel === "INSTAGRAM" ? "Instagram Direct" : "Facebook Messenger",
          metadata,
        });

        const replyAllowedUntil = new Date(receivedAt.getTime() + REPLY_WINDOW_MS);
        const pool = getSqlPool();
        await pool.query(
          `UPDATE "CommunicationInquiry"
           SET "integrationAccountId"=$2,
               "externalThreadId"=$3,
               "externalParticipantId"=$4,
               "lastInboundAt"=$5,
               "replyAllowedUntil"=$6,
               "lastSyncedAt"=CURRENT_TIMESTAMP,
               "metadata"=COALESCE("metadata", '{}'::jsonb) || $7::jsonb,
               "updatedAt"=CURRENT_TIMESTAMP
           WHERE "id"=$1`,
          [inquiry.id, accountId, threadExternalId, participantId, receivedAt, replyAllowedUntil, JSON.stringify(metadata)],
        );
        await upsertMetaIdentity({ channel, accountId, participantId, metadata });
        accepted += 1;
        continue;
      }

      if (postback) {
        const payload = asString(postback.payload) || asString(postback.title) || "Postback";
        const eventId = `postback:${accountId}:${participantId}:${asNumber(event.timestamp) || Date.now()}:${payload}`;
        const recorded = await recordWebhookEvent(channel, eventId, "postback", event);
        if (!recorded.inserted) duplicates += 1;
        const receivedAt = eventDate(event.timestamp);
        const inquiry = await ingestCommunicationInquiry({
          channel,
          externalId: threadExternalId,
          externalMessageId: eventId,
          subject: channel === "INSTAGRAM" ? "Instagram Direct" : "Facebook Messenger",
          preview: payload,
          message: payload,
          receivedAt,
          sourceDetail: "Meta postback",
          metadata: { provider: "META", object, accountId, participantId, threadExternalId, raw: event },
        });
        const pool = getSqlPool();
        await pool.query(
          `UPDATE "CommunicationInquiry" SET "integrationAccountId"=$2,"externalThreadId"=$3,"externalParticipantId"=$4,"lastInboundAt"=$5,"replyAllowedUntil"=$6,"lastSyncedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
          [inquiry.id, accountId, threadExternalId, participantId, receivedAt, new Date(receivedAt.getTime() + REPLY_WINDOW_MS)],
        );
        accepted += 1;
        continue;
      }

      if (delivery) {
        const mids = asArray(delivery.mids).map(asString).filter((item): item is string => Boolean(item));
        const eventId = mids.length ? `delivery:${mids.join(",")}` : `delivery:${accountId}:${participantId}:${asNumber(delivery.watermark) || Date.now()}`;
        const recorded = await recordWebhookEvent(channel, eventId, "delivery", event);
        if (!recorded.inserted) duplicates += 1;
        await updateDeliveryStatus(mids, "DELIVERED");
        accepted += 1;
        continue;
      }

      if (read) {
        const readMid = asString(read.mid);
        const watermark = asNumber(read.watermark) || asNumber(event.timestamp) || Date.now();
        const eventId = readMid
          ? `read:${readMid}`
          : `read:${accountId}:${participantId}:${watermark}`;
        const recorded = await recordWebhookEvent(channel, eventId, "read", event);
        if (!recorded.inserted) duplicates += 1;
        if (readMid) await updateDeliveryStatus([readMid], "READ");
        else await updateReadStatus(channel, threadExternalId, watermark);
        accepted += 1;
      }
    }
  }

  return { ok: true, channel, accepted, duplicates };
}

function targetFields(target: MetaDeliveryTarget) {
  const metadata = asRecord(target.metadata);
  const accountId = target.integrationAccountId || asString(metadata?.accountId);
  const participantId = target.externalParticipantId || asString(metadata?.participantId);
  return { accountId, participantId };
}

function apiError(payload: unknown, status: number) {
  const body = asRecord(payload);
  const error = asRecord(body?.error);
  const message = asString(error?.message) || asString(body?.message) || `Meta API HTTP ${status}`;
  const code = error?.code !== undefined ? String(error.code) : `HTTP_${status}`;
  return Object.assign(new Error(message), { code });
}

export async function sendMetaTextMessage(target: MetaDeliveryTarget, text: string): Promise<MetaSendResult> {
  const config = await getIntegrationCredential("META");
  const token = config?.pageAccessToken || "";
  if (!token) throw Object.assign(new Error("Meta Page access token не налаштований"), { code: "META_NOT_CONFIGURED" });

  const { accountId, participantId } = targetFields(target);
  if (!accountId || !participantId) {
    throw Object.assign(new Error("У звернення немає Meta account/participant ID. Дочекайтеся нового webhook-повідомлення після підключення Meta."), { code: "META_TARGET_MISSING" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(accountId)}/messages`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        recipient: { id: participantId },
        ...(target.channel === "FACEBOOK" ? { messaging_type: "RESPONSE" } : {}),
        message: { text },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw apiError(payload, response.status);
    const body = asRecord(payload);
    return {
      providerMessageId: asString(body?.message_id),
      providerPayload: payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function testMetaConnection() {
  const config = await getIntegrationCredential("META");
  const token = config?.pageAccessToken || "";
  if (!token) return { ok: false, message: "Meta access token не налаштований." };

  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/me?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, message: `Meta Graph API відповів HTTP ${response.status}.`, payload };
  const body = asRecord(payload);
  return {
    ok: true,
    message: "Meta access token працює.",
    pageId: asString(body?.id),
    pageName: asString(body?.name),
    instagramBusinessAccount: asRecord(body?.instagram_business_account),
  };
}
