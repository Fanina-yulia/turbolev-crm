-- CreateEnum
CREATE TYPE "PlannerAppointmentStatus" AS ENUM (
  'BOOKED','ARRIVED','DIAGNOSTICS','WAITING_PARTS_SELECTION','WAITING_CALCULATION',
  'WAITING_APPROVAL','WAITING_PARTS','READY_FOR_REPAIR','IN_REPAIR','WAITING_QC',
  'READY_FOR_PICKUP','COMPLETED','WARRANTY','PAUSED','NO_SHOW','CANCELLED','RESERVE'
);

-- CreateTable
CREATE TABLE "ServiceLocation" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Kyiv',
  "openMinute" INTEGER NOT NULL DEFAULT 540,
  "closeMinute" INTEGER NOT NULL DEFAULT 1260,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServicePost" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServicePost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceMechanic" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "userId" VARCHAR(64),
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceMechanic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceAppointment" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "postId" TEXT,
  "mechanicId" TEXT,
  "leadId" VARCHAR(64),
  "clientId" VARCHAR(64),
  "vehicleId" VARCHAR(64),
  "workOrderId" VARCHAR(64),
  "status" "PlannerAppointmentStatus" NOT NULL DEFAULT 'BOOKED',
  "customerName" TEXT,
  "phone" VARCHAR(32),
  "vehicleLabel" TEXT,
  "plateNumber" VARCHAR(24),
  "problem" TEXT,
  "comment" TEXT,
  "source" VARCHAR(40),
  "estimatedAmount" DECIMAL(14,2),
  "priority" INTEGER NOT NULL DEFAULT 0,
  "plannedStartAt" TIMESTAMP(3) NOT NULL,
  "plannedEndAt" TIMESTAMP(3) NOT NULL,
  "actualArrivalAt" TIMESTAMP(3),
  "actualStartAt" TIMESTAMP(3),
  "actualEndAt" TIMESTAMP(3),
  "partsEtaAt" TIMESTAMP(3),
  "noShowAt" TIMESTAMP(3),
  "createdById" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceAppointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicePost_locationId_name_key" ON "ServicePost"("locationId","name");
CREATE INDEX "ServiceLocation_isActive_sortOrder_idx" ON "ServiceLocation"("isActive","sortOrder");
CREATE INDEX "ServicePost_locationId_isActive_sortOrder_idx" ON "ServicePost"("locationId","isActive","sortOrder");
CREATE INDEX "ServiceMechanic_locationId_isActive_sortOrder_idx" ON "ServiceMechanic"("locationId","isActive","sortOrder");
CREATE INDEX "ServiceMechanic_userId_idx" ON "ServiceMechanic"("userId");
CREATE INDEX "ServiceAppointment_locationId_plannedStartAt_plannedEndAt_idx" ON "ServiceAppointment"("locationId","plannedStartAt","plannedEndAt");
CREATE INDEX "ServiceAppointment_postId_plannedStartAt_plannedEndAt_idx" ON "ServiceAppointment"("postId","plannedStartAt","plannedEndAt");
CREATE INDEX "ServiceAppointment_mechanicId_plannedStartAt_plannedEndAt_idx" ON "ServiceAppointment"("mechanicId","plannedStartAt","plannedEndAt");
CREATE INDEX "ServiceAppointment_status_plannedStartAt_idx" ON "ServiceAppointment"("status","plannedStartAt");
CREATE INDEX "ServiceAppointment_leadId_idx" ON "ServiceAppointment"("leadId");
CREATE INDEX "ServiceAppointment_clientId_idx" ON "ServiceAppointment"("clientId");
CREATE INDEX "ServiceAppointment_vehicleId_idx" ON "ServiceAppointment"("vehicleId");
CREATE INDEX "ServiceAppointment_workOrderId_idx" ON "ServiceAppointment"("workOrderId");

ALTER TABLE "ServicePost" ADD CONSTRAINT "ServicePost_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceMechanic" ADD CONSTRAINT "ServiceMechanic_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAppointment" ADD CONSTRAINT "ServiceAppointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceAppointment" ADD CONSTRAINT "ServiceAppointment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ServicePost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceAppointment" ADD CONSTRAINT "ServiceAppointment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "ServiceMechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the current Glevakha station. Resources remain database-driven and can be changed later.
INSERT INTO "ServiceLocation" ("id","name","timezone","openMinute","closeMinute","isActive","sortOrder","updatedAt")
VALUES ('loc_glevakha','Глеваха','Europe/Kyiv',540,1260,true,10,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ServicePost" ("id","locationId","name","sortOrder","isActive","capabilities","updatedAt") VALUES
('post_glevakha_1','loc_glevakha','Пост 1',10,true,ARRAY[]::TEXT[],CURRENT_TIMESTAMP),
('post_glevakha_2','loc_glevakha','Пост 2',20,true,ARRAY[]::TEXT[],CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ServiceMechanic" ("id","locationId","name","sortOrder","isActive","updatedAt") VALUES
('mechanic_glevakha_1','loc_glevakha','Автомеханік 1',10,true,CURRENT_TIMESTAMP),
('mechanic_glevakha_2','loc_glevakha','Автомеханік 2',20,true,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
