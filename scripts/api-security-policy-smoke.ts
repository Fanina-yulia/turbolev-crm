import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveApiSecurityPolicy } from "../src/security/api-policy";

const API_ROOT = path.resolve("app/api");
const METHOD_RE = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

async function collectRouteFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectRouteFiles(full);
      return entry.isFile() && entry.name === "route.ts" ? [full] : [];
    }),
  );
  return nested.flat();
}

function routePath(file: string) {
  const relative = path.relative(path.resolve("app"), file).split(path.sep).join("/");
  return `/${relative.replace(/\/route\.ts$/, "")}`;
}

const files = await collectRouteFiles(API_ROOT);
assert.ok(files.length > 0, "No API routes found");

const unclassified: string[] = [];
const methodless: string[] = [];
const classified: Array<{ route: string; methods: string[]; kind: string }> = [];

for (const file of files.sort()) {
  const source = await fs.readFile(file, "utf8");
  const methods = Array.from(source.matchAll(METHOD_RE), (match) => match[1]);
  if (!methods.length) methodless.push(routePath(file));
  const route = routePath(file);
  const checkMethods = methods.length ? methods : ["GET"];
  let kind = "";
  for (const method of checkMethods) {
    const policy = resolveApiSecurityPolicy(route, method);
    if (!policy) {
      unclassified.push(`${method} ${route}`);
      continue;
    }
    kind = policy.kind;
    if (policy.kind === "INTERNAL_RBAC") {
      assert.ok(policy.permission, `${method} ${route} must declare a permission`);
      assert.ok(policy.intendedScope, `${method} ${route} must declare an intended scope`);
    }
  }
  classified.push({ route, methods: checkMethods, kind });
}

assert.deepEqual(unclassified, [], `Unclassified API routes:\n${unclassified.join("\n")}`);
assert.deepEqual(methodless, [], `API route files without explicit HTTP exports:\n${methodless.join("\n")}`);

const strictSources = [
  "app/api/security/access-catalog/route.ts",
  "app/api/security/provision/route.ts",
  "app/api/security/users/[id]/roles/route.ts",
  "app/api/security/config/route.ts",
  "app/api/me/compensation/route.ts",
];
for (const sourcePath of strictSources) {
  const source = await fs.readFile(sourcePath, "utf8");
  assert.match(source, /authorize\(/, `${sourcePath} must call authorize()`);
  assert.match(source, /strict:\s*true/, `${sourcePath} must enforce even while global mode is SHADOW`);
}

const shadowAwareSources = [
  "app/api/settings/cameras/route.ts",
  "app/api/settings/cameras/[id]/route.ts",
  "app/api/settings/cameras/[id]/events/route.ts",
  "app/api/settings/cameras/[id]/rotate-ingest-token/route.ts",
  "app/api/settings/cameras/[id]/test/route.ts",
];
for (const sourcePath of shadowAwareSources) {
  const source = await fs.readFile(sourcePath, "utf8");
  assert.match(source, /authorize\(/, `${sourcePath} must remain RBAC-aware`);
  assert.doesNotMatch(source, /strict:\s*true/, `${sourcePath} must follow the global SHADOW/ENFORCED mode`);
}

const rbacAwareSources = [
  "app/api/personnel/route.ts",
  "app/api/audit/route.ts",
  "app/api/intake/route.ts",
  "app/api/leads/route.ts",
  "app/api/leads/[id]/route.ts",
  "app/api/leads/[id]/attempt/route.ts",
  "app/api/leads/[id]/book/route.ts",
  "app/api/leads/[id]/convert/route.ts",
  "app/api/telephony/call/route.ts",
];
for (const sourcePath of rbacAwareSources) {
  const source = await fs.readFile(sourcePath, "utf8");
  assert.match(source, /authorize\(/, `${sourcePath} must remain RBAC-aware`);
}

const authProxy = await fs.readFile("app/api/auth/[...path]/route.ts", "utf8");
assert.match(authProxy, /ALLOWED_AUTH_PATHS/, "Auth proxy must use an explicit endpoint allowlist");
assert.doesNotMatch(authProxy, /sign-up\/email/, "Open sign-up must not be exposed by the CRM auth proxy");

const counts = classified.reduce<Record<string, number>>((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
console.log(`API security policy smoke passed for ${classified.length} route files`, counts);
