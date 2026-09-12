import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFile(join(root, path), "utf8");

const service = await read("src/security/security-admin.service.ts");
assert.match(service, /RBAC_PROVISIONING_INCOMPLETE/);
assert.match(service, /RECENT_OWNER_LOGIN_REQUIRED/);
assert.match(service, /allowSelfRegistration: false/);
assert.match(service, /isPrimary/);

const route = await read("app/api/security/config/route.ts");
assert.match(route, /SECURITY_ACCESS_MANAGE/);
assert.match(route, /strict: true/);
assert.match(route, /setSecurityEnforcementMode/);

const readiness = await read("scripts/rbac-production-readiness.ts");
assert.match(readiness, /--require-enforced/);
assert.match(readiness, /enforcementMode/);
assert.match(readiness, /primary_roles/);
assert.match(readiness, /recentOwner/);

const control = await read("app/security-enforcement-control.tsx");
assert.match(control, /Увімкнути ENFORCED/);
assert.match(control, /Сервер і далі блокуватиме/);
assert.match(control, /SHADOW більше не вимикає захист/);

console.log("RBAC enforced contract smoke passed");
