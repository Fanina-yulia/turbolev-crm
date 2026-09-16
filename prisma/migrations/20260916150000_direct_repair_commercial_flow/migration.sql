-- Direct repair commercial flow: additive configuration only.
CREATE TYPE "DirectRepairPartsMode" AS ENUM ('SERVICE_SUPPLIED', 'CUSTOMER_SUPPLIED', 'MIXED', 'NO_PARTS');
CREATE TYPE "PartSupplySource" AS ENUM ('SERVICE', 'CUSTOMER');

CREATE TABLE "DirectRepairCommercialConfig" (
  "workOrderId" TEXT NOT NULL,
  "partsMode" "DirectRepairPartsMode",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectRepairCommercialConfig_pkey" PRIMARY KEY ("workOrderId")
);

CREATE TABLE "DirectRepairPartSource" (
  "workOrderLineId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "source" "PartSupplySource" NOT NULL,
  "customerPartConfirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectRepairPartSource_pkey" PRIMARY KEY ("workOrderLineId")
);

CREATE INDEX "DirectRepairCommercialConfig_partsMode_updatedAt_idx" ON "DirectRepairCommercialConfig"("partsMode", "updatedAt");
CREATE INDEX "DirectRepairPartSource_workOrderId_source_idx" ON "DirectRepairPartSource"("workOrderId", "source");
CREATE INDEX "DirectRepairPartSource_workOrderId_customerPartConfirmedAt_idx" ON "DirectRepairPartSource"("workOrderId", "customerPartConfirmedAt");

ALTER TABLE "DirectRepairCommercialConfig"
  ADD CONSTRAINT "DirectRepairCommercialConfig_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectRepairPartSource"
  ADD CONSTRAINT "DirectRepairPartSource_workOrderLineId_fkey"
  FOREIGN KEY ("workOrderLineId") REFERENCES "WorkOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectRepairPartSource"
  ADD CONSTRAINT "DirectRepairPartSource_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guard against accidental cross-order line source assignment.
CREATE OR REPLACE FUNCTION "validate_direct_repair_part_source"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WorkOrderLine" l
    WHERE l."id" = NEW."workOrderLineId"
      AND l."workOrderId" = NEW."workOrderId"
      AND l."type" = 'PART'
  ) THEN
    RAISE EXCEPTION 'DIRECT_REPAIR_PART_SOURCE_INVALID_LINE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DirectRepairPartSource_validate_line"
BEFORE INSERT OR UPDATE ON "DirectRepairPartSource"
FOR EACH ROW EXECUTE FUNCTION "validate_direct_repair_part_source"();