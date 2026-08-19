import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { getSqlPool } from "@/src/lib/sql";
import { sendMetaTextMessage } from "@/src/services/meta-communications.service";
import { markOlxThreadRead, sendOlxTextMessage } from "@/src/services/olx-communications.service";
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

type AttachmentInput = {
  name?: string;
  type?: string;
  size?: number;
  url?: string;
};

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function isMetaChannel(channel: CommunicationChannel): channel is "FACEBOOK" | "INSTAGRAM" {
  return channel === "FACEBOOK" || channel === "INSTAGRAM";
}

function isLiveMessageChannel(channel: CommunicationChannel) {
  return isMetaChannel(channel) || channel === "OLX";
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

export async function sendCommunicationReply(id: string, text: string, attachments: AttachmentInput[] = []) {
  const normalizedText = text.trim();
  if (!normalizedText) throw Object.assign(new Error("text is required"), { code: "TEXT_REQUIRED" });

  const pool = getSqlPool();
  const inquiryResult = await pool.query<DeliveryInquiryRow>(
    `SELECT "id","channel","externalId","integrationAccountId","externalThreadId","externalParticipantId","replyAllowedUntil","metadata"
     FROM "CommunicationInquiry" WHERE "id"=$1 LIMIT 1`,
    [id],
  );
  const inquiry = inquiryResult.rows[0];
  if (!inquiry) throw Object.assign(new Error("Inquiry not found"), { code: "INQUIRY_NOT_FOUND" });

  if (isMetaChannel(inquiry.channel)
      && inquiry.replyAllowedUntil
      && inquiry.replyAllowedUntil.getTime() < Date.now()) {
    throw Object.assign(
      new Error("Стандартне вікно відповіді Meta завершилося. Потрібен дозволений Meta сценарій повторного контакту."),
      { code: "META_REPLY_WINDOW_EXPIRED" },
    );
  }

  const messageId = makeId("msg");
  const initialStatus = isLiveMessageChannel(inquiry.channel) ? "PENDING" : "CRM_ONLY";
  const inserted = await pool.query(
    `INSERT INTO "CommunicationMessage"
     ("id","inquiryId","direction","text","sentAt","metadata","deliveryStatus","attachments")
     VALUES ($1,$2,'OUT',$3,CURRENT_TIMESTAMP,$4::jsonb,$5,$6::jsonb)
     RETURNING *`,
    [
      messageId,
      id,
      normalizedText,
      JSON.stringify({ delivery: initialStatus }),
      initialStatus,
      JSON.stringify(attachments),
    ],
  );

  if (!isLiveMessageChannel(inquiry.channel)) {
    await pool.query(
      `UPDATE "CommunicationInquiry"
       SET "answered"=TRUE,"unread"=FALSE,"state"=CASE WHEN "state"='NEW' THEN 'IN_WORK' ELSE "state" END,
           "lastOutboundAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=$1`,
      [id],
    );
    return { message: inserted.rows[0], delivery: "CRM_ONLY" as const };
  }

  try {
    let delivered: { providerMessageId: string | null; providerPayload: unknown };
    if (inquiry.channel === "OLX") {
      delivered = await sendOlxTextMessage(
        { externalId: inquiry.externalId, externalThreadId: inquiry.externalThreadId },
        normalizedText,
      );
    } else if (isMetaChannel(inquiry.channel)) {
      delivered = await sendMetaTextMessage({
        channel: inquiry.channel,
        integrationAccountId: inquiry.integrationAccountId,
        externalParticipantId: inquiry.externalParticipantId,
        metadata: inquiry.metadata,
      }, normalizedText);
    } else {
      throw Object.assign(new Error("Unsupported live communication channel"), { code: "CHANNEL_NOT_SUPPORTED" });
    }

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
      [id],
    );
    const message = await pool.query(`SELECT * FROM "CommunicationMessage" WHERE "id"=$1`, [messageId]);
    return { message: message.rows[0], delivery: "SENT" as const, providerMessageId: delivered.providerMessageId };
  } catch (error) {
    await pool.query(
      `UPDATE "CommunicationMessage"
       SET "deliveryStatus"='FAILED',"errorCode"=$2,"errorMessage"=$3,
           "metadata"=COALESCE("metadata", '{}'::jsonb) || $4::jsonb
       WHERE "id"=$1`,
      [messageId, errorCode(error), errorMessage(error), JSON.stringify({ delivery: "FAILED" })],
    );
    throw error;
  }
}

export async function markCommunicationRead(id: string) {
  const pool = getSqlPool();
  const result = await pool.query<DeliveryInquiryRow>(
    `SELECT "id","channel","externalId","integrationAccountId","externalThreadId","externalParticipantId","replyAllowedUntil","metadata"
     FROM "CommunicationInquiry" WHERE "id"=$1 LIMIT 1`,
    [id],
  );
  const inquiry = result.rows[0];
  if (!inquiry) return false;

  if (inquiry.channel === "OLX") {
    return markOlxThreadRead({ externalId: inquiry.externalId, externalThreadId: inquiry.externalThreadId });
  }
  return true;
}
