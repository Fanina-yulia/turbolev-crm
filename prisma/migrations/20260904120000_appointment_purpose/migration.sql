CREATE TYPE "AppointmentPurpose" AS ENUM ('DIAGNOSTICS', 'REPAIR');

ALTER TABLE "ServiceAppointment" ADD COLUMN "purpose" "AppointmentPurpose";

-- Safe legacy backfill: an explicit work order wins; otherwise use the exact
-- diagnostic visit link or known walk-in/diagnostic status. Ambiguous rows stay
-- NULL and are visible for manual review instead of being silently reclassified.
UPDATE "ServiceAppointment" AS a
SET "purpose" = 'REPAIR'
WHERE a."workOrderId" IS NOT NULL;

UPDATE "ServiceAppointment" AS a
SET "purpose" = 'DIAGNOSTICS'
WHERE a."purpose" IS NULL
  AND EXISTS (
    SELECT 1 FROM "DiagnosticVisitLink" AS dvl
    WHERE dvl."appointmentId" = a."id"
  );

UPDATE "ServiceAppointment" AS a
SET "purpose" = 'DIAGNOSTICS'
WHERE a."purpose" IS NULL
  AND (
    a."source" = 'WALK_IN'
    OR a."status" = 'DIAGNOSTICS'
  );

CREATE INDEX "ServiceAppointment_purpose_plannedStartAt_idx"
  ON "ServiceAppointment"("purpose", "plannedStartAt");
