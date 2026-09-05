import { randomUUID } from "node:crypto";
import { PRIMARY_BINOTEL_PBX_NUMBER } from "@/src/domain/binotel-config";
import { getSqlPool } from "@/src/lib/sql";

export type BinotelInquirySyncInput = {
  callId: string;
  event: "incomingCall" | "answeredTheCall" | "hangupTheCall";
  callType?: "INCOMING" | "OUTGOING" | null;
  phone: string;
  name?: string | null;
  status?: "ANSWERED" | "MISSED" | "BUSY" | null;
  duration?: number | null;
  internalNumber?: string | null;
  pbxNumber?: string | null;
  recordingAvailable?: boolean;
  clientId?: string | null;
  leadId?: string | null;
  workOrderId?: string | null;
  occurredAt?: Date | null;
};

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `38${digits}`;
  if (!digits.startsWith("380") && digits.length === 9) digits = `380${digits}`;
  return digits.slice(0, 12);
}

function cleanName(value?: string | null) {
  const name = String(value || "").trim();
  if (!name) return null;
  const normalized = name.toLocaleLowerCase("uk-UA").replace(/\s+/g, " ");
  if (["без імені", "без имени", "невідомий номер", "неизвестный номер", "unknown", "unknown number"].includes(normalized)) return null;
  return name.slice(0, 160);
}

function callCopy(input: BinotelInquirySyncInput) {
  const seconds = Math.max(0, Math.floor(input.duration || 0));
  const duration = ` · ${seconds} с`;
  const durationSuffix = seconds ? duration : "";
  const isOutgoing = input.callType === "OUTGOING";

  if (input.status === "MISSED") {
    if (isOutgoing) {
      return {
        subject: "Вихідний дзвінок без відповіді",
        preview: `Вихідний дзвінок${durationSuffix} — без відповіді`,
        message: `Вихідний дзвінок клієнту не завершився розмовою${durationSuffix}.`,
      };
    }
    return {
      subject: "Пропущений дзвінок",
      preview: `Пропущений дзвінок${durationSuffix} — потрібно передзвонити`,
      message: `Пропущений вхідний дзвінок${durationSuffix}. Потрібно передзвонити клієнту.`,
    };
  }

  if (input.status === "BUSY") {
    if (isOutgoing) {
      return {
        subject: "Вихідний дзвінок — зайнято",
        preview: `Вихідний дзвінок${durationSuffix} — лінія зайнята`,
        message: `Вихідний дзвінок клієнту не з’єднався${durationSuffix}.`,
      };
    }
    return {
      subject: "Неуспішний вхідний дзвінок",
      preview: `Вхідний дзвінок не з’єднався${durationSuffix}`,
      message: `Вхідний дзвінок не з’єднався${durationSuffix}. Потрібен повторний контакт.`,
    };
  }

  if (input.status === "ANSWERED") {
    return {
      subject: isOutgoing ? "Вихідний дзвінок" : "Вхідний дзвінок",
      preview: `${isOutgoing ? "Вихідний дзвінок" : "Розмова з клієнтом завершена"}${durationSuffix}`,
      message: `${isOutgoing ? "Вихідний дзвінок клієнту завершено" : "Розмова з клієнтом завершена"}${durationSuffix}.${input.recordingAvailable ? " Запис розмови збережено в історії дзвінків." : ""}`,
    };
  }

  if (input.event === "answeredTheCall") {
    return {
      subject: isOutgoing ? "Вихідний дзвінок" : "Вхідний дзвінок",
      preview: isOutgoing ? "Менеджер додзвонився клієнту" : "Менеджер відповів на дзвінок",
      message: isOutgoing ? "Менеджер додзвонився клієнту." : "Менеджер відповів на вхідний дзвінок.",
    };
  }

  return {
    subject: isOutgoing ? "Вихідний дзвінок" : "Вхідний дзвінок",
    preview: isOutgoing ? "Вихідний дзвінок клієнту" : "Новий вхідний дзвінок",
    message: isOutgoing ? "Вихідний дзвінок клієнту зафіксовано в CRM." : "Новий вхідний дзвінок. Контакт зафіксовано в CRM.",
  };
}

/**
 * Mirrors a Binotel call into the omnichannel Inbox.
 *
 * Binotel is also a trusted source of the caller phone number: if this phone is not
 * known yet, CRM creates a lightweight Client card immediately and stores the number
 * as primary. This does NOT create a new Lead automatically. An already active Lead
 * remains linked to the communication and can continue through the normal funnel.
 */
export async function syncBinotelInquiry(input: BinotelInquirySyncInput) {
  const pool = getSqlPool();
  const client = await pool.connect();
  const externalId = `binotel-call:${input.callId}`;
  const copy = callCopy(input);
  const isOutgoing = input.callType === "OUTGOING";
  const isAnswered = input.status === "ANSWERED" || input.event === "answeredTheCall";
  const isHandled = isOutgoing || isAnswered;
  const state = input.leadId ? "LINKED" : isHandled ? "IN_WORK" : "NEW";
  const unread = !isHandled;
  const answered = isHandled;
  const pbxNumber = normalizePhone(input.pbxNumber || PRIMARY_BINOTEL_PBX_NUMBER) || normalizePhone(PRIMARY_BINOTEL_PBX_NUMBER);
  const eventAt = input.occurredAt || new Date();

  try {
    await client.query("BEGIN");

    const phoneNormalized = normalizePhone(input.phone);
    let resolvedClientId = input.clientId || null;
    if (!resolvedClientId && input.callType !== "OUTGOING" && phoneNormalized.length === 12 && phoneNormalized.startsWith("380")) {
      const existingClient = await client.query(
        `SELECT DISTINCT c."id"
         FROM "Client" c
         LEFT JOIN "ClientPhone" cp ON cp."clientId"=c."id"
         WHERE c."phoneNormalized"=$1 OR cp."phoneNormalized"=$1
         LIMIT 1`, [phoneNormalized]);
      resolvedClientId = existingClient.rows[0]?.id || null;

      if (!resolvedClientId) {
        resolvedClientId = `client_${randomUUID()}`;
        const displayPhone = `+${phoneNormalized}`;
        await client.query(
          `INSERT INTO "Client" ("id","name","phone","phoneNormalized","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT ("phoneNormalized") DO NOTHING`,
          [resolvedClientId, cleanName(input.name), displayPhone, phoneNormalized],
        );
        const created = await client.query(`SELECT "id" FROM "Client" WHERE "phoneNormalized"=$1 LIMIT 1`, [phoneNormalized]);
        resolvedClientId = created.rows[0]?.id || resolvedClientId;
        await client.query(
          `INSERT INTO "ClientPhone" ("id","clientId","phone","phoneNormalized","label","isPrimary","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,'Основний',true,NOW(),NOW())
           ON CONFLICT ("phoneNormalized") DO UPDATE SET
             "clientId"=EXCLUDED."clientId","phone"=EXCLUDED."phone","label"='Основний',"isPrimary"=true,"updatedAt"=NOW()`,
          [`cp_${randomUUID()}`, resolvedClientId, displayPhone, phoneNormalized],
        );
      }
    }

    if (resolvedClientId) {
      await client.query(
        `UPDATE "CallHistory"
         SET "clientId"=$1,"leadId"=COALESCE("leadId",$2),"updatedAt"=NOW()
         WHERE "binotelCallId"=$3`,
        [resolvedClientId, input.leadId || null, input.callId],
      );
    }

    const metadata = {
      provider: "BINOTEL",
      callId: input.callId,
      event: input.event,
      callType: input.callType || "INCOMING",
      pbxNumber,
      callStatus: input.status || null,
      duration: Math.max(0, Math.floor(input.duration || 0)),
      internalNumber: input.internalNumber || null,
      recordingAvailable: Boolean(input.recordingAvailable),
      clientId: resolvedClientId,
      leadId: input.leadId || null,
      workOrderId: input.workOrderId || null,
    };

    const inquiryResult = await client.query(
      `INSERT INTO "CommunicationInquiry" (
        "id","externalId","channel","state","name","phone","phoneNormalized",
        "subject","preview","unread","answered","receivedAt","sourceDetail",
        "leadId","metadata"
      ) VALUES ($1,$2,'BINOTEL',$3,$4,$5,$6,$7,$8,$9,$10,$11,'Binotel · телефонія',$12,$13::jsonb)
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
        phoneNormalized || input.phone,
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
