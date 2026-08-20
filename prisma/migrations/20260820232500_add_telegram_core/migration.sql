CREATE TABLE "TelegramContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "chatId" VARCHAR(32),
    "telegramUserId" VARCHAR(32),
    "username" VARCHAR(64),
    "firstName" VARCHAR(120),
    "lastName" VARCHAR(120),
    "linkTokenHash" VARCHAR(64),
    "linkExpiresAt" TIMESTAMP(6),
    "linkedAt" TIMESTAMP(6),
    "lastInboundAt" TIMESTAMP(6),
    "lastOutboundAt" TIMESTAMP(6),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramContact_clientId_key" ON "TelegramContact"("clientId");
CREATE UNIQUE INDEX "TelegramContact_chatId_key" ON "TelegramContact"("chatId");
CREATE UNIQUE INDEX "TelegramContact_telegramUserId_key" ON "TelegramContact"("telegramUserId");
CREATE UNIQUE INDEX "TelegramContact_linkTokenHash_key" ON "TelegramContact"("linkTokenHash");
CREATE INDEX "TelegramContact_isActive_updatedAt_idx" ON "TelegramContact"("isActive", "updatedAt");
CREATE INDEX "TelegramContact_linkExpiresAt_idx" ON "TelegramContact"("linkExpiresAt");
