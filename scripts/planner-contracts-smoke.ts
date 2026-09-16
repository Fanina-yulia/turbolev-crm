import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePlannerBoardPayload } from "@/src/lib/contracts/planner-payload.parsers";
import { derivePlannerFinancialPresentation } from "@/src/services/planner-financial-summary.service";

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

const notCalculated = derivePlannerFinancialPresentation({
  amount: null,
  approved: false,
  paid: 0,
  appointmentStatus: "WAITING_PAYMENT",
});
assert.equal(notCalculated.displayStatus, "Очікує розрахунку");
assert.equal(notCalculated.approvalState, "NOT_CALCULATED");

const estimated = derivePlannerFinancialPresentation({
  amount: 3000,
  approved: false,
  paid: 0,
  appointmentStatus: "BOOKED",
});
assert.equal(estimated.displayStatus, "Очікує погодження");
assert.equal(estimated.approvalState, "ESTIMATED");

const prepaid = derivePlannerFinancialPresentation({
  amount: 3000,
  approved: true,
  paid: 1000,
  appointmentStatus: "IN_REPAIR",
});
assert.equal(prepaid.displayStatus, "Частково оплачено");
assert.equal(prepaid.outstanding, 2000);

const fullyPaid = derivePlannerFinancialPresentation({
  amount: 3000,
  approved: true,
  paid: 3000,
  appointmentStatus: "COMPLETED",
});
assert.equal(fullyPaid.displayStatus, "Оплачено");
assert.equal(fullyPaid.outstanding, 0);

const compactWindowSource = readFileSync(new URL("../app/planner-appointment-window-enhancer.tsx", import.meta.url), "utf8");
assert(compactWindowSource.includes("Орієнтовна вартість"), "unapproved amount label should be present");
assert(compactWindowSource.includes("Вартість"), "approved amount label should be present");
assert(compactWindowSource.includes("Передплата"), "prepayment label should be present");
assert(compactWindowSource.includes("Залишок"), "balance label should be present");
assert(compactWindowSource.includes("Оплачено"), "paid label should be present");
assert(compactWindowSource.includes("Додатково до погодження"), "additional approval amount should be present");
assert(compactWindowSource.includes("/financial-summary"), "planner appointment should load canonical financial summary");
assert(!compactWindowSource.includes("Орієнтовна вартість діагностики"), "legacy diagnostic-only amount label must be removed");
assert(compactWindowSource.includes('navigateCrm("Клієнти", { clientId })'), "client click should open exact client card");
assert(compactWindowSource.includes('[data-planner-hidden="true"]'), "large duplicate sections should be hidden in compact mode");
assert(compactWindowSource.includes("max-height: calc(100vh - 16px)"), "desktop detail window should be constrained to one viewport");

console.log("Planner contracts smoke: OK");
