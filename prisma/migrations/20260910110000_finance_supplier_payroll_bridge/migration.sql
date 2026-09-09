-- Financial Center V2: automatic bridges into the existing factual Financial Core.
-- No parallel ledger is introduced.
-- SupplierOrder creates/updates AP without P&L recognition (inventory purchase is not COGS by itself).
-- Closing a PayrollPeriod creates one OPEX fact and one salary payable per employee.

INSERT INTO "FinancialCategory" (
  "id", "code", "name", "pnlSection", "cashFlowSection", "isSystem", "isActive", "sortOrder", "updatedAt"
) VALUES (
  'financial_category_inventory_purchase', 'INVENTORY_PURCHASE', 'Закупівля товарів / запчастин', NULL, 'OPERATING', true, true, 260, CURRENT_TIMESTAMP
) ON CONFLICT ("code") DO NOTHING;

INSERT INTO "FinancialCategory" (
  "id", "code", "name", "pnlSection", "cashFlowSection", "isSystem", "isActive", "sortOrder", "updatedAt"
) VALUES (
  'financial_category_opex_payroll', 'OPEX_PAYROLL', 'Заробітна плата', 'OPEX', 'OPERATING', true, true, 520, CURRENT_TIMESTAMP
) ON CONFLICT ("code") DO NOTHING;

CREATE OR REPLACE FUNCTION finance_sync_supplier_order_payable()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_supplier_name TEXT;
  v_category_id TEXT;
  v_existing_id TEXT;
  v_settled NUMERIC(14,2);
  v_issued_at TIMESTAMP(3);
BEGIN
  IF NEW."status"::text IN ('CONFIRMED', 'PARTIAL', 'FULFILLED')
     AND NEW."totalPurchase" IS NOT NULL
     AND NEW."totalPurchase" > 0 THEN

    SELECT "name" INTO v_supplier_name FROM "Supplier" WHERE "id" = NEW."supplierId";
    SELECT "id" INTO v_category_id FROM "FinancialCategory" WHERE "code" = 'INVENTORY_PURCHASE' LIMIT 1;
    v_issued_at := COALESCE(NEW."confirmedAt", NEW."submittedAt", NEW."createdAt", CURRENT_TIMESTAMP);

    SELECT "id", "settledAmount"
      INTO v_existing_id, v_settled
      FROM "FinancialObligation"
     WHERE "direction"::text = 'PAYABLE'
       AND "sourceEntity" = 'SUPPLIER_ORDER'
       AND "sourceEntityId" = NEW."id"
     ORDER BY "createdAt" ASC
     LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO "FinancialObligation" (
        "id", "direction", "status", "amount", "settledAmount", "currency", "issuedAt",
        "categoryId", "workOrderId", "supplierId", "counterpartyName", "sourceEntity", "sourceEntityId",
        "description", "metadata", "createdAt", "updatedAt"
      ) VALUES (
        'fin_sup_ap_' || substr(md5(NEW."id"), 1, 24),
        'PAYABLE', 'OPEN', NEW."totalPurchase", 0, NEW."currency", v_issued_at,
        v_category_id, NEW."workOrderId", NEW."supplierId", v_supplier_name,
        'SUPPLIER_ORDER', NEW."id", 'Замовлення постачальнику',
        jsonb_build_object('externalOrderId', NEW."externalOrderId", 'supplierOrderStatus', NEW."status"::text),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    ELSE
      UPDATE "FinancialObligation"
         SET "amount" = GREATEST(NEW."totalPurchase", COALESCE(v_settled, 0)),
             "currency" = NEW."currency",
             "categoryId" = COALESCE(v_category_id, "categoryId"),
             "workOrderId" = COALESCE(NEW."workOrderId", "workOrderId"),
             "supplierId" = NEW."supplierId",
             "counterpartyName" = COALESCE(v_supplier_name, "counterpartyName"),
             "status" = CASE
               WHEN COALESCE(v_settled, 0) >= NEW."totalPurchase" THEN 'PAID'::"FinancialObligationStatus"
               WHEN COALESCE(v_settled, 0) > 0 THEN 'PARTIALLY_PAID'::"FinancialObligationStatus"
               ELSE 'OPEN'::"FinancialObligationStatus"
             END,
             "metadata" = jsonb_build_object('externalOrderId', NEW."externalOrderId", 'supplierOrderStatus', NEW."status"::text),
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = v_existing_id;
    END IF;
  ELSIF NEW."status"::text IN ('CANCELLED', 'ERROR') THEN
    UPDATE "FinancialObligation"
       SET "status" = 'CANCELLED',
           "updatedAt" = CURRENT_TIMESTAMP,
           "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object('supplierOrderStatus', NEW."status"::text)
     WHERE "direction"::text = 'PAYABLE'
       AND "sourceEntity" = 'SUPPLIER_ORDER'
       AND "sourceEntityId" = NEW."id"
       AND "settledAmount" = 0;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_finance_supplier_order_payable ON "SupplierOrder";
CREATE TRIGGER trg_finance_supplier_order_payable
AFTER INSERT OR UPDATE OF "status", "totalPurchase", "currency", "externalOrderId" ON "SupplierOrder"
FOR EACH ROW EXECUTE FUNCTION finance_sync_supplier_order_payable();

-- Explicit supplier AP backfill, guarded by source identity.
INSERT INTO "FinancialObligation" (
  "id", "direction", "status", "amount", "settledAmount", "currency", "issuedAt",
  "categoryId", "workOrderId", "supplierId", "counterpartyName", "sourceEntity", "sourceEntityId",
  "description", "metadata", "createdAt", "updatedAt"
)
SELECT
  'fin_sup_ap_' || substr(md5(so."id"), 1, 24),
  'PAYABLE', 'OPEN', so."totalPurchase", 0, so."currency",
  COALESCE(so."confirmedAt", so."submittedAt", so."createdAt"),
  fc."id", so."workOrderId", so."supplierId", s."name", 'SUPPLIER_ORDER', so."id",
  'Замовлення постачальнику',
  jsonb_build_object('externalOrderId', so."externalOrderId", 'supplierOrderStatus', so."status"::text),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SupplierOrder" so
JOIN "Supplier" s ON s."id" = so."supplierId"
LEFT JOIN "FinancialCategory" fc ON fc."code" = 'INVENTORY_PURCHASE'
WHERE so."status"::text IN ('CONFIRMED', 'PARTIAL', 'FULFILLED')
  AND so."totalPurchase" IS NOT NULL
  AND so."totalPurchase" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "FinancialObligation" fo
     WHERE fo."direction"::text = 'PAYABLE'
       AND fo."sourceEntity" = 'SUPPLIER_ORDER'
       AND fo."sourceEntityId" = so."id"
  );

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

  SELECT "id" INTO v_category_id FROM "FinancialCategory" WHERE "code" = 'OPEX_PAYROLL' LIMIT 1;

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
    v_event_id := 'fin_pay_evt_' || substr(md5(v_source_id), 1, 24);
    v_obligation_id := 'fin_pay_ap_' || substr(md5(v_source_id), 1, 24);

    IF NOT EXISTS (
      SELECT 1 FROM "FinancialEvent"
       WHERE "sourceEntity" = 'PAYROLL_PERIOD_EMPLOYEE'
         AND "sourceEntityId" = v_source_id
         AND "status"::text = 'POSTED'
    ) THEN
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
    ELSE
      UPDATE "FinancialEvent"
         SET "amount" = r.total_amount,
             "currency" = r.currency,
             "recognizedAt" = NEW."periodEnd",
             "categoryId" = v_category_id,
             "employeeId" = r.employee_id,
             "description" = 'Нарахування зарплати: ' || trim(r.last_name || ' ' || r.first_name),
             "metadata" = jsonb_build_object('payrollPeriodId', NEW."id", 'payrollKey', NEW."key", 'employeeId', r.employee_id),
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE "sourceEntity" = 'PAYROLL_PERIOD_EMPLOYEE'
         AND "sourceEntityId" = v_source_id
         AND "status"::text = 'POSTED';
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

DROP TRIGGER IF EXISTS trg_finance_payroll_period_closed ON "PayrollPeriod";
CREATE TRIGGER trg_finance_payroll_period_closed
AFTER INSERT OR UPDATE OF "status", "closedAt" ON "PayrollPeriod"
FOR EACH ROW EXECUTE FUNCTION finance_sync_closed_payroll_period();

-- Backfill already closed payroll periods by issuing a no-op update, which invokes the idempotent trigger.
UPDATE "PayrollPeriod"
   SET "closedAt" = "closedAt"
 WHERE "status"::text = 'CLOSED';
