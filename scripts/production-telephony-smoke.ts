import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as binotelWebhookPost } from "../app/api/telephony/binotel-webhook/route";
import { getPrisma } from "../src/lib/prisma";

const TEST_CALL_ID = "test_binotel_call_1001";
const TEST_PHONE = "380671234567";
const TEST_INTERNAL = "101";

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

async function main() {
  const prisma = getPrisma();

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('Client', 'Lead', 'CallHistory', 'User')
  `;

  const tableNames = new Set(tables.map((row) => row.tablename));
  for (const name of ["Client", "Lead", "CallHistory", "User"]) {
    assert(tableNames.has(name), `Missing production table: ${name}`);
  }

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'Client_phoneNormalized_key',
        'Lead_phoneNormalized_idx',
        'CallHistory_binotelCallId_key',
        'CallHistory_externalNumber_createdAt_idx',
        'CallHistory_status_createdAt_idx'
      )
  `;

  const indexNames = new Set(indexes.map((row) => row.indexname));
  for (const name of [
    "Client_phoneNormalized_key",
    "Lead_phoneNormalized_idx",
    "CallHistory_binotelCallId_key",
    "CallHistory_externalNumber_createdAt_idx",
    "CallHistory_status_createdAt_idx",
  ]) {
    assert(indexNames.has(name), `Missing production index: ${name}`);
  }

  const existingClient = await prisma.client.findFirst({
    where: {
      OR: [{ phoneNormalized: TEST_PHONE }, { phone: { in: [TEST_PHONE, `+${TEST_PHONE}`] } }],
    },
  });
  assert.equal(existingClient, null, "Smoke-test phone already belongs to a Client; aborting to avoid touching real data");

  const beforeLeads = await prisma.lead.count({ where: { phoneNormalized: TEST_PHONE } });
  const beforeCalls = await prisma.callHistory.count({ where: { binotelCallId: TEST_CALL_ID } });

  const incoming = await invokeWebhook("incomingCall", {
    callID: TEST_CALL_ID,
    externalNumber: `+${TEST_PHONE}`,
    internalNumber: TEST_INTERNAL,
    callType: "0",
  });

  const lead = await prisma.lead.findFirst({
    where: { phoneNormalized: TEST_PHONE },
    orderBy: { createdAt: "desc" },
  });

  assert(lead, "Lead was not created/found after incomingCall");
  assert.equal(lead.phoneNormalized, TEST_PHONE);
  assert.equal(lead.status, "NEW_REQUEST");
  assert.equal(lead.source, "BINOTEL");

  const callAfterIncoming = await prisma.callHistory.findUnique({
    where: { binotelCallId: TEST_CALL_ID },
  });

  assert(callAfterIncoming, "CallHistory was not created after incomingCall");
  assert.equal(callAfterIncoming.leadId, lead.id, "CallHistory is not linked to the expected Lead");
  assert.equal(callAfterIncoming.externalNumber, TEST_PHONE);

  await invokeWebhook("answeredTheCall", {
    callID: TEST_CALL_ID,
    externalNumber: `+${TEST_PHONE}`,
    internalNumber: TEST_INTERNAL,
    callType: "0",
  });

  // Repeat the same event to prove idempotency of the upsert.
  await invokeWebhook("answeredTheCall", {
    callID: TEST_CALL_ID,
    externalNumber: `+${TEST_PHONE}`,
    internalNumber: TEST_INTERNAL,
    callType: "0",
  });

  const afterLeads = await prisma.lead.count({ where: { phoneNormalized: TEST_PHONE } });
  const afterCalls = await prisma.callHistory.count({ where: { binotelCallId: TEST_CALL_ID } });
  const finalCall = await prisma.callHistory.findUnique({ where: { binotelCallId: TEST_CALL_ID } });

  assert.equal(afterCalls, Math.max(beforeCalls, 1), "Duplicate CallHistory rows detected");
  assert.equal(afterCalls, 1, "Expected exactly one CallHistory row for the Binotel call id");
  assert.equal(afterLeads, Math.max(beforeLeads, 1), "Duplicate Lead rows detected");
  assert.equal(afterLeads, 1, "Expected exactly one smoke-test Lead");
  assert.equal(finalCall?.status, "ANSWERED", "answeredTheCall did not update status to ANSWERED");
  assert.equal(finalCall?.leadId, lead.id, "Lead relation changed after idempotent update");

  console.log("PRODUCTION_TELEPHONY_SMOKE_OK", {
    migrationSchema: "ready",
    requiredTables: [...tableNames].sort(),
    requiredIndexes: [...indexNames].sort(),
    lead: {
      phoneNormalized: lead.phoneNormalized,
      status: lead.status,
      source: lead.source,
    },
    call: {
      binotelCallId: finalCall?.binotelCallId,
      status: finalCall?.status,
      leadLinked: finalCall?.leadId === lead.id,
      duplicateCount: afterCalls,
    },
    firstIncomingCreatedLead: incoming.createdLead,
  });

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("PRODUCTION_TELEPHONY_SMOKE_FAILED", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
