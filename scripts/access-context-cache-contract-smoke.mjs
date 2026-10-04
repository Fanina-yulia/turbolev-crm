import assert from "node:assert/strict";
import fs from "node:fs";

const cache = fs.readFileSync("src/security/access-context-cache.ts", "utf8");
const access = fs.readFileSync("src/security/access-context.ts", "utf8");
const mutationFiles = [
  "src/security/security-admin.service.ts",
  "src/security/security-management.service.ts",
  "app/api/security/users/[id]/overrides/route.ts",
  "src/services/personnel-access.service.ts",
  "src/services/personnel-v2.service.ts",
];

assert.match(cache, /securityMode:\s*15_000/);
assert.match(cache, /rbac:\s*20_000/);
assert.match(cache, /inflight/);
assert.match(cache, /epoch/);
assert.match(access, /getAccessContextCachedValue\("security:mode"/);
assert.match(access, /getAccessContextCachedValue<RbacSnapshot>/);
assert.match(access, /LAST_SEEN_TOUCH_INTERVAL_MS = 300_000/);

for (const file of mutationFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /invalidateAccessContextCache/, `${file} must invalidate RBAC cache after access mutations`);
}

console.log("[rbac-cache] short TTL, request coalescing and mutation invalidation contracts OK.");
