import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { getSqlPool } from "@/src/lib/sql";

export type CommunicationChannel = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "BINOTEL" | "OLX" | "WEBSITE";
export type InquiryState = "NEW" | "IN_WORK" | "CONVERTED" | "LINKED" | "SPAM";

export type InquiryInput = {
  channel: CommunicationChannel;
  externalId?: string;
  externalMessageId?: string;
  name?: string;
  phone?: string;
  handle?: string;
  subject: string;
  preview?: string;
  message?: string;
  vehicle?: string;
  plate?: string;
  receivedAt?: string | Date;
  sourceDetail?: string;
  campaign?: string;
  utm?: string;
  assignedUserId?: string;
  metadata?: unknown;
};

type CommunicationMessageView = {
  id: string;
  direction: "in" | "out" | "system";
  text: string;
  at: Date;
  metadata: unknown;
};

interface CommunicationInquiryRow extends QueryResultRow {
  id: string;
  channel: CommunicationChannel;
  state: InquiryState;
  name: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  handle: string | null;
  subject: string;
  preview: string | null;
  vehicle: string | null;
  plate: string | null;
  unread: boolean;
  answered: boolean;
  receivedAt: Date;
  sourceDetail: string | null;
  campaign: string | null;
  utm: string | null;
  leadId: string | null;
  assignedUserId: string | null;
  metadata: unknown;
}

interface CommunicationMessageRow extends QueryResultRow {
  id: string;
  inquiryId: string;
  direction: "IN" | "OUT" | "SYSTEM" | string;
  text: string;
  sentAt: Date;
  metadata: unknown;
  attachments: unknown;
  deliveryStatus: string | null;
}

interface ClientMatchRow extends QueryResultRow {
  phoneNormalized: string;
  id: string;
  name: string | null;
}

interface LeadRow extends QueryResultRow {
  id: string;
  name: string | null;
  phoneNormalized: string;
}

export function normalizePhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("0")) return `380${digits}`;
  if (digits.length === 12 && digits.startsWith("380")) return digits;
  return digits;
}

export function normalizePlate(value?: string | null) {
  return String(value || "").toUpperCase().replace(/[\s-]/g, "");
}

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function leadSource(channel: CommunicationChannel) {
  if (channel === "BINOTEL") return "BINOTEL";
  if (channel === "WEBSITE") return "WEBSITE";
  return "MESSENGER";
}

function publicChannelLabel(channel: CommunicationChannel) {
  if (channel === "FACEBOOK") return "Facebook";
  if (channel === "INSTAGRAM") return "Instagram";
  if (channel === "TIKTOK") return "TikTok";
  if (channel === "BINOTEL") return "Binotel";
  if (channel === "OLX") return "OLX";
  return "Сайт";
}

function publicMessageMetadata(message: CommunicationMessageRow) {
  const base: Record<string, unknown> = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
    ? { ...(message.metadata as Record<string, unknown>) }
    : {};
  if (Array.isArray(message.attachments) && message.attachments.length) {
    base.attachments = message.attachments;
  }
  if (message.direction === "OUT" && message.deliveryStatus) {
    base.delivery = message.deliveryStatus;
  }
  return Object.keys(base).length ? base : null;
}

export async function listCommunicationInquiries(input?: { channel?: string; unread?: boolean; noReply?: boolean; search?: string }) {
  const pool = getSqlPool();
  const where: string[] = [`i."state" <> 'SPAM'`];
  const values: unknown[] = [];

  if (input?.channel && input.channel !== "ALL") {
    values.push(input.channel);
    where.push(`i."channel" = $${values.length}`);
  }
  if (input?.unread) where.push(`i."unread" = TRUE`);
  if (input?.noReply) where.push(`i."answered" = FALSE`);
  if (input?.search?.trim()) {
    values.push(`%${input.search.trim().toLowerCase()}%`);
    where.push(`LOWER(COALESCE(i."name",'') || ' ' || COALESCE(i."phone",'') || ' ' || COALESCE(i."handle",'') || ' ' || i."subject" || ' ' || COALESCE(i."vehicle",'') || ' ' || COALESCE(i."plate",'')) LIKE $${values.length}`);
  }

  const inquiryResult = await pool.query<CommunicationInquiryRow>(
    `SELECT i.* FROM "CommunicationInquiry" i WHERE ${where.join(" AND ")} ORDER BY i."receivedAt" DESC LIMIT 250`,
    values,
  );
  const rows = inquiryResult.rows;
  if (!rows.length) return { items: [] };

  const ids = rows.map((row) => row.id);
  const messageResult = await pool.query<CommunicationMessageRow>(
    `SELECT * FROM "CommunicationMessage" WHERE "inquiryId" = ANY($1::text[]) ORDER BY "sentAt" ASC`,
    [ids],
  );
  const messagesByInquiry = new Map<string, CommunicationMessageView[]>();
  for (const message of messageResult.rows) {
    const list = messagesByInquiry.get(message.inquiryId) || [];
    list.push({
      id: message.id,
      direction: message.direction === "OUT" ? "out" : message.direction === "SYSTEM" ? "system" : "in",
      text: message.text,
      at: message.sentAt,
      metadata: publicMessageMetadata(message),
    });
    messagesByInquiry.set(message.inquiryId, list);
  }

  const phones = [...new Set(
    rows.map((row) => row.phoneNormalized).filter((phone): phone is string => Boolean(phone)),
  )];
  const clientMap = new Map<string, { id: string; name: string | null }>();
  const duplicateMap = new Map<string, { id: string; name: string | null }>();
  if (phones.length) {
    const clientResult = await pool.query<ClientMatchRow>(
      `SELECT DISTINCT ON ("phoneNormalized") "phoneNormalized","id","name"
       FROM (
         SELECT c."phoneNormalized" AS "phoneNormalized", c."id", c."name", c."updatedAt"
         FROM "Client" c
         WHERE c."phoneNormalized" = ANY($1::text[])
         UNION ALL
         SELECT cp."phoneNormalized" AS "phoneNormalized", c."id", c."name", c."updatedAt"
         FROM "ClientPhone" cp
         JOIN "Client" c ON c."id" = cp."clientId"
         WHERE cp."phoneNormalized" = ANY($1::text[])
       ) matched
       ORDER BY "phoneNormalized", "updatedAt" DESC`,
      [phones],
    );
    for (const client of clientResult.rows) {
      clientMap.set(client.phoneNormalized, { id: client.id, name: client.name });
    }

    const leadResult = await pool.query<LeadRow>(
      `SELECT DISTINCT ON ("phoneNormalized") "id","name","phoneNormalized" FROM "Lead" WHERE "phoneNormalized" = ANY($1::text[]) ORDER BY "phoneNormalized","updatedAt" DESC`,
      [phones],
    );
    for (const lead of leadResult.rows) {
      duplicateMap.set(lead.phoneNormalized, { id: lead.id, name: lead.name });
    }
  }

  return {
    items: rows.map((row) => {
      const client = row.phoneNormalized ? clientMap.get(row.phoneNormalized) : null;
      return {
        id: row.id,
        channel: row.channel,
        state: row.state,
        name: client?.name?.trim() || row.name || "Без імені",
        phone: row.phone || undefined,
        handle: row.handle || undefined,
        subject: row.subject,
        preview: row.preview,
        vehicle: row.vehicle || undefined,
        plate: row.plate || undefined,
        unread: row.unread,
        answered: row.answered,
        receivedAt: row.receivedAt,
        sourceDetail: row.sourceDetail || undefined,
        campaign: row.campaign || undefined,
        utm: row.utm || undefined,
        existingLeadId: row.leadId || undefined,
        assignedUserId: row.assignedUserId || undefined,
        metadata: row.metadata || undefined,
        messages: messagesByInquiry.get(row.id) || [],
        duplicateLead: !row.leadId && row.phoneNormalized ? duplicateMap.get(row.phoneNormalized) || null : null,
      };
    }),
  };
}

export async function ingestCommunicationInquiry(input: InquiryInput) {
  const pool = getSqlPool();
  const client = await pool.connect();
  const id = makeId("inq");
  const externalId = input.externalId || id;
  const phoneNormalized = normalizePhone(input.phone);
  const plateNormalized = normalizePlate(input.plate);
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const preview = input.preview || input.message || input.subject;

  try {
    await client.query("BEGIN");
    const inquiryResult = await client.query<CommunicationInquiryRow>(
      `INSERT INTO "CommunicationInquiry" ("id","externalId","channel","state","name","phone","phoneNormalized","handle","subject","preview","vehicle","plate","plateNormalized","unread","answered","receivedAt","sourceDetail","campaign","utm","assignedUserId","metadata")
       VALUES ($1,$2,$3,'NEW',$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,FALSE,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT ("channel","externalId") DO UPDATE SET
         "name"=COALESCE(EXCLUDED."name","CommunicationInquiry"."name"),
         "phone"=COALESCE(EXCLUDED."phone","CommunicationInquiry"."phone"),
         "phoneNormalized"=COALESCE(EXCLUDED."phoneNormalized","CommunicationInquiry"."phoneNormalized"),
         "handle"=COALESCE(EXCLUDED."handle","CommunicationInquiry"."handle"),
         "subject"=EXCLUDED."subject",
         "preview"=EXCLUDED."preview",
         "vehicle"=COALESCE(EXCLUDED."vehicle","CommunicationInquiry"."vehicle"),
         "plate"=COALESCE(EXCLUDED."plate","CommunicationInquiry"."plate"),
         "plateNormalized"=COALESCE(EXCLUDED."plateNormalized","CommunicationInquiry"."plateNormalized"),
         "unread"=TRUE,
         "receivedAt"=GREATEST("CommunicationInquiry"."receivedAt",EXCLUDED."receivedAt"),
         "sourceDetail"=COALESCE(EXCLUDED."sourceDetail","CommunicationInquiry"."sourceDetail"),
         "campaign"=COALESCE(EXCLUDED."campaign","CommunicationInquiry"."campaign"),
         "utm"=COALESCE(EXCLUDED."utm","CommunicationInquiry"."utm"),
         "metadata"=COALESCE(EXCLUDED."metadata","CommunicationInquiry"."metadata"),
         "updatedAt"=CURRENT_TIMESTAMP
       RETURNING *`,
      [id, externalId, input.channel, input.name || null, input.phone || null, phoneNormalized || null, input.handle || null, input.subject, preview, input.vehicle || null, input.plate || null, plateNormalized || null, receivedAt, input.sourceDetail || null, input.campaign || null, input.utm || null, input.assignedUserId || null, JSON.stringify(input.metadata ?? {})],
    );
    const inquiry = inquiryResult.rows[0];

    if (input.message) {
      const messageId = makeId("msg");
      const externalMessageId = input.externalMessageId || `${externalId}:initial`;
      await client.query(
        `INSERT INTO "CommunicationMessage" ("id","inquiryId","externalId","direction","text","sentAt","metadata")
         VALUES ($1,$2,$3,'IN',$4,$5,$6::jsonb)
         ON CONFLICT ("inquiryId","externalId") DO NOTHING`,
        [messageId, inquiry.id, externalMessageId, input.message, receivedAt, JSON.stringify(input.metadata ?? {})],
      );
    }

    await client.query("COMMIT");
    return inquiry;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function patchCommunicationInquiry(id: string, patch: { unread?: boolean; answered?: boolean; state?: InquiryState; assignedUserId?: string | null }) {
  const pool = getSqlPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    values.push(value);
    sets.push(`"${key}" = $${values.length}`);
  }
  if (!sets.length) throw new Error("No changes supplied");
  values.push(id);
  const result = await pool.query<CommunicationInquiryRow>(
    `UPDATE "CommunicationInquiry" SET ${sets.join(", ")}, "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length} RETURNING *`,
    values,
  );
  if (!result.rowCount) throw new Error("Inquiry not found");
  return result.rows[0];
}

export async function addCommunicationMessage(id: string, text: string) {
  const pool = getSqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inquiryResult = await client.query<CommunicationInquiryRow>(
      `SELECT * FROM "CommunicationInquiry" WHERE "id"=$1 FOR UPDATE`,
      [id],
    );
    if (!inquiryResult.rowCount) throw new Error("Inquiry not found");
    const message = await client.query<CommunicationMessageRow>(
      `INSERT INTO "CommunicationMessage" ("id","inquiryId","direction","text","sentAt","metadata") VALUES ($1,$2,'OUT',$3,CURRENT_TIMESTAMP,$4::jsonb) RETURNING *`,
      [makeId("msg"), id, text.trim(), JSON.stringify({ delivery: "CRM_ONLY" })],
    );
    await client.query(
      `UPDATE "CommunicationInquiry" SET "answered"=TRUE,"unread"=FALSE,"state"=CASE WHEN "state"='NEW' THEN 'IN_WORK' ELSE "state" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
      [id],
    );
    await client.query("COMMIT");
    return { message: message.rows[0], delivery: "CRM_ONLY" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function convertInquiryToLead(id: string) {
  const pool = getSqlPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inquiryResult = await client.query<CommunicationInquiryRow>(
      `SELECT * FROM "CommunicationInquiry" WHERE "id"=$1 FOR UPDATE`,
      [id],
    );
    if (!inquiryResult.rowCount) throw new Error("Inquiry not found");
    const inquiry = inquiryResult.rows[0];
    if (inquiry.leadId) {
      const lead = await client.query<LeadRow>(`SELECT * FROM "Lead" WHERE "id"=$1`, [inquiry.leadId]);
      await client.query("COMMIT");
      return { lead: lead.rows[0], linkedExisting: inquiry.state === "LINKED" };
    }
    if (!inquiry.phoneNormalized) throw new Error("PHONE_REQUIRED");

    const existing = await client.query<LeadRow>(
      `SELECT * FROM "Lead" WHERE "phoneNormalized"=$1 ORDER BY "updatedAt" DESC LIMIT 1`,
      [inquiry.phoneNormalized],
    );
    if (existing.rowCount) {
      const lead = existing.rows[0];
      await client.query(
        `UPDATE "CommunicationInquiry" SET "leadId"=$1,"state"='LINKED',"unread"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,
        [lead.id, id],
      );
      await client.query("COMMIT");
      return { lead, linkedExisting: true };
    }

    const leadId = makeId("lead");
    const detail = [
      `[${publicChannelLabel(inquiry.channel)}] ${inquiry.subject}`,
      inquiry.sourceDetail,
      inquiry.campaign ? `Кампанія: ${inquiry.campaign}` : null,
      inquiry.utm ? `UTM: ${inquiry.utm}` : null,
      inquiry.vehicle ? `Авто: ${inquiry.vehicle}` : null,
      inquiry.plate ? `Номер: ${inquiry.plate}` : null,
    ].filter(Boolean).join("\n");
    const nextContact = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const leadResult = await client.query<LeadRow>(
      `INSERT INTO "Lead" ("id","name","phone","phoneNormalized","status","source","comment","nextContactAt","assignedUserId") VALUES ($1,$2,$3,$4,'NEW',$5,$6,$7,$8) RETURNING *`,
      [leadId, inquiry.name || null, inquiry.phone, inquiry.phoneNormalized, leadSource(inquiry.channel), detail, nextContact, inquiry.assignedUserId || null],
    );
    await client.query(
      `UPDATE "CommunicationInquiry" SET "leadId"=$1,"state"='CONVERTED',"unread"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,
      [leadId, id],
    );
    await client.query("COMMIT");
    return { lead: leadResult.rows[0], linkedExisting: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordWebhookEvent(channel: CommunicationChannel, externalEventId: string, eventType: string | undefined, payload: unknown) {
  const pool = getSqlPool();
  const result = await pool.query(
    `INSERT INTO "WebhookEvent" ("id","channel","externalEventId","eventType","payload","status") VALUES ($1,$2,$3,$4,$5::jsonb,'RECEIVED') ON CONFLICT ("channel","externalEventId") DO NOTHING RETURNING "id"`,
    [makeId("wh"), channel, externalEventId, eventType || null, JSON.stringify(payload ?? {})],
  );
  return { inserted: Boolean(result.rowCount) };
}
