import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import pg from "pg";
import { computeEffectivePermissions } from "../src/security/rbac-engine";

const authorizeSource = await fs.readFile("src/security/authorize.ts", "utf8");
assert.doesNotMatch(
  authorizeSource,
  /allowed:\s*true,\s*wouldAllow:\s*false/,
  "authorization must never allow a request that RBAC would deny",
);
assert.doesNotMatch(
  authorizeSource,
  /shadowBypass:\s*true/,
  "SHADOW must never bypass server-side authorization",
);
assert.match(
  authorizeSource,
  /response:\s*denialResponse\(context,\s*permission,\s*requiredScope\)/,
  "denied authorization must return an explicit denial response",
);

const direct = computeEffectivePermissions(
  [
    { code: "WORK_ORDERS.READ", scope: "ASSIGNED" },
    { code: "WORK_ORDERS.READ", scope: "LOCATION" },
    { code: "PAYROLL.SELF_READ", scope: "SELF" },
  ],
  [],
);
assert.equal(direct.permissions["WORK_ORDERS.READ"], "LOCATION");
assert.equal(direct.permissions["PAYROLL.SELF_READ"], "SELF");

const denied = computeEffectivePermissions(
  [{ code: "FINANCE.READ", scope: "ALL" }],
  [
    { code: "FINANCE.READ", scope: "ALL", effect: "DENY" },
    { code: "FINANCE.READ", scope: "ALL", effect: "ALLOW" },
  ],
);
assert.equal(denied.permissions["FINANCE.READ"], undefined);
assert.deepEqual(denied.deniedPermissions, ["FINANCE.READ"]);

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required for the RBAC database smoke test");

const canonicalRoleCodes = [
  "OWNER",
  "EXECUTIVE_DIRECTOR",
  "STATION_MANAGER",
  "SERVICE_ADVISOR",
  "MECHANIC",
  "PARTS_SPECIALIST",
  "WAREHOUSE_KEEPER",
  "HEAD_OF_SALES",
  "SALES",
  "ACCOUNTANT",
  "MARKETING_DIRECTOR",
  "MARKETER",
  "HR_MANAGER",
  "ADMINISTRATOR",
  "CRM_ADMIN",
] as const;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const config = await client.query(`SELECT "enforcementMode", "bootstrapCompleted", "allowSelfRegistration" FROM "SecurityConfig" WHERE id='default'`);
  assert.equal(config.rowCount, 1);
  assert.equal(config.rows[0].enforcementMode, "SHADOW");
  assert.equal(config.rows[0].bootstrapCompleted, false);
  assert.equal(config.rows[0].allowSelfRegistration, false);

  const roles = await client.query(`SELECT code FROM "AccessRole" WHERE "isActive"=true ORDER BY code`);
  assert.deepEqual(
    roles.rows.map((row) => row.code).sort(),
    [...canonicalRoleCodes].sort(),
    "active RBAC roles must match the canonical personnel structure",
  );

  const permissionCount = await client.query(`SELECT count(*)::int AS count FROM "Permission"`);
  assert.equal(permissionCount.rows[0].count, 45);

  const users = await client.query(`SELECT count(*)::int AS count FROM "User"`);
  assert.equal(users.rows[0].count, 0, "security migration must not create application users");

  const grants = await client.query(`
    SELECT r.code AS role_code, p.code AS permission_code, rp.scope
    FROM "AccessRolePermission" rp
    JOIN "AccessRole" r ON r.id=rp."roleId"
    JOIN "Permission" p ON p.id=rp."permissionId"
  `);
  const matrix = new Map<string, Set<string>>();
  const scopes = new Map<string, string>();
  for (const row of grants.rows) {
    if (!matrix.has(row.role_code)) matrix.set(row.role_code, new Set());
    matrix.get(row.role_code)!.add(row.permission_code);
    scopes.set(`${row.role_code}:${row.permission_code}`, row.scope);
  }

  for (const role of canonicalRoleCodes) {
    assert.ok(matrix.get(role)?.has("PAYROLL.SELF_READ"), `${role} must be able to read own salary`);
  }

  assert.ok(matrix.get("ACCOUNTANT")?.has("PAYROLL.ALL_READ"));
  assert.ok(matrix.get("OWNER")?.has("PAYROLL.ALL_READ"));
  assert.ok(matrix.get("EXECUTIVE_DIRECTOR")?.has("PAYROLL.ALL_READ"));
  for (const role of [
    "HEAD_OF_SALES",
    "STATION_MANAGER",
    "SERVICE_ADVISOR",
    "MECHANIC",
    "SALES",
    "PARTS_SPECIALIST",
    "WAREHOUSE_KEEPER",
    "MARKETING_DIRECTOR",
    "MARKETER",
    "HR_MANAGER",
    "ADMINISTRATOR",
    "CRM_ADMIN",
  ]) {
    assert.ok(!matrix.get(role)?.has("PAYROLL.ALL_READ"), `${role} must not read all payroll`);
  }

  for (const role of ["OWNER", "EXECUTIVE_DIRECTOR", "ACCOUNTANT"]) {
    assert.ok(matrix.get(role)?.has("PERSONNEL.COMPENSATION_READ"), `${role} should have compensation visibility`);
  }
  for (const role of [
    "HEAD_OF_SALES",
    "SALES",
    "PARTS_SPECIALIST",
    "WAREHOUSE_KEEPER",
    "STATION_MANAGER",
    "SERVICE_ADVISOR",
    "MECHANIC",
    "MARKETING_DIRECTOR",
    "MARKETER",
    "HR_MANAGER",
    "ADMINISTRATOR",
    "CRM_ADMIN",
  ]) {
    assert.ok(!matrix.get(role)?.has("PERSONNEL.COMPENSATION_READ"), `${role} must not see other salaries`);
  }

  assert.ok(matrix.get("MECHANIC")?.has("DIAGNOSTICS.WRITE"));
  assert.equal(scopes.get("MECHANIC:DIAGNOSTICS.WRITE"), "ASSIGNED");
  assert.ok(!matrix.get("MECHANIC")?.has("DIAGNOSTICS.CONFIRM"));
  assert.ok(matrix.get("SERVICE_ADVISOR")?.has("DIAGNOSTICS.CONFIRM"));
  assert.equal(scopes.get("SERVICE_ADVISOR:DIAGNOSTICS.CONFIRM"), "LOCATION");
  assert.ok(!matrix.get("SERVICE_ADVISOR")?.has("FINANCE.READ"));

  for (const role of ["OWNER", "EXECUTIVE_DIRECTOR", "CRM_ADMIN"]) {
    assert.ok(matrix.get(role)?.has("SECURITY.ACCESS_MANAGE"), `${role} must administer access`);
  }
  for (const role of [
    "HEAD_OF_SALES",
    "SALES",
    "PARTS_SPECIALIST",
    "WAREHOUSE_KEEPER",
    "STATION_MANAGER",
    "SERVICE_ADVISOR",
    "MECHANIC",
    "ACCOUNTANT",
    "MARKETING_DIRECTOR",
    "MARKETER",
    "HR_MANAGER",
    "ADMINISTRATOR",
  ]) {
    assert.ok(!matrix.get(role)?.has("SECURITY.ACCESS_MANAGE"), `${role} must not administer access`);
  }

  assert.equal(matrix.get("OWNER")?.size, 45);
  assert.equal(matrix.get("EXECUTIVE_DIRECTOR")?.size, 45);
} finally {
  await client.end();
}

console.log("RBAC smoke tests passed");
