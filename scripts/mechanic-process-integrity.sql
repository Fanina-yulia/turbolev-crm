\set ON_ERROR_STOP on
\echo '=== mechanic process-card integrity: BEFORE ==='

SELECT count(*) AS total_appointments FROM "ServiceAppointment";
SELECT count(*) AS diagnostic_links FROM "DiagnosticVisitLink";

SELECT count(*) AS linked_rows_with_wrong_purpose
FROM "ServiceAppointment" a
JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
WHERE a."purpose" IS DISTINCT FROM 'DIAGNOSTICS';

SELECT
  a.id AS "appointmentId",
  coalesce(v."brand",'') || ' ' || coalesce(v."model",'') AS vehicle,
  coalesce(v."plateNumber", a."plateNumber") AS plate,
  a."purpose"::text AS purpose,
  a."status"::text AS status,
  a."workOrderId",
  dvl."diagnosticRequestId"
FROM "ServiceAppointment" a
JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
LEFT JOIN "Vehicle" v ON v.id = a."vehicleId"
WHERE a."purpose" IS DISTINCT FROM 'DIAGNOSTICS'
ORDER BY a."plannedStartAt" DESC;

BEGIN;

UPDATE "ServiceAppointment" AS a
SET "purpose" = 'DIAGNOSTICS'
WHERE EXISTS (
  SELECT 1
  FROM "DiagnosticVisitLink" AS dvl
  WHERE dvl."appointmentId" = a.id
)
AND a."purpose" IS DISTINCT FROM 'DIAGNOSTICS';

UPDATE "ServiceAppointment" AS a
SET "purpose" = 'DIAGNOSTICS'
WHERE a."purpose" IS NULL
  AND (a."source" = 'WALK_IN' OR a."status" = 'DIAGNOSTICS');

UPDATE "ServiceAppointment" AS a
SET "purpose" = 'REPAIR'
WHERE a."purpose" IS NULL
  AND a."workOrderId" IS NOT NULL
  AND a."source" IS DISTINCT FROM 'WALK_IN'
  AND a."status" IS DISTINCT FROM 'DIAGNOSTICS'
  AND NOT EXISTS (
    SELECT 1 FROM "DiagnosticVisitLink" AS dvl
    WHERE dvl."appointmentId" = a.id
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ServiceAppointment" a
    JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
    WHERE a."purpose" IS DISTINCT FROM 'DIAGNOSTICS'
  ) THEN
    RAISE EXCEPTION 'Integrity failure: a DiagnosticVisitLink appointment is still not DIAGNOSTICS';
  END IF;
END $$;

COMMIT;

\echo '=== mechanic process-card integrity: AFTER ==='
SELECT count(*) AS linked_rows_with_wrong_purpose
FROM "ServiceAppointment" a
JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
WHERE a."purpose" IS DISTINCT FROM 'DIAGNOSTICS';

SELECT count(*) AS remaining_unclassified_legacy_rows
FROM "ServiceAppointment" a
WHERE a."purpose" IS NULL;

SELECT
  coalesce(v."brand",'') || ' ' || coalesce(v."model",'') AS vehicle,
  coalesce(v."plateNumber", a."plateNumber") AS plate,
  a."purpose"::text AS purpose,
  a."status"::text AS status,
  a."plannedStartAt",
  (dvl.id IS NOT NULL) AS "hasDiagnosticLink",
  (a."workOrderId" IS NOT NULL) AS "hasWorkOrder"
FROM "ServiceAppointment" a
LEFT JOIN "Vehicle" v ON v.id = a."vehicleId"
LEFT JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
WHERE lower(coalesce(v."brand",'')) = 'toyota'
  AND lower(coalesce(v."model",'')) LIKE '%highlander%'
ORDER BY a."plannedStartAt" DESC;
