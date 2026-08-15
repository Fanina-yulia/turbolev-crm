import assert from "node:assert/strict";
import pg from "pg";
import { computeEffectivePermissions } from "../src/security/rbac-engine";

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

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const config = await client.query(`SELECT "enforcementMode", "bootstrapCompleted", "allowSelfRegistration" FROM "SecurityConfig" WHERE id='default'`);
  assert.equal(config.rowCount, 1);
  assert.equal(config.rows[0].enforcementMode, "SHADOW");
  assert.equal(config.rows[0].bootstrapCompleted, false);
  assert.equal(config.rows[0].allowSelfRegistration, false);

  const roleCount = await client.query(`SELECT count(*)::int AS count FROM "AccessRole" WHERE "isActive"=true`);
  assert.equal(roleCount.rows[0].count, 9);

  const permissionCount = await client.query(`SELECT count(*)::int AS count FROM "Permission"`);
  assert.equal(permissionCount.rows[0].count, 45);

  const users = await client.query(`SELECT count(*)::int AS count FROM "User"`);
  assert.equal(users.rows[0].count, 0, "security migration must not create application users");

  const grants = await client.query(`
    SELECT r.code AS role_code, p.code AS permission_code
    FROM "AccessRolePermission" rp
    JOIN "AccessRole" r ON r.id=rp."roleId"
    JOIN "Permission" p ON p.id=rp."permissionId"
  `);
  const matrix = new Map<string, Set<string>>();
  for (const row of grants.rows) {
    if (!matrix.has(row.role_code)) matrix.set(row.role_code, new Set());
    matrix.get(row.role_code)!.add(row.permission_code);
  }

  const roleCodes = ["OWNER","EXECUTIVE_DIRECTOR","HEAD_OF_SALES","SALES","PARTS_SPECIALIST","STATION_MANAGER","MECHANIC","ACCOUNTANT","ADMINISTRATOR"];
  for (const role of roleCodes) {
    assert.ok(matrix.get(role)?.has("PAYROLL.SELF_READ"), `${role} must be able to read own salary`);
  }

  assert.ok(matrix.get("ACCOUNTANT")?.has("PAYROLL.ALL_READ"));
  assert.ok(matrix.get("OWNER")?.has("PAYROLL.ALL_READ"));
  assert.ok(matrix.get("EXECUTIVE_DIRECTOR")?.has("PAYROLL.ALL_READ"));
  assert.ok(!matrix.get("HEAD_OF_SALES")?.has("PAYROLL.ALL_READ"));
  assert.ok(!matrix.get("STATION_MANAGER")?.has("PAYROLL.ALL_READ"));
  assert.ok(!matrix.get("MECHANIC")?.has("PAYROLL.ALL_READ"));
  assert.ok(!matrix.get("SALES")?.has("PAYROLL.ALL_READ"));

  for (const role of ["OWNER", "EXECUTIVE_DIRECTOR", "ACCOUNTANT"]) {
    assert.ok(matrix.get(role)?.has("PERSONNEL.COMPENSATION_READ"), `${role} should have compensation visibility`);
  }
  for (const role of ["HEAD_OF_SALES", "SALES", "PARTS_SPECIALIST", "STATION_MANAGER", "MECHANIC", "ADMINISTRATOR"]) {
    assert.ok(!matrix.get(role)?.has("PERSONNEL.COMPENSATION_READ"), `${role} must not see other salaries`);
  }

  assert.ok(matrix.get("OWNER")?.has("SECURITY.ACCESS_MANAGE"));
  assert.ok(matrix.get("EXECUTIVE_DIRECTOR")?.has("SECURITY.ACCESS_MANAGE"));
  for (const role of ["HEAD_OF_SALES", "SALES", "PARTS_SPECIALIST", "STATION_MANAGER", "MECHANIC", "ACCOUNTANT", "ADMINISTRATOR"]) {
    assert.ok(!matrix.get(role)?.has("SECURITY.ACCESS_MANAGE"), `${role} must not administer access`);
  }

  assert.equal(matrix.get("OWNER")?.size, 45);
  assert.equal(matrix.get("EXECUTIVE_DIRECTOR")?.size, 45);
} finally {
  await client.end();
}

console.log("RBAC smoke tests passed");
