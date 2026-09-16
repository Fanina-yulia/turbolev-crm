import assert from "node:assert/strict";
import fs from "node:fs";

const wrapper = fs.readFileSync("app/parts-catalog-legacy.tsx", "utf8");
const ui = fs.readFileSync("app/parts-selection-workspace-v4.tsx", "utf8");
const selection = fs.readFileSync("src/services/parts-selection.service.ts", "utf8");
const route = fs.readFileSync("app/api/parts-selection/select/route.ts", "utf8");
const knowledge = fs.readFileSync("src/services/parts-selection-knowledge.service.ts", "utf8");

assert.equal(wrapper.includes("PartsSelectionWorkspaceV4"), true, "Diagnostic parts context must mount the V4 picker workspace");
assert.equal(
  ui.includes('if (vehicleScoped && resolvedFitment?.status !== "VERIFIED")'),
  false,
  "Frontend must not block supplier API search when exact fitment is missing",
);
assert.equal(ui.includes('offer.resultType === "ASSEMBLY" || offer.sourceKind === "ASSEMBLY"'), true, "UI must classify assembly alternatives independently");
assert.equal(ui.includes('title: "Комплектні альтернативи"'), true, "Picker must expose assembly alternatives as a visible grouped section");
assert.equal(ui.includes('title: "Потребує перевірки"'), true, "Picker must expose unconfirmed results as a visible grouped section");
assert.equal(ui.includes("needsManualConfirmation"), true, "Unsafe and assembly results must expose a manual confirmation gate");
assert.equal(ui.includes('review && !manualConfirmation'), true, "Manual confirmation must gate unsafe selections");
assert.equal(ui.includes("matchReasons: offer.matchReasons || []"), true, "Selection request must carry match provenance");
assert.equal(ui.includes('resultType: offer.resultType || null'), true, "Selection request must preserve supplier result classification");
assert.equal(ui.includes("К-ть знайдених запчастин"), true, "Grouped picker must show the real result count");

assert.equal(selection.includes("const selectionEvidence = {"), true, "Server must rebuild selection evidence from the live offer");
assert.equal(selection.includes('liveOffer.resultType === "ASSEMBLY"'), true, "Server must identify assembly offers from live supplier results");
assert.equal(selection.includes("selectionEvidence.requiresManualConfirmation && input.manualConfirmation !== true"), true, "Server must enforce explicit manual confirmation");
assert.equal(selection.includes("selectionEvidence,"), true, "Verified evidence must be returned to the API boundary");

assert.equal(route.includes("recordPartSelectionKnowledge"), true, "Selection route must record learning/feedback");
assert.equal(route.includes("const evidence = result.selectionEvidence"), true, "Knowledge persistence must use server-verified evidence");
assert.equal(route.includes("knowledgeGenericArticleId"), true, "Canonical article should be resolved before staging knowledge");

assert.equal(knowledge.includes('"PROPOSE_ASSEMBLY_ALTERNATIVE"'), true, "Assembly mappings must be staged for review, not auto-approved");
assert.equal(knowledge.includes('"PROPOSE_SUPPLIER_REFERENCE"'), true, "Selected supplier articles must be staged for review");
assert.equal(knowledge.includes('status: "PENDING"'), true, "Knowledge candidates must stay pending until reviewed");

console.log("Parts cascade UI + selection knowledge contract: PASS (20 checks)");
