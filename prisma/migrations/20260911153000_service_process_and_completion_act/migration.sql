CREATE TYPE "WorkOrderOrigin" AS ENUM ('AFTER_DIAGNOSTICS', 'DIRECT_REPAIR', 'DIAGNOSTIC_THEN_REPAIR');
CREATE TYPE "ServiceCompletionActStatus" AS ENUM ('ISSUED', 'CANCELLED');

ALTER TABLE "WorkOrder"
  ALTER COLUMN "diagnosticRequestId" DROP NOT NULL,
  ADD COLUMN "origin" "WorkOrderOrigin" NOT NULL DEFAULT 'AFTER_DIAGNOSTICS',
  ADD COLUMN "directPriceConfirmedAt" TIMESTAMP(3);

CREATE TABLE "ServiceCompletionAct" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "actNumber" VARCHAR(64) NOT NULL,
  "status" "ServiceCompletionActStatus" NOT NULL DEFAULT 'ISSUED',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
  "lineSnapshot" JSONB NOT NULL,
  "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedByName" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceCompletionAct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceCompletionAct_workOrderId_key" ON "ServiceCompletionAct"("workOrderId");
CREATE UNIQUE INDEX "ServiceCompletionAct_actNumber_key" ON "ServiceCompletionAct"("actNumber");
CREATE INDEX "ServiceCompletionAct_status_issuedAt_idx" ON "ServiceCompletionAct"("status", "issuedAt");
ALTER TABLE "ServiceCompletionAct"
  ADD CONSTRAINT "ServiceCompletionAct_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_workorder_confirmed_diagnostic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  diagnostic_status "DiagnosticRequestStatus";
  diagnostic_confirmed_at TIMESTAMP(3);
BEGIN
  IF NEW."diagnosticRequestId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT dr."status", dr."confirmedAt"
    INTO diagnostic_status, diagnostic_confirmed_at
  FROM "DiagnosticRequest" dr
  WHERE dr."id" = NEW."diagnosticRequestId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DiagnosticRequest % does not exist', NEW."diagnosticRequestId" USING ERRCODE = '23503';
  END IF;
  IF diagnostic_status <> 'CONFIRMED'::"DiagnosticRequestStatus" OR diagnostic_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'WorkOrder requires a confirmed DiagnosticRequest' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
