ALTER TABLE "WorkOrderLine"
ADD COLUMN "warrantyKm" INTEGER,
ADD COLUMN "warrantyDays" INTEGER,
ADD COLUMN "warrantyStartsAt" TIMESTAMP(3),
ADD COLUMN "warrantyEndsAt" TIMESTAMP(3),
ADD COLUMN "warrantyMileageStartKm" INTEGER;

CREATE INDEX "WorkOrderLine_warrantyEndsAt_idx" ON "WorkOrderLine"("warrantyEndsAt");
