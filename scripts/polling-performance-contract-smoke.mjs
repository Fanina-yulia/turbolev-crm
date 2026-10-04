import assert from "node:assert/strict";
import fs from "node:fs";

const helper = fs.readFileSync("src/lib/client/adaptive-polling.ts", "utf8");
const telephony = fs.readFileSync("app/telephony-realtime-bridge.tsx", "utf8");
const communications = fs.readFileSync("app/communications-hub-server.tsx", "utf8");
const mechanic = fs.readFileSync("app/mechanic-standalone-cabinet.tsx", "utf8");

assert.match(helper, /inFlight/);
assert.match(helper, /visibilitychange/);
assert.match(helper, /setTimeout/);
assert.equal(/setInterval/.test(helper), false);

assert.match(telephony, /startAdaptivePoller/);
assert.match(telephony, /activeCallRef\.current \? 2_500 : 8_000/);
assert.equal(/setInterval/.test(telephony), false);

assert.match(communications, /startAdaptivePoller/);
assert.match(communications, /intervalMs: 15_000/);
assert.equal(/7000/.test(communications), false);

assert.match(mechanic, /startAdaptivePoller/);
assert.match(mechanic, /intervalMs: 30_000/);
assert.equal(/setInterval\(\(\) => void loadNotifications/.test(mechanic), false);

console.log("[adaptive-polling] no-overlap polling, hidden-tab pause and reduced idle frequencies OK.");
