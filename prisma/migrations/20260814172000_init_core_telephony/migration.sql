-- CreateEnum
CREATE TYPE "CallType" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ANSWERED', 'MISSED', 'BUSY');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW_REQUEST', 'CONTACTED', 'QUALIFIED', 'BOOKED', 'LOST', 'CONVERTED');

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
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW_REQUEST',
    "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
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
    "managerId" TEXT,
    CONSTRAINT "CallHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_internalNumber_key" ON "User"("internalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Client_phoneNormalized_key" ON "Client"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "Lead_phoneNormalized_idx" ON "Lead"("phoneNormalized");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_source_createdAt_idx" ON "Lead"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallHistory_binotelCallId_key" ON "CallHistory"("binotelCallId");

-- CreateIndex
CREATE INDEX "CallHistory_externalNumber_createdAt_idx" ON "CallHistory"("externalNumber", "createdAt");

-- CreateIndex
CREATE INDEX "CallHistory_internalNumber_createdAt_idx" ON "CallHistory"("internalNumber", "createdAt");

-- CreateIndex
CREATE INDEX "CallHistory_type_createdAt_idx" ON "CallHistory"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CallHistory_status_createdAt_idx" ON "CallHistory"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CallHistory_leadId_idx" ON "CallHistory"("leadId");

-- CreateIndex
CREATE INDEX "CallHistory_clientId_idx" ON "CallHistory"("clientId");

-- CreateIndex
CREATE INDEX "CallHistory_managerId_idx" ON "CallHistory"("managerId");

-- AddForeignKey
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallHistory" ADD CONSTRAINT "CallHistory_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
