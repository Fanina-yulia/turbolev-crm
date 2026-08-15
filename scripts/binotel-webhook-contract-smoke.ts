import assert from "node:assert/strict";
import { CallType } from "@/src/generated/prisma/client";
import { inflateBinotelFormEntries, requiresBinotelSuccessAck } from "@/src/services/binotel-webhook-payload";
import { parseBinotelWebhook } from "@/src/services/binotel-webhook.service";

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

console.log("Binotel webhook contract smoke passed");
