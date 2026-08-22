import { getSqlPool } from "../src/lib/sql";

type AuditRow = {
  vehicle_id: string;
  plate_number: string | null;
  vehicle_label: string;
  appointment_id: string | null;
  appointment_status: string | null;
  planned_start_at: Date | null;
  actual_arrival_at: Date | null;
  diagnostic_id: string | null;
  diagnostic_status: string | null;
  diagnostic_confirmed_at: Date | null;
  work_order_id: string | null;
  work_order_status: string | null;
  work_order_closed_at: Date | null;
  has_final_diagnostic_card: boolean;
  has_estimate: boolean;
  estimate_approved: boolean;
  has_completed_work: boolean;
  has_required_parts: boolean;
  has_parts_request: boolean;
  required_parts_received: boolean;
  qc_completed: boolean;
  has_actual_finance: boolean;
  has_payment_evidence: boolean;
};

type Stage = { key: string; passed: boolean; optional?: boolean };

const MIN_REAL_VEHICLES = Math.max(10, Number(process.env.E2E_MIN_REAL_VEHICLES || 10));
const MAX_REPORT_ROWS = Math.max(MIN_REAL_VEHICLES, Math.min(50, Number(process.env.E2E_MAX_REPORT_ROWS || 20)));
const INCLUDE_IDENTIFIERS = process.env.E2E_AUDIT_INCLUDE_IDENTIFIERS === "1";

function maskPlate(value: string | null) {
  if (!value) return "NO_PLATE";
  if (INCLUDE_IDENTIFIERS || value.length <= 4) return value;
  return `${value.slice(0, 2)}${"•".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}

function stages(row: AuditRow): Stage[] {
  const partsOptional = !row.has_required_parts;
  return [
    { key: "appointment", passed: Boolean(row.appointment_id) },
    { key: "arrival", passed: Boolean(row.actual_arrival_at) },
    { key: "diagnostics", passed: Boolean(row.diagnostic_id) },
    { key: "diagnostic_confirmed", passed: Boolean(row.diagnostic_confirmed_at) },
    { key: "diagnostic_card_final", passed: row.has_final_diagnostic_card },
    { key: "work_order", passed: Boolean(row.work_order_id) },
    { key: "estimate", passed: row.has_estimate },
    { key: "approval", passed: row.estimate_approved },
    { key: "parts_request", passed: partsOptional || row.has_parts_request, optional: partsOptional },
    { key: "parts_received", passed: partsOptional || row.required_parts_received, optional: partsOptional },
    { key: "repair_completed", passed: row.has_completed_work },
    { key: "qc", passed: row.qc_completed },
    { key: "finance_actual", passed: row.has_actual_finance },
    { key: "payment", passed: row.has_payment_evidence },
    { key: "closed", passed: row.work_order_status === "CLOSED" || Boolean(row.work_order_closed_at) },
  ];
}

async function main() {
  const pool = getSqlPool();
  const client = await pool.connect();
  let rows: AuditRow[] = [];

  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const result = await client.query<AuditRow>(`
      WITH latest_appointment AS (
        SELECT DISTINCT ON ("vehicleId")
          "vehicleId", id, status::text AS status, "plannedStartAt", "actualArrivalAt", "workOrderId"
        FROM "ServiceAppointment"
        WHERE id NOT LIKE 'demo_%' AND "vehicleId" IS NOT NULL
        ORDER BY "vehicleId", "plannedStartAt" DESC NULLS LAST, "createdAt" DESC
      ),
      latest_diagnostic AS (
        SELECT DISTINCT ON ("vehicleId")
          "vehicleId", id, status::text AS status, "confirmedAt"
        FROM "DiagnosticRequest"
        WHERE id NOT LIKE 'demo_%'
        ORDER BY "vehicleId", "createdAt" DESC
      ),
      latest_work_order AS (
        SELECT DISTINCT ON ("vehicleId")
          "vehicleId", id, status::text AS status, "diagnosticRequestId", "closedAt", "createdAt"
        FROM "WorkOrder"
        WHERE id NOT LIKE 'demo_%'
        ORDER BY "vehicleId", "createdAt" DESC
      ),
      cycle AS (
        SELECT
          v.id AS vehicle_id,
          v."plateNumber" AS plate_number,
          concat_ws(' ', v.brand, v.model, v.year::text) AS vehicle_label,
          a.id AS appointment_id,
          a.status AS appointment_status,
          a."plannedStartAt" AS planned_start_at,
          a."actualArrivalAt" AS actual_arrival_at,
          COALESCE(wo.id, a."workOrderId") AS work_order_id,
          COALESCE(wo.status, awo.status) AS work_order_status,
          COALESCE(wo."closedAt", awo."closedAt") AS work_order_closed_at,
          COALESCE(wo."diagnosticRequestId", awo."diagnosticRequestId", d.id) AS diagnostic_id,
          COALESCE(dr.status::text, d.status) AS diagnostic_status,
          COALESCE(dr."confirmedAt", d."confirmedAt") AS diagnostic_confirmed_at
        FROM "Vehicle" v
        LEFT JOIN latest_appointment a ON a."vehicleId"=v.id
        LEFT JOIN latest_work_order wo ON wo."vehicleId"=v.id
        LEFT JOIN "WorkOrder" awo ON awo.id=a."workOrderId"
        LEFT JOIN latest_diagnostic d ON d."vehicleId"=v.id
        LEFT JOIN "DiagnosticRequest" dr ON dr.id=COALESCE(wo."diagnosticRequestId", awo."diagnosticRequestId", d.id)
        WHERE v.id NOT LIKE 'demo_%'
      )
      SELECT
        c.*,
        EXISTS (
          SELECT 1 FROM "DiagnosticCard" dc
          JOIN "DiagnosticCardRevision" dcr ON dcr."diagnosticCardId"=dc.id AND dcr.kind='FINAL'
          WHERE dc."diagnosticRequestId"=c.diagnostic_id
        ) AS has_final_diagnostic_card,
        EXISTS (SELECT 1 FROM "WorkOrderEstimate" e WHERE e."workOrderId"=c.work_order_id) AS has_estimate,
        EXISTS (SELECT 1 FROM "WorkOrderEstimate" e WHERE e."workOrderId"=c.work_order_id AND e."approvedAt" IS NOT NULL) AS estimate_approved,
        EXISTS (SELECT 1 FROM "WorkOrderLine" l WHERE l."workOrderId"=c.work_order_id AND l.status='COMPLETED') AS has_completed_work,
        EXISTS (SELECT 1 FROM "WorkOrderLine" l WHERE l."workOrderId"=c.work_order_id AND l.type='PART' AND l."requiredForRepair"=true) AS has_required_parts,
        EXISTS (SELECT 1 FROM "PartsRequest" pr WHERE pr."workOrderId"=c.work_order_id) AS has_parts_request,
        EXISTS (SELECT 1 FROM "PartsRequest" pr WHERE pr."workOrderId"=c.work_order_id AND pr."receivedAt" IS NOT NULL) AS required_parts_received,
        EXISTS (SELECT 1 FROM "WorkOrderQualityControl" qc WHERE qc."workOrderId"=c.work_order_id AND qc."completedAt" IS NOT NULL) AS qc_completed,
        EXISTS (SELECT 1 FROM "WorkOrderFinanceSnapshot" fs WHERE fs."workOrderId"=c.work_order_id AND fs.kind='ACTUAL') AS has_actual_finance,
        (
          EXISTS (SELECT 1 FROM "CashTransaction" ct WHERE ct."workOrderId"=c.work_order_id AND ct.status='POSTED')
          OR EXISTS (
            SELECT 1 FROM "FinancialObligation" fo
            WHERE fo."workOrderId"=c.work_order_id AND fo.direction='RECEIVABLE' AND fo.status='PAID'
          )
        ) AS has_payment_evidence
      FROM cycle c
      WHERE c.appointment_id IS NOT NULL OR c.diagnostic_id IS NOT NULL OR c.work_order_id IS NOT NULL
      ORDER BY c.planned_start_at DESC NULLS LAST, c.vehicle_id
      LIMIT $1
    `, [MAX_REPORT_ROWS]);
    rows = result.rows;
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const evaluated = rows.map((row) => {
    const stageList = stages(row);
    const blockers = stageList.filter((stage) => !stage.passed).map((stage) => stage.key);
    const completed = blockers.length === 0;
    const staleBooked = row.appointment_status === "BOOKED" && Boolean(row.planned_start_at && row.planned_start_at.getTime() < Date.now()) && !row.actual_arrival_at;
    const stalledDiagnostic = row.diagnostic_status === "IN_PROGRESS" && !row.diagnostic_confirmed_at;
    return {
      vehicleId: row.vehicle_id,
      vehicle: row.vehicle_label || "Vehicle",
      plate: maskPlate(row.plate_number),
      appointmentStatus: row.appointment_status,
      diagnosticStatus: row.diagnostic_status,
      workOrderStatus: row.work_order_status,
      passedStages: stageList.filter((stage) => stage.passed).length,
      totalStages: stageList.length,
      blockers,
      staleBooked,
      stalledDiagnostic,
      complete: completed,
    };
  });

  const completeVehicles = evaluated.filter((row) => row.complete).length;
  const staleBooked = evaluated.filter((row) => row.staleBooked).length;
  const stalledDiagnostics = evaluated.filter((row) => row.stalledDiagnostic).length;
  const passed = completeVehicles >= MIN_REAL_VEHICLES;

  console.log("REAL_VEHICLE_E2E_READINESS", JSON.stringify({
    mode: "READ_ONLY",
    minimumCompleteVehicles: MIN_REAL_VEHICLES,
    auditedVehicles: evaluated.length,
    completeVehicles,
    staleBooked,
    stalledDiagnostics,
    gate: passed ? "PASS" : "BLOCKED",
    vehicles: evaluated,
  }, null, 2));

  await pool.end().catch(() => undefined);
  if (!passed) process.exitCode = 2;
}

main().catch(async (error) => {
  console.error("REAL_VEHICLE_E2E_READINESS_FAILED", {
    message: error instanceof Error ? error.message : String(error),
  });
  await getSqlPool().end().catch(() => undefined);
  process.exit(1);
});
