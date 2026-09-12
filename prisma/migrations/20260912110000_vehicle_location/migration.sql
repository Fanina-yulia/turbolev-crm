CREATE TYPE "VehicleLocationCode" AS ENUM (
  'OUTSIDE',
  'RECEPTION',
  'QUEUE',
  'POST',
  'PARKING',
  'WAITING_PARTS',
  'QUALITY_CONTROL',
  'READY_ZONE',
  'DELIVERED'
);

CREATE TABLE "VehicleLocation" (
  "id" TEXT NOT NULL,
  "vehicleId" VARCHAR(64) NOT NULL,
  "code" "VehicleLocationCode" NOT NULL,
  "serviceLocationId" VARCHAR(64),
  "servicePostId" VARCHAR(64),
  "reason" TEXT,
  "sourceType" VARCHAR(40) NOT NULL,
  "sourceId" VARCHAR(96) NOT NULL,
  "updatedByUserId" VARCHAR(64),
  "updatedByName" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleLocation_vehicleId_key" ON "VehicleLocation"("vehicleId");
CREATE INDEX "VehicleLocation_serviceLocationId_code_idx" ON "VehicleLocation"("serviceLocationId", "code");
CREATE INDEX "VehicleLocation_servicePostId_idx" ON "VehicleLocation"("servicePostId");
CREATE INDEX "VehicleLocation_code_updatedAt_idx" ON "VehicleLocation"("code", "updatedAt");

CREATE TABLE "VehicleLocationEvent" (
  "id" TEXT NOT NULL,
  "vehicleId" VARCHAR(64) NOT NULL,
  "fromCode" "VehicleLocationCode",
  "fromServiceLocationId" VARCHAR(64),
  "fromServicePostId" VARCHAR(64),
  "toCode" "VehicleLocationCode" NOT NULL,
  "toServiceLocationId" VARCHAR(64),
  "toServicePostId" VARCHAR(64),
  "serviceLocationId" VARCHAR(64),
  "sourceType" VARCHAR(40) NOT NULL,
  "sourceId" VARCHAR(96) NOT NULL,
  "reason" TEXT,
  "actorUserId" VARCHAR(64),
  "actorName" VARCHAR(160),
  "idempotencyKey" VARCHAR(160),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleLocationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleLocationEvent_idempotencyKey_key" ON "VehicleLocationEvent"("idempotencyKey");
CREATE INDEX "VehicleLocationEvent_vehicleId_occurredAt_idx" ON "VehicleLocationEvent"("vehicleId", "occurredAt");
CREATE INDEX "VehicleLocationEvent_toCode_occurredAt_idx" ON "VehicleLocationEvent"("toCode", "occurredAt");
CREATE INDEX "VehicleLocationEvent_toServicePostId_occurredAt_idx" ON "VehicleLocationEvent"("toServicePostId", "occurredAt");
CREATE INDEX "VehicleLocationEvent_sourceType_sourceId_idx" ON "VehicleLocationEvent"("sourceType", "sourceId");
