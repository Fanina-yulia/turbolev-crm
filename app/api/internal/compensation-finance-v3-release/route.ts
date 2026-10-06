import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIGRATION_NAME = "20261006224500_compensation_finance_v3";
const MIGRATION_SQL = "-- Compensation Finance V3\n-- Real-time salary accruals become P&L facts when earned, not when cash is paid.\n-- Salary payments affect payroll payable/cash separately.\n-- Historical closed payroll aggregate facts remain untouched.\n\nINSERT INTO \"FinancialCategory\" (\n  \"id\",\"code\",\"name\",\"pnlSection\",\"cashFlowSection\",\"isSystem\",\"isActive\",\"sortOrder\",\"updatedAt\"\n) VALUES\n  ('financial_category_cogs_staff_sales','COGS_STAFF_SALES','Комісійна винагорода персоналу','COGS','OPERATING',true,true,125,CURRENT_TIMESTAMP),\n  ('financial_category_opex_profit_share','OPEX_PROFIT_SHARE','Бонус від прибутку','OPEX','OPERATING',true,true,525,CURRENT_TIMESTAMP)\nON CONFLICT (\"code\") DO UPDATE SET\n  \"name\" = EXCLUDED.\"name\",\n  \"pnlSection\" = EXCLUDED.\"pnlSection\",\n  \"cashFlowSection\" = EXCLUDED.\"cashFlowSection\",\n  \"isActive\" = true,\n  \"updatedAt\" = CURRENT_TIMESTAMP;\n\nINSERT INTO \"FinancialCategory\" (\n  \"id\",\"code\",\"name\",\"pnlSection\",\"cashFlowSection\",\"isSystem\",\"isActive\",\"sortOrder\",\"updatedAt\"\n) VALUES\n  ('financial_category_cogs_labor','COGS_LABOR','Пряма оплата праці механіків','COGS','OPERATING',true,true,120,CURRENT_TIMESTAMP),\n  ('financial_category_opex_payroll','OPEX_PAYROLL','Заробітна плата','OPEX','OPERATING',true,true,520,CURRENT_TIMESTAMP)\nON CONFLICT (\"code\") DO UPDATE SET\n  \"name\" = EXCLUDED.\"name\",\n  \"pnlSection\" = EXCLUDED.\"pnlSection\",\n  \"cashFlowSection\" = EXCLUDED.\"cashFlowSection\",\n  \"isActive\" = true,\n  \"updatedAt\" = CURRENT_TIMESTAMP;\n\nCREATE OR REPLACE FUNCTION finance_refresh_live_payroll_payable(p_period_id TEXT, p_employee_id TEXT)\nRETURNS void\nLANGUAGE plpgsql\nAS $function$\nDECLARE\n  v_total NUMERIC(14,2);\n  v_paid NUMERIC(14,2);\n  v_currency TEXT;\n  v_period_key TEXT;\n  v_period_status TEXT;\n  v_employee_name TEXT;\n  v_category_id TEXT;\n  v_source_id TEXT;\n  v_existing_id TEXT;\n  v_old_aggregate_id TEXT;\n  v_status \"FinancialObligationStatus\";\nBEGIN\n  SELECT p.\"key\", p.\"status\"::text\n    INTO v_period_key, v_period_status\n    FROM \"PayrollPeriod\" p\n   WHERE p.\"id\" = p_period_id;\n\n  IF v_period_key IS NULL THEN RETURN; END IF;\n\n  SELECT COALESCE(SUM(a.\"amount\"),0)::numeric(14,2), COALESCE(NULLIF(MAX(a.\"currency\"),''),'UAH')\n    INTO v_total, v_currency\n    FROM \"SalaryAccrual\" a\n   WHERE a.\"payrollPeriodId\" = p_period_id\n     AND a.\"employeeId\" = p_employee_id\n     AND a.\"status\"::text = 'POSTED';\n\n  SELECT COALESCE(SUM(pmt.\"amount\"),0)::numeric(14,2)\n    INTO v_paid\n    FROM \"SalaryPayment\" pmt\n   WHERE pmt.\"payrollPeriodId\" = p_period_id\n     AND pmt.\"employeeId\" = p_employee_id;\n\n  SELECT trim(e.\"lastName\" || ' ' || e.\"firstName\")\n    INTO v_employee_name\n    FROM \"EmployeeProfile\" e\n   WHERE e.\"id\" = p_employee_id;\n\n  SELECT \"id\" INTO v_category_id FROM \"FinancialCategory\" WHERE \"code\"='OPEX_PAYROLL' LIMIT 1;\n\n  v_source_id := p_period_id || ':' || p_employee_id;\n\n  -- Do not create a second payable for historical periods already bridged by the legacy close trigger.\n  SELECT \"id\" INTO v_old_aggregate_id\n    FROM \"FinancialObligation\"\n   WHERE \"direction\"::text='PAYABLE'\n     AND \"sourceEntity\"='PAYROLL_PERIOD_EMPLOYEE'\n     AND \"sourceEntityId\"=v_source_id\n   ORDER BY \"createdAt\" ASC\n   LIMIT 1;\n\n  IF v_old_aggregate_id IS NOT NULL THEN\n    UPDATE \"FinancialObligation\"\n       SET \"settledAmount\" = LEAST(v_total, v_paid),\n           \"status\" = CASE\n             WHEN v_total <= 0 OR v_paid >= v_total THEN 'PAID'::\"FinancialObligationStatus\"\n             WHEN v_paid > 0 THEN 'PARTIALLY_PAID'::\"FinancialObligationStatus\"\n             ELSE 'OPEN'::\"FinancialObligationStatus\"\n           END,\n           \"settledAt\" = CASE WHEN v_total <= 0 OR v_paid >= v_total THEN CURRENT_TIMESTAMP ELSE NULL END,\n           \"updatedAt\" = CURRENT_TIMESTAMP\n     WHERE \"id\" = v_old_aggregate_id;\n    RETURN;\n  END IF;\n\n  v_source_id := p_period_id || ':' || p_employee_id || ':live';\n  SELECT \"id\" INTO v_existing_id\n    FROM \"FinancialObligation\"\n   WHERE \"direction\"::text='PAYABLE'\n     AND \"sourceEntity\"='PAYROLL_PERIOD_EMPLOYEE_LIVE'\n     AND \"sourceEntityId\"=v_source_id\n   ORDER BY \"createdAt\" ASC\n   LIMIT 1;\n\n  v_status := CASE\n    WHEN v_total <= 0 OR v_paid >= v_total THEN 'PAID'::\"FinancialObligationStatus\"\n    WHEN v_paid > 0 THEN 'PARTIALLY_PAID'::\"FinancialObligationStatus\"\n    ELSE 'OPEN'::\"FinancialObligationStatus\"\n  END;\n\n  IF v_existing_id IS NULL AND v_total > 0 THEN\n    INSERT INTO \"FinancialObligation\" (\n      \"id\",\"direction\",\"status\",\"amount\",\"settledAmount\",\"currency\",\"issuedAt\",\"dueAt\",\n      \"categoryId\",\"counterpartyName\",\"sourceEntity\",\"sourceEntityId\",\"description\",\"metadata\",\"createdAt\",\"updatedAt\"\n    ) VALUES (\n      'fin_pay_live_' || substr(md5(v_source_id),1,22),\n      'PAYABLE',v_status,v_total,LEAST(v_total,v_paid),v_currency,CURRENT_TIMESTAMP,NULL,\n      v_category_id,v_employee_name,'PAYROLL_PERIOD_EMPLOYEE_LIVE',v_source_id,\n      'Нарахована зарплата за ' || v_period_key,\n      jsonb_build_object('payrollPeriodId',p_period_id,'payrollKey',v_period_key,'employeeId',p_employee_id,'live',true),\n      CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\n    );\n  ELSIF v_existing_id IS NOT NULL THEN\n    UPDATE \"FinancialObligation\"\n       SET \"amount\"=GREATEST(v_total,0),\n           \"settledAmount\"=LEAST(GREATEST(v_total,0),GREATEST(v_paid,0)),\n           \"currency\"=v_currency,\n           \"categoryId\"=COALESCE(v_category_id,\"categoryId\"),\n           \"counterpartyName\"=COALESCE(v_employee_name,\"counterpartyName\"),\n           \"status\"=v_status,\n           \"settledAt\"=CASE WHEN v_status::text='PAID' THEN CURRENT_TIMESTAMP ELSE NULL END,\n           \"updatedAt\"=CURRENT_TIMESTAMP,\n           \"metadata\"=jsonb_build_object('payrollPeriodId',p_period_id,'payrollKey',v_period_key,'employeeId',p_employee_id,'live',true)\n     WHERE \"id\"=v_existing_id;\n  END IF;\nEND\n$function$;\n\nCREATE OR REPLACE FUNCTION finance_sync_salary_accrual_live()\nRETURNS trigger\nLANGUAGE plpgsql\nAS $function$\nDECLARE\n  v_category_code TEXT;\n  v_category_id TEXT;\n  v_pnl \"FinancialPnlSection\";\n  v_location_id TEXT;\n  v_work_order_id TEXT;\n  v_event_id TEXT;\n  v_has_legacy_aggregate BOOLEAN;\n  v_period_key TEXT;\nBEGIN\n  IF NEW.\"status\"::text = 'REVERSED' THEN\n    UPDATE \"FinancialEvent\"\n       SET \"status\"='REVERSED',\"updatedAt\"=CURRENT_TIMESTAMP\n     WHERE \"sourceEntity\"='SALARY_ACCRUAL'\n       AND \"sourceEntityId\"=NEW.\"id\"\n       AND \"status\"::text='POSTED';\n    PERFORM finance_refresh_live_payroll_payable(NEW.\"payrollPeriodId\",NEW.\"employeeId\");\n    RETURN NEW;\n  END IF;\n\n  IF NEW.\"status\"::text <> 'POSTED' THEN\n    RETURN NEW;\n  END IF;\n\n  -- Legacy closed periods may already have one aggregate payroll P&L event.\n  SELECT EXISTS(\n    SELECT 1\n      FROM \"FinancialEvent\" fe\n     WHERE fe.\"sourceEntity\"='PAYROLL_PERIOD_EMPLOYEE'\n       AND fe.\"sourceEntityId\"=NEW.\"payrollPeriodId\" || ':' || NEW.\"employeeId\"\n       AND fe.\"status\"::text='POSTED'\n  ) INTO v_has_legacy_aggregate;\n\n  IF NOT v_has_legacy_aggregate THEN\n    IF NEW.\"category\"::text='LABOR' THEN\n      v_category_code := 'COGS_LABOR';\n      v_pnl := 'COGS'::\"FinancialPnlSection\";\n    ELSIF NEW.\"category\"::text='SALES' THEN\n      v_category_code := 'COGS_STAFF_SALES';\n      v_pnl := 'COGS'::\"FinancialPnlSection\";\n    ELSIF COALESCE(NEW.\"sourceType\",'')='PROFIT_SHARE' THEN\n      v_category_code := 'OPEX_PROFIT_SHARE';\n      v_pnl := 'OPEX'::\"FinancialPnlSection\";\n    ELSE\n      v_category_code := 'OPEX_PAYROLL';\n      v_pnl := 'OPEX'::\"FinancialPnlSection\";\n    END IF;\n\n    SELECT \"id\" INTO v_category_id FROM \"FinancialCategory\" WHERE \"code\"=v_category_code LIMIT 1;\n\n    SELECT era.\"locationId\"\n      INTO v_location_id\n      FROM \"EmployeeRoleAssignment\" era\n     WHERE era.\"employeeId\"=NEW.\"employeeId\"\n       AND era.\"startsAt\" <= NEW.\"occurredAt\"\n       AND (era.\"endsAt\" IS NULL OR era.\"endsAt\" >= NEW.\"occurredAt\")\n     ORDER BY era.\"isPrimary\" DESC, era.\"startsAt\" DESC\n     LIMIT 1;\n\n    IF NEW.\"sourceType\"='WORK_ORDER_LABOR' THEN\n      SELECT wol.\"workOrderId\" INTO v_work_order_id FROM \"WorkOrderLine\" wol WHERE wol.\"id\"=NEW.\"sourceId\" LIMIT 1;\n    END IF;\n\n    SELECT \"id\" INTO v_event_id\n      FROM \"FinancialEvent\"\n     WHERE \"sourceEntity\"='SALARY_ACCRUAL'\n       AND \"sourceEntityId\"=NEW.\"id\"\n     ORDER BY \"createdAt\" ASC\n     LIMIT 1;\n\n    IF v_event_id IS NULL THEN\n      v_event_id := 'fin_sal_evt_' || substr(md5(NEW.\"id\"),1,23);\n      INSERT INTO \"FinancialEvent\" (\n        \"id\",\"status\",\"pnlSection\",\"amount\",\"currency\",\"recognizedAt\",\"categoryId\",\n        \"workOrderId\",\"employeeId\",\"locationId\",\"sourceEntity\",\"sourceEntityId\",\n        \"description\",\"metadata\",\"postedAt\",\"createdAt\",\"updatedAt\"\n      ) VALUES (\n        v_event_id,'POSTED',v_pnl,NEW.\"amount\",NEW.\"currency\",NEW.\"occurredAt\",v_category_id,\n        v_work_order_id,NEW.\"employeeId\",v_location_id,'SALARY_ACCRUAL',NEW.\"id\",\n        COALESCE(NEW.\"description\",'Нарахування працівнику'),\n        jsonb_build_object(\n          'salaryAccrualId',NEW.\"id\",\n          'payrollPeriodId',NEW.\"payrollPeriodId\",\n          'salaryCategory',NEW.\"category\"::text,\n          'sourceType',NEW.\"sourceType\",\n          'sourceId',NEW.\"sourceId\",\n          'liveAccrual',true\n        ),\n        CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\n      );\n    ELSE\n      UPDATE \"FinancialEvent\"\n         SET \"status\"='POSTED',\n             \"pnlSection\"=v_pnl,\n             \"amount\"=NEW.\"amount\",\n             \"currency\"=NEW.\"currency\",\n             \"recognizedAt\"=NEW.\"occurredAt\",\n             \"categoryId\"=v_category_id,\n             \"workOrderId\"=v_work_order_id,\n             \"employeeId\"=NEW.\"employeeId\",\n             \"locationId\"=v_location_id,\n             \"description\"=COALESCE(NEW.\"description\",'Нарахування працівнику'),\n             \"updatedAt\"=CURRENT_TIMESTAMP\n       WHERE \"id\"=v_event_id;\n    END IF;\n  END IF;\n\n  PERFORM finance_refresh_live_payroll_payable(NEW.\"payrollPeriodId\",NEW.\"employeeId\");\n  RETURN NEW;\nEND\n$function$;\n\nDROP TRIGGER IF EXISTS trg_finance_salary_accrual_live ON \"SalaryAccrual\";\nCREATE TRIGGER trg_finance_salary_accrual_live\nAFTER INSERT OR UPDATE OF \"status\",\"amount\",\"occurredAt\",\"category\",\"sourceType\",\"sourceId\"\nON \"SalaryAccrual\"\nFOR EACH ROW EXECUTE FUNCTION finance_sync_salary_accrual_live();\n\nCREATE OR REPLACE FUNCTION finance_sync_salary_payment_live()\nRETURNS trigger\nLANGUAGE plpgsql\nAS $function$\nBEGIN\n  IF TG_OP='DELETE' THEN\n    IF OLD.\"payrollPeriodId\" IS NOT NULL THEN\n      PERFORM finance_refresh_live_payroll_payable(OLD.\"payrollPeriodId\",OLD.\"employeeId\");\n    END IF;\n    RETURN OLD;\n  END IF;\n  IF NEW.\"payrollPeriodId\" IS NOT NULL THEN\n    PERFORM finance_refresh_live_payroll_payable(NEW.\"payrollPeriodId\",NEW.\"employeeId\");\n  END IF;\n  IF TG_OP='UPDATE' AND OLD.\"payrollPeriodId\" IS NOT NULL\n     AND (OLD.\"payrollPeriodId\"<>NEW.\"payrollPeriodId\" OR OLD.\"employeeId\"<>NEW.\"employeeId\") THEN\n    PERFORM finance_refresh_live_payroll_payable(OLD.\"payrollPeriodId\",OLD.\"employeeId\");\n  END IF;\n  RETURN NEW;\nEND\n$function$;\n\nDROP TRIGGER IF EXISTS trg_finance_salary_payment_live ON \"SalaryPayment\";\nCREATE TRIGGER trg_finance_salary_payment_live\nAFTER INSERT OR UPDATE OR DELETE ON \"SalaryPayment\"\nFOR EACH ROW EXECUTE FUNCTION finance_sync_salary_payment_live();\n\n-- Payroll close no longer creates a second P&L expense. Accruals are already recognized when earned.\n-- It only refreshes the salary payable and preserves historical aggregate events already posted by older releases.\nCREATE OR REPLACE FUNCTION finance_sync_closed_payroll_period()\nRETURNS trigger\nLANGUAGE plpgsql\nAS $function$\nDECLARE\n  r RECORD;\nBEGIN\n  IF NEW.\"status\"::text <> 'CLOSED' THEN RETURN NEW; END IF;\n  FOR r IN\n    SELECT DISTINCT a.\"employeeId\" AS employee_id\n      FROM \"SalaryAccrual\" a\n     WHERE a.\"payrollPeriodId\"=NEW.\"id\"\n       AND a.\"status\"::text='POSTED'\n  LOOP\n    PERFORM finance_refresh_live_payroll_payable(NEW.\"id\",r.employee_id);\n  END LOOP;\n  RETURN NEW;\nEND\n$function$;\n\n-- Backfill only open/review payroll periods. Closed legacy periods keep their historic aggregate P&L event.\nUPDATE \"SalaryAccrual\" a\n   SET \"updatedAt\"=a.\"updatedAt\"\n  FROM \"PayrollPeriod\" p\n WHERE p.\"id\"=a.\"payrollPeriodId\"\n   AND p.\"status\"::text IN ('OPEN','REVIEW')\n   AND a.\"status\"::text='POSTED';\n";

function authorized(request: NextRequest) {
  const expected = process.env.DB_RELEASE_TOKEN?.trim() || "";
  const supplied = request.headers.get("x-db-release-token")?.trim() || "";
  return Boolean(expected && supplied && supplied === expected);
}

function migrationConnectionString() {
  const raw = (
    process.env.DATABASE_URL_UNPOOLED
    || process.env.DIRECT_URL
    || process.env.DATABASE_URL
    || ""
  ).trim();
  if (!raw) throw new Error("Database release connection is not configured.");
  try {
    const url = new URL(raw);
    if (url.hostname.includes("-pooler.") && url.hostname.endsWith(".neon.tech")) {
      url.hostname = url.hostname.replace("-pooler.", ".");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function hidden() {
  return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return hidden();

  const client = new Client({ connectionString: migrationConnectionString() });
  try {
    await client.connect();

    const existing = await client.query<{ migration_name: string }>(
      'SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name"=$1 AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL LIMIT 1',
      [MIGRATION_NAME],
    );
    if (existing.rowCount) {
      return NextResponse.json({ ok: true, alreadyApplied: true, migration: MIGRATION_NAME }, { headers: { "Cache-Control": "no-store" } });
    }

    const checksum = createHash("sha256").update(MIGRATION_SQL).digest("hex");

    await client.query("BEGIN");
    try {
      await client.query(MIGRATION_SQL);
      await client.query(
        'INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count") VALUES ($1,$2,CURRENT_TIMESTAMP,$3,NULL,NULL,CURRENT_TIMESTAMP,1)',
        [randomUUID(), checksum, MIGRATION_NAME],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const verification = await client.query<{
      category_count: number;
      function_count: number;
      trigger_count: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM "FinancialCategory" WHERE "code" IN ('COGS_STAFF_SALES','OPEX_PROFIT_SHARE','COGS_LABOR','OPEX_PAYROLL')) AS category_count,
        (SELECT COUNT(*)::int FROM pg_proc WHERE proname IN ('finance_refresh_live_payroll_payable','finance_sync_salary_accrual_live','finance_sync_salary_payment_live','finance_sync_closed_payroll_period')) AS function_count,
        (SELECT COUNT(*)::int FROM pg_trigger WHERE tgname IN ('trg_finance_salary_accrual_live','trg_finance_salary_payment_live') AND NOT tgisinternal) AS trigger_count
    `);

    return NextResponse.json({
      ok: true,
      alreadyApplied: false,
      migration: MIGRATION_NAME,
      verification: verification.rows[0] ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("compensation finance v3 database release failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "DATABASE_RELEASE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
