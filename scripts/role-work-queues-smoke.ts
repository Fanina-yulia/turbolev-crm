import assert from "node:assert/strict";
import {
  assertRoleQueuePolicyCoverage,
  buildRoleWorkQueues,
  ROLE_QUEUE_POLICIES,
  type RoleQueueSignal,
} from "../src/domain/role-work-queues";
import { CANONICAL_ROLE_CODES } from "../src/security/role-contract";

function signal(input: Partial<RoleQueueSignal> & Pick<RoleQueueSignal, "id" | "category">): RoleQueueSignal {
  return {
    id: input.id,
    sourceType: input.sourceType ?? "WORK_ORDER",
    taskId: input.taskId ?? null,
    category: input.category,
    level: input.level ?? "MEDIUM",
    bucket: input.bucket ?? "ACTION",
    dueAt: input.dueAt ?? null,
    occurredAt: input.occurredAt ?? "2026-09-12T08:00:00.000Z",
    isOverdue: input.isOverdue ?? false,
    metadata: input.metadata ?? {},
  };
}

assert.equal(assertRoleQueuePolicyCoverage(), true);
assert.deepEqual(Object.keys(ROLE_QUEUE_POLICIES).sort(), [...CANONICAL_ROLE_CODES].sort());

const owner = buildRoleWorkQueues({
  roles: [{ code: "OWNER", isPrimary: true }],
  signals: [
    signal({ id: "finance-critical", category: "FINANCE", level: "CRITICAL" }),
    signal({ id: "service-high", category: "SERVICE", level: "HIGH" }),
    signal({ id: "service-medium", category: "SERVICE", level: "MEDIUM" }),
  ],
  userId: "owner-1",
  now: new Date("2026-09-12T09:00:00.000Z"),
});
assert.deepEqual(owner.actionRequired.map((item) => item.id), ["finance-critical"]);
assert.deepEqual(owner.attentionCenter.map((item) => item.id), ["service-high", "service-medium"]);

const manager = buildRoleWorkQueues({
  roles: [{ code: "STATION_MANAGER", isPrimary: true }],
  signals: [
    signal({ id: "critical-repair", category: "SERVICE", level: "CRITICAL" }),
    signal({ id: "high-parts", category: "PARTS", level: "HIGH", isOverdue: true }),
    signal({ id: "post-monitor", category: "POSTS", level: "MEDIUM", bucket: "MONITORING" }),
  ],
  userId: "manager-1",
});
assert.deepEqual(manager.actionRequired.map((item) => item.id), ["critical-repair", "high-parts"]);
assert.deepEqual(manager.attentionCenter.map((item) => item.id), ["post-monitor"]);

const mechanic = buildRoleWorkQueues({
  roles: [{ code: "MECHANIC", isPrimary: true }],
  signals: [
    signal({ id: "foreign-live", category: "DIAGNOSTICS", level: "HIGH", metadata: { assigneeUserId: "mechanic-2" } }),
    signal({ id: "owned-live", category: "DIAGNOSTICS", level: "HIGH", metadata: { assigneeUserId: "mechanic-1" } }),
    signal({ id: "personal-task", category: "SERVICE", level: "MEDIUM", taskId: "task-1" }),
  ],
  userId: "mechanic-1",
});
assert.deepEqual(mechanic.actionRequired.map((item) => item.id), ["owned-live", "personal-task"]);
assert.deepEqual(mechanic.attentionCenter.map((item) => item.id), ["foreign-live"]);

const sales = buildRoleWorkQueues({
  roles: [{ code: "SALES", isPrimary: true }],
  signals: [
    signal({ id: "team-lead", category: "COMMUNICATIONS", level: "HIGH", sourceType: "LEAD" }),
    signal({ id: "my-lead", category: "COMMUNICATIONS", level: "HIGH", sourceType: "LEAD", metadata: { responsibleUserId: "sales-1" } }),
  ],
  userId: "sales-1",
});
assert.deepEqual(sales.actionRequired.map((item) => item.id), ["my-lead"]);
assert.deepEqual(sales.attentionCenter.map((item) => item.id), ["team-lead"]);

const sorted = buildRoleWorkQueues({
  roles: [{ code: "SERVICE_ADVISOR", isPrimary: true }],
  signals: [
    signal({ id: "medium", category: "SERVICE", level: "MEDIUM" }),
    signal({ id: "critical", category: "SERVICE", level: "CRITICAL" }),
    signal({ id: "high-overdue", category: "SERVICE", level: "HIGH", isOverdue: true }),
    signal({ id: "high-normal", category: "SERVICE", level: "HIGH" }),
  ],
  userId: "advisor-1",
});
assert.deepEqual(sorted.actionRequired.map((item) => item.id), ["critical", "high-overdue", "high-normal", "medium"]);

for (const queue of [owner, manager, mechanic, sales, sorted]) {
  const actionIds = new Set(queue.actionRequired.map((item) => item.id));
  assert.equal(queue.attentionCenter.some((item) => actionIds.has(item.id)), false, "signal cannot exist in both queues");
  assert.equal(queue.summary.actionRequired, queue.actionRequired.length);
  assert.equal(queue.summary.attentionCenter, queue.attentionCenter.length);
}

const unknown = buildRoleWorkQueues({
  roles: [{ code: "UNKNOWN" }],
  signals: [signal({ id: "hidden", category: "SERVICE" })],
});
assert.equal(unknown.primaryRole, null);
assert.equal(unknown.hidden, 1);
assert.equal(unknown.actionRequired.length, 0);
assert.equal(unknown.attentionCenter.length, 0);

console.log("role-work-queues-smoke: ok");
