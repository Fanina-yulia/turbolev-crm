import assert from "node:assert/strict";
import { parseCabinetHomePayload } from "@/src/lib/contracts/cabinet-home-payload.parsers";

const start = "2026-08-20T09:00:00.000Z";
const end = "2026-08-20T10:00:00.000Z";

const mechanicLinked = parseCabinetHomePayload({
  ok: true,
  cabinet: "MECHANIC",
  linked: true,
  mechanic: { id: "mechanic-1", name: "Механік", station: { id: "station-1", name: "Глеваха" } },
  kpis: { assigned: 2, scheduledToday: 1, inProgress: 1, completedToday: 3, waitingParts: 0 },
  tasks: [{
    id: "line-1",
    workOrderId: "wo-1",
    description: "Діагностика ходової",
    status: "IN_PROGRESS",
    type: "LABOR",
    laborHours: "1.5",
    plate: "AA1234AA",
    vehicle: "Volkswagen Passat 2018",
    workOrderStatus: "IN_REPAIR",
    updatedAt: start,
  }],
  appointments: [{
    id: "appointment-1",
    workOrderId: null,
    status: "ARRIVED",
    workOrderStatus: null,
    plannedStartAt: start,
    plannedEndAt: end,
    plate: "AA1234AA",
    vehicle: "Volkswagen Passat 2018",
    problem: "Стук спереду",
    post: null,
  }],
});
assert(mechanicLinked && mechanicLinked.cabinet === "MECHANIC" && mechanicLinked.linked);
assert.equal(mechanicLinked.kpis.scheduledToday, 1);
assert.equal(mechanicLinked.appointments[0]?.workOrderId, null);

const mechanicUnlinked = parseCabinetHomePayload({
  ok: true,
  cabinet: "MECHANIC",
  linked: false,
  reason: "MECHANIC_RESOURCE_NOT_LINKED",
});
assert(mechanicUnlinked && mechanicUnlinked.cabinet === "MECHANIC" && !mechanicUnlinked.linked);

const managerKpis = {
  carsToday: 8,
  carsOnStation: 5,
  inRepair: 2,
  postsOccupied: 2,
  postsTotal: 4,
  mechanicsTotal: 3,
  noShow: 1,
  needsAction: 6,
  overdue: 3,
  unassigned: 1,
  missedCalls: 2,
  newInquiries: 3,
  stuckCars: 2,
  proposalsNotSent: 1,
  waitingCustomerDecision: 2,
  partsBlocking: 1,
};

const managerLinked = parseCabinetHomePayload({
  ok: true,
  cabinet: "STATION_MANAGER",
  linked: true,
  station: { id: "station-1", name: "Глеваха" },
  kpis: managerKpis,
  flow: { booked: 2, diagnostics: 1, approval: 1, waitingParts: 1, readyForRepair: 0, inRepair: 2, qc: 1, ready: 0 },
  attention: [{
    id: "estimate:est-1:not-sent",
    sourceType: "ESTIMATE",
    sourceId: "est-1",
    code: "COMMERCIAL_PROPOSAL_NOT_SENT",
    title: "KA5678KA: комерційна пропозиція не відправлена",
    description: "Діагностика ходової",
    priority: "HIGH",
    reason: "Остання ревізія кошторису залишається DRAFT.",
    overdue: true,
    waitingMinutes: 45,
    plate: "KA5678KA",
    vehicle: "Volvo XC90 2020",
    customer: "Клієнт",
    action: {
      label: "Відкрити кошторис",
      section: "Замовлення-наряди",
      params: { workOrderId: "wo-2", workOrderTab: "estimate" },
    },
  }],
  posts: [{
    id: "post-1",
    name: "Пост 1",
    occupied: true,
    plate: "KA5678KA",
    vehicle: "Volvo XC90 2020",
    mechanic: "Механік",
    plannedEndAt: end,
  }],
  mechanics: [{
    id: "mechanic-1",
    name: "Механік",
    activeCars: 2,
    inRepair: 1,
    waiting: 1,
    available: false,
  }],
});
assert(managerLinked && managerLinked.cabinet === "STATION_MANAGER" && managerLinked.linked);
assert.equal(managerLinked.attention[0]?.code, "COMMERCIAL_PROPOSAL_NOT_SENT");
assert.equal(managerLinked.attention[0]?.action.params?.workOrderTab, "estimate");
assert.equal(managerLinked.kpis.missedCalls, 2);
assert.equal(managerLinked.kpis.proposalsNotSent, 1);
assert.equal(managerLinked.kpis.needsAction, 6);
assert.equal(managerLinked.posts[0]?.occupied, true);
assert.equal(managerLinked.mechanics[0]?.activeCars, 2);

assert.equal(parseCabinetHomePayload({
  ok: true,
  cabinet: "MECHANIC",
  linked: true,
  mechanic: { id: "m", name: "M", station: { id: "s", name: "S" } },
  kpis: { assigned: 1, scheduledToday: -1, inProgress: 0, completedToday: 0, waitingParts: 0 },
  tasks: [],
  appointments: [],
}), null);

assert.equal(parseCabinetHomePayload({
  ok: true,
  cabinet: "STATION_MANAGER",
  linked: true,
  station: { id: "s", name: "S" },
  kpis: { ...managerKpis, missedCalls: -1 },
  flow: { booked: 1, diagnostics: 0, approval: 0, waitingParts: 0, readyForRepair: 0, inRepair: 0, qc: 0, ready: 0 },
  attention: [],
  posts: [],
  mechanics: [],
}), null);

assert.equal(parseCabinetHomePayload({
  ok: true,
  cabinet: "STATION_MANAGER",
  linked: true,
  station: { id: "s", name: "S" },
  kpis: managerKpis,
  flow: { booked: 1, diagnostics: 0, approval: 0, waitingParts: 0, readyForRepair: 0, inRepair: 0, qc: 0, ready: 0 },
  attention: [{
    id: "bad",
    sourceType: "UNKNOWN",
    sourceId: "x",
    code: "TEST",
    title: "Test",
    description: null,
    priority: "HIGH",
    reason: "Test",
    overdue: false,
    waitingMinutes: 0,
    plate: null,
    vehicle: null,
    customer: null,
    action: { label: "Відкрити", section: "Планувальник" },
  }],
  posts: [],
  mechanics: [],
}), null);

console.log("Cabinet home contracts smoke: OK");
