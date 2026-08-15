-- CreateEnum
CREATE TYPE "SecurityEnforcementMode" AS ENUM ('SHADOW', 'ENFORCED');

-- CreateEnum
CREATE TYPE "AccessScope" AS ENUM ('SELF', 'ASSIGNED', 'TEAM', 'LOCATION', 'ALL');

-- CreateEnum
CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authUserId" VARCHAR(128),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SecurityConfig" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "enforcementMode" "SecurityEnforcementMode" NOT NULL DEFAULT 'SHADOW',
    "bootstrapCompleted" BOOLEAN NOT NULL DEFAULT false,
    "allowSelfRegistration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRole" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(96) NOT NULL,
    "module" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "scope" "AccessScope" NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAccessRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "locationId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "reason" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAccessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" "PermissionEffect" NOT NULL,
    "scope" "AccessScope" NOT NULL DEFAULT 'ALL',
    "locationId" TEXT,
    "reason" VARCHAR(240),
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRole_code_key" ON "AccessRole"("code");

-- CreateIndex
CREATE INDEX "AccessRole_isActive_sortOrder_idx" ON "AccessRole"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_module_action_idx" ON "Permission"("module", "action");

-- CreateIndex
CREATE INDEX "Permission_isSensitive_idx" ON "Permission"("isSensitive");

-- CreateIndex
CREATE INDEX "AccessRolePermission_permissionId_roleId_idx" ON "AccessRolePermission"("permissionId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessRolePermission_roleId_permissionId_key" ON "AccessRolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserAccessRole_userId_isActive_startsAt_endsAt_idx" ON "UserAccessRole"("userId", "isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "UserAccessRole_roleId_isActive_idx" ON "UserAccessRole"("roleId", "isActive");

-- CreateIndex
CREATE INDEX "UserAccessRole_locationId_isActive_idx" ON "UserAccessRole"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccessRole_userId_roleId_locationId_key" ON "UserAccessRole"("userId", "roleId", "locationId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_userId_isActive_startsAt_expiresAt_idx" ON "UserPermissionOverride"("userId", "isActive", "startsAt", "expiresAt");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_permissionId_effect_idx" ON "UserPermissionOverride"("permissionId", "effect");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_locationId_isActive_idx" ON "UserPermissionOverride"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE INDEX "User_authUserId_isActive_idx" ON "User"("authUserId", "isActive");

-- AddForeignKey
ALTER TABLE "AccessRolePermission" ADD CONSTRAINT "AccessRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRolePermission" ADD CONSTRAINT "AccessRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessRole" ADD CONSTRAINT "UserAccessRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessRole" ADD CONSTRAINT "UserAccessRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AccessRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAccessRole" ADD CONSTRAINT "UserAccessRole_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Turbo LEV security bootstrap. Enforcement intentionally starts in SHADOW mode.
INSERT INTO "SecurityConfig" ("id", "enforcementMode", "bootstrapCompleted", "allowSelfRegistration", "createdAt", "updatedAt")
VALUES ('default', 'SHADOW', false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "AccessRole" ("id", "code", "name", "description", "isSystem", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
('access_owner','OWNER','Власник','Повний контроль системи та бізнесу',true,true,10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_executive','EXECUTIVE_DIRECTOR','Виконавчий директор','Операційне управління компанією',true,true,20,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_rop','HEAD_OF_SALES','РОП','Управління продажами без доступу до чужих зарплат',true,true,30,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_sales','SALES','Продавець','Продажі та робота з клієнтами',true,true,40,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_parts','PARTS_SPECIALIST','Підборщик','Підбір, закупівля та постачання деталей',true,true,50,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_station','STATION_MANAGER','Завідувач станцією','Управління виробництвом, планом і якістю',true,true,60,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_mechanic','MECHANIC','Автомеханік','Виконання призначених робіт',true,true,70,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_accountant','ACCOUNTANT','Бухгалтер','Фінанси, платежі та зарплатний облік',true,true,80,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('access_admin','ADMINISTRATOR','Адміністратор','Операційне адміністрування без чутливих фінансових прав',true,true,90,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name"=EXCLUDED."name", "description"=EXCLUDED."description", "isSystem"=true, "updatedAt"=CURRENT_TIMESTAMP;

INSERT INTO "Permission" ("id", "code", "module", "action", "description", "isSensitive", "createdAt", "updatedAt") VALUES
('perm_overview_read','OVERVIEW.READ','OVERVIEW','READ','Перегляд огляду станції',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_communications_read','COMMUNICATIONS.READ','COMMUNICATIONS','READ','Перегляд комунікацій',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_communications_write','COMMUNICATIONS.WRITE','COMMUNICATIONS','WRITE','Обробка комунікацій',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_leads_read','LEADS.READ','LEADS','READ','Перегляд лідів',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_leads_write','LEADS.WRITE','LEADS','WRITE','Редагування лідів',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_leads_assign','LEADS.ASSIGN','LEADS','ASSIGN','Призначення відповідальних за ліди',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_clients_read','CLIENTS.READ','CLIENTS','READ','Перегляд клієнтів і авто',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_clients_write','CLIENTS.WRITE','CLIENTS','WRITE','Редагування клієнтів і авто',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_planner_read','PLANNER.READ','PLANNER','READ','Перегляд планувальника',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_planner_write','PLANNER.WRITE','PLANNER','WRITE','Керування планувальником',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_diagnostics_read','DIAGNOSTICS.READ','DIAGNOSTICS','READ','Перегляд діагностики',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_diagnostics_write','DIAGNOSTICS.WRITE','DIAGNOSTICS','WRITE','Редагування діагностики',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_diagnostics_confirm','DIAGNOSTICS.CONFIRM','DIAGNOSTICS','CONFIRM','Підтвердження технічного висновку',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_wo_read','WORK_ORDERS.READ','WORK_ORDERS','READ','Перегляд замовлень-нарядів',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_wo_write','WORK_ORDERS.WRITE','WORK_ORDERS','WRITE','Редагування замовлень-нарядів',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_wo_estimate','WORK_ORDERS.ESTIMATE','WORK_ORDERS','ESTIMATE','Формування та зміна кошторису',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_production_read','PRODUCTION.READ','PRODUCTION','READ','Перегляд виробництва',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_production_write','PRODUCTION.WRITE','PRODUCTION','WRITE','Керування виконанням робіт',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_qc_read','QC.READ','QC','READ','Перегляд контролю якості',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_qc_write','QC.WRITE','QC','WRITE','Проведення контролю якості',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_parts_read','PARTS.READ','PARTS','READ','Перегляд підбору запчастин',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_parts_write','PARTS.WRITE','PARTS','WRITE','Підбір та зміна пропозицій деталей',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_procurement_read','PROCUREMENT.READ','PROCUREMENT','READ','Перегляд закупівель і складу',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_procurement_write','PROCUREMENT.WRITE','PROCUREMENT','WRITE','Керування закупівлями і складом',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_finance_read','FINANCE.READ','FINANCE','READ','Перегляд фінансового центру',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_finance_write','FINANCE.WRITE','FINANCE','WRITE','Проведення фінансових операцій',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_payments_read','PAYMENTS.READ','PAYMENTS','READ','Перегляд оплат',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_payments_write','PAYMENTS.WRITE','PAYMENTS','WRITE','Проведення оплат',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_payroll_self','PAYROLL.SELF_READ','PAYROLL','SELF_READ','Перегляд власної зарплати',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_payroll_all','PAYROLL.ALL_READ','PAYROLL','ALL_READ','Перегляд зарплат усіх працівників',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_payroll_write','PAYROLL.WRITE','PAYROLL','WRITE','Нарахування та коригування зарплати',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_payroll_close','PAYROLL.CLOSE','PAYROLL','CLOSE','Закриття зарплатного періоду',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_personnel_read','PERSONNEL.READ','PERSONNEL','READ','Перегляд кадрових профілів',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_personnel_write','PERSONNEL.WRITE','PERSONNEL','WRITE','Створення та редагування працівників',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_personnel_comp','PERSONNEL.COMPENSATION_READ','PERSONNEL','COMPENSATION_READ','Перегляд умов оплати праці інших працівників',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_warranty_read','WARRANTY.READ','WARRANTY','READ','Перегляд гарантій',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_warranty_write','WARRANTY.WRITE','WARRANTY','WRITE','Керування гарантійними випадками',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_analytics_read','ANALYTICS.READ','ANALYTICS','READ','Перегляд загальної аналітики',false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_analytics_personnel','ANALYTICS.PERSONNEL_READ','ANALYTICS','PERSONNEL_READ','Перегляд KPI та ефективності персоналу без автоматичного права на зарплати',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_analytics_financial','ANALYTICS.FINANCIAL_READ','ANALYTICS','FINANCIAL_READ','Перегляд фінансової аналітики',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_settings_read','SETTINGS.READ','SETTINGS','READ','Перегляд налаштувань',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_settings_write','SETTINGS.WRITE','SETTINGS','WRITE','Зміна операційних налаштувань',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_settings_integrations','SETTINGS.INTEGRATIONS','SETTINGS','INTEGRATIONS','Керування інтеграціями та секретами',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_audit_read','AUDIT.READ','AUDIT','READ','Перегляд журналу аудиту',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
('perm_security_manage','SECURITY.ACCESS_MANAGE','SECURITY','ACCESS_MANAGE','Керування ролями та доступами',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "module"=EXCLUDED."module", "action"=EXCLUDED."action", "description"=EXCLUDED."description", "isSensitive"=EXCLUDED."isSensitive", "updatedAt"=CURRENT_TIMESTAMP;

-- Owner and Executive Director receive the complete catalog. Security remains separately auditable.
INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT 'rp_' || md5(r."id" || ':' || p."id"), r."id", p."id", 'ALL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "AccessRole" r CROSS JOIN "Permission" p
WHERE r."code" IN ('OWNER','EXECUTIVE_DIRECTOR')
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET "scope"=EXCLUDED."scope", "updatedAt"=CURRENT_TIMESTAMP;

WITH grants(role_code, permission_code, scope) AS (VALUES
('HEAD_OF_SALES','OVERVIEW.READ','ALL'),('HEAD_OF_SALES','COMMUNICATIONS.READ','ALL'),('HEAD_OF_SALES','COMMUNICATIONS.WRITE','TEAM'),('HEAD_OF_SALES','LEADS.READ','ALL'),('HEAD_OF_SALES','LEADS.WRITE','TEAM'),('HEAD_OF_SALES','LEADS.ASSIGN','TEAM'),('HEAD_OF_SALES','CLIENTS.READ','ALL'),('HEAD_OF_SALES','CLIENTS.WRITE','TEAM'),('HEAD_OF_SALES','PLANNER.READ','ALL'),('HEAD_OF_SALES','WORK_ORDERS.READ','ALL'),('HEAD_OF_SALES','WORK_ORDERS.ESTIMATE','TEAM'),('HEAD_OF_SALES','PAYROLL.SELF_READ','SELF'),('HEAD_OF_SALES','PERSONNEL.READ','TEAM'),('HEAD_OF_SALES','ANALYTICS.READ','ALL'),('HEAD_OF_SALES','ANALYTICS.PERSONNEL_READ','TEAM'),
('SALES','OVERVIEW.READ','LOCATION'),('SALES','COMMUNICATIONS.READ','TEAM'),('SALES','COMMUNICATIONS.WRITE','ASSIGNED'),('SALES','LEADS.READ','TEAM'),('SALES','LEADS.WRITE','ASSIGNED'),('SALES','CLIENTS.READ','TEAM'),('SALES','CLIENTS.WRITE','ASSIGNED'),('SALES','PLANNER.READ','LOCATION'),('SALES','PLANNER.WRITE','ASSIGNED'),('SALES','WORK_ORDERS.READ','ASSIGNED'),('SALES','WORK_ORDERS.ESTIMATE','ASSIGNED'),('SALES','PAYROLL.SELF_READ','SELF'),
('PARTS_SPECIALIST','OVERVIEW.READ','LOCATION'),('PARTS_SPECIALIST','WORK_ORDERS.READ','LOCATION'),('PARTS_SPECIALIST','PARTS.READ','ALL'),('PARTS_SPECIALIST','PARTS.WRITE','ALL'),('PARTS_SPECIALIST','PROCUREMENT.READ','ALL'),('PARTS_SPECIALIST','PROCUREMENT.WRITE','ALL'),('PARTS_SPECIALIST','PAYROLL.SELF_READ','SELF'),
('STATION_MANAGER','OVERVIEW.READ','LOCATION'),('STATION_MANAGER','CLIENTS.READ','LOCATION'),('STATION_MANAGER','PLANNER.READ','LOCATION'),('STATION_MANAGER','PLANNER.WRITE','LOCATION'),('STATION_MANAGER','DIAGNOSTICS.READ','LOCATION'),('STATION_MANAGER','DIAGNOSTICS.WRITE','LOCATION'),('STATION_MANAGER','DIAGNOSTICS.CONFIRM','LOCATION'),('STATION_MANAGER','WORK_ORDERS.READ','LOCATION'),('STATION_MANAGER','WORK_ORDERS.WRITE','LOCATION'),('STATION_MANAGER','WORK_ORDERS.ESTIMATE','LOCATION'),('STATION_MANAGER','PRODUCTION.READ','LOCATION'),('STATION_MANAGER','PRODUCTION.WRITE','LOCATION'),('STATION_MANAGER','QC.READ','LOCATION'),('STATION_MANAGER','QC.WRITE','LOCATION'),('STATION_MANAGER','PARTS.READ','LOCATION'),('STATION_MANAGER','PROCUREMENT.READ','LOCATION'),('STATION_MANAGER','PAYROLL.SELF_READ','SELF'),('STATION_MANAGER','PERSONNEL.READ','LOCATION'),('STATION_MANAGER','ANALYTICS.READ','LOCATION'),('STATION_MANAGER','ANALYTICS.PERSONNEL_READ','LOCATION'),('STATION_MANAGER','WARRANTY.READ','LOCATION'),('STATION_MANAGER','WARRANTY.WRITE','LOCATION'),
('MECHANIC','OVERVIEW.READ','LOCATION'),('MECHANIC','PLANNER.READ','ASSIGNED'),('MECHANIC','DIAGNOSTICS.READ','ASSIGNED'),('MECHANIC','WORK_ORDERS.READ','ASSIGNED'),('MECHANIC','PRODUCTION.READ','ASSIGNED'),('MECHANIC','PRODUCTION.WRITE','ASSIGNED'),('MECHANIC','QC.READ','ASSIGNED'),('MECHANIC','PARTS.READ','ASSIGNED'),('MECHANIC','PAYROLL.SELF_READ','SELF'),
('ACCOUNTANT','OVERVIEW.READ','ALL'),('ACCOUNTANT','WORK_ORDERS.READ','ALL'),('ACCOUNTANT','FINANCE.READ','ALL'),('ACCOUNTANT','FINANCE.WRITE','ALL'),('ACCOUNTANT','PAYMENTS.READ','ALL'),('ACCOUNTANT','PAYMENTS.WRITE','ALL'),('ACCOUNTANT','PAYROLL.SELF_READ','SELF'),('ACCOUNTANT','PAYROLL.ALL_READ','ALL'),('ACCOUNTANT','PAYROLL.WRITE','ALL'),('ACCOUNTANT','PAYROLL.CLOSE','ALL'),('ACCOUNTANT','PERSONNEL.READ','ALL'),('ACCOUNTANT','PERSONNEL.COMPENSATION_READ','ALL'),('ACCOUNTANT','ANALYTICS.READ','ALL'),('ACCOUNTANT','ANALYTICS.PERSONNEL_READ','ALL'),('ACCOUNTANT','ANALYTICS.FINANCIAL_READ','ALL'),('ACCOUNTANT','AUDIT.READ','ALL'),
('ADMINISTRATOR','OVERVIEW.READ','LOCATION'),('ADMINISTRATOR','COMMUNICATIONS.READ','LOCATION'),('ADMINISTRATOR','COMMUNICATIONS.WRITE','LOCATION'),('ADMINISTRATOR','LEADS.READ','LOCATION'),('ADMINISTRATOR','LEADS.WRITE','LOCATION'),('ADMINISTRATOR','CLIENTS.READ','LOCATION'),('ADMINISTRATOR','CLIENTS.WRITE','LOCATION'),('ADMINISTRATOR','PLANNER.READ','LOCATION'),('ADMINISTRATOR','PLANNER.WRITE','LOCATION'),('ADMINISTRATOR','DIAGNOSTICS.READ','LOCATION'),('ADMINISTRATOR','WORK_ORDERS.READ','LOCATION'),('ADMINISTRATOR','PARTS.READ','LOCATION'),('ADMINISTRATOR','PROCUREMENT.READ','LOCATION'),('ADMINISTRATOR','PAYROLL.SELF_READ','SELF'),('ADMINISTRATOR','PERSONNEL.READ','LOCATION'),('ADMINISTRATOR','WARRANTY.READ','LOCATION')
)
INSERT INTO "AccessRolePermission" ("id", "roleId", "permissionId", "scope", "createdAt", "updatedAt")
SELECT 'rp_' || md5(r."id" || ':' || p."id"), r."id", p."id", g.scope::"AccessScope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM grants g
JOIN "AccessRole" r ON r."code" = g.role_code
JOIN "Permission" p ON p."code" = g.permission_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET "scope"=EXCLUDED."scope", "updatedAt"=CURRENT_TIMESTAMP;
