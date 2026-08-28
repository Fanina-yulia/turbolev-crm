import { readFile } from "node:fs/promises";

const checks = [
  ["app/api/vehicles/route.ts", ["authorize(", "CLIENTS_READ"]],
  ["app/api/vehicles/card/route.ts", ["authorize(", "CLIENTS_READ"]],
  ["app/api/clients-vehicles/route.ts", ["authorize(", "CLIENTS_READ"]],
  ["app/api/client-card/route.ts", ["authorize(", "CLIENTS_WRITE"]],
  ["app/api/communications/route.ts", ["authorize(", "COMMUNICATIONS_READ", "COMMUNICATIONS_WRITE"]],
  ["app/api/search/route.ts", ["authorize(", "strict: true", "hasPermission"]],
  ["app/api/webhooks/website/route.ts", ["WEBHOOK_NOT_CONFIGURED", "enforceRequestRateLimit"]],
  ["app/api/auth/local/sign-in/route.ts", ["local-sign-in-ip", "local-sign-in-account"]],
  ["app/api/cabinet/mechanic/tasks/[lineId]/route.ts", ["PLATE_VERIFICATION_REQUIRED", "normalizeRegistrationPlate"]],
  ["app/api/cabinet/mechanic/tasks/[lineId]/verify-plate/route.ts", ["PLATE_MISMATCH", "MECHANIC_PLATE_VERIFIED"]],
  ["app/api/cabinet/execution-issues/route.ts", ["REASSIGN", "RESCHEDULE", "SCHEDULE_CONFLICT", "pg_advisory_xact_lock"]],
  ["app/api/cabinet/execution-issues/[issueId]/comments/route.ts", ["EXECUTION_ISSUE_COMMENT_ADDED"]],
  ["prisma/migrations/20260828120000_execution_issue_comments/migration.sql", ["WorkExecutionIssueComment", "issueId_fkey"]],
];

const failures = [];
for (const [path, markers] of checks) {
  const source = await readFile(path, "utf8");
  for (const marker of markers) if (!source.includes(marker)) failures.push(`${path}: missing ${marker}`);
}
if (failures.length) {
  console.error("[crm-hardening-smoke] FAIL");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`[crm-hardening-smoke] OK — ${checks.length} hardening contracts verified.`);
