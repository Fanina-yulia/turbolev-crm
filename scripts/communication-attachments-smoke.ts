import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getSqlPool } from "../src/lib/sql";
import {
  assertStoredCommunicationImages,
  attachStoredCommunicationImages,
  createCommunicationImage,
  getCommunicationAttachmentById,
  getCommunicationAttachmentByProviderToken,
} from "../src/services/communication-attachments.service";

const pool = getSqlPool();
const inquiryId = `smoke_inq_${randomUUID().replace(/-/g, "")}`;
const messageId = `smoke_msg_${randomUUID().replace(/-/g, "")}`;

try {
  await pool.query(
    `INSERT INTO "CommunicationInquiry" ("id","externalId","channel","state","subject","preview","unread","answered","receivedAt")
     VALUES ($1,$2,'FACEBOOK','NEW','Attachment smoke','Attachment smoke',FALSE,FALSE,CURRENT_TIMESTAMP)`,
    [inquiryId, inquiryId],
  );

  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
  const file = new File([bytes], "smoke.gif", { type: "image/gif" });
  const attachment = await createCommunicationImage({ inquiryId, file, origin: "https://crm.example.test" });

  assert.match(attachment.id, /^att_/);
  assert.equal(attachment.type, "image/gif");
  assert.equal(attachment.size, bytes.length);
  assert.match(attachment.url, /^\/api\/communications\/attachments\//);
  assert.match(attachment.providerUrl, /^https:\/\/crm\.example\.test\/api\/webhooks\/communication-assets\//);

  const token = new URL(attachment.providerUrl).pathname.split("/").at(-1) || "";
  const byToken = await getCommunicationAttachmentByProviderToken(token);
  assert.ok(byToken);
  assert.equal(byToken?.fileName, "smoke.gif");
  assert.equal(byToken?.fileData.length, bytes.length);

  const forged = { ...attachment, providerUrl: "https://evil.example/image.gif", name: "forged.gif" };
  await assertStoredCommunicationImages(inquiryId, [forged]);
  assert.equal(forged.providerUrl, attachment.providerUrl, "server must restore canonical provider URL");
  assert.equal(forged.name, "smoke.gif", "server must restore canonical file name");

  await pool.query(
    `INSERT INTO "CommunicationMessage" ("id","inquiryId","direction","text","sentAt","metadata","deliveryStatus","attachments")
     VALUES ($1,$2,'OUT','📎 smoke.gif',CURRENT_TIMESTAMP,'{}'::jsonb,'PENDING',$3::jsonb)`,
    [messageId, inquiryId, JSON.stringify([attachment])],
  );
  await attachStoredCommunicationImages(messageId, inquiryId, [attachment]);
  const stored = await getCommunicationAttachmentById(attachment.id);
  assert.equal(stored?.messageId, messageId);

  console.log("communication-attachments-smoke: ok");
} finally {
  await pool.query(`DELETE FROM "CommunicationAttachment" WHERE "inquiryId"=$1`, [inquiryId]).catch(() => undefined);
  await pool.query(`DELETE FROM "CommunicationMessage" WHERE "inquiryId"=$1`, [inquiryId]).catch(() => undefined);
  await pool.query(`DELETE FROM "CommunicationInquiry" WHERE "id"=$1`, [inquiryId]).catch(() => undefined);
  await pool.end();
}
