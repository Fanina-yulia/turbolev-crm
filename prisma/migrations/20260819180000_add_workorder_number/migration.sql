-- Stable human-readable WorkOrder numbering.
-- Stored separately from the legacy WorkOrder model so numbering can be introduced
-- without rewriting the core table. A database trigger guarantees that every new
-- WorkOrder gets a number even during a rolling deployment.

CREATE SEQUENCE "WorkOrderNumber_number_seq" AS INTEGER START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "WorkOrderNumber" (
  "workOrderId" TEXT NOT NULL,
  "number" INTEGER NOT NULL DEFAULT nextval('"WorkOrderNumber_number_seq"'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderNumber_pkey" PRIMARY KEY ("workOrderId")
);

CREATE UNIQUE INDEX "WorkOrderNumber_number_key" ON "WorkOrderNumber"("number");
CREATE INDEX "WorkOrderNumber_createdAt_idx" ON "WorkOrderNumber"("createdAt");

-- Backfill all existing WorkOrders chronologically so older jobs get smaller numbers.
WITH ordered AS (
  SELECT
    "id",
    "createdAt",
    ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::INTEGER AS seq
  FROM "WorkOrder"
)
INSERT INTO "WorkOrderNumber" ("workOrderId", "number", "createdAt")
SELECT "id", seq, "createdAt"
FROM ordered
ORDER BY seq;

-- The next generated value must continue immediately after the backfill.
SELECT setval(
  '"WorkOrderNumber_number_seq"',
  COALESCE((SELECT MAX("number") FROM "WorkOrderNumber"), 0) + 1,
  false
);

CREATE OR REPLACE FUNCTION "assign_work_order_number"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "WorkOrderNumber" ("workOrderId", "createdAt")
  VALUES (NEW."id", NEW."createdAt")
  ON CONFLICT ("workOrderId") DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "WorkOrder_assign_number_after_insert"
AFTER INSERT ON "WorkOrder"
FOR EACH ROW
EXECUTE FUNCTION "assign_work_order_number"();
