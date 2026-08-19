import assert from "node:assert/strict";
import { buildCommunicationActivationDiagnostic } from "../src/services/communication-activation-diagnostics";

const missing = buildCommunicationActivationDiagnostic({
  key: "FACEBOOK",
  label: "Facebook Messenger",
  provider: "META",
  configured: false,
  apiConnected: false,
  transportLabel: "Webhook",
  transportReady: false,
});
assert.equal(missing.ready, false);
assert.equal(missing.steps[0]?.key, "credentials");
assert.equal(missing.steps[0]?.state, "WAITING");
assert.match(missing.nextAction || "", /доступ/i);

const healthy = buildCommunicationActivationDiagnostic({
  key: "INSTAGRAM",
  label: "Instagram Direct",
  provider: "META",
  configured: true,
  apiConnected: true,
  apiAt: "2026-08-19T12:00:00.000Z",
  transportLabel: "Webhook",
  transportReady: true,
  transportAt: "2026-08-19T12:01:00.000Z",
  inboundAt: "2026-08-19T12:02:00.000Z",
  outboundAcceptedAt: "2026-08-19T12:03:00.000Z",
  deliveredAt: "2026-08-19T12:04:00.000Z",
  readAt: "2026-08-19T12:05:00.000Z",
});
assert.equal(healthy.ready, true);
assert.equal(healthy.nextAction, null);
assert.ok(healthy.steps.every((item) => item.state === "OK"));
assert.equal(healthy.steps.at(-1)?.detail, "Одержувач прочитав повідомлення.");

const olxError = buildCommunicationActivationDiagnostic({
  key: "OLX",
  label: "OLX",
  provider: "OLX",
  configured: true,
  apiConnected: true,
  transportLabel: "OAuth",
  transportReady: false,
  transportError: "refresh token expired",
});
assert.equal(olxError.ready, false);
assert.equal(olxError.steps[2]?.state, "ERROR");
assert.equal(olxError.steps[2]?.detail, "refresh token expired");

const deliveryPending = buildCommunicationActivationDiagnostic({
  key: "FACEBOOK",
  label: "Facebook Messenger",
  provider: "META",
  configured: true,
  apiConnected: true,
  transportLabel: "Webhook",
  transportReady: true,
  inboundAt: "2026-08-19T13:00:00.000Z",
  outboundAcceptedAt: "2026-08-19T13:01:00.000Z",
});
assert.equal(deliveryPending.steps[4]?.state, "OK");
assert.equal(deliveryPending.steps[5]?.state, "WAITING");
assert.match(deliveryPending.steps[5]?.detail || "", /delivery\/read/i);

const failedLatest = buildCommunicationActivationDiagnostic({
  key: "INSTAGRAM",
  label: "Instagram Direct",
  provider: "META",
  configured: true,
  apiConnected: true,
  transportLabel: "Webhook",
  transportReady: true,
  inboundAt: "2026-08-19T14:00:00.000Z",
  outboundAcceptedAt: "2026-08-19T14:01:00.000Z",
  failedAt: "2026-08-19T14:02:00.000Z",
});
assert.equal(failedLatest.steps[4]?.state, "ERROR");
assert.equal(failedLatest.steps[5]?.state, "ERROR");

console.log("communication activation diagnostics smoke: ok");
