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

const managerLinked = parseCabinetHomePayload({
  ok: true,
  cabinet: "STATION_MANAGER",
  linked: true,
  station: { id: "station-1", name: "Глеваха" },
  kpis: { carsToday: 8, carsOnStation: 5, inRepair: 2, postsOccupied: 2, postsTotal: 4, mechanicsTotal: 3, noShow: 1 },
  flow: { booked: 2, diagnostics: 1, approval: 1, waitingParts: 1, readyForRepair: 0, inRepair: 2, qc: 1, ready: 0 },
  attention: [{
    id: "appointment-2",
    status: "WAITING_PARTS",
    plate: "KA5678KA",
    vehicle: "Volvo XC90 2020",
    problem: null,
    plannedStartAt: start,
    post: "Пост 2",
    mechanic: "Механік",
  }],
});
assert(managerLinked && managerLinked.cabinet === "STATION_MANAGER" && managerLinked.linked);
assert.equal(managerLinked.attention[0]?.status, "WAITING_PARTS");

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
  kpis: { carsToday: 1, carsOnStation: 1, inRepair: 0, postsOccupied: 0, postsTotal: 1, mechanicsTotal: 1, noShow: 0 },
  flow: { booked: 1, diagnostics: 0, approval: 0, waitingParts: 0, readyForRepair: 0, inRepair: 0, qc: 0, ready: 0 },
  attention: [{ id: "a", status: "UNKNOWN", plate: "AA", vehicle: "Car", problem: null, plannedStartAt: start, post: null, mechanic: null }],
}), null);

console.log("Cabinet home contracts smoke: OK");
