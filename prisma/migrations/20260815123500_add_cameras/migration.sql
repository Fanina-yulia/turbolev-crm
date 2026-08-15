-- CreateEnum
CREATE TYPE "CameraProvider" AS ENUM ('REOLINK');

-- CreateEnum
CREATE TYPE "CameraPurpose" AS ENUM ('ENTRY', 'EXIT', 'TERRITORY', 'SERVICE_POST');

-- CreateEnum
CREATE TYPE "CameraConnectionMode" AS ENUM ('EMAIL_EVENTS', 'UID_P2P', 'LOCAL');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('NOT_TESTED', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "CameraEventType" AS ENUM ('VEHICLE_DETECTED', 'ENTRY', 'EXIT', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "CameraEventSource" AS ENUM ('GMAIL_EMAIL', 'P2P_BRIDGE', 'LOCAL_STREAM');

-- CreateEnum
CREATE TYPE "CameraRecognitionStatus" AS ENUM ('PENDING', 'RECOGNIZED', 'REVIEW_REQUIRED', 'IGNORED');

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "provider" "CameraProvider" NOT NULL DEFAULT 'REOLINK',
    "uid" VARCHAR(40) NOT NULL,
    "username" VARCHAR(80) NOT NULL DEFAULT 'admin',
    "encryptedPassword" TEXT NOT NULL,
    "ingestTokenHash" VARCHAR(64),
    "purpose" "CameraPurpose" NOT NULL DEFAULT 'TERRITORY',
    "connectionMode" "CameraConnectionMode" NOT NULL DEFAULT 'EMAIL_EVENTS',
    "status" "CameraStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "model" VARCHAR(120),
    "lastSeenAt" TIMESTAMP(3),
    "lastTestAt" TIMESTAMP(3),
    "lastTestMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraEvent" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "workOrderId" TEXT,
    "eventType" "CameraEventType" NOT NULL DEFAULT 'VEHICLE_DETECTED',
    "source" "CameraEventSource" NOT NULL DEFAULT 'GMAIL_EMAIL',
    "sourceEventId" VARCHAR(180),
    "plateNumber" VARCHAR(24),
    "plateNormalized" VARCHAR(24),
    "confidence" INTEGER,
    "recognitionStatus" "CameraRecognitionStatus" NOT NULL DEFAULT 'PENDING',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotUrl" TEXT,
    "snapshotData" BYTEA,
    "snapshotMimeType" VARCHAR(80),
    "snapshotSize" INTEGER,
    "plateCropUrl" TEXT,
    "videoUrl" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Camera_uid_key" ON "Camera"("uid");
CREATE INDEX "Camera_purpose_isActive_idx" ON "Camera"("purpose", "isActive");
CREATE INDEX "Camera_status_updatedAt_idx" ON "Camera"("status", "updatedAt");
CREATE UNIQUE INDEX "CameraEvent_cameraId_sourceEventId_key" ON "CameraEvent"("cameraId", "sourceEventId");
CREATE INDEX "CameraEvent_cameraId_detectedAt_idx" ON "CameraEvent"("cameraId", "detectedAt");
CREATE INDEX "CameraEvent_vehicleId_detectedAt_idx" ON "CameraEvent"("vehicleId", "detectedAt");
CREATE INDEX "CameraEvent_plateNormalized_detectedAt_idx" ON "CameraEvent"("plateNormalized", "detectedAt");
CREATE INDEX "CameraEvent_recognitionStatus_detectedAt_idx" ON "CameraEvent"("recognitionStatus", "detectedAt");
CREATE INDEX "CameraEvent_workOrderId_idx" ON "CameraEvent"("workOrderId");

-- AddForeignKey
ALTER TABLE "CameraEvent" ADD CONSTRAINT "CameraEvent_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
