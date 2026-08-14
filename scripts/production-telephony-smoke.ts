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
      AND tablename IN ('Client', 'Lead', 'CallHistory', 'User', 'Vehicle', 'WorkOrder')
  `;

  const tableNames = new Set(tables.map((row) => row.tablename));
  for (const name of ["Client", "Lead", "CallHistory", "User", "Vehicle", "WorkOrder"]) {
    assert(tableNames.has(name), `Missing production table: ${name}`);
  }

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'Client_phoneNormalized_key',
        'Lead_phoneNormalized_idx',
        'Lead_assignedUserId_status_idx',
        'Lead_nextContactAt_idx',
        'CallHistory_binotelCallId_key',
        'CallHistory_workOrderId_idx',
        'WorkOrder_clientId_closedAt_idx'
      )
  `;

  const requiredIndexes = [
    "Client_phoneNormalized_key",
    "Lead_phoneNormalized_idx",
    "Lead_assignedUserId_status_idx",
    "Lead_nextContactAt_idx",
    "CallHistory_binotelCallId_key",
    "CallHistory_workOrderId_idx",
    "WorkOrder_clientId_closedAt_idx",
  ];
  const indexNames = new Set(indexes.map((row) => row.indexname));
  for (const name of requiredIndexes) {
    assert(indexNames.has(name), `Missing production index: ${name}`);
  }

  const existingClient = await prisma.client.findUnique({
    where: { phoneNormalized: TEST_PHONE },
  });
  assert.equal(
    existingClient,
    null,
    "Smoke-test phone belongs to a Client; aborting to avoid touching real client data",
  );

  const beforeLeads = await prisma.lead.count({ where: { phoneNormalized: TEST_PHONE } });

  const incoming = await invokeWebhook("incomingCall", {
    callID: TEST_CALL_ID,
    externalNumber: `+${TEST_PHONE}`,
    internalNumber: TEST_INTERNAL,
    callType: "0",
  });

  const lead = await prisma.lead.findFirst({
    where: { phoneNormalized: TEST_PHONE },
    orderBy: { updatedAt: "desc" },
  });

  assert(lead, "Lead was not created/found after incomingCall");
  assert.equal(lead.phoneNormalized, TEST_PHONE);
  assert.equal(lead.status, "NEW");
  assert.equal(lead.source, "BINOTEL");

  const callAfterIncoming = await prisma.callHistory.findUnique({
    where: { binotelCallId: TEST_CALL_ID },
  });
  assert(callAfterIncoming, "CallHistory was not created after incomingCall");
  assert.equal(callAfterIncoming.leadId, lead.id, "CallHistory is not linked to Lead");
  assert.equal(callAfterIncoming.clientId, null);
  assert.equal(callAfterIncoming.externalNumber, TEST_PHONE);

  await invokeWebhook("answeredTheCall", {
    callID: TEST_CALL_ID,
    externalNumber: `+${TEST_PHONE}`,
    internalNumber: TEST_INTERNAL,
    callType: "0",
  });

  await invokeWebhook("answeredTheCall", {
    callID: TEST_CALL_ID,
    externalNumber: `+${TEST_PHONE}`,
    internalNumber: TEST_INTERNAL,
    callType: "0",
  });

  const afterLeads = await prisma.lead.count({ where: { phoneNormalized: TEST_PHONE } });
  const afterCalls = await prisma.callHistory.count({ where: { binotelCallId: TEST_CALL_ID } });
  const finalCall = await prisma.callHistory.findUnique({
    where: { binotelCallId: TEST_CALL_ID },
  });
  const finalLead = await prisma.lead.findUnique({ where: { id: lead.id } });

  assert.equal(afterCalls, 1, "Duplicate CallHistory rows detected");
  assert.equal(afterLeads, Math.max(beforeLeads, 1), "Duplicate Lead rows detected");
  assert.equal(finalCall?.status, "ANSWERED", "answeredTheCall did not set ANSWERED");
  assert.equal(finalCall?.leadId, lead.id, "Lead relation changed during UPSERT");
  assert.equal(finalLead?.status, "NEW", "Existing active lead status was reset unexpectedly");

  console.log("PRODUCTION_TELEPHONY_SMOKE_OK", {
    requiredTables: [...tableNames].sort(),
    requiredIndexes: [...indexNames].sort(),
    lead: {
      id: lead.id,
      phoneNormalized: lead.phoneNormalized,
      status: finalLead?.status,
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
