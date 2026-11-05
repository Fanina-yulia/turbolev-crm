-- Compensation Finance V3
-- Real-time salary accruals become P&L facts when earned, not when cash is paid.
-- Salary payments affect payroll payable/cash separately.
-- Historical closed payroll aggregate facts remain untouched.

INSERT INTO "FinancialCategory" (
  "id","code","name","pnlSection","cashFlowSection","isSystem","isActive","sortOrder","updatedAt"
) VALUES
  ('financial_category_cogs_staff_sales','COGS_STAFF_SALES','Комісійна винагорода персоналу','COGS','OPERATING',true,true,125,CURRENT_TIMESTAMP),
  ('financial_category_opex_profit_share','OPEX_PROFIT_SHARE','Бонус від прибутку','OPEX','OPERATING',true,true,525,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "pnlSection" = EXCLUDED."pnlSection",
  "cashFlowSection" = EXCLUDED."cashFlowSection",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "FinancialCategory" (
  "id","code","name","pnlSection","cashFlowSection","isSystem","isActive","sortOrder","updatedAt"
) VALUES
  ('financial_category_cogs_labor','COGS_LABOR','Пряма оплата праці механіків','COGS','OPERATING',true,true,120,CURRENT_TIMESTAMP),
  ('financial_category_opex_payroll','OPEX_PAYROLL','Заробітна плата','OPEX','OPERATING',true,true,520,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "pnlSection" = EXCLUDED."pnlSection",
  "cashFlowSection" = EXCLUDED."cashFlowSection",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION finance_refresh_live_payroll_payable(p_period_id TEXT, p_employee_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_total NUMERIC(14,2);
  v_paid NUMERIC(14,2);
  v_currency TEXT;
  v_period_key TEXT;
  v_period_status TEXT;
  v_employee_name TEXT;
  v_category_id TEXT;
  v_source_id TEXT;
  v_existing_id TEXT;
  v_old_aggregate_id TEXT;
  v_status "FinancialObligationStatus";
BEGIN
  SELECT p."key", p."status"::text
    INTO v_period_key, v_period_status
    FROM "PayrollPeriod" p
   WHERE p."id" = p_period_id;

  IF v_period_key IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(a."amount"),0)::numeric(14,2), COALESCE(NULLIF(MAX(a."currency"),''),'UAH')
    INTO v_total, v_currency
    FROM "SalaryAccrual" a
   WHERE a."payrollPeriodId" = p_period_id
     AND a."employeeId" = p_employee_id
     AND a."status"::text = 'POSTED';

  SELECT COALESCE(SUM(pmt."amount"),0)::numeric(14,2)
    INTO v_paid
    FROM "SalaryPayment" pmt
   WHERE pmt."payrollPeriodId" = p_period_id
     AND pmt."employeeId" = p_employee_id;

  SELECT trim(e."lastName" || ' ' || e."firstName")
    INTO v_employee_name
    FROM "EmployeeProfile" e
   WHERE e."id" = p_employee_id;

  SELECT "id" INTO v_category_id FROM "FinancialCategory" WHERE "code"='OPEX_PAYROLL' LIMIT 1;

  v_source_id := p_period_id || ':' || p_employee_id;

  -- Do not create a second payable for historical periods already bridged by the legacy close trigger.
  SELECT "id" INTO v_old_aggregate_id
    FROM "FinancialObligation"
   WHERE "direction"::text='PAYABLE'
     AND "sourceEntity"='PAYROLL_PERIOD_EMPLOYEE'
     AND "sourceEntityId"=v_source_id
   ORDER BY "createdAt" ASC
   LIMIT 1;

  IF v_old_aggregate_id IS NOT NULL THEN
    UPDATE "FinancialObligation"
       SET "settledAmount" = LEAST(v_total, v_paid),
           "status" = CASE
             WHEN v_total <= 0 OR v_paid >= v_total THEN 'PAID'::"FinancialObligationStatus"
             WHEN v_paid > 0 THEN 'PARTIALLY_PAID'::"FinancialObligationStatus"
             ELSE 'OPEN'::"FinancialObligationStatus"
           END,
           "settledAt" = CASE WHEN v_total <= 0 OR v_paid >= v_total THEN CURRENT_TIMESTAMP ELSE NULL END,
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = v_old_aggregate_id;
    RETURN;
  END IF;

  v_source_id := p_period_id || ':' || p_employee_id || ':live';
  SELECT "id" INTO v_existing_id
    FROM "FinancialObligation"
   WHERE "direction"::text='PAYABLE'
     AND "sourceEntity"='PAYROLL_PERIOD_EMPLOYEE_LIVE'
     AND "sourceEntityId"=v_source_id
   ORDER BY "createdAt" ASC
   LIMIT 1;

  v_status := CASE
    WHEN v_total <= 0 OR v_paid >= v_total THEN 'PAID'::"FinancialObligationStatus"
    WHEN v_paid > 0 THEN 'PARTIALLY_PAID'::"FinancialObligationStatus"
    ELSE 'OPEN'::"FinancialObligationStatus"
  END;

  IF v_existing_id IS NULL AND v_total > 0 THEN
    INSERT INTO "FinancialObligation" (
      "id","direction","status","amount","settledAmount","currency","issuedAt","dueAt",
      "categoryId","counterpartyName","sourceEntity","sourceEntityId","description","metadata","createdAt","updatedAt"
    ) VALUES (
      'fin_pay_live_' || substr(md5(v_source_id),1,22),
      'PAYABLE',v_status,v_total,LEAST(v_total,v_paid),v_currency,CURRENT_TIMESTAMP,NULL,
      v_category_id,v_employee_name,'PAYROLL_PERIOD_EMPLOYEE_LIVE',v_source_id,
      'Нарахована зарплата за ' || v_period_key,
      jsonb_build_object('payrollPeriodId',p_period_id,'payrollKey',v_period_key,'employeeId',p_employee_id,'live',true),
      CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
    );
  ELSIF v_existing_id IS NOT NULL THEN
    UPDATE "FinancialObligation"
       SET "amount"=GREATEST(v_total,0),
           "settledAmount"=LEAST(GREATEST(v_total,0),GREATEST(v_paid,0)),
           "currency"=v_currency,
           "categoryId"=COALESCE(v_category_id,"categoryId"),
           "counterpartyName"=COALESCE(v_employee_name,"counterpartyName"),
           "status"=v_status,
           "settledAt"=CASE WHEN v_status::text='PAID' THEN CURRENT_TIMESTAMP ELSE NULL END,
           "updatedAt"=CURRENT_TIMESTAMP,
           "metadata"=jsonb_build_object('payrollPeriodId',p_period_id,'payrollKey',v_period_key,'employeeId',p_employee_id,'live',true)
     WHERE "id"=v_existing_id;
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION finance_sync_salary_accrual_live()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_category_code TEXT;
  v_category_id TEXT;
  v_pnl "FinancialPnlSection";
  v_location_id TEXT;
  v_work_order_id TEXT;
  v_event_id TEXT;
  v_has_legacy_aggregate BOOLEAN;
  v_period_key TEXT;
BEGIN
  IF NEW."status"::text = 'REVERSED' THEN
    UPDATE "FinancialEvent"
       SET "status"='REVERSED',"updatedAt"=CURRENT_TIMESTAMP
     WHERE "sourceEntity"='SALARY_ACCRUAL'
       AND "sourceEntityId"=NEW."id"
       AND "status"::text='POSTED';
    PERFORM finance_refresh_live_payroll_payable(NEW."payrollPeriodId",NEW."employeeId");
    RETURN NEW;
  END IF;

  IF NEW."status"::text <> 'POSTED' THEN
    RETURN NEW;
  END IF;

  -- Legacy closed periods may already have one aggregate payroll P&L event.
  SELECT EXISTS(
    SELECT 1
      FROM "FinancialEvent" fe
     WHERE fe."sourceEntity"='PAYROLL_PERIOD_EMPLOYEE'
       AND fe."sourceEntityId"=NEW."payrollPeriodId" || ':' || NEW."employeeId"
       AND fe."status"::text='POSTED'
  ) INTO v_has_legacy_aggregate;

  IF NOT v_has_legacy_aggregate THEN
    IF NEW."category"::text='LABOR' THEN
      v_category_code := 'COGS_LABOR';
      v_pnl := 'COGS'::"FinancialPnlSection";
    ELSIF NEW."category"::text='SALES' THEN
      v_category_code := 'COGS_STAFF_SALES';
      v_pnl := 'COGS'::"FinancialPnlSection";
    ELSIF COALESCE(NEW."sourceType",'')='PROFIT_SHARE' THEN
      v_category_code := 'OPEX_PROFIT_SHARE';
      v_pnl := 'OPEX'::"FinancialPnlSection";
    ELSE
      v_category_code := 'OPEX_PAYROLL';
      v_pnl := 'OPEX'::"FinancialPnlSection";
    END IF;

    SELECT "id" INTO v_category_id FROM "FinancialCategory" WHERE "code"=v_category_code LIMIT 1;

    SELECT era."locationId"
      INTO v_location_id
      FROM "EmployeeRoleAssignment" era
     WHERE era."employeeId"=NEW."employeeId"
       AND era."startsAt" <= NEW."occurredAt"
       AND (era."endsAt" IS NULL OR era."endsAt" >= NEW."occurredAt")
     ORDER BY era."isPrimary" DESC, era."startsAt" DESC
     LIMIT 1;

    IF NEW."sourceType"='WORK_ORDER_LABOR' THEN
      SELECT wol."workOrderId" INTO v_work_order_id FROM "WorkOrderLine" wol WHERE wol."id"=NEW."sourceId" LIMIT 1;
    END IF;

    SELECT "id" INTO v_event_id
      FROM "FinancialEvent"
     WHERE "sourceEntity"='SALARY_ACCRUAL'
       AND "sourceEntityId"=NEW."id"
     ORDER BY "createdAt" ASC
     LIMIT 1;

    IF v_event_id IS NULL THEN
      v_event_id := 'fin_sal_evt_' || substr(md5(NEW."id"),1,23);
      INSERT INTO "FinancialEvent" (
        "id","status","pnlSection","amount","currency","recognizedAt","categoryId",
        "workOrderId","employeeId","locationId","sourceEntity","sourceEntityId",
        "description","metadata","postedAt","createdAt","updatedAt"
      ) VALUES (
        v_event_id,'POSTED',v_pnl,NEW."amount",NEW."currency",NEW."occurredAt",v_category_id,
        v_work_order_id,NEW."employeeId",v_location_id,'SALARY_ACCRUAL',NEW."id",
        COALESCE(NEW."description",'Нарахування працівнику'),
        jsonb_build_object(
          'salaryAccrualId',NEW."id",
          'payrollPeriodId',NEW."payrollPeriodId",
          'salaryCategory',NEW."category"::text,
          'sourceType',NEW."sourceType",
          'sourceId',NEW."sourceId",
          'liveAccrual',true
        ),
        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
      );
    ELSE
      UPDATE "FinancialEvent"
         SET "status"='POSTED',
             "pnlSection"=v_pnl,
             "amount"=NEW."amount",
             "currency"=NEW."currency",
             "recognizedAt"=NEW."occurredAt",
             "categoryId"=v_category_id,
             "workOrderId"=v_work_order_id,
             "employeeId"=NEW."employeeId",
             "locationId"=v_location_id,
             "description"=COALESCE(NEW."description",'Нарахування працівнику'),
             "updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=v_event_id;
    END IF;
  END IF;

  PERFORM finance_refresh_live_payroll_payable(NEW."payrollPeriodId",NEW."employeeId");
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_finance_salary_accrual_live ON "SalaryAccrual";
CREATE TRIGGER trg_finance_salary_accrual_live
AFTER INSERT OR UPDATE OF "status","amount","occurredAt","category","sourceType","sourceId"
ON "SalaryAccrual"
FOR EACH ROW EXECUTE FUNCTION finance_sync_salary_accrual_live();

CREATE OR REPLACE FUNCTION finance_sync_salary_payment_live()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD."payrollPeriodId" IS NOT NULL THEN
      PERFORM finance_refresh_live_payroll_payable(OLD."payrollPeriodId",OLD."employeeId");
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."payrollPeriodId" IS NOT NULL THEN
    PERFORM finance_refresh_live_payroll_payable(NEW."payrollPeriodId",NEW."employeeId");
  END IF;
  IF TG_OP='UPDATE' AND OLD."payrollPeriodId" IS NOT NULL
     AND (OLD."payrollPeriodId"<>NEW."payrollPeriodId" OR OLD."employeeId"<>NEW."employeeId") THEN
    PERFORM finance_refresh_live_payroll_payable(OLD."payrollPeriodId",OLD."employeeId");
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_finance_salary_payment_live ON "SalaryPayment";
CREATE TRIGGER trg_finance_salary_payment_live
AFTER INSERT OR UPDATE OR DELETE ON "SalaryPayment"
FOR EACH ROW EXECUTE FUNCTION finance_sync_salary_payment_live();

-- Payroll close no longer creates a second P&L expense. Accruals are already recognized when earned.
-- It only refreshes the salary payable and preserves historical aggregate events already posted by older releases.
CREATE OR REPLACE FUNCTION finance_sync_closed_payroll_period()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  r RECORD;
BEGIN
  IF NEW."status"::text <> 'CLOSED' THEN RETURN NEW; END IF;
  FOR r IN
    SELECT DISTINCT a."employeeId" AS employee_id
      FROM "SalaryAccrual" a
     WHERE a."payrollPeriodId"=NEW."id"
       AND a."status"::text='POSTED'
  LOOP
    PERFORM finance_refresh_live_payroll_payable(NEW."id",r.employee_id);
  END LOOP;
  RETURN NEW;
END
$function$;

-- Backfill only open/review payroll periods. Closed legacy periods keep their historic aggregate P&L event.
UPDATE "SalaryAccrual" a
   SET "updatedAt"=a."updatedAt"
  FROM "PayrollPeriod" p
 WHERE p."id"=a."payrollPeriodId"
   AND p."status"::text IN ('OPEN','REVIEW')
   AND a."status"::text='POSTED';
