import { randomUUID } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";

export type BinotelInquirySyncInput = {
  callId: string;
  event: "incomingCall" | "answeredTheCall" | "hangupTheCall";
  phone: string;
  name?: string | null;
  status?: "ANSWERED" | "MISSED" | "BUSY" | null;
  duration?: number | null;
  internalNumber?: string | null;
  recordingAvailable?: boolean;
  clientId?: string | null;
  leadId?: string | null;
  workOrderId?: string | null;
  occurredAt?: Date | null;
};

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function callCopy(input: BinotelInquirySyncInput) {
  const seconds = Math.max(0, Math.floor(input.duration || 0));
  const duration = seconds ? ` · ${seconds} с` : "";

  if (input.status === "MISSED") {
    return {
      subject: "Пропущений дзвінок",
      preview: `Пропущений дзвінок${duration} — потрібно передзвонити`,
      message: `Пропущений вхідний дзвінок${duration}. Потрібно передзвонити клієнту.`,
    };
  }

  if (input.status === "BUSY") {
    return {
      subject: "Неуспішний вхідний дзвінок",
      preview: `Вхідний дзвінок не з’єднався${duration}`,
      message: `Вхідний дзвінок не з’єднався${duration}. Потрібен повторний контакт.`,
    };
  }

  if (input.status === "ANSWERED") {
    return {
      subject: "Вхідний дзвінок",
      preview: `Розмова з клієнтом завершена${duration}`,
      message: `Розмова з клієнтом завершена${duration}.${input.recordingAvailable ? " Запис розмови збережено в історії дзвінків." : ""}`,
    };
  }

  if (input.event === "answeredTheCall") {
    return {
      subject: "Вхідний дзвінок",
      preview: "Менеджер відповів на дзвінок",
      message: "Менеджер відповів на вхідний дзвінок.",
    };
  }

  return {
    subject: "Вхідний дзвінок",
    preview: "Новий вхідний дзвінок",
    message: "Новий вхідний дзвінок. Контакт зафіксовано в CRM.",
  };
}

/**
 * Mirrors an inbound Binotel call into the omnichannel Inbox.
 *
 * Important business rule: telephony never creates a Client or a new Lead here.
 * The call becomes CommunicationInquiry first. An already active lead may be linked,
 * otherwise a manager converts the inquiry through the normal sales funnel.
 */
export async function syncBinotelInquiry(input: BinotelInquirySyncInput) {
  const pool = getSqlPool();
  const client = await pool.connect();
  const externalId = `binotel-call:${input.callId}`;
  const copy = callCopy(input);
  const isAnswered = input.status === "ANSWERED" || input.event === "answeredTheCall";
  const state = input.leadId ? "LINKED" : isAnswered ? "IN_WORK" : "NEW";
  const unread = !isAnswered;
  const answered = isAnswered;
  const eventAt = input.occurredAt || new Date();
  const metadata = {
    provider: "BINOTEL",
    callId: input.callId,
    event: input.event,
    callStatus: input.status || null,
    duration: Math.max(0, Math.floor(input.duration || 0)),
    internalNumber: input.internalNumber || null,
    recordingAvailable: Boolean(input.recordingAvailable),
    clientId: input.clientId || null,
    leadId: input.leadId || null,
    workOrderId: input.workOrderId || null,
  };

  try {
    await client.query("BEGIN");

    const inquiryResult = await client.query(
      `INSERT INTO "CommunicationInquiry" (
        "id","externalId","channel","state","name","phone","phoneNormalized",
        "subject","preview","unread","answered","receivedAt","sourceDetail",
        "leadId","metadata"
      ) VALUES ($1,$2,'BINOTEL',$3,$4,$5,$5,$6,$7,$8,$9,$10,'Binotel · телефонія',$11,$12::jsonb)
      ON CONFLICT ("channel","externalId") DO UPDATE SET
        "state"=EXCLUDED."state",
        "name"=COALESCE(EXCLUDED."name","CommunicationInquiry"."name"),
        "phone"=EXCLUDED."phone",
        "phoneNormalized"=EXCLUDED."phoneNormalized",
        "subject"=EXCLUDED."subject",
        "preview"=EXCLUDED."preview",
        "unread"=EXCLUDED."unread",
        "answered"=EXCLUDED."answered",
        "receivedAt"=GREATEST("CommunicationInquiry"."receivedAt",EXCLUDED."receivedAt"),
        "sourceDetail"=EXCLUDED."sourceDetail",
        "leadId"=COALESCE(EXCLUDED."leadId","CommunicationInquiry"."leadId"),
        "metadata"=EXCLUDED."metadata",
        "updatedAt"=CURRENT_TIMESTAMP
      RETURNING *`,
      [
        makeId("inq"),
        externalId,
        state,
        input.name || "Невідомий номер",
        input.phone,
        copy.subject,
        copy.preview,
        unread,
        answered,
        eventAt,
        input.leadId || null,
        JSON.stringify(metadata),
      ],
    );

    const inquiry = inquiryResult.rows[0];
    const messageExternalId = `${externalId}:${input.event}:${input.status || "RINGING"}`;

    await client.query(
      `INSERT INTO "CommunicationMessage" (
        "id","inquiryId","externalId","direction","text","sentAt","metadata"
      ) VALUES ($1,$2,$3,'SYSTEM',$4,$5,$6::jsonb)
      ON CONFLICT ("inquiryId","externalId") DO UPDATE SET
        "text"=EXCLUDED."text",
        "sentAt"=EXCLUDED."sentAt",
        "metadata"=EXCLUDED."metadata"`,
      [makeId("msg"), inquiry.id, messageExternalId, copy.message, eventAt, JSON.stringify(metadata)],
    );

    await client.query("COMMIT");
    return inquiry;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
