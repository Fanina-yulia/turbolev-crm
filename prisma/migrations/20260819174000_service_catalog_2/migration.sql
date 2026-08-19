-- Price Catalog 2.0: typed service catalog with safe legacy backfill.

CREATE TYPE "ServiceCatalogSource" AS ENUM ('TURBO_LEV_LEGACY', 'MS_MASTER', 'MANUAL');
CREATE TYPE "ServiceCatalogItemType" AS ENUM ('LABOR', 'DIAGNOSTIC', 'MATERIAL', 'INFORMATION', 'CHECKLIST', 'RENT', 'PARKING', 'WASH', 'OTHER');
CREATE TYPE "ServiceCatalogReviewStatus" AS ENUM ('READY', 'NEEDS_REVIEW', 'QUARANTINED');
CREATE TYPE "ServiceCatalogBodySide" AS ENUM ('LEFT', 'RIGHT');
CREATE TYPE "ServiceCatalogCalculatorOperation" AS ENUM ('REPLACE_NO_PAINT', 'REPLACE_WITH_PAINT', 'PAINT_NO_REPAIR', 'LIGHT_REPAIR', 'LIGHT_REPAIR_PAINT', 'COMPLEX_REPAIR', 'COMPLEX_REPAIR_PAINT');
CREATE TYPE "ServiceCatalogPayrollType" AS ENUM ('NONE', 'PERCENT_NORM_HOURS');

CREATE TABLE "ServiceCatalogCategory" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceCatalogCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceCatalogImportBatch" (
    "id" TEXT NOT NULL,
    "source" "ServiceCatalogSource" NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileSha256" VARCHAR(64),
    "sourceVersion" VARCHAR(255),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "readyRows" INTEGER NOT NULL DEFAULT 0,
    "reviewRows" INTEGER NOT NULL DEFAULT 0,
    "quarantinedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "activatedRows" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceCatalogImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceCatalogItem" (
    "id" TEXT NOT NULL,
    "source" "ServiceCatalogSource" NOT NULL,
    "externalServiceId" VARCHAR(64),
    "code" VARCHAR(64),
    "legacyDirectoryItemId" VARCHAR(128),
    "internalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "searchAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "categoryId" TEXT,
    "sourceCategory" VARCHAR(180),
    "itemType" "ServiceCatalogItemType" NOT NULL DEFAULT 'LABOR',
    "basePrice" DECIMAL(14,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "unit" VARCHAR(32) NOT NULL DEFAULT 'роб',
    "defaultQuantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "normMinutes" INTEGER,
    "complexSurcharge" DECIMAL(10,2),
    "vehicleCoefficientEnabled" BOOLEAN NOT NULL DEFAULT true,
    "warrantyKm" INTEGER,
    "warrantyDays" INTEGER,
    "payrollCategory" VARCHAR(180),
    "payrollType" "ServiceCatalogPayrollType" NOT NULL DEFAULT 'NONE',
    "mechanicPercent" DECIMAL(7,3),
    "mechanicFixedAmount" DECIMAL(14,2),
    "bodyPart" VARCHAR(180),
    "bodySide" "ServiceCatalogBodySide",
    "calculatorOperation" "ServiceCatalogCalculatorOperation",
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "showToOperator" BOOLEAN NOT NULL DEFAULT false,
    "showToClient" BOOLEAN NOT NULL DEFAULT false,
    "showOnLanding" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" "ServiceCatalogReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewReason" TEXT,
    "sourceRow" INTEGER,
    "sourceVersion" VARCHAR(255),
    "originalData" JSONB,
    "importBatchId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceCatalogCategory_slug_key" ON "ServiceCatalogCategory"("slug");
CREATE INDEX "ServiceCatalogCategory_isActive_sortOrder_idx" ON "ServiceCatalogCategory"("isActive", "sortOrder");
CREATE INDEX "ServiceCatalogImportBatch_source_createdAt_idx" ON "ServiceCatalogImportBatch"("source", "createdAt");
CREATE UNIQUE INDEX "ServiceCatalogItem_legacyDirectoryItemId_key" ON "ServiceCatalogItem"("legacyDirectoryItemId");
CREATE UNIQUE INDEX "ServiceCatalogItem_source_externalServiceId_key" ON "ServiceCatalogItem"("source", "externalServiceId");
CREATE INDEX "ServiceCatalogItem_isActive_reviewStatus_itemType_idx" ON "ServiceCatalogItem"("isActive", "reviewStatus", "itemType");
CREATE INDEX "ServiceCatalogItem_categoryId_isActive_displayName_idx" ON "ServiceCatalogItem"("categoryId", "isActive", "displayName");
CREATE INDEX "ServiceCatalogItem_source_reviewStatus_idx" ON "ServiceCatalogItem"("source", "reviewStatus");
CREATE INDEX "ServiceCatalogItem_code_idx" ON "ServiceCatalogItem"("code");
CREATE INDEX "ServiceCatalogItem_bodyPart_bodySide_calculatorOperation_idx" ON "ServiceCatalogItem"("bodyPart", "bodySide", "calculatorOperation");
CREATE INDEX "ServiceCatalogItem_importBatchId_idx" ON "ServiceCatalogItem"("importBatchId");

ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceCatalogItem" ADD CONSTRAINT "ServiceCatalogItem_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ServiceCatalogImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ServiceCatalogCategory" ("id", "slug", "name", "sortOrder", "updatedAt") VALUES
('svc_cat_engine', 'engine', 'Двигун', 10, CURRENT_TIMESTAMP),
('svc_cat_chassis', 'chassis', 'Ходова', 20, CURRENT_TIMESTAMP),
('svc_cat_brakes', 'brakes', 'Гальмівна система', 30, CURRENT_TIMESTAMP),
('svc_cat_filters', 'filters', 'Фільтри', 40, CURRENT_TIMESTAMP),
('svc_cat_fluids', 'fluids', 'Мастила та рідини', 50, CURRENT_TIMESTAMP),
('svc_cat_diagnostics', 'diagnostics', 'Діагностика', 60, CURRENT_TIMESTAMP),
('svc_cat_electrics', 'electrics', 'Агрегати, датчики, електрика', 70, CURRENT_TIMESTAMP),
('svc_cat_tires', 'tires', 'Шиномонтаж', 80, CURRENT_TIMESTAMP),
('svc_cat_body', 'body', 'Кузовний ремонт', 90, CURRENT_TIMESTAMP),
('svc_cat_wash', 'wash', 'Мийка', 100, CURRENT_TIMESTAMP),
('svc_cat_complex', 'complex', 'Комплекси послуг', 110, CURRENT_TIMESTAMP),
('svc_cat_gas', 'gas', 'ГБО', 120, CURRENT_TIMESTAMP),
('svc_cat_parking', 'parking', 'Стоянка', 130, CURRENT_TIMESTAMP),
('svc_cat_interior', 'interior', 'Салон', 140, CURRENT_TIMESTAMP),
('svc_cat_hydrogen', 'hydrogen', 'Водень', 150, CURRENT_TIMESTAMP),
('svc_cat_other', 'other', 'Інше', 999, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- Preserve every current Turbo LEV WORK_PRICE row as the initially active catalog.
INSERT INTO "ServiceCatalogItem" (
    "id", "source", "externalServiceId", "code", "legacyDirectoryItemId",
    "internalName", "displayName", "searchAliases", "categoryId", "sourceCategory", "itemType",
    "basePrice", "unit", "defaultQuantity", "normMinutes", "complexSurcharge", "vehicleCoefficientEnabled",
    "isActive", "showToOperator", "showToClient", "showOnLanding", "reviewStatus",
    "sourceVersion", "originalData", "importedAt", "createdAt", "updatedAt"
)
SELECT
    'svc_legacy_' || substr(md5(d."id"), 1, 24),
    'TURBO_LEV_LEGACY'::"ServiceCatalogSource",
    COALESCE(d."code", d."id"),
    d."code",
    d."id",
    d."name",
    d."name",
    ARRAY_REMOVE(ARRAY[d."code", d."name"], NULL),
    CASE
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%двиг%' THEN 'svc_cat_engine'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%ход%' THEN 'svc_cat_chassis'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%торм%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%гальм%' THEN 'svc_cat_brakes'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%фильтр%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%фільтр%' THEN 'svc_cat_filters'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%масл%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%ріди%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%жидк%' THEN 'svc_cat_fluids'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%диаг%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%діаг%' THEN 'svc_cat_diagnostics'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%элект%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%елект%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%датчик%' THEN 'svc_cat_electrics'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%шин%' THEN 'svc_cat_tires'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%куз%' THEN 'svc_cat_body'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%мий%' OR lower(COALESCE(d."data"->>'category','')) LIKE '%мой%' THEN 'svc_cat_wash'
      WHEN lower(COALESCE(d."data"->>'category','')) LIKE '%комплекс%' THEN 'svc_cat_complex'
      ELSE 'svc_cat_other'
    END,
    NULLIF(d."data"->>'category',''),
    'LABOR'::"ServiceCatalogItemType",
    CASE WHEN COALESCE(d."data"->>'price','') ~ '^-?[0-9]+([.,][0-9]+)?$' THEN replace(d."data"->>'price', ',', '.')::DECIMAL(14,2) ELSE NULL END,
    COALESCE(NULLIF(d."data"->>'unit',''), 'роб'),
    1,
    CASE WHEN COALESCE(d."data"->>'normHours','') ~ '^[0-9]+([.,][0-9]+)?$' THEN round(replace(d."data"->>'normHours', ',', '.')::numeric * 60)::INTEGER ELSE NULL END,
    CASE WHEN COALESCE(d."data"->>'complexSurcharge','') ~ '^-?[0-9]+([.,][0-9]+)?$' THEN replace(d."data"->>'complexSurcharge', ',', '.')::DECIMAL(10,2) ELSE NULL END,
    true,
    d."isActive",
    d."isActive",
    false,
    false,
    'READY'::"ServiceCatalogReviewStatus",
    'CrmDirectoryItem:WORK_PRICE',
    d."data",
    CURRENT_TIMESTAMP,
    d."createdAt",
    CURRENT_TIMESTAMP
FROM "CrmDirectoryItem" d
WHERE d."category" = 'WORK_PRICE'
ON CONFLICT ("legacyDirectoryItemId") DO NOTHING;
