-- DiagnosticVisitLink is the canonical appointment boundary.
-- Repair historic rows where a diagnostic appointment was later given a WorkOrder
-- and therefore incorrectly remained/was classified as REPAIR.
UPDATE "ServiceAppointment" AS a
SET "purpose" = 'DIAGNOSTICS'
WHERE EXISTS (
  SELECT 1
  FROM "DiagnosticVisitLink" AS dvl
  WHERE dvl."appointmentId" = a."id"
)
AND a."purpose" IS DISTINCT FROM 'DIAGNOSTICS';

-- Safe legacy normalization for rows that predate AppointmentPurpose.
UPDATE "ServiceAppointment" AS a
SET "purpose" = 'DIAGNOSTICS'
WHERE a."purpose" IS NULL
  AND (
    a."source" = 'WALK_IN'
    OR a."status" = 'DIAGNOSTICS'
  );

UPDATE "ServiceAppointment" AS a
SET "purpose" = 'REPAIR'
WHERE a."purpose" IS NULL
  AND a."workOrderId" IS NOT NULL
  AND a."source" IS DISTINCT FROM 'WALK_IN'
  AND a."status" IS DISTINCT FROM 'DIAGNOSTICS'
  AND NOT EXISTS (
    SELECT 1
    FROM "DiagnosticVisitLink" AS dvl
    WHERE dvl."appointmentId" = a."id"
  );
