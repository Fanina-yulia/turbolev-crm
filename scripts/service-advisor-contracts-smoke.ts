import assert from "node:assert/strict";
import { parseServiceAdvisorCabinetPayload } from "@/src/lib/contracts/service-advisor-payload.parsers";

const start = "2026-08-20T09:00:00.000Z";

const linked = parseServiceAdvisorCabinetPayload({
  ok: true,
  linked: true,
  station: { id: "station-1", name: "Глеваха" },
  kpis: { today: 6, arrived: 2, approval: 1, waitingParts: 1, inRepair: 2, mechanicFindings: 1 },
  appointments: [{
    id: "appointment-1",
    status: "ARRIVED",
    start,
    plate: "AA1234AA",
    vehicle: "Volkswagen Passat 2018",
    problem: "Стук спереду",
    post: "Пост 1",
    mechanic: "Механік",
  }],
  diagnostics: [{
    id: "diagnostic-1",
    status: "IN_PROGRESS",
    plate: "AA1234AA",
    vehicle: "Volkswagen Passat",
    client: "Марія",
  }],
  mechanicFindings: [{
    id: "finding-1",
    workOrderId: "wo-1",
    workOrderLineId: "line-1",
    status: "SUBMITTED",
    resolutionCode: null,
    estimateLineId: null,
    urgency: "CRITICAL",
    findingText: "Люфт кульової опори",
    recommendation: "Замінити",
    managerComment: null,
    mechanicReply: null,
    mechanicRepliedAt: null,
    submittedAt: start,
    reviewedAt: null,
    mechanic: "Механік",
    workDescription: "Діагностика ходової",
    plate: "AA1234AA",
    vehicle: "Volkswagen Passat 2018",
    media: [{ id: "media-1", fileName: "finding.jpg", mimeType: "image/jpeg", fileSize: 1024, url: "/api/cabinet/findings/finding-1/media/media-1" }],
  }],
});
assert(linked && linked.linked);
assert.equal(linked.kpis.mechanicFindings, 1);
assert.equal(linked.mechanicFindings[0]?.workOrderLineId, "line-1");
assert.equal(linked.mechanicFindings[0]?.urgency, "CRITICAL");

const unlinked = parseServiceAdvisorCabinetPayload({ ok: true, linked: false, reason: "LOCATION_NOT_ASSIGNED" });
assert(unlinked && !unlinked.linked);
assert.equal(unlinked.reason, "LOCATION_NOT_ASSIGNED");

assert.equal(parseServiceAdvisorCabinetPayload({
  ok: true,
  linked: true,
  station: { id: "station-1", name: "Глеваха" },
  kpis: { today: -1, arrived: 0, approval: 0, waitingParts: 0, inRepair: 0, mechanicFindings: 0 },
  appointments: [],
  diagnostics: [],
  mechanicFindings: [],
}), null);

assert.equal(parseServiceAdvisorCabinetPayload({
  ok: true,
  linked: true,
  station: { id: "station-1", name: "Глеваха" },
  kpis: { today: 1, arrived: 1, approval: 0, waitingParts: 0, inRepair: 0, mechanicFindings: 0 },
  appointments: [{ id: "appointment-1", status: "UNKNOWN", start, plate: "AA", vehicle: "Car", problem: null, post: null, mechanic: null }],
  diagnostics: [],
  mechanicFindings: [],
}), null);

assert.equal(parseServiceAdvisorCabinetPayload({
  ok: true,
  linked: true,
  station: { id: "station-1", name: "Глеваха" },
  kpis: { today: 0, arrived: 0, approval: 0, waitingParts: 0, inRepair: 0, mechanicFindings: 1 },
  appointments: [],
  diagnostics: [],
  mechanicFindings: [{
    id: "finding-1", workOrderId: "wo-1", workOrderLineId: "line-1", status: "SUBMITTED", resolutionCode: null,
    estimateLineId: null, urgency: "UNKNOWN", findingText: "Text", recommendation: null, managerComment: null, mechanicReply: null,
    mechanicRepliedAt: null, submittedAt: start, reviewedAt: null, mechanic: "M", workDescription: "Work", plate: "AA", vehicle: "Car", media: [],
  }],
}), null);

console.log("Service advisor contracts smoke: OK");
