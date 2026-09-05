import assert from "node:assert/strict";
import { resolveDiagnosticWorkflowState } from "@/src/services/diagnostic-workflow.service";

assert.equal(resolveDiagnosticWorkflowState("IN_PROGRESS", null), "IN_PROGRESS");
assert.equal(resolveDiagnosticWorkflowState("IN_PROGRESS", "SUBMITTED"), "SUBMITTED");
assert.equal(resolveDiagnosticWorkflowState("IN_PROGRESS", "RETURNED"), "RETURNED");
assert.equal(resolveDiagnosticWorkflowState("IN_PROGRESS", "CONFIRMED"), "CONFIRMED");
assert.equal(resolveDiagnosticWorkflowState("CONFIRMED", null), "CONFIRMED");
assert.equal(resolveDiagnosticWorkflowState("CANCELLED", "DRAFT"), "CANCELLED");

console.log("Diagnostic workflow contracts smoke: OK");
