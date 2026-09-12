import assert from "node:assert/strict";
import {
  BLOCKER_LABELS,
  type BlockerCode,
} from "../src/domain/workflow";
import {
  blockerCodeForExecutionIssue,
  OPERATIONAL_BLOCKER_PRIORITIES,
  OPERATIONAL_BLOCKER_SOURCE_TYPES,
  OPERATIONAL_BLOCKER_STATUSES,
  parseOperationalBlockerCode,
  parseOperationalBlockerPriority,
  parseOperationalBlockerSourceType,
  parseOperationalBlockerStatus,
} from "../src/services/operational-blockers.service";

assert.equal(OPERATIONAL_BLOCKER_STATUSES.join(","), "OPEN,ACKNOWLEDGED,RESOLVED,CANCELLED");
assert.equal(OPERATIONAL_BLOCKER_PRIORITIES.join(","), "LOW,MEDIUM,HIGH,CRITICAL");
assert.ok(OPERATIONAL_BLOCKER_SOURCE_TYPES.includes("WORK_ORDER_LINE"));
assert.equal(parseOperationalBlockerCode("parts_missing"), "PARTS_MISSING");
assert.equal(parseOperationalBlockerPriority("critical"), "CRITICAL");
assert.equal(parseOperationalBlockerSourceType("work_order_line"), "WORK_ORDER_LINE");
assert.equal(parseOperationalBlockerStatus("acknowledged"), "ACKNOWLEDGED");
assert.equal(blockerCodeForExecutionIssue("PARTS_UNAVAILABLE"), "PARTS_MISSING");
assert.equal(blockerCodeForExecutionIssue("BAY_OCCUPIED"), "POST_UNAVAILABLE");
assert.equal(Object.keys(BLOCKER_LABELS).length >= 15, true);

const typed: BlockerCode = "OTHER";
assert.equal(typed, "OTHER");

console.log("Operational blocker contract smoke passed");
