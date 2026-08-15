CREATE TABLE IF NOT EXISTS "ClientPhone" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "phoneNormalized" TEXT NOT NULL,
  "label" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientPhone_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ClientPhone_clientId_fkey'
      AND conrelid = '"ClientPhone"'::regclass
  ) THEN
    ALTER TABLE "ClientPhone"
      ADD CONSTRAINT "ClientPhone_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ClientPhone_phoneNormalized_key" ON "ClientPhone"("phoneNormalized");
CREATE INDEX IF NOT EXISTS "ClientPhone_clientId_isPrimary_idx" ON "ClientPhone"("clientId", "isPrimary");

INSERT INTO "ClientPhone" ("id", "clientId", "phone", "phoneNormalized", "label", "isPrimary", "createdAt", "updatedAt")
SELECT 'cp_' || md5(c."id" || ':' || c."phoneNormalized"), c."id", c."phone", c."phoneNormalized", 'Основний', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Client" c
WHERE c."phoneNormalized" IS NOT NULL AND c."phoneNormalized" <> ''
ON CONFLICT ("phoneNormalized") DO NOTHING;
