-- Link planner mechanic resources to canonical EmployeeProfile records.
-- employeeId intentionally remains nullable so historical legacy appointments can keep their old ServiceMechanic rows.
ALTER TABLE "ServiceMechanic"
ADD COLUMN IF NOT EXISTS "employeeId" VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceMechanic_locationId_employeeId_key"
ON "ServiceMechanic"("locationId", "employeeId");

CREATE INDEX IF NOT EXISTS "ServiceMechanic_employeeId_idx"
ON "ServiceMechanic"("employeeId");

-- Legacy seeded placeholders must never be offered for new appointments.
-- Existing appointment history remains intact because rows are only deactivated, not deleted.
UPDATE "ServiceMechanic"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "employeeId" IS NULL
  AND "id" IN ('mechanic_glevakha_1', 'mechanic_glevakha_2');
