-- Keep closed payroll financial facts immutable after first posting.
-- Re-running the trigger reuses the existing FinancialEvent instead of rewriting it.

CREATE OR REPLACE FUNCTION finance_sync_closed_payroll_period()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  r RECORD;
  v_category_id TEXT;
  v_source_id TEXT;
  v_event_id TEXT;
  v_obligation_id TEXT;
BEGIN
  IF NEW."status"::text <> 'CLOSED' THEN
    RETURN NEW;
  END IF;

  SELECT "id" INTO v_category_id
    FROM "FinancialCategory"
   WHERE "code" = 'OPEX_PAYROLL'
   LIMIT 1;

  FOR r IN
    SELECT
      a."employeeId" AS employee_id,
      SUM(a."amount")::numeric(14,2) AS total_amount,
      COALESCE(NULLIF(MAX(a."currency"), ''), 'UAH') AS currency,
      e."firstName" AS first_name,
      e."lastName" AS last_name
    FROM "SalaryAccrual" a
    JOIN "EmployeeProfile" e ON e."id" = a."employeeId"
    WHERE a."payrollPeriodId" = NEW."id"
      AND a."status"::text = 'POSTED'
    GROUP BY a."employeeId", e."firstName", e."lastName"
    HAVING SUM(a."amount") > 0
  LOOP
    v_source_id := NEW."id" || ':' || r.employee_id;
    v_event_id := NULL;
    v_obligation_id := 'fin_pay_ap_' || substr(md5(v_source_id), 1, 24);

    SELECT "id" INTO v_event_id
      FROM "FinancialEvent"
     WHERE "sourceEntity" = 'PAYROLL_PERIOD_EMPLOYEE'
       AND "sourceEntityId" = v_source_id
       AND "status"::text = 'POSTED'
     ORDER BY "createdAt" ASC
     LIMIT 1;

    IF v_event_id IS NULL THEN
      v_event_id := 'fin_pay_evt_' || substr(md5(v_source_id), 1, 24);
      INSERT INTO "FinancialEvent" (
        "id", "status", "pnlSection", "amount", "currency", "recognizedAt", "categoryId",
        "employeeId", "sourceEntity", "sourceEntityId", "description", "metadata", "postedAt", "createdAt", "updatedAt"
      ) VALUES (
        v_event_id, 'POSTED', 'OPEX', r.total_amount, r.currency, NEW."periodEnd", v_category_id,
        r.employee_id, 'PAYROLL_PERIOD_EMPLOYEE', v_source_id,
        'Нарахування зарплати: ' || trim(r.last_name || ' ' || r.first_name),
        jsonb_build_object('payrollPeriodId', NEW."id", 'payrollKey', NEW."key", 'employeeId', r.employee_id),
        COALESCE(NEW."closedAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "FinancialObligation"
       WHERE "direction"::text = 'PAYABLE'
         AND "sourceEntity" = 'PAYROLL_PERIOD_EMPLOYEE'
         AND "sourceEntityId" = v_source_id
    ) THEN
      INSERT INTO "FinancialObligation" (
        "id", "direction", "status", "amount", "settledAmount", "currency", "issuedAt", "dueAt",
        "categoryId", "sourceEventId", "counterpartyName", "sourceEntity", "sourceEntityId", "description",
        "metadata", "createdAt", "updatedAt"
      ) VALUES (
        v_obligation_id, 'PAYABLE', 'OPEN', r.total_amount, 0, r.currency,
        COALESCE(NEW."closedAt", NEW."periodEnd"), NULL, v_category_id, v_event_id,
        trim(r.last_name || ' ' || r.first_name), 'PAYROLL_PERIOD_EMPLOYEE', v_source_id,
        'Заробітна плата за ' || NEW."key",
        jsonb_build_object('payrollPeriodId', NEW."id", 'payrollKey', NEW."key", 'employeeId', r.employee_id),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    END IF;
  END LOOP;

  RETURN NEW;
END
$function$;