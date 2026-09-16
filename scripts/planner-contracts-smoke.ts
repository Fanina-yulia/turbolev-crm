import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePlannerBoardPayload } from "@/src/lib/contracts/planner-payload.parsers";

const start = "2026-08-20T12:00:00.000Z";
const end = "2026-08-20T13:00:00.000Z";

const post = {
  id: "post-1",
  name: "Пост 1",
  sortOrder: 1,
  capabilities: ["TYPE:LIFT"],
};

const mechanic = {
  id: "mechanic-1",
  name: "Іван Механік",
  sortOrder: 1,
};

const location = {
  id: "location-1",
  name: "Глеваха",
  timezone: "Europe/Kyiv",
  openMinute: 540,
  closeMinute: 1260,
  posts: [post],
  mechanics: [mechanic],
};

const appointment = {
  id: "appointment-1",
  locationId: location.id,
  postId: post.id,
  mechanicId: mechanic.id,
  status: "IN_REPAIR",
  workOrderId: "work-order-1",
  purpose: "REPAIR",
  processStatus: "IN_REPAIR",
  processLabel: "У ремонті",
  payment: { status: "UNPAID", amount: "2500", paid: 0, outstanding: "2500" },
  vehicleId: "vehicle-1",
  customerName: "Марія",
  phone: "+380670000000",
  vehicleLabel: "Volkswagen Passat 2018",
  plateNumber: "AA1234AA",
  problem: "Діагностика ходової",
  comment: null,
  source: "PLANNER",
  estimatedAmount: "2500",
  priority: 1,
  plannedStartAt: start,
  plannedEndAt: end,
  actualArrivalAt: start,
  actualStartAt: start,
  actualEndAt: null,
  partsEtaAt: null,
  post,
  mechanic,
};

const payload = parsePlannerBoardPayload({
  status: "OK",
  locations: [location],
  activeLocationId: location.id,
  appointments: [appointment],
});
assert(payload);
assert.equal(payload.activeLocationId, location.id);
assert.equal(payload.appointments[0]?.status, "IN_REPAIR");
assert.equal(payload.appointments[0]?.estimatedAmount, "2500");
assert.equal(payload.locations[0]?.posts[0]?.capabilities[0], "TYPE:LIFT");

assert.equal(parsePlannerBoardPayload({
  status: "OK",
  locations: [location],
  activeLocationId: "missing-location",
  appointments: [appointment],
}), null);

assert.equal(parsePlannerBoardPayload({
  status: "OK",
  locations: [location],
  activeLocationId: location.id,
  appointments: [{ ...appointment, status: "UNKNOWN" }],
}), null);

assert.equal(parsePlannerBoardPayload({
  status: "OK",
  locations: [{ ...location, posts: [{ ...post, capabilities: [123] }] }],
  activeLocationId: location.id,
  appointments: [appointment],
}), null);

const compactWindowSource = readFileSync(new URL("../app/planner-appointment-window-enhancer.tsx", import.meta.url), "utf8");
assert(compactWindowSource.includes("estimatedAmount"), "planner detail window should use appointment estimated amount");
assert(compactWindowSource.includes("Орієнтовна сума робіт"), "repair estimate label should be present");
assert(compactWindowSource.includes("Орієнтовна вартість діагностики"), "diagnostic estimate label should be present");
assert(
  compactWindowSource.includes('navigateCrm("Клієнти"') && compactWindowSource.includes("clientId"),
  "client click should open exact client card",
);
assert(compactWindowSource.includes('[data-planner-hidden="true"]'), "large duplicate sections should be hidden in compact mode");
assert(/max-height:\s*calc\(100vh - 16px\)/.test(compactWindowSource), "desktop detail window should be constrained to one viewport");

console.log("Planner contracts smoke: OK");
