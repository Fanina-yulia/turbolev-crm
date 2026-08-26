CREATE TABLE "DiagnosticVisitLink" (
    "id" TEXT NOT NULL,
    "diagnosticRequestId" TEXT NOT NULL,
    "appointmentId" VARCHAR(64) NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticVisitLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiagnosticVisitLink_diagnosticRequestId_key" ON "DiagnosticVisitLink"("diagnosticRequestId");
CREATE UNIQUE INDEX "DiagnosticVisitLink_appointmentId_key" ON "DiagnosticVisitLink"("appointmentId");
CREATE INDEX "DiagnosticVisitLink_vehicleId_createdAt_idx" ON "DiagnosticVisitLink"("vehicleId", "createdAt");
