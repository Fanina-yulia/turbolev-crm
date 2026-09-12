import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BLOCKER_LABELS, type BlockerCode } from "../src/domain/workflow";

const service = await readFile(join(process.cwd(), "src/services/operational-blockers.service.ts"), "utf8");

assert.match(service, /OPERATIONAL_BLOCKER_STATUSES = \["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"\]/);
assert.match(service, /OPERATIONAL_BLOCKER_PRIORITIES = \["LOW", "MEDIUM", "HIGH", "CRITICAL"\]/);
assert.match(service, /WORK_ORDER_LINE/);
assert.match(service, /parseOperationalBlockerCode/);
assert.match(service, /parseOperationalBlockerPriority/);
assert.match(service, /parseOperationalBlockerSourceType/);
assert.match(service, /parseOperationalBlockerStatus/);
assert.match(service, /PARTS_UNAVAILABLE: "PARTS_MISSING"/);
assert.match(service, /BAY_OCCUPIED: "POST_UNAVAILABLE"/);
assert.match(service, /OPERATIONAL_BLOCKER_OPENED/);
assert.match(service, /pg_advisory_xact_lock/);
assert.equal(Object.keys(BLOCKER_LABELS).length >= 15, true);

const typed: BlockerCode = "OTHER";
assert.equal(typed, "OTHER");

console.log("Operational blocker contract smoke passed");
