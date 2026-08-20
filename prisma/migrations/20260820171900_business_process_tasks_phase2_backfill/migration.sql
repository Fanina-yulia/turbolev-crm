-- Fire the phase-2 UPDATE OF triggers for already-active records.
UPDATE "WorkOrderEstimate"
   SET "status" = "status"
 WHERE "status"::text = 'SENT';

UPDATE "PartsRequest"
   SET "status" = "status"
 WHERE "status"::text IN ('NEW','SELECTING','SELECTED','WAITING_APPROVAL','APPROVED','ORDER_REQUIRED','ORDERED','PARTIALLY_RECEIVED');

UPDATE "FinancialObligation"
   SET "status" = "status"
 WHERE "direction"::text = 'RECEIVABLE'
   AND "workOrderId" IS NOT NULL
   AND "status"::text IN ('OPEN','PARTIALLY_PAID','OVERDUE');

UPDATE "WorkOrderQualityControl"
   SET "status" = "status"
 WHERE "status"::text IN ('PENDING','IN_PROGRESS','FAILED','RECHECK');

UPDATE "WarrantyClaim"
   SET "status" = "status"
 WHERE "status"::text IN ('OPEN','REVIEW','APPROVED');
