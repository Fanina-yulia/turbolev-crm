import assert from "node:assert/strict";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL_UNPOOLED or DATABASE_URL is required");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const config = await client.query(`
    SELECT "enforcementMode", "bootstrapCompleted", "allowSelfRegistration"
    FROM "SecurityConfig"
    WHERE id='default'
  `);
  assert.equal(config.rowCount, 1, "SecurityConfig/default must exist");
  assert.equal(config.rows[0].allowSelfRegistration, false, "self-registration must stay disabled");

  const activeUsers = await client.query(`
    SELECT
      u.id,
      u.name,
      count(ur.id) FILTER (
        WHERE ur."isActive"=true
          AND ur."startsAt"<=now()
          AND (ur."endsAt" IS NULL OR ur."endsAt">now())
      )::int AS active_roles,
      count(ur.id) FILTER (
        WHERE ur."isActive"=true
          AND ur."isPrimary"=true
          AND ur."startsAt"<=now()
          AND (ur."endsAt" IS NULL OR ur."endsAt">now())
      )::int AS primary_roles
    FROM "User" u
    LEFT JOIN "UserAccessRole" ur ON ur."userId"=u.id
    WHERE u."isActive"=true
    GROUP BY u.id,u.name
    ORDER BY u.name
  `);
  assert.ok(activeUsers.rowCount && activeUsers.rowCount > 0, "at least one active CRM user is required");
  for (const user of activeUsers.rows) {
    assert.ok(user.active_roles >= 1, `${user.name} must have at least one active role`);
    assert.equal(user.primary_roles, 1, `${user.name} must have exactly one active primary role`);
  }

  const recentOwner = await client.query(`
    SELECT u.id,u.name,u."lastSeenAt"
    FROM "User" u
    WHERE u."isActive"=true
      AND u."authUserId" IS NOT NULL
      AND u."lastSeenAt">=now()-interval '60 minutes'
      AND EXISTS (
        SELECT 1
        FROM "UserAccessRole" ur
        JOIN "AccessRole" r ON r.id=ur."roleId"
        WHERE ur."userId"=u.id
          AND ur."isActive"=true
          AND ur."startsAt"<=now()
          AND (ur."endsAt" IS NULL OR ur."endsAt">now())
          AND r.code='OWNER'
          AND r."isActive"=true
      )
    LIMIT 1
  `);
  assert.equal(recentOwner.rowCount, 1, "an active auth-linked OWNER seen within the last hour is required before ENFORCED");

  const locationRoleProblems = await client.query(`
    SELECT u.name,r.code
    FROM "UserAccessRole" ur
    JOIN "User" u ON u.id=ur."userId"
    JOIN "AccessRole" r ON r.id=ur."roleId"
    WHERE u."isActive"=true
      AND ur."isActive"=true
      AND ur."startsAt"<=now()
      AND (ur."endsAt" IS NULL OR ur."endsAt">now())
      AND ur."locationId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "AccessRolePermission" rp
        WHERE rp."roleId"=r.id AND rp.scope='LOCATION'
      )
  `);
  assert.equal(locationRoleProblems.rowCount, 0, `active LOCATION-scoped roles require a location: ${locationRoleProblems.rows.map((row) => `${row.name}:${row.code}`).join(", ")}`);

  const mechanicProblems = await client.query(`
    SELECT u.name,ur."locationId" AS role_location,m."locationId" AS mechanic_location,m.id AS mechanic_id
    FROM "User" u
    JOIN "UserAccessRole" ur ON ur."userId"=u.id AND ur."isActive"=true
    JOIN "AccessRole" r ON r.id=ur."roleId" AND r.code='MECHANIC'
    LEFT JOIN "ServiceMechanic" m ON m."userId"=u.id AND m."isActive"=true
    WHERE u."isActive"=true
      AND ur."startsAt"<=now()
      AND (ur."endsAt" IS NULL OR ur."endsAt">now())
      AND (m.id IS NULL OR m."locationId" IS DISTINCT FROM ur."locationId")
  `);
  assert.equal(mechanicProblems.rowCount, 0, "each active MECHANIC user must have an active ServiceMechanic in the same location");

  const appointmentMismatch = await client.query(`
    SELECT count(*)::int AS count
    FROM "ServiceAppointment" a
    JOIN "ServiceMechanic" m ON m.id=a."mechanicId"
    WHERE a."mechanicId" IS NOT NULL
      AND a."locationId"<>m."locationId"
  `);
  assert.equal(appointmentMismatch.rows[0].count, 0, "assigned appointments must stay in the mechanic location");

  const ownerPermissions = await client.query(`
    SELECT count(*)::int AS count
    FROM "AccessRolePermission" rp
    JOIN "AccessRole" r ON r.id=rp."roleId"
    WHERE r.code='OWNER' AND r."isActive"=true
  `);
  const permissionCount = await client.query(`SELECT count(*)::int AS count FROM "Permission"`);
  assert.equal(ownerPermissions.rows[0].count, permissionCount.rows[0].count, "OWNER must retain every registered permission");

  const mechanicContract = await client.query(`
    SELECT p.code,rp.scope
    FROM "AccessRolePermission" rp
    JOIN "AccessRole" r ON r.id=rp."roleId"
    JOIN "Permission" p ON p.id=rp."permissionId"
    WHERE r.code='MECHANIC'
      AND p.code IN ('DIAGNOSTICS.READ','DIAGNOSTICS.WRITE','PLANNER.READ','WORK_ORDERS.READ','PRODUCTION.READ','PRODUCTION.WRITE','PAYROLL.SELF_READ')
  `);
  const mechanicScopes = new Map(mechanicContract.rows.map((row) => [row.code, row.scope]));
  for (const code of ['DIAGNOSTICS.READ','DIAGNOSTICS.WRITE','PLANNER.READ','WORK_ORDERS.READ','PRODUCTION.READ','PRODUCTION.WRITE']) {
    assert.equal(mechanicScopes.get(code), 'ASSIGNED', `MECHANIC ${code} must stay ASSIGNED`);
  }
  assert.equal(mechanicScopes.get('PAYROLL.SELF_READ'), 'SELF', 'MECHANIC PAYROLL.SELF_READ must stay SELF');

  const advisorForbidden = await client.query(`
    SELECT p.code
    FROM "AccessRolePermission" rp
    JOIN "AccessRole" r ON r.id=rp."roleId"
    JOIN "Permission" p ON p.id=rp."permissionId"
    WHERE r.code='SERVICE_ADVISOR'
      AND p.code IN ('FINANCE.READ','FINANCE.WRITE','PAYROLL.ALL_READ','PERSONNEL.COMPENSATION_READ','SECURITY.ACCESS_MANAGE')
  `);
  assert.equal(advisorForbidden.rowCount, 0, "SERVICE_ADVISOR must not receive finance/payroll/admin permissions outside the approved contract");

  const activeOverrides = await client.query(`
    SELECT count(*)::int AS count
    FROM "UserPermissionOverride"
    WHERE "isActive"=true
      AND "startsAt"<=now()
      AND ("expiresAt" IS NULL OR "expiresAt">now())
  `);

  console.log("RBAC production readiness passed", {
    enforcementMode: config.rows[0].enforcementMode,
    bootstrapCompleted: config.rows[0].bootstrapCompleted,
    activeUsers: activeUsers.rowCount,
    activeOverrides: activeOverrides.rows[0].count,
    recentOwner: recentOwner.rows[0]?.name ?? null,
  });
} finally {
  await client.end();
}
