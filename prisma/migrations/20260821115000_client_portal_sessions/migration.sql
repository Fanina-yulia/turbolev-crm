CREATE TABLE "ClientPortalSession" (
    "id" TEXT NOT NULL,
    "clientId" VARCHAR(64) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "bootstrapShareId" VARCHAR(64),
    "userAgentHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ClientPortalSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientPortalSession_tokenHash_key" ON "ClientPortalSession"("tokenHash");
CREATE INDEX "ClientPortalSession_clientId_expiresAt_idx" ON "ClientPortalSession"("clientId", "expiresAt");
CREATE INDEX "ClientPortalSession_expiresAt_revokedAt_idx" ON "ClientPortalSession"("expiresAt", "revokedAt");
