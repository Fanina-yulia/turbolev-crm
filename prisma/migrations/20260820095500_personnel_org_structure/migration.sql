-- Canonical Turbo LEV personnel structure: category -> position -> access role.
-- Existing role codes are preserved where possible so cabinets, audit history and assignments keep working.

INSERT INTO public."StaffRole" ("id","code","name","category","isActive","sortOrder","createdAt","updatedAt","economicsMode") VALUES
  ('staff_role_owner','OWNER','Власник','Керівництво',true,10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'OWNER'::"RoleEconomicsMode"),
  ('staff_role_executive_director','EXECUTIVE_DIRECTOR','Виконавчий директор','Керівництво',true,20,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'MANAGED_VALUE'::"RoleEconomicsMode"),
  ('staff_role_station_manager','STATION_MANAGER','Керівник станції','Керівництво',true,30,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'MANAGED_VALUE'::"RoleEconomicsMode"),
  ('staff_role_service_advisor','SERVICE_ADVISOR','Сервіс-менеджер','Сервіс',true,40,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'DIRECT_ROI'::"RoleEconomicsMode"),
  ('staff_role_mechanic','MECHANIC','Механік','Механіки',true,50,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'DIRECT_ROI'::"RoleEconomicsMode"),
  ('staff_role_parts_specialist','PARTS_SPECIALIST','Менеджер з запчастин','Запчастини та склад',true,60,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'DIRECT_ROI'::"RoleEconomicsMode"),
  ('staff_role_warehouse_keeper','WAREHOUSE_KEEPER','Комірник','Запчастини та склад',true,70,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'SUPPORT_CAPACITY'::"RoleEconomicsMode"),
  ('staff_role_head_of_sales','HEAD_OF_SALES','Керівник відділу продажів','Продажі',true,80,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'MANAGED_VALUE'::"RoleEconomicsMode"),
  ('staff_role_sales','SALES','Менеджер з продажу','Продажі',true,90,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'DIRECT_ROI'::"RoleEconomicsMode"),
  ('staff_role_accountant','ACCOUNTANT','Бухгалтер','Фінанси',true,100,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'SUPPORT_CAPACITY'::"RoleEconomicsMode"),
  ('staff_role_marketing_director','MARKETING_DIRECTOR','Директор з маркетингу','Маркетинг',true,110,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'MANAGED_VALUE'::"RoleEconomicsMode"),
  ('staff_role_marketer','MARKETER','Маркетолог','Маркетинг',true,120,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'SUPPORT_CAPACITY'::"RoleEconomicsMode"),
  ('staff_role_hr_manager','HR_MANAGER','HR-менеджер','Персонал',true,130,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'SUPPORT_CAPACITY'::"RoleEconomicsMode"),
  ('staff_role_administrator','ADMINISTRATOR','Адміністратор','Адміністрація',true,140,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'SUPPORT_CAPACITY'::"RoleEconomicsMode"),
  ('staff_role_crm_admin','CRM_ADMIN','CRM-адміністратор','IT / CRM',true,150,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'SUPPORT_CAPACITY'::"RoleEconomicsMode")
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name",
  "category"=EXCLUDED."category",
  "isActive"=true,
  "sortOrder"=EXCLUDED."sortOrder",
  "updatedAt"=CURRENT_TIMESTAMP;

INSERT INTO public."AccessRole" ("id","code","name","description","isSystem","isActive","sortOrder","createdAt","updatedAt") VALUES
  ('access_role_owner','OWNER','Власник','Повний доступ до всієї мережі, фінансів, безпеки та налаштувань.',true,true,10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_executive_director','EXECUTIVE_DIRECTOR','Виконавчий директор','Повний управлінський доступ до всієї мережі.',true,true,20,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_station_manager','STATION_MANAGER','Керівник станції','Керує операційною роботою конкретної станції, персоналом станції та контролем якості без глобальної фінансової адміністрації.',true,true,30,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_service_advisor','SERVICE_ADVISOR','Сервіс-менеджер','Власник сервісного процесу: приймання, клієнтська комунікація, кошторис, погодження, підбір деталей і супровід авто до видачі.',true,true,40,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_mechanic','MECHANIC','Механік','Єдина посада для всіх механічних спеціалізацій: призначені діагностики та ремонт, старт, пауза, продовження і завершення власних робіт.',true,true,50,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_parts_specialist','PARTS_SPECIALIST','Менеджер з запчастин','Підбір, закупівля, отримання та робота з постачальниками в межах сервісного процесу.',true,true,60,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_warehouse_keeper','WAREHOUSE_KEEPER','Комірник','Приймання, резервування, зберігання та видача запчастин у межах своєї станції.',true,true,70,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_head_of_sales','HEAD_OF_SALES','Керівник відділу продажів','Керує воронкою продажів і командою. Фінальний кошторис Замовлення-наряду формує сервіс-менеджер.',true,true,80,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_sales','SALES','Менеджер з продажу','Працює зі зверненнями, лідами, клієнтами та записом. Фінальний кошторис формує сервіс-менеджер.',true,true,90,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_accountant','ACCOUNTANT','Бухгалтер','Каса, платежі, фінанси та зарплата. Проводить оплату, але не керує сервісним статусом автомобіля вручну.',true,true,100,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_marketing_director','MARKETING_DIRECTOR','Директор з маркетингу','Керує маркетингом мережі, бачить комунікації, ліди та операційну аналітику без фінансового адміністрування.',true,true,110,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_marketer','MARKETER','Маркетолог','Маркетингові комунікації, ліди та аналітика мережі без доступу до фінансів і системного адміністрування.',true,true,120,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_hr_manager','HR_MANAGER','HR-менеджер','Кадровий контур мережі: персонал та кадрова аналітика без доступу до фінансів і ставок працівників.',true,true,130,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_administrator','ADMINISTRATOR','Адміністратор','Адміністративна робота станції та операційний планувальник.',true,true,140,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('access_role_crm_admin','CRM_ADMIN','CRM-адміністратор','Технічне адміністрування CRM, інтеграцій, ролей і аудиту без доступу до фінансових даних бізнесу.',true,true,150,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name"=EXCLUDED."name",
  "description"=EXCLUDED."description",
  "isSystem"=true,
  "isActive"=true,
  "sortOrder"=EXCLUDED."sortOrder",
  "updatedAt"=CURRENT_TIMESTAMP;

-- New-role grants. Permissions themselves already belong to the security catalog.
WITH grants(role_code, permission_code, scope) AS (VALUES
  ('WAREHOUSE_KEEPER','OVERVIEW.READ','LOCATION'),
  ('WAREHOUSE_KEEPER','WORK_ORDERS.READ','LOCATION'),
  ('WAREHOUSE_KEEPER','PARTS.READ','LOCATION'),
  ('WAREHOUSE_KEEPER','PARTS.WRITE','LOCATION'),
  ('WAREHOUSE_KEEPER','PROCUREMENT.READ','LOCATION'),
  ('WAREHOUSE_KEEPER','PROCUREMENT.WRITE','LOCATION'),
  ('WAREHOUSE_KEEPER','PAYROLL.SELF_READ','SELF'),

  ('MARKETING_DIRECTOR','OVERVIEW.READ','ALL'),
  ('MARKETING_DIRECTOR','COMMUNICATIONS.READ','ALL'),
  ('MARKETING_DIRECTOR','LEADS.READ','ALL'),
  ('MARKETING_DIRECTOR','CLIENTS.READ','ALL'),
  ('MARKETING_DIRECTOR','ANALYTICS.READ','ALL'),
  ('MARKETING_DIRECTOR','PAYROLL.SELF_READ','SELF'),

  ('MARKETER','OVERVIEW.READ','ALL'),
  ('MARKETER','COMMUNICATIONS.READ','ALL'),
  ('MARKETER','LEADS.READ','ALL'),
  ('MARKETER','CLIENTS.READ','ALL'),
  ('MARKETER','ANALYTICS.READ','ALL'),
  ('MARKETER','PAYROLL.SELF_READ','SELF'),

  ('HR_MANAGER','OVERVIEW.READ','ALL'),
  ('HR_MANAGER','PERSONNEL.READ','ALL'),
  ('HR_MANAGER','PERSONNEL.WRITE','ALL'),
  ('HR_MANAGER','ANALYTICS.PERSONNEL_READ','ALL'),
  ('HR_MANAGER','PAYROLL.SELF_READ','SELF'),

  ('CRM_ADMIN','OVERVIEW.READ','ALL'),
  ('CRM_ADMIN','SETTINGS.READ','ALL'),
  ('CRM_ADMIN','SETTINGS.WRITE','ALL'),
  ('CRM_ADMIN','SETTINGS.INTEGRATIONS','ALL'),
  ('CRM_ADMIN','AUDIT.READ','ALL'),
  ('CRM_ADMIN','SECURITY.ACCESS_MANAGE','ALL'),
  ('CRM_ADMIN','PAYROLL.SELF_READ','SELF')
)
INSERT INTO public."AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT
  'arp_org_' || md5(grants.role_code || ':' || grants.permission_code),
  ar.id,
  p.id,
  grants.scope::"AccessScope",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM grants
JOIN public."AccessRole" ar ON ar.code=grants.role_code
JOIN public."Permission" p ON p.code=grants.permission_code
ON CONFLICT ("roleId","permissionId") DO UPDATE SET
  "scope"=EXCLUDED."scope",
  "updatedAt"=CURRENT_TIMESTAMP;

-- QC belongs to the station manager after removing the separate shift-master position.
INSERT INTO public."AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT 'arp_org_station_qc_write', ar.id, p.id, 'LOCATION'::"AccessScope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public."AccessRole" ar
JOIN public."Permission" p ON p.code='QC.WRITE'
WHERE ar.code='STATION_MANAGER'
ON CONFLICT ("roleId","permissionId") DO UPDATE SET "scope"='LOCATION'::"AccessScope", "updatedAt"=CURRENT_TIMESTAMP;

DELETE FROM public."AccessRolePermission" arp
USING public."AccessRole" ar, public."Permission" p
WHERE arp."roleId"=ar.id
  AND arp."permissionId"=p.id
  AND ar.code='MECHANIC'
  AND p.code IN ('QC.READ','QC.WRITE');

-- Convert any still-current Shift Master assignments to the single Mechanic position before retiring the legacy role.
WITH shift_role AS (SELECT id FROM public."StaffRole" WHERE code='SHIFT_MASTER'),
     mechanic_role AS (SELECT id FROM public."StaffRole" WHERE code='MECHANIC'),
     current_shift AS (
       SELECT era.* FROM public."EmployeeRoleAssignment" era, shift_role
       WHERE era."roleId"=shift_role.id
         AND era."startsAt" <= CURRENT_TIMESTAMP
         AND (era."endsAt" IS NULL OR era."endsAt" > CURRENT_TIMESTAMP)
     )
INSERT INTO public."EmployeeRoleAssignment" ("id","employeeId","roleId","locationId","startsAt","endsAt","isPrimary","createdAt","updatedAt")
SELECT
  'era_org_' || md5(cs."employeeId" || ':' || COALESCE(cs."locationId",'GLOBAL')),
  cs."employeeId", mr.id, cs."locationId", CURRENT_TIMESTAMP, NULL, cs."isPrimary", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM current_shift cs
CROSS JOIN mechanic_role mr
WHERE NOT EXISTS (
  SELECT 1 FROM public."EmployeeRoleAssignment" existing
  WHERE existing."employeeId"=cs."employeeId"
    AND existing."roleId"=mr.id
    AND existing."startsAt" <= CURRENT_TIMESTAMP
    AND (existing."endsAt" IS NULL OR existing."endsAt" > CURRENT_TIMESTAMP)
)
ON CONFLICT ("id") DO NOTHING;

UPDATE public."EmployeeRoleAssignment" era
SET "endsAt"=CURRENT_TIMESTAMP, "isPrimary"=false, "updatedAt"=CURRENT_TIMESTAMP
FROM public."StaffRole" sr
WHERE era."roleId"=sr.id
  AND sr.code='SHIFT_MASTER'
  AND era."startsAt" <= CURRENT_TIMESTAMP
  AND (era."endsAt" IS NULL OR era."endsAt" > CURRENT_TIMESTAMP);

WITH shift_role AS (SELECT id FROM public."AccessRole" WHERE code='SHIFT_MASTER'),
     mechanic_role AS (SELECT id FROM public."AccessRole" WHERE code='MECHANIC'),
     current_shift AS (
       SELECT uar.* FROM public."UserAccessRole" uar, shift_role
       WHERE uar."roleId"=shift_role.id AND uar."isActive"=true
         AND uar."startsAt" <= CURRENT_TIMESTAMP
         AND (uar."endsAt" IS NULL OR uar."endsAt" > CURRENT_TIMESTAMP)
     )
INSERT INTO public."UserAccessRole" ("id","userId","roleId","locationId","isPrimary","isActive","startsAt","endsAt","reason","createdAt","updatedAt")
SELECT
  'uar_org_' || md5(cs."userId" || ':' || COALESCE(cs."locationId",'GLOBAL')),
  cs."userId", mr.id, cs."locationId", cs."isPrimary", true, CURRENT_TIMESTAMP, NULL,
  'Org structure migration: SHIFT_MASTER -> MECHANIC', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM current_shift cs
CROSS JOIN mechanic_role mr
ON CONFLICT ("userId","roleId","locationId") DO UPDATE SET
  "isActive"=true,
  "isPrimary"=EXCLUDED."isPrimary",
  "startsAt"=CURRENT_TIMESTAMP,
  "endsAt"=NULL,
  "reason"=EXCLUDED."reason",
  "updatedAt"=CURRENT_TIMESTAMP;

UPDATE public."UserAccessRole" uar
SET "isActive"=false, "isPrimary"=false, "endsAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP
FROM public."AccessRole" ar
WHERE uar."roleId"=ar.id AND ar.code='SHIFT_MASTER' AND uar."isActive"=true;

UPDATE public."StaffRole" SET "isActive"=false, "updatedAt"=CURRENT_TIMESTAMP WHERE code='SHIFT_MASTER';
UPDATE public."AccessRole" SET "isActive"=false, "updatedAt"=CURRENT_TIMESTAMP WHERE code='SHIFT_MASTER';

-- Employee cards must always mirror their current primary position/category.
UPDATE public."EmployeeProfile" ep
SET "position"=sr.name,
    "personnelCategory"=sr.category,
    "updatedAt"=CURRENT_TIMESTAMP
FROM public."EmployeeRoleAssignment" era
JOIN public."StaffRole" sr ON sr.id=era."roleId"
WHERE era."employeeId"=ep.id
  AND era."isPrimary"=true
  AND era."startsAt" <= CURRENT_TIMESTAMP
  AND (era."endsAt" IS NULL OR era."endsAt" > CURRENT_TIMESTAMP)
  AND sr."isActive"=true;

-- Normalize legacy mechanic cards even when they have no current role assignment.
UPDATE public."EmployeeProfile"
SET "position"='Механік', "personnelCategory"='Механіки', "updatedAt"=CURRENT_TIMESTAMP
WHERE "position" IN ('Автомеханік','Майстер зміни','Механік-діагност','Моторист','Ходовик','Автоелектрик','Шиномонтажник')
   OR "personnelCategory" IN ('Автомеханіки','SERVICE') AND "position"='Автомеханік';
