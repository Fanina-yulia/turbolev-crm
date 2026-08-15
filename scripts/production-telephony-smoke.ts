import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as binotelWebhookPost } from "../app/api/telephony/binotel-webhook/route";
import { getPrisma } from "../src/lib/prisma";
import { getSqlPool } from "../src/lib/sql";

const UNKNOWN_PHONE = "380671234567";
const SECONDARY_PHONE = "380671234568";
const PRIMARY_PHONE = "380671234569";
const MISSED_PHONE = "380671234570";
const INTERNAL_NUMBER = "101";
const UNKNOWN_CALL_ID = "smoke_binotel_unknown_1001";
const SECONDARY_CALL_ID = "smoke_binotel_secondary_1002";
const MISSED_CALL_ID = "smoke_binotel_missed_1003";
const TEST_USER_EMAIL = "telephony-smoke@turbolev.invalid";

async function invokeWebhook(event: string, body: Record<string, unknown>) {
  const url = new URL("https://smoke.local/api/telephony/binotel-webhook");
  url.searchParams.set("event", event);
  const token = process.env.BINOTEL_WEBHOOK_TOKEN?.trim();
  if (token) url.searchParams.set("token", token);

  const request = new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await binotelWebhookPost(request);
  const json = await response.json();
  assert.equal(response.status, 200, `${event} webhook failed: ${JSON.stringify(json)}`);
  assert.equal(json.ok, true, `${event} webhook returned ok=false`);
  return json as Record<string, unknown>;
}

async function inquiryCount(callId: string) {
  const result = await getSqlPool().query(
    `SELECT COUNT(*)::int AS count FROM "CommunicationInquiry" WHERE "channel"='BINOTEL' AND "externalId"=$1`,
    [`binotel-call:${callId}`],
  );
  return Number(result.rows[0]?.count || 0);
}

async function cleanup() {
  const prisma = getPrisma();
  const pool = getSqlPool();
  const callIds = [UNKNOWN_CALL_ID, SECONDARY_CALL_ID, MISSED_CALL_ID];
  await pool.query(
    `DELETE FROM "CommunicationMessage" WHERE "inquiryId" IN (
       SELECT "id" FROM "CommunicationInquiry" WHERE "channel"='BINOTEL' AND "externalId" = ANY($1::text[])
     )`,
    [callIds.map((id) => `binotel-call:${id}`)],
  ).catch(() => undefined);
  await pool.query(
    `DELETE FROM "CommunicationInquiry" WHERE "channel"='BINOTEL' AND "externalId" = ANY($1::text[])`,
    [callIds.map((id) => `binotel-call:${id}`)],
  ).catch(() => undefined);
  await prisma.callHistory.deleteMany({ where: { binotelCallId: { in: callIds } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } }).catch(() => undefined);
  const clients = await prisma.client.findMany({
    where: { phoneNormalized: { in: [PRIMARY_PHONE, SECONDARY_PHONE] } },
    select: { id: true },
  }).catch(() => []);
  if (clients.length) {
    await prisma.client.deleteMany({ where: { id: { in: clients.map((item) => item.id) } } }).catch(() => undefined);
  }
  await prisma.lead.deleteMany({ where: { phoneNormalized: { in: [UNKNOWN_PHONE, SECONDARY_PHONE, MISSED_PHONE] } } }).catch(() => undefined);
}

async function main() {
  const prisma = getPrisma();
  await cleanup();

  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname='public' AND tablename IN ('Client','ClientPhone','Lead','CallHistory','User','CommunicationInquiry')
    `;
    const names = new Set(tables.map((row) => row.tablename));
    for (const required of ["Client", "ClientPhone", "Lead", "CallHistory", "User", "CommunicationInquiry"]) {
      assert(names.has(required), `Missing telephony table: ${required}`);
    }

    await prisma.user.create({
      data: { name: "Telephony Smoke Manager", email: TEST_USER_EMAIL, internalNumber: INTERNAL_NUMBER },
    });

    const incoming = await invokeWebhook("incomingCall", {
      eventName: "incomingCall",
      callDetails: {
        generalCallID: UNKNOWN_CALL_ID,
        externalNumber: `+${UNKNOWN_PHONE}`,
        internalNumber: INTERNAL_NUMBER,
        callType: "0",
        customerData: { name: "Smoke Unknown Caller" },
        employeeData: { email: TEST_USER_EMAIL },
      },
    });
    assert.equal(incoming.createdLead, false, "Unknown call must not auto-create a Lead");
    assert.equal(await prisma.lead.count({ where: { phoneNormalized: UNKNOWN_PHONE } }), 0, "Unknown call created a Lead");
    assert.equal(await inquiryCount(UNKNOWN_CALL_ID), 1, "Unknown call was not mirrored into Inbox");

    const callAfterIncoming = await prisma.callHistory.findUnique({ where: { binotelCallId: UNKNOWN_CALL_ID } });
    assert(callAfterIncoming, "CallHistory was not created");
    assert.equal(callAfterIncoming.externalNumber, UNKNOWN_PHONE);
    assert.equal(callAfterIncoming.internalNumber, INTERNAL_NUMBER);
    assert(callAfterIncoming.managerId, "Manager was not linked from Binotel extension/e-mail");

    await invokeWebhook("answeredTheCall", {
      eventName: "answeredTheCall",
      callDetails: {
        generalCallID: UNKNOWN_CALL_ID,
        externalNumber: `+${UNKNOWN_PHONE}`,
        internalAdditionalData: INTERNAL_NUMBER,
        callType: "0",
        employeeData: { email: TEST_USER_EMAIL },
      },
    });
    await invokeWebhook("answeredTheCall", {
      eventName: "answeredTheCall",
      callDetails: {
        generalCallID: UNKNOWN_CALL_ID,
        externalNumber: `+${UNKNOWN_PHONE}`,
        internalAdditionalData: INTERNAL_NUMBER,
        callType: "0",
      },
    });
    assert.equal(await prisma.callHistory.count({ where: { binotelCallId: UNKNOWN_CALL_ID } }), 1, "Duplicate CallHistory detected");
    assert.equal(await inquiryCount(UNKNOWN_CALL_ID), 1, "Duplicate Binotel inquiry detected");
    assert.equal((await prisma.callHistory.findUnique({ where: { binotelCallId: UNKNOWN_CALL_ID } }))?.status, "ANSWERED");

    const client = await prisma.client.create({
      data: {
        name: "Telephony Smoke Client",
        phone: `+${PRIMARY_PHONE}`,
        phoneNormalized: PRIMARY_PHONE,
        phones: {
          create: {
            id: "client_phone_telephony_smoke",
            phone: `+${SECONDARY_PHONE}`,
            phoneNormalized: SECONDARY_PHONE,
            label: "Додатковий",
            isPrimary: false,
          },
        },
      },
    });

    await invokeWebhook("incomingCall", {
      eventName: "incomingCall",
      callDetails: {
        generalCallID: SECONDARY_CALL_ID,
        externalNumber: `+${SECONDARY_PHONE}`,
        internalNumber: INTERNAL_NUMBER,
        callType: "0",
      },
    });
    const secondaryCall = await prisma.callHistory.findUnique({ where: { binotelCallId: SECONDARY_CALL_ID } });
    assert.equal(secondaryCall?.clientId, client.id, "Secondary ClientPhone was not resolved to Client");
    assert.equal(secondaryCall?.leadId, null, "Client call should not attach an unrelated Lead");

    await invokeWebhook("hangupTheCall", {
      eventName: "hangupTheCall",
      callDetails: {
        generalCallID: MISSED_CALL_ID,
        externalNumber: `+${MISSED_PHONE}`,
        internalNumber: INTERNAL_NUMBER,
        callType: "0",
        disposition: "NO ANSWER",
        billsec: 0,
      },
    });
    const missed = await prisma.callHistory.findUnique({ where: { binotelCallId: MISSED_CALL_ID } });
    assert.equal(missed?.status, "MISSED", "Unanswered terminal call must be MISSED");
    assert.equal(await inquiryCount(MISSED_CALL_ID), 1, "Missed call must remain in Inbox");
    assert.equal(await prisma.lead.count({ where: { phoneNormalized: MISSED_PHONE } }), 0, "Missed call auto-created a Lead");

    console.log("TELEPHONY_SMOKE_OK", {
      unknownCall: "inquiry_without_auto_lead",
      nestedCallDetails: true,
      internalAdditionalData: true,
      secondaryClientPhone: true,
      idempotentCallHistory: true,
      missedCallInbox: true,
    });
  } finally {
    await cleanup();
    await prisma.$disconnect();
    await getSqlPool().end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("TELEPHONY_SMOKE_FAILED", { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
