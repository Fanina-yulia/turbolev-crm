import assert from "node:assert/strict";
import { PRIMARY_BINOTEL_PBX_NUMBER } from "@/src/domain/binotel-config";
import { CallType } from "@/src/generated/prisma/client";
import { BinotelService } from "@/src/services/binotel.service";
import { inflateBinotelFormEntries, requiresBinotelSuccessAck } from "@/src/services/binotel-webhook-payload";
import { parseBinotelWebhook } from "@/src/services/binotel-webhook.service";

assert.equal(PRIMARY_BINOTEL_PBX_NUMBER, "0983415646", "CRM must use the approved single Binotel PBX number");

const completedBody = new URLSearchParams(
  "requestType=apiCallCompleted&attemptsCounter=3&callDetails%5BcompanyID%5D=32860&callDetails%5BgeneralCallID%5D=3141127535&callDetails%5BcallID%5D=3141127535&callDetails%5BstartTime%5D=1639667705&callDetails%5BcallType%5D=0&callDetails%5BinternalNumber%5D=901&callDetails%5BexternalNumber%5D=0689532858&callDetails%5Bbillsec%5D=0&callDetails%5Bdisposition%5D=CANCEL&callDetails%5BemployeeData%5D%5Bemail%5D=manager%40alta-profil.ua&callDetails%5BhistoryData%5D%5B0%5D%5Bwaitsec%5D=30&callDetails%5BhistoryData%5D%5B0%5D%5Bdisposition%5D=CANCEL",
);
const completedPayload = inflateBinotelFormEntries(completedBody.entries());
const completedDetails = completedPayload.callDetails as Record<string, unknown>;
assert.equal(completedDetails.generalCallID, "3141127535");
assert.equal((completedDetails.employeeData as Record<string, unknown>).email, "manager@alta-profil.ua");
assert.equal(((completedDetails.historyData as unknown[])[0] as Record<string, unknown>).disposition, "CANCEL");
assert.equal(requiresBinotelSuccessAck(completedPayload), true);

const completed = parseBinotelWebhook(completedPayload);
assert.equal(completed.event, "hangupTheCall");
assert.equal(completed.callId, "3141127535");
assert.equal(completed.externalNumber, "380689532858");
assert.equal(completed.internalNumber, "901");
assert.equal(completed.employeeEmail, "manager@alta-profil.ua");
assert.equal(completed.type, CallType.INCOMING);
assert.equal(completed.terminalHint, "CANCEL");

const receivedPayload = inflateBinotelFormEntries(new URLSearchParams(
  "externalNumber=74993836476&internalNumber=901&generalCallID=3112425781&callType=1&companyID=37572&requestType=receivedTheCall&method=receivedTheCall&dstNumber=74993836476&extNumber=901",
).entries());
const received = parseBinotelWebhook(receivedPayload);
assert.equal(received.event, "incomingCall");
assert.equal(received.callId, "3112425781");
assert.equal(received.type, CallType.OUTGOING);
assert.equal(requiresBinotelSuccessAck(receivedPayload), false);

const hangupPayload = inflateBinotelFormEntries(new URLSearchParams(
  "generalCallID=3112425781&billsec=0&disposition=CHANUNAVAIL&requestType=hangupTheCall&method=hangupTheCall",
).entries());
const hangup = parseBinotelWebhook(hangupPayload);
assert.equal(hangup.event, "hangupTheCall");
assert.equal(hangup.callId, "3112425781");
assert.equal(hangup.terminalHint, "CHANUNAVAIL");

const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({
    url: String(input),
    payload: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>,
  });
  return new Response(JSON.stringify({ status: "success", generalCallID: "9001", callDetails: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

try {
  const service = new BinotelService({
    apiKey: "test-key",
    apiSecret: "test-secret",
    apiBaseUrl: "https://api.example.test/api",
    apiVersion: "4.0",
  });

  await service.sendCall({ internalNumber: "901", externalNumber: "+38 (067) 123-45-67" });
  await service.hangupCall("9001");
  await service.transferCall("9001", "912");
  await service.getIncomingCallsForPeriod({ startTime: 100, stopTime: 200 });
  await service.getOutgoingCallsForPeriod({ startTime: 100, stopTime: 200 });
  await service.getCallDetails(["9001", "9002"]);
  await service.getHistoryByExternalNumber(["+380671234567"]);

  assert.match(requests[0].url, /calls\/internal-number-to-external-number\.json$/);
  assert.equal(requests[0].payload.internalNumber, "901");
  assert.equal(requests[0].payload.externalNumber, "+380671234567");
  assert.equal(requests[0].payload.pbxNumber, PRIMARY_BINOTEL_PBX_NUMBER);
  assert.equal(requests[0].payload.async, true);

  assert.match(requests[1].url, /calls\/hangup-call\.json$/);
  assert.equal(requests[1].payload.generalCallID, "9001");

  assert.match(requests[2].url, /calls\/attended-call-transfer\.json$/);
  assert.equal(requests[2].payload.generalCallID, "9001");
  assert.equal(requests[2].payload.externalNumber, "912");

  assert.match(requests[3].url, /stats\/incoming-calls-for-period\.json$/);
  assert.equal(requests[3].payload.startTime, 100);
  assert.equal(requests[3].payload.stopTime, 200);
  assert.match(requests[4].url, /stats\/outgoing-calls-for-period\.json$/);
  assert.deepEqual(requests[5].payload.generalCallID, ["9001", "9002"]);
  assert.deepEqual(requests[6].payload.externalNumbers, ["+380671234567"]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Binotel webhook and REST contract smoke passed");
