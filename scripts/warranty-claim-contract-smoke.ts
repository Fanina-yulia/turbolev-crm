import assert from "node:assert/strict";
import {
  WARRANTY_CLAIM_STATUS_CODES,
  WARRANTY_CLAIM_STATUS_LABELS,
  WARRANTY_CLAIM_TERMINAL_STATUS_CODES,
  WARRANTY_CLAIM_TRANSITIONS,
  isWarrantyClaimStatus,
  isWarrantyClaimTransitionAllowed,
} from "@/src/domain/warranty/contract";

assert.deepEqual(WARRANTY_CLAIM_STATUS_CODES, ["OPEN", "REVIEW", "APPROVED", "REJECTED", "CLOSED"]);
assert.equal(WARRANTY_CLAIM_STATUS_LABELS.OPEN, "Нове");
assert.deepEqual(WARRANTY_CLAIM_TERMINAL_STATUS_CODES, ["REJECTED", "CLOSED"]);
assert.equal(isWarrantyClaimStatus("REVIEW"), true);
assert.equal(isWarrantyClaimStatus("ACTIVE"), false);

assert.equal(isWarrantyClaimTransitionAllowed("OPEN", "REVIEW"), true);
assert.equal(isWarrantyClaimTransitionAllowed("REVIEW", "APPROVED"), true);
assert.equal(isWarrantyClaimTransitionAllowed("APPROVED", "CLOSED"), true);
assert.equal(isWarrantyClaimTransitionAllowed("OPEN", "CLOSED"), false);
assert.equal(isWarrantyClaimTransitionAllowed("CLOSED", "REVIEW"), false);
assert.equal(isWarrantyClaimTransitionAllowed("REVIEW", "REVIEW"), true);
assert.deepEqual(WARRANTY_CLAIM_TRANSITIONS.CLOSED, []);

console.log("Warranty claim contract smoke: OK");
