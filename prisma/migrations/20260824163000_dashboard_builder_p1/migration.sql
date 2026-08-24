CREATE TABLE "DashboardConfiguration" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dashboardId" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "presetId" VARCHAR(80) NOT NULL,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DashboardConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DashboardConfigurationVersion" (
  "id" TEXT NOT NULL,
  "dashboardConfigurationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "presetId" VARCHAR(80) NOT NULL,
  "config" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DashboardConfigurationVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardConfiguration_userId_dashboardId_key"
  ON "DashboardConfiguration"("userId", "dashboardId");
CREATE INDEX "DashboardConfiguration_dashboardId_updatedAt_idx"
  ON "DashboardConfiguration"("dashboardId", "updatedAt");
CREATE UNIQUE INDEX "DashboardConfigurationVersion_dashboardConfigurationId_version_key"
  ON "DashboardConfigurationVersion"("dashboardConfigurationId", "version");
CREATE INDEX "DashboardConfigurationVersion_createdByUserId_createdAt_idx"
  ON "DashboardConfigurationVersion"("createdByUserId", "createdAt");

ALTER TABLE "DashboardConfiguration"
  ADD CONSTRAINT "DashboardConfiguration_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardConfigurationVersion"
  ADD CONSTRAINT "DashboardConfigurationVersion_dashboardConfigurationId_fkey"
  FOREIGN KEY ("dashboardConfigurationId") REFERENCES "DashboardConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardConfigurationVersion"
  ADD CONSTRAINT "DashboardConfigurationVersion_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
