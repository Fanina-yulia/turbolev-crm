-- Additional work execution flow V1.
-- Keep TECHNICAL_DECISION blockers tied to a proposed WorkOrderLine in sync
-- regardless of whether approval comes from CRM, client portal or mixed approval.

CREATE OR REPLACE FUNCTION "sync_mechanic_additional_work_blocker_status"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  blocker RECORD;
  next_status "OperationalBlockerStatus";
  audit_action text;
  resolution_text text;
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NEW."status"::text NOT IN ('APPROVED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;

  IF NEW."status"::text = 'APPROVED' THEN
    next_status := 'RESOLVED'::"OperationalBlockerStatus";
    audit_action := 'OPERATIONAL_BLOCKER_AUTO_RESOLVED';
    resolution_text := 'Додаткову позицію погоджено до виконання.';
  ELSE
    next_status := 'CANCELLED'::"OperationalBlockerStatus";
    audit_action := 'OPERATIONAL_BLOCKER_AUTO_CANCELLED';
    resolution_text := 'Додаткову позицію скасовано або відхилено.';
  END IF;

  FOR blocker IN
    SELECT "id", "status"
    FROM "OperationalBlocker"
    WHERE "sourceType" = 'WORK_ORDER_LINE'::"OperationalBlockerSourceType"
      AND "sourceId" = NEW."id"
      AND "code" = 'TECHNICAL_DECISION'
      AND "status" IN ('OPEN'::"OperationalBlockerStatus", 'ACKNOWLEDGED'::"OperationalBlockerStatus")
    FOR UPDATE
  LOOP
    UPDATE "OperationalBlocker"
    SET
      "status" = next_status,
      "resolvedAt" = CURRENT_TIMESTAMP,
      "resolutionComment" = resolution_text,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = blocker."id";

    INSERT INTO "AuditEvent" (
      "id",
      "actorName",
      "entityType",
      "entityId",
      "action",
      "metadata",
      "createdAt"
    ) VALUES (
      md5(random()::text || clock_timestamp()::text || blocker."id"),
      'CRM / WorkOrderLine lifecycle',
      'OperationalBlocker',
      blocker."id",
      audit_action,
      jsonb_build_object(
        'workOrderLineId', NEW."id",
        'workOrderId', NEW."workOrderId",
        'fromLineStatus', OLD."status"::text,
        'toLineStatus', NEW."status"::text,
        'fromBlockerStatus', blocker."status"::text,
        'toBlockerStatus', next_status::text
      ),
      CURRENT_TIMESTAMP
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_sync_mechanic_additional_work_blocker_status" ON "WorkOrderLine";

CREATE TRIGGER "trg_sync_mechanic_additional_work_blocker_status"
AFTER UPDATE OF "status" ON "WorkOrderLine"
FOR EACH ROW
EXECUTE FUNCTION "sync_mechanic_additional_work_blocker_status"();
