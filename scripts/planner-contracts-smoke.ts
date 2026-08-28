import assert from "node:assert/strict";
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

console.log("Planner contracts smoke: OK");
