import { getSqlPool } from "../src/lib/sql";

type AuditRow = {
  cycle_id: string;
  cycle_kind: "WORK_ORDER" | "APPOINTMENT" | "DIAGNOSTIC";
  cycle_time: Date;
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

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const MIN_REAL_VEHICLES = boundedInt(process.env.E2E_MIN_REAL_VEHICLES, 10, 10, 20);
const MAX_REPORT_ROWS = boundedInt(process.env.E2E_MAX_REPORT_ROWS, 20, MIN_REAL_VEHICLES, 50);
const LOOKBACK_DAYS = boundedInt(process.env.E2E_AUDIT_LOOKBACK_DAYS, 180, 30, 365);
const INCLUDE_IDENTIFIERS = process.env.E2E_AUDIT_INCLUDE_IDENTIFIERS === "1";

function maskPlate(value: string | null) {
  if (!value) return "NO_PLATE";
  if (INCLUDE_IDENTIFIERS || value.length <= 4) return value;
  return `${value.slice(0, 2)}${"•".repeat(Math.max(2, value.length - 4))}${value.slice(-2)}`;
}

function maskId(value: string) {
  if (INCLUDE_IDENTIFIERS || value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
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
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  let rows: AuditRow[] = [];

  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const result = await client.query<AuditRow>(`
      WITH work_order_cycles AS (
        SELECT
          'wo:' || wo.id AS cycle_id,
          'WORK_ORDER'::text AS cycle_kind,
          wo."createdAt" AS cycle_time,
          v.id AS vehicle_id,
          v."plateNumber" AS plate_number,
          concat_ws(' ', v.brand, v.model, v.year::text) AS vehicle_label,
          sa.id AS appointment_id,
          sa.status AS appointment_status,
          sa."plannedStartAt" AS planned_start_at,
          sa."actualArrivalAt" AS actual_arrival_at,
          dr.id AS diagnostic_id,
          dr.status::text AS diagnostic_status,
          dr."confirmedAt" AS diagnostic_confirmed_at,
          wo.id AS work_order_id,
          wo.status::text AS work_order_status,
          wo."closedAt" AS work_order_closed_at
        FROM "WorkOrder" wo
        JOIN "Vehicle" v ON v.id=wo."vehicleId"
        LEFT JOIN LATERAL (
          SELECT sa.id, sa.status::text AS status, sa."plannedStartAt", sa."actualArrivalAt"
          FROM "ServiceAppointment" sa
          WHERE sa."workOrderId"=wo.id AND sa.id NOT LIKE 'demo_%'
          ORDER BY sa."plannedStartAt" DESC NULLS LAST, sa."createdAt" DESC
          LIMIT 1
        ) sa ON true
        LEFT JOIN "DiagnosticRequest" dr ON dr.id=wo."diagnosticRequestId"
        WHERE wo.id NOT LIKE 'demo_%' AND wo."createdAt" >= $1
      ),
      latest_orphan_appointment AS (
        SELECT DISTINCT ON (sa."vehicleId")
          sa.id,
          sa."vehicleId",
          sa.status::text AS status,
          sa."plannedStartAt",
          sa."actualArrivalAt",
          sa."createdAt"
        FROM "ServiceAppointment" sa
        WHERE sa.id NOT LIKE 'demo_%'
          AND sa."workOrderId" IS NULL
          AND sa."createdAt" >= $1
        ORDER BY sa."vehicleId", sa."plannedStartAt" DESC NULLS LAST, sa."createdAt" DESC
      ),
      appointment_cycles AS (
        SELECT
          'appt:' || a.id AS cycle_id,
          'APPOINTMENT'::text AS cycle_kind,
          a."createdAt" AS cycle_time,
          v.id AS vehicle_id,
          v."plateNumber" AS plate_number,
          concat_ws(' ', v.brand, v.model, v.year::text) AS vehicle_label,
          a.id AS appointment_id,
          a.status AS appointment_status,
          a."plannedStartAt" AS planned_start_at,
          a."actualArrivalAt" AS actual_arrival_at,
          dr.id AS diagnostic_id,
          dr.status AS diagnostic_status,
          dr."confirmedAt" AS diagnostic_confirmed_at,
          NULL::text AS work_order_id,
          NULL::text AS work_order_status,
          NULL::timestamptz AS work_order_closed_at
        FROM latest_orphan_appointment a
        JOIN "Vehicle" v ON v.id=a."vehicleId"
        LEFT JOIN LATERAL (
          SELECT dr.id, dr.status::text AS status, dr."confirmedAt"
          FROM "DiagnosticRequest" dr
          WHERE dr."vehicleId"=a."vehicleId"
            AND dr.id NOT LIKE 'demo_%'
            AND dr."createdAt" >= a."createdAt"
            AND NOT EXISTS (SELECT 1 FROM "WorkOrder" wo WHERE wo."diagnosticRequestId"=dr.id)
          ORDER BY dr."createdAt" DESC
          LIMIT 1
        ) dr ON true
      ),
      diagnostic_cycles AS (
        SELECT DISTINCT ON (dr."vehicleId")
          'diag:' || dr.id AS cycle_id,
          'DIAGNOSTIC'::text AS cycle_kind,
          dr."createdAt" AS cycle_time,
          v.id AS vehicle_id,
          v."plateNumber" AS plate_number,
          concat_ws(' ', v.brand, v.model, v.year::text) AS vehicle_label,
          NULL::text AS appointment_id,
          NULL::text AS appointment_status,
          NULL::timestamptz AS planned_start_at,
          NULL::timestamptz AS actual_arrival_at,
          dr.id AS diagnostic_id,
          dr.status::text AS diagnostic_status,
          dr."confirmedAt" AS diagnostic_confirmed_at,
          NULL::text AS work_order_id,
          NULL::text AS work_order_status,
          NULL::timestamptz AS work_order_closed_at
        FROM "DiagnosticRequest" dr
        JOIN "Vehicle" v ON v.id=dr."vehicleId"
        WHERE dr.id NOT LIKE 'demo_%'
          AND dr."createdAt" >= $1
          AND NOT EXISTS (SELECT 1 FROM "WorkOrder" wo WHERE wo."diagnosticRequestId"=dr.id)
          AND NOT EXISTS (
            SELECT 1 FROM latest_orphan_appointment a
            WHERE a."vehicleId"=dr."vehicleId" AND a."createdAt" <= dr."createdAt"
          )
        ORDER BY dr."vehicleId", dr."createdAt" DESC
      ),
      base_cycles AS (
        SELECT * FROM work_order_cycles
        UNION ALL
        SELECT * FROM appointment_cycles
        UNION ALL
        SELECT * FROM diagnostic_cycles
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
        (
          EXISTS (SELECT 1 FROM "WorkOrderLine" l WHERE l."workOrderId"=c.work_order_id AND l.status='COMPLETED')
          AND NOT EXISTS (
            SELECT 1 FROM "WorkOrderLine" l
            WHERE l."workOrderId"=c.work_order_id AND l.status NOT IN ('COMPLETED','CANCELLED')
          )
        ) AS has_completed_work,
        EXISTS (
          SELECT 1 FROM "WorkOrderLine" l
          WHERE l."workOrderId"=c.work_order_id AND l.type='PART' AND l."requiredForRepair"=true AND l.status <> 'CANCELLED'
        ) AS has_required_parts,
        EXISTS (SELECT 1 FROM "PartsRequest" pr WHERE pr."workOrderId"=c.work_order_id) AS has_parts_request,
        NOT EXISTS (
          SELECT 1
          FROM "WorkOrderLine" l
          WHERE l."workOrderId"=c.work_order_id
            AND l.type='PART'
            AND l."requiredForRepair"=true
            AND l.status <> 'CANCELLED'
            AND COALESCE((
              SELECT SUM(GREATEST(COALESCE(pri."receivedQuantity", 0), COALESCE(pri."installedQuantity", 0)))
              FROM "PartsRequestItem" pri
              JOIN "PartsRequest" pr ON pr.id=pri."partsRequestId"
              WHERE pr."workOrderId"=c.work_order_id AND pri."workOrderLineId"=l.id
            ), 0) < l."plannedQuantity"
        ) AS required_parts_received,
        EXISTS (
          SELECT 1 FROM "WorkOrderQualityControl" qc
          WHERE qc."workOrderId"=c.work_order_id AND qc."completedAt" IS NOT NULL
        ) AS qc_completed,
        EXISTS (
          SELECT 1 FROM "WorkOrderFinanceSnapshot" fs
          WHERE fs."workOrderId"=c.work_order_id AND fs.kind='ACTUAL'
        ) AS has_actual_finance,
        EXISTS (
          SELECT 1
          FROM "WorkOrderFinanceSnapshot" fs
          WHERE fs."workOrderId"=c.work_order_id
            AND fs.kind='ACTUAL'
            AND fs."grossRevenue" > 0
            AND (
              COALESCE((
                SELECT SUM(ct.amount)
                FROM "CashTransaction" ct
                WHERE ct."workOrderId"=c.work_order_id AND ct.status='POSTED' AND ct.kind='INFLOW'
              ), 0) >= fs."grossRevenue"
              OR EXISTS (
                SELECT 1 FROM "FinancialObligation" fo
                WHERE fo."workOrderId"=c.work_order_id
                  AND fo.direction='RECEIVABLE'
                  AND fo.status='PAID'
                  AND fo."settledAmount" >= fo.amount
              )
            )
        ) AS has_payment_evidence
      FROM base_cycles c
      ORDER BY c.cycle_time DESC, c.vehicle_id, c.cycle_id
    `, [cutoff]);
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
    const complete = blockers.length === 0;
    const staleBooked = row.appointment_status === "BOOKED"
      && Boolean(row.planned_start_at && row.planned_start_at.getTime() < Date.now())
      && !row.actual_arrival_at;
    const stalledDiagnostic = row.diagnostic_status === "IN_PROGRESS" && !row.diagnostic_confirmed_at;
    return {
      cycle: maskId(row.cycle_id),
      cycleKind: row.cycle_kind,
      vehicleRef: maskId(row.vehicle_id),
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
      complete,
    };
  });

  const auditedVehicleIds = new Set(rows.map((row) => row.vehicle_id));
  const completeVehicleIds = new Set(rows.filter((row, index) => evaluated[index]?.complete).map((row) => row.vehicle_id));
  const staleBooked = evaluated.filter((row) => row.staleBooked).length;
  const stalledDiagnostics = evaluated.filter((row) => row.stalledDiagnostic).length;
  const passed = completeVehicleIds.size >= MIN_REAL_VEHICLES;

  console.log("REAL_VEHICLE_E2E_READINESS", JSON.stringify({
    mode: "READ_ONLY",
    lookbackDays: LOOKBACK_DAYS,
    minimumCompleteVehicles: MIN_REAL_VEHICLES,
    auditedCycles: evaluated.length,
    auditedVehicles: auditedVehicleIds.size,
    completeVehicles: completeVehicleIds.size,
    staleBooked,
    stalledDiagnostics,
    gate: passed ? "PASS" : "BLOCKED",
    cycles: evaluated.slice(0, MAX_REPORT_ROWS),
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
