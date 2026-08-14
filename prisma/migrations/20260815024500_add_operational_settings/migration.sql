-- Turbo LEV operational settings and editable directories.
-- Additive migration: does not alter or rewrite existing business tables.
CREATE TABLE IF NOT EXISTS "CrmSetting" (
  "key" VARCHAR(64) PRIMARY KEY,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CrmDirectoryItem" (
  "id" TEXT PRIMARY KEY,
  "category" VARCHAR(32) NOT NULL,
  "name" TEXT NOT NULL,
  "code" VARCHAR(64),
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CrmDirectoryItem_category_isActive_sortOrder_idx"
  ON "CrmDirectoryItem" ("category", "isActive", "sortOrder");

INSERT INTO "CrmSetting" ("key", "value", "updatedAt") VALUES
  ('work_schedule', '[{"day":1,"label":"Пн","enabled":true,"open":"09:00","close":"21:00"},{"day":2,"label":"Вт","enabled":true,"open":"09:00","close":"21:00"},{"day":3,"label":"Ср","enabled":true,"open":"09:00","close":"21:00"},{"day":4,"label":"Чт","enabled":true,"open":"09:00","close":"21:00"},{"day":5,"label":"Пт","enabled":true,"open":"09:00","close":"21:00"},{"day":6,"label":"Сб","enabled":true,"open":"09:00","close":"21:00"},{"day":7,"label":"Нд","enabled":true,"open":"09:00","close":"21:00"}]'::jsonb, CURRENT_TIMESTAMP),
  ('markup', '{"defaultPartsPercent":23,"customerPartsLaborPercent":20,"rounding":"NONE"}'::jsonb, CURRENT_TIMESTAMP),
  ('client_rules', '{"deduplicateByPhone":true,"requirePhone":true,"defaultDiscountPercent":0,"keepVehicleHistory":true}'::jsonb, CURRENT_TIMESTAMP),
  ('cash_rules', '{"currency":"UAH","paymentMethods":["Готівка","Картка","Переказ"],"requireShiftClose":true}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "CrmDirectoryItem" ("id","category","name","code","data","isActive","sortOrder","updatedAt")
VALUES
  ('dir_warehouse_main','WAREHOUSE','Основний склад','MAIN','{"location":"Глеваха","responsible":""}'::jsonb,TRUE,10,CURRENT_TIMESTAMP),
  ('dir_cash_main','CASH','Основна каса','MAIN','{"location":"Глеваха","paymentMethods":["Готівка","Картка","Переказ"]}'::jsonb,TRUE,10,CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
