import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { getSqlPool } from "@/src/lib/sql";
import { sendMetaTextMessage } from "@/src/services/meta-communications.service";
import { markOlxThreadRead, sendOlxTextMessage } from "@/src/services/olx-communications.service";
import { sendTelegramTextMessage } from "@/src/services/telegram.service";
import {
  assertStoredCommunicationImages,
  attachStoredCommunicationImages,
  type CommunicationAttachmentRef,
} from "@/src/services/communication-attachments.service";
import { sendMetaImageMessage, sendOlxImageMessage } from "@/src/services/communication-media-provider.service";
import type { CommunicationChannel } from "@/src/services/communications-server.service";

type DeliveryInquiryRow = QueryResultRow & {
  id: string;
  channel: CommunicationChannel;
  externalId: string | null;
  integrationAccountId: string | null;
  externalThreadId: string | null;
  externalParticipantId: string | null;
  replyAllowedUntil: Date | null;
  metadata: unknown;
};

type DeliveryMessageRow = QueryResultRow & {
  id: string;
  inquiryId: string;
  direction: string;
  text: string;
  deliveryStatus: string | null;
  attachments: unknown;
};

type AttachmentInput = Partial<CommunicationAttachmentRef>;

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function isMetaChannel(channel: CommunicationChannel): channel is "FACEBOOK" | "INSTAGRAM" {
  return channel === "FACEBOOK" || channel === "INSTAGRAM";
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isTelegramInquiry(inquiry: DeliveryInquiryRow) {
  const metadata = metadataObject(inquiry.metadata);
  return inquiry.channel === "WEBSITE"
    && metadata.source === "TELEGRAM"
    && Boolean(inquiry.externalParticipantId || metadata.chatId);
}

function telegramChatId(inquiry: DeliveryInquiryRow) {
  const metadata = metadataObject(inquiry.metadata);
  const value = inquiry.externalParticipantId || (typeof metadata.chatId === "string" ? metadata.chatId : "");
  if (!value) throw Object.assign(new Error("Telegram chat ID відсутній."), { code: "TELEGRAM_CHAT_ID_MISSING" });
  return value;
}

function isLiveInquiry(inquiry: DeliveryInquiryRow) {
  return isMetaChannel(inquiry.channel) || inquiry.channel === "OLX" || isTelegramInquiry(inquiry);
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code !== undefined && code !== null) return String(code);
  }
  return "DELIVERY_FAILED";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не вдалося доставити повідомлення";
}

function normalizeAttachments(value: unknown): CommunicationAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const type = typeof item.type === "string" ? item.type.trim() : "";
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const providerUrl = typeof item.providerUrl === "string" ? item.providerUrl.trim() : "";
    if (!id || !name || !type || !size || !url || !providerUrl) {
      throw Object.assign(new Error("Некоректне вкладення."), { code: "ATTACHMENT_INVALID" });
    }
    return { id, name, type, size, url, providerUrl };
  });
}

function assertReplyWindow(inquiry: DeliveryInquiryRow) {
  if (isMetaChannel(inquiry.channel)
      && inquiry.replyAllowedUntil
      && inquiry.replyAllowedUntil.getTime() < Date.now()) {
    throw Object.assign(
      new Error("Стандартне вікно відповіді Meta завершилося. Потрібен дозволений Meta сценарій повторного контакту."),
      { code: "META_REPLY_WINDOW_EXPIRED" },
    );
  }
}

async function loadInquiry(id: string) {
  const pool = getSqlPool();
  const result = await pool.query<DeliveryInquiryRow>(
    `SELECT "id","channel","externalId","integrationAccountId","externalThreadId","externalParticipantId","replyAllowedUntil","metadata"
     FROM "CommunicationInquiry" WHERE "id"=$1 LIMIT 1`,
    [id],
  );
  const inquiry = result.rows[0];
  if (!inquiry) throw Object.assign(new Error("Inquiry not found"), { code: "INQUIRY_NOT_FOUND" });
  return inquiry;
}

async function deliverToProvider(inquiry: DeliveryInquiryRow, text: string, attachments: CommunicationAttachmentRef[]) {
  if (isTelegramInquiry(inquiry)) {
    if (attachments.length) {
      throw Object.assign(new Error("Вкладення Telegram будуть додані на наступному етапі. Зараз надішліть текст."), { code: "TELEGRAM_ATTACHMENT_NOT_SUPPORTED" });
    }
    return sendTelegramTextMessage({ chatId: telegramChatId(inquiry), text });
  }

  if (attachments.length) {
    if (inquiry.channel === "OLX") {
      return sendOlxImageMessage(
        { externalId: inquiry.externalId, externalThreadId: inquiry.externalThreadId },
        text,
        attachments,
      );
    }
    if (isMetaChannel(inquiry.channel)) {
      if (attachments.length !== 1) {
        throw Object.assign(new Error("Meta: одне медіа-повідомлення має містити одне зображення."), { code: "META_ATTACHMENT_LIMIT" });
      }
      return sendMetaImageMessage({
        channel: inquiry.channel,
        integrationAccountId: inquiry.integrationAccountId,
        externalParticipantId: inquiry.externalParticipantId,
        metadata: inquiry.metadata,
      }, attachments[0]);
    }
    throw Object.assign(new Error("Вкладення для цього каналу ще не підтримуються."), { code: "ATTACHMENT_CHANNEL_NOT_SUPPORTED" });
  }

  if (inquiry.channel === "OLX") {
    return sendOlxTextMessage(
      { externalId: inquiry.externalId, externalThreadId: inquiry.externalThreadId },
      text,
    );
  }
  if (isMetaChannel(inquiry.channel)) {
    return sendMetaTextMessage({
      channel: inquiry.channel,
      integrationAccountId: inquiry.integrationAccountId,
      externalParticipantId: inquiry.externalParticipantId,
      metadata: inquiry.metadata,
    }, text);
  }
  throw Object.assign(new Error("Unsupported live communication channel"), { code: "CHANNEL_NOT_SUPPORTED" });
}

async function markDeliveryFailed(messageId: string, error: unknown) {
  const pool = getSqlPool();
  await pool.query(
    `UPDATE "CommunicationMessage"
     SET "deliveryStatus"='FAILED',"errorCode"=$2,"errorMessage"=$3,
         "metadata"=COALESCE("metadata", '{}'::jsonb) || $4::jsonb
     WHERE "id"=$1`,
    [messageId, errorCode(error), errorMessage(error), JSON.stringify({ delivery: "FAILED" })],
  );
}

async function markDeliverySent(inquiryId: string, messageId: string, delivered: { providerMessageId: string | null; providerPayload: unknown }) {
  const pool = getSqlPool();
  await pool.query(
    `UPDATE "CommunicationMessage"
     SET "externalId"=COALESCE($2,"externalId"),
         "providerMessageId"=$2,
         "deliveryStatus"='SENT',
         "providerPayload"=$3::jsonb,
         "metadata"=COALESCE("metadata", '{}'::jsonb) || $4::jsonb,
         "errorCode"=NULL,
         "errorMessage"=NULL
     WHERE "id"=$1`,
    [messageId, delivered.providerMessageId, JSON.stringify(delivered.providerPayload ?? {}), JSON.stringify({ delivery: "SENT" })],
  );
  await pool.query(
    `UPDATE "CommunicationInquiry"
     SET "answered"=TRUE,"unread"=FALSE,"state"=CASE WHEN "state"='NEW' THEN 'IN_WORK' ELSE "state" END,
         "lastOutboundAt"=CURRENT_TIMESTAMP,"lastSyncedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1`,
    [inquiryId],
  );
  const message = await pool.query(`SELECT * FROM "CommunicationMessage" WHERE "id"=$1`, [messageId]);
  return { message: message.rows[0], delivery: "SENT" as const, providerMessageId: delivered.providerMessageId };
}

async function deliverExistingMessage(inquiry: DeliveryInquiryRow, messageId: string, text: string, attachments: CommunicationAttachmentRef[]) {
  assertReplyWindow(inquiry);
  try {
    const delivered = await deliverToProvider(inquiry, text, attachments);
    return await markDeliverySent(inquiry.id, messageId, delivered);
  } catch (error) {
    await markDeliveryFailed(messageId, error);
    throw error;
  }
}

export async function sendCommunicationReply(id: string, text: string, attachmentsInput: AttachmentInput[] = []) {
  const normalizedText = text.trim();
  if (!normalizedText) throw Object.assign(new Error("text is required"), { code: "TEXT_REQUIRED" });

  const pool = getSqlPool();
  const inquiry = await loadInquiry(id);
  assertReplyWindow(inquiry);
  const attachments = normalizeAttachments(attachmentsInput);
  await assertStoredCommunicationImages(id, attachments);

  const messageId = makeId("msg");
  const initialStatus = isLiveInquiry(inquiry) ? "PENDING" : "CRM_ONLY";
  const inserted = await pool.query(
    `INSERT INTO "CommunicationMessage"
     ("id","inquiryId","direction","text","sentAt","metadata","deliveryStatus","attachments")
     VALUES ($1,$2,'OUT',$3,CURRENT_TIMESTAMP,$4::jsonb,$5,$6::jsonb)
     RETURNING *`,
    [
      messageId,
      id,
      normalizedText,
      JSON.stringify({ delivery: initialStatus, attachments }),
      initialStatus,
      JSON.stringify(attachments),
    ],
  );
  await attachStoredCommunicationImages(messageId, id, attachments);

  if (!isLiveInquiry(inquiry)) {
    await pool.query(
      `UPDATE "CommunicationInquiry"
       SET "answered"=TRUE,"unread"=FALSE,"state"=CASE WHEN "state"='NEW' THEN 'IN_WORK' ELSE "state" END,
           "lastOutboundAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=$1`,
      [id],
    );
    return { message: inserted.rows[0], delivery: "CRM_ONLY" as const };
  }

  return deliverExistingMessage(inquiry, messageId, normalizedText, attachments);
}

export async function retryCommunicationMessage(inquiryId: string, messageId: string) {
  const pool = getSqlPool();
  const inquiry = await loadInquiry(inquiryId);
  if (!isLiveInquiry(inquiry)) {
    throw Object.assign(new Error("Повторна відправка доступна лише для Facebook, Instagram, OLX та Telegram."), { code: "RETRY_NOT_SUPPORTED" });
  }
  assertReplyWindow(inquiry);

  const claimed = await pool.query<DeliveryMessageRow>(
    `UPDATE "CommunicationMessage"
     SET "deliveryStatus"='PENDING',
         "errorCode"=NULL,
         "errorMessage"=NULL,
         "metadata"=COALESCE("metadata", '{}'::jsonb) || $3::jsonb
     WHERE "id"=$1 AND "inquiryId"=$2 AND "direction"='OUT' AND "deliveryStatus"='FAILED'
     RETURNING "id","inquiryId","direction","text","deliveryStatus","attachments"`,
    [messageId, inquiryId, JSON.stringify({ delivery: "PENDING", retryRequestedAt: new Date().toISOString() })],
  );

  const message = claimed.rows[0];
  if (!message) {
    const existing = await pool.query<DeliveryMessageRow>(
      `SELECT "id","inquiryId","direction","text","deliveryStatus","attachments"
       FROM "CommunicationMessage" WHERE "id"=$1 AND "inquiryId"=$2 LIMIT 1`,
      [messageId, inquiryId],
    );
    const row = existing.rows[0];
    if (!row) throw Object.assign(new Error("Повідомлення не знайдено"), { code: "MESSAGE_NOT_FOUND" });
    if (row.direction !== "OUT") throw Object.assign(new Error("Вхідне повідомлення не можна відправити повторно"), { code: "MESSAGE_NOT_RETRYABLE" });
    if (row.deliveryStatus === "PENDING") throw Object.assign(new Error("Повідомлення вже повторно надсилається"), { code: "MESSAGE_RETRY_IN_PROGRESS" });
    throw Object.assign(new Error("Повторна відправка доступна лише для повідомлень зі статусом FAILED"), { code: "MESSAGE_NOT_FAILED" });
  }

  const attachments = normalizeAttachments(message.attachments);
  await assertStoredCommunicationImages(inquiryId, attachments);
  return deliverExistingMessage(inquiry, messageId, message.text.trim(), attachments);
}

export async function markCommunicationRead(id: string) {
  const inquiry = await loadInquiry(id).catch(() => null);
  if (!inquiry) return false;

  if (inquiry.channel === "OLX") {
    return markOlxThreadRead({ externalId: inquiry.externalId, externalThreadId: inquiry.externalThreadId });
  }
  return true;
}
