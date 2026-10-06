import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyMechanicProcessAppointment } from "../src/domain/mechanic-process-classification";

const linked = new Set(["diag-linked"]);

assert.equal(classifyMechanicProcessAppointment({
  id: "diag-linked",
  purpose: "REPAIR",
  workOrderId: "wo-1",
  status: "BOOKED",
  source: "PLANNER",
}, linked), "DIAGNOSTIC", "DiagnosticVisitLink must win even over legacy REPAIR/workOrder data");

assert.equal(classifyMechanicProcessAppointment({
  id: "explicit-repair",
  purpose: "REPAIR",
  workOrderId: "wo-2",
  status: "BOOKED",
  source: "PLANNER",
}, linked), "REPAIR");

assert.equal(classifyMechanicProcessAppointment({
  id: "legacy-walk-in",
  purpose: null,
  workOrderId: "wo-3",
  status: "BOOKED",
  source: "WALK_IN",
}, linked), "DIAGNOSTIC", "legacy walk-in must not become a repair card");

assert.equal(classifyMechanicProcessAppointment({
  id: "legacy-diagnostics-status",
  purpose: null,
  workOrderId: "wo-4",
  status: "DIAGNOSTICS",
  source: "PLANNER",
}, linked), "DIAGNOSTIC", "legacy DIAGNOSTICS status must not become a repair card");

assert.equal(classifyMechanicProcessAppointment({
  id: "legacy-repair",
  purpose: null,
  workOrderId: "wo-5",
  status: "BOOKED",
  source: "PLANNER",
}, linked), "REPAIR");

assert.equal(classifyMechanicProcessAppointment({
  id: "ambiguous",
  purpose: null,
  workOrderId: null,
  status: "BOOKED",
  source: "PLANNER",
}, linked), "UNCLASSIFIED", "ambiguous legacy appointments must not be guessed");

const route = readFileSync("app/api/cabinet/mechanic/process-cards/route.ts", "utf8");
const linkService = readFileSync("src/services/diagnostic-visit-link.service.ts", "utf8");

assert.match(route, /diagnosticAppointmentIds = new Set\(links\.map/, "process-card route must build the canonical linked appointment set");
assert.match(route, /classifyMechanicProcessAppointment\(row, diagnosticAppointmentIds\) === "REPAIR"/, "repair cards must use canonical classification");
assert.match(linkService, /enforceDiagnosticPurpose/, "link creation must normalize appointment purpose to diagnostics");
assert.match(linkService, /AppointmentPurpose\.DIAGNOSTICS/, "linked appointments must be persisted as DIAGNOSTICS");

console.log("[mechanic-process-cards] canonical diagnostic/repair separation OK");
