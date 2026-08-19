import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSqlPool } from "../src/lib/sql";
import { listCommunicationInquiries } from "../src/services/communications-server.service";

const pool = getSqlPool();
const suffix = randomUUID().replace(/-/g, "");
const inquiryId = `smoke_media_inq_${suffix}`;
const messageId = `smoke_media_msg_${suffix}`;
const externalId = `smoke_media_thread_${suffix}`;

try {
  await pool.query(
    `INSERT INTO "CommunicationInquiry" ("id","externalId","channel","state","subject","preview","unread","answered","receivedAt")
     VALUES ($1,$2,'OLX','NEW','OLX media smoke','Фото від клієнта',TRUE,FALSE,CURRENT_TIMESTAMP)`,
    [inquiryId, externalId],
  );

  const attachments = [{ url: "https://img.example.test/photo.jpg", type: "image", name: "photo.jpg" }];
  await pool.query(
    `INSERT INTO "CommunicationMessage" ("id","inquiryId","externalId","direction","text","sentAt","metadata","attachments","deliveryStatus")
     VALUES ($1,$2,$3,'IN','Фото від клієнта',CURRENT_TIMESTAMP,$4::jsonb,$5::jsonb,'SENT')`,
    [messageId, inquiryId, `${externalId}:message`, JSON.stringify({ provider: "OLX" }), JSON.stringify(attachments)],
  );

  const result = await listCommunicationInquiries({ channel: "OLX", search: "OLX media smoke" });
  const inquiry = result.items.find((item) => item.id === inquiryId);
  assert.ok(inquiry, "smoke inquiry must be returned");
  assert.equal(inquiry.messages.length, 1);
  const metadata = inquiry.messages[0]?.metadata as Record<string, unknown> | null;
  assert.ok(metadata);
  assert.equal(metadata?.provider, "OLX");
  assert.deepEqual(metadata?.attachments, attachments, "stored provider attachments must be exposed to the inbox timeline");
  assert.equal("delivery" in (metadata || {}), false, "inbound messages must not expose outbound delivery state");

  console.log("communication-message-view-smoke: ok");
} finally {
  await pool.query(`DELETE FROM "CommunicationMessage" WHERE "inquiryId"=$1`, [inquiryId]).catch(() => undefined);
  await pool.query(`DELETE FROM "CommunicationInquiry" WHERE "id"=$1`, [inquiryId]).catch(() => undefined);
  await pool.end();
}
