-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ANSWERED', 'MISSED', 'BUSY');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'QUALIFYING', 'BOOKED', 'ARRIVED', 'WARM_LEAD', 'REJECTED', 'SPAM_WRONG', 'SUPPLIER_PARTNER');

-- CreateEnum
CREATE TYPE "RejectReason" AS ENUM ('TOO_EXPENSIVE', 'NO_CAPACITY_NO_TIME', 'SERVICE_NOT_PROVIDED', 'WRONG_NUMBER', 'SPAM_ADS', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('BINOTEL', 'WEBSITE', 'PHONE', 'MESSENGER', 'WALK_IN', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "internalNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "vin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ARRIVED',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
    "carBrand" TEXT,
    "carModel" TEXT,
    "vin" TEXT,
    "comment" TEXT,
    "rejectReason" "RejectReason",
    "nextContactAt" TIMESTAMP(3),
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallHistory" (
    "id" TEXT NOT NULL,
    "binotelCallId" TEXT NOT NULL,
    "externalNumber" TEXT NOT NULL,
    "internalNumber" TEXT,
    "type" "CallType" NOT NULL,
    "status" "CallStatus",
    "duration" INTEGER NOT NULL DEFAULT 0,
    "recordingUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "workOrderId" TEXT,
    "managerId" TEXT,
    CONSTRAINT "CallHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_internalNumber_key" ON "User"("internalNumber");
CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");
CREATE UNIQUE INDEX "Client_phoneNormalized_key" ON "Client"("phoneNormalized");
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");
CREATE INDEX "Vehicle_clientId_idx" ON "Vehicle"("clientId");
CREATE INDEX "Vehicle_brand_model_idx" ON "Vehicle"("brand", "model");
CREATE INDEX "WorkOrder_clientId_closedAt_idx" ON "WorkOrder"("clientId", "closedAt");
CREATE INDEX "WorkOrder_vehicleId_closedAt_idx" ON "WorkOrder"("vehicleId", "closedAt");
CREATE INDEX "WorkOrder_status_updatedAt_idx" ON "WorkOrder"("status", "updatedAt");
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");
CREATE INDEX "Lead_phoneNormalized_idx" ON "Lead"("phoneNormalized");
CREATE INDEX "Lead_status_updatedAt_idx" ON "Lead"("status", "updatedAt");
CREATE INDEX "Lead_source_createdAt_idx" ON "Lead"("source", "createdAt");
CREATE INDEX "Lead_assignedUserId_status_idx" ON "Lead"("assignedUserId", "status");
CREATE INDEX "Lead_nextContactAt_idx" ON "Lead"("nextContactAt");
CREATE UNIQUE INDEX "CallHistory_binotelCallId_key" ON "CallHistory"("binotelCallId");
CREATE INDEX "CallHistory_externalNumber_createdAt_idx" ON "CallHistory"("externalNumber", "createdAt");
CREATE INDEX "CallHistory_internalNumber_createdAt_idx" ON "CallHistory"("internalNumber", "createdAt");
CREATE INDEX "CallHistory_type_createdAt_idx" ON "CallHistory"("type", "createdAt");
CREATE INDEX "CallHistory_status_createdAt_idx" ON "CallHistory"("status", "createdAt");
CREATE INDEX "CallHistory_leadId_idx" ON "CallHistory"("leadId");
CREATE INDEX "CallHistory_clientId_idx" ON "CallHistory"("clientId");
CREATE INDEX "CallHistory_workOrderId_idx" ON "CallHistory"("workOrderId");
CREATE INDEX "CallHistory_managerId_idx" ON "CallHistory"("managerId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
