ALTER TABLE "WorkOrderLine"
ADD COLUMN "warrantyKm" INTEGER,
ADD COLUMN "warrantyDays" INTEGER,
ADD COLUMN "warrantyStartsAt" TIMESTAMP(3),
ADD COLUMN "warrantyEndsAt" TIMESTAMP(3),
ADD COLUMN "warrantyMileageStartKm" INTEGER;

CREATE INDEX "WorkOrderLine_warrantyEndsAt_idx" ON "WorkOrderLine"("warrantyEndsAt");

CREATE OR REPLACE FUNCTION "turbolev_work_order_line_warranty_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  service_row RECORD;
  current_mileage INTEGER;
BEGIN
  IF TG_OP = 'INSERT'
     AND NEW."sourceEntity" = 'SERVICE_CATALOG'
     AND NEW."sourceEntityId" IS NOT NULL THEN
    SELECT s."id", s."warrantyKm", s."warrantyDays"
    INTO service_row
    FROM "ServiceCatalogItem" s
    WHERE s."id" = NEW."sourceEntityId"
      AND s."isActive" = TRUE
      AND s."reviewStatus" = 'READY'
    LIMIT 1;

    IF FOUND THEN
      NEW."catalogItemId" := service_row."id";
      NEW."warrantyKm" := service_row."warrantyKm";
      NEW."warrantyDays" := service_row."warrantyDays";
    END IF;
  END IF;

  IF NEW."status" = 'COMPLETED'
     AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'COMPLETED')
     AND (COALESCE(NEW."warrantyKm", 0) > 0 OR COALESCE(NEW."warrantyDays", 0) > 0) THEN
    NEW."warrantyStartsAt" := COALESCE(NEW."warrantyStartsAt", NEW."completedAt", CURRENT_TIMESTAMP);

    IF COALESCE(NEW."warrantyDays", 0) > 0 THEN
      NEW."warrantyEndsAt" := NEW."warrantyStartsAt" + make_interval(days => NEW."warrantyDays");
    END IF;

    IF NEW."warrantyMileageStartKm" IS NULL THEN
      SELECT v."mileageKm"
      INTO current_mileage
      FROM "WorkOrder" w
      JOIN "Vehicle" v ON v."id" = w."vehicleId"
      WHERE w."id" = NEW."workOrderId"
      LIMIT 1;
      NEW."warrantyMileageStartKm" := current_mileage;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "WorkOrderLine_warranty_snapshot_trg"
BEFORE INSERT OR UPDATE OF "status" ON "WorkOrderLine"
FOR EACH ROW
EXECUTE FUNCTION "turbolev_work_order_line_warranty_snapshot"();
