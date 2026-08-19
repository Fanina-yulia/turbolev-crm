import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSqlPool } from "@/src/lib/sql";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PROVIDER_URL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type StoredAttachmentRow = {
  id: string;
  inquiryId: string;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  providerUrl: string;
  providerTokenHash: string;
  providerExpiresAt: Date;
  fileData: Buffer;
};

export type CommunicationAttachmentRef = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  providerUrl: string;
};

function makeId() {
  return `att_${randomUUID().replace(/-/g, "")}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function fileHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeName(value: string) {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  return normalized || "image";
}

export function validateCommunicationImage(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw Object.assign(new Error("Підтримуються JPG, PNG, WEBP та GIF."), { code: "ATTACHMENT_TYPE_NOT_ALLOWED" });
  }
  if (file.size <= 0) {
    throw Object.assign(new Error("Файл порожній."), { code: "ATTACHMENT_EMPTY" });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("Максимальний розмір зображення — 4 МБ."), { code: "ATTACHMENT_TOO_LARGE" });
  }
}

export async function createCommunicationImage(input: {
  inquiryId: string;
  file: File;
  origin: string;
}): Promise<CommunicationAttachmentRef> {
  validateCommunicationImage(input.file);
  const pool = getSqlPool();
  const exists = await pool.query<{ id: string }>(
    `SELECT "id" FROM "CommunicationInquiry" WHERE "id"=$1 LIMIT 1`,
    [input.inquiryId],
  );
  if (!exists.rowCount) {
    throw Object.assign(new Error("Звернення не знайдено."), { code: "INQUIRY_NOT_FOUND" });
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const id = makeId();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PROVIDER_URL_TTL_MS);
  const fileName = safeName(input.file.name);
  const origin = input.origin.replace(/\/$/, "");
  const providerUrl = `${origin}/api/webhooks/communication-assets/${encodeURIComponent(token)}`;
  await pool.query(
    `INSERT INTO "CommunicationAttachment"
      ("id","inquiryId","fileName","mimeType","fileSize","sha256","providerUrl","providerTokenHash","providerExpiresAt","fileData")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, input.inquiryId, fileName, input.file.type, bytes.length, fileHash(bytes), providerUrl, tokenHash(token), expiresAt, bytes],
  );

  return {
    id,
    name: fileName,
    type: input.file.type,
    size: bytes.length,
    url: `/api/communications/attachments/${encodeURIComponent(id)}`,
    providerUrl,
  };
}

export async function getCommunicationAttachmentById(id: string) {
  const pool = getSqlPool();
  const result = await pool.query<StoredAttachmentRow>(
    `SELECT "id","inquiryId","messageId","fileName","mimeType","fileSize","providerUrl","providerTokenHash","providerExpiresAt","fileData"
     FROM "CommunicationAttachment" WHERE "id"=$1 LIMIT 1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function getCommunicationAttachmentByProviderToken(token: string) {
  if (!token || token.length < 32 || token.length > 128) return null;
  const pool = getSqlPool();
  const result = await pool.query<StoredAttachmentRow>(
    `SELECT "id","inquiryId","messageId","fileName","mimeType","fileSize","providerUrl","providerTokenHash","providerExpiresAt","fileData"
     FROM "CommunicationAttachment"
     WHERE "providerTokenHash"=$1 AND "providerExpiresAt" > CURRENT_TIMESTAMP
     LIMIT 1`,
    [tokenHash(token)],
  );
  return result.rows[0] || null;
}

export async function attachStoredCommunicationImages(messageId: string, inquiryId: string, attachments: CommunicationAttachmentRef[]) {
  if (!attachments.length) return;
  const ids = attachments.map((item) => item.id);
  const pool = getSqlPool();
  const result = await pool.query<{ id: string }>(
    `UPDATE "CommunicationAttachment"
     SET "messageId"=$1,"attachedAt"=CURRENT_TIMESTAMP
     WHERE "inquiryId"=$2 AND "id" = ANY($3::text[]) AND "messageId" IS NULL
     RETURNING "id"`,
    [messageId, inquiryId, ids],
  );
  if (result.rowCount !== ids.length) {
    throw Object.assign(new Error("Одне або кілька вкладень недоступні для цього діалогу."), { code: "ATTACHMENT_OWNERSHIP_INVALID" });
  }
}

export async function assertStoredCommunicationImages(inquiryId: string, attachments: CommunicationAttachmentRef[]) {
  if (!attachments.length) return;
  if (attachments.length > 4) {
    throw Object.assign(new Error("За одне відправлення можна додати до 4 зображень."), { code: "ATTACHMENT_LIMIT" });
  }
  const ids = attachments.map((item) => item.id);
  const pool = getSqlPool();
  const result = await pool.query<{ id: string; fileName: string; mimeType: string; fileSize: number; providerUrl: string; providerExpiresAt: Date }>(
    `SELECT "id","fileName","mimeType","fileSize","providerUrl","providerExpiresAt" FROM "CommunicationAttachment"
     WHERE "inquiryId"=$1 AND "id" = ANY($2::text[])`,
    [inquiryId, ids],
  );
  if (result.rowCount !== ids.length) {
    throw Object.assign(new Error("Одне або кілька вкладень не належать цьому діалогу."), { code: "ATTACHMENT_OWNERSHIP_INVALID" });
  }
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  for (const attachment of attachments) {
    const stored = byId.get(attachment.id);
    if (!stored || !ALLOWED_IMAGE_TYPES.has(stored.mimeType) || stored.fileSize > MAX_IMAGE_BYTES || stored.providerExpiresAt.getTime() <= Date.now()) {
      throw Object.assign(new Error("Вкладення не пройшло перевірку або посилання для провайдера вже протерміноване."), { code: "ATTACHMENT_INVALID" });
    }
    attachment.name = stored.fileName;
    attachment.type = stored.mimeType;
    attachment.size = stored.fileSize;
    attachment.url = `/api/communications/attachments/${encodeURIComponent(stored.id)}`;
    attachment.providerUrl = stored.providerUrl;
  }
}
