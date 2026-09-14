-- Additional work execution hard gate V2.
-- A mechanic request marked BLOCKS_REPAIR must be a real execution stop,
-- not only an attention signal. The database therefore:
-- 1) marks the source mechanic line STOPPED when TECHNICAL_DECISION opens;
-- 2) prevents execution from being resumed/started/completed while the blocker is active.

CREATE OR REPLACE FUNCTION "hard_stop_source_line_for_technical_decision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_line_id text;
  now_iso text;
  affected integer := 0;
  source_order_id text;
BEGIN
  IF NEW."code" <> 'TECHNICAL_DECISION'
     OR NEW."sourceType" <> 'WORK_ORDER_LINE'::"OperationalBlockerSourceType"
     OR NEW."status" NOT IN ('OPEN'::"OperationalBlockerStatus", 'ACKNOWLEDGED'::"OperationalBlockerStatus") THEN
    RETURN NEW;
  END IF;

  source_line_id := NULLIF(COALESCE(NEW."metadata"->>'sourceLineId', ''), '');
  IF source_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  now_iso := to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  SELECT "workOrderId"
    INTO source_order_id
    FROM "WorkOrderLine"
   WHERE "id" = source_line_id
   LIMIT 1;

  UPDATE "WorkOrderLine"
     SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(
           'mechanicWorkflow',
           COALESCE("metadata"->'mechanicWorkflow', '{}'::jsonb) || jsonb_build_object(
             'pausedAt', COALESCE(NULLIF("metadata"->'mechanicWorkflow'->>'pausedAt', ''), now_iso),
             'pauseReason', 'CUSTOMER_APPROVAL_REQUIRED',
             'pauseNote', COALESCE(NULLIF(NEW."reason", ''), 'Потрібне погодження додаткової роботи'),
             'stopAt', now_iso,
             'stopReason', 'CUSTOMER_APPROVAL_REQUIRED',
             'stopNote', COALESCE(NULLIF(NEW."reason", ''), 'Потрібне погодження додаткової роботи'),
             'stopStatus', 'OPEN',
             'lastAction', 'STOP',
             'lastActionAt', now_iso
           )
         ),
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "id" = source_line_id
     AND "status" = 'IN_PROGRESS'
     AND COALESCE("metadata"->'mechanicWorkflow'->>'stopAt', '') = '';

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected > 0 THEN
    INSERT INTO "AuditEvent" (
      "id",
      "actorName",
      "entityType",
      "entityId",
      "action",
      "metadata",
      "createdAt"
    ) VALUES (
      md5(random()::text || clock_timestamp()::text || source_line_id),
      'CRM / Technical decision gate',
      'WorkOrderLine',
      source_line_id,
      'MECHANIC_WORK_AUTO_STOPPED_FOR_APPROVAL',
      jsonb_build_object(
        'workOrderId', COALESCE(source_order_id, NEW."workOrderId"),
        'blockerId', NEW."id",
        'blockerCode', NEW."code",
        'reason', NEW."reason",
        'source', 'MECHANIC_ADDITIONAL_WORK'
      ),
      CURRENT_TIMESTAMP
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_hard_stop_source_line_on_technical_decision_insert" ON "OperationalBlocker";
CREATE TRIGGER "trg_hard_stop_source_line_on_technical_decision_insert"
AFTER INSERT ON "OperationalBlocker"
FOR EACH ROW
EXECUTE FUNCTION "hard_stop_source_line_for_technical_decision"();

DROP TRIGGER IF EXISTS "trg_hard_stop_source_line_on_technical_decision_update" ON "OperationalBlocker";
CREATE TRIGGER "trg_hard_stop_source_line_on_technical_decision_update"
AFTER UPDATE OF "status", "metadata", "reason" ON "OperationalBlocker"
FOR EACH ROW
EXECUTE FUNCTION "hard_stop_source_line_for_technical_decision"();

CREATE OR REPLACE FUNCTION "guard_work_order_line_technical_decision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_active_decision boolean;
  old_stop_at text;
  new_stop_at text;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM "OperationalBlocker"
     WHERE "workOrderId" = NEW."workOrderId"
       AND "code" = 'TECHNICAL_DECISION'
       AND "status" IN ('OPEN'::"OperationalBlockerStatus", 'ACKNOWLEDGED'::"OperationalBlockerStatus")
  ) INTO has_active_decision;

  IF NOT has_active_decision THEN
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NEW."status"::text IN ('IN_PROGRESS', 'COMPLETED') THEN
    RAISE EXCEPTION 'TECHNICAL_DECISION_PENDING'
      USING ERRCODE = 'P0001',
            DETAIL = 'Active TECHNICAL_DECISION blocks WorkOrder execution.';
  END IF;

  old_stop_at := COALESCE(OLD."metadata"->'mechanicWorkflow'->>'stopAt', '');
  new_stop_at := COALESCE(NEW."metadata"->'mechanicWorkflow'->>'stopAt', '');

  IF old_stop_at <> '' AND new_stop_at = '' THEN
    RAISE EXCEPTION 'TECHNICAL_DECISION_PENDING'
      USING ERRCODE = 'P0001',
            DETAIL = 'Active TECHNICAL_DECISION must be resolved before mechanic resume.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_guard_work_order_line_technical_decision" ON "WorkOrderLine";
CREATE TRIGGER "trg_guard_work_order_line_technical_decision"
BEFORE UPDATE OF "status", "metadata" ON "WorkOrderLine"
FOR EACH ROW
EXECUTE FUNCTION "guard_work_order_line_technical_decision"();