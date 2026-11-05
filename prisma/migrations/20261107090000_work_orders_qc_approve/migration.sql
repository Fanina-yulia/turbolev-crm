-- SEC-R1: separate permission for the final quality-control decision (PASS/FAIL).
-- Additive and idempotent: only inserts a permission row and role grants. No deletes, no schema changes.
-- Not granted to MECHANIC (or any role without QC.WRITE today). Grants mirror who may record QC today.
INSERT INTO "Permission" ("id","code","module","action","description","isSensitive","createdAt","updatedAt")
VALUES ('perm_work_orders_qc_approve','WORK_ORDERS.QC_APPROVE','WORK_ORDERS','QC_APPROVE','Остаточне погодження контролю якості (не виконавець)',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "AccessRolePermission" ("id","roleId","permissionId","scope","createdAt","updatedAt")
SELECT 'arp_qc_approve_' || LEFT(MD5(ar.code), 20), ar.id, p.id,
       (CASE WHEN ar.code = 'STATION_MANAGER' THEN 'LOCATION' ELSE 'ALL' END)::"AccessScope",
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "AccessRole" ar
JOIN "Permission" p ON p.code = 'WORK_ORDERS.QC_APPROVE'
WHERE ar.code IN ('OWNER','EXECUTIVE_DIRECTOR','STATION_MANAGER')
ON CONFLICT ("roleId","permissionId") DO NOTHING;
