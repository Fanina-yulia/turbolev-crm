// Test-only resolver: replaces infrastructure (DB, session, services) with in-memory fakes.
// Real code under test: the 7 route handlers + src/security/work-order-route-guard.ts + permissions.ts.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const stub = (name) => pathToFileURL(join(here, name)).href;
const map = new Map([
  ["server-only", "empty.ts"],
  ["next/server", "next-server.ts"],
  ["@/src/security/authorize", "authorize.ts"],
  ["@/src/security/work-order-scope", "scope.ts"],
  ["@/src/lib/prisma", "prisma.ts"],
  ["@/src/generated/prisma/client", "generated.ts"],
  ["@/src/domain/work-order-finance", "services.ts"],
  ["@/src/domain/work-order-number", "number.ts"],
  ["@/src/services/work-order-lines.service", "services.ts"],
  ["@/src/services/work-order-service-warranty.service", "services.ts"],
  ["@/src/services/vehicle-issues.service", "services.ts"],
  ["@/src/services/work-order-commercial.service", "services.ts"],
  ["@/src/services/work-order-cycle.service", "services.ts"],
  ["@/src/services/financial-estimate-margin-gate.service", "services.ts"],
  ["@/src/services/work-order-estimate-fingerprint.service", "services.ts"],
  ["@/src/services/work-order-qc.service", "services.ts"],
  ["@/src/services/work-orders.service", "services.ts"],
]);
export async function resolve(specifier, context, next) {
  const file = map.get(specifier);
  if (file) return { url: stub(file), shortCircuit: true };
  const resolved = await next(specifier, context);
  // tsx may already have turned "@/src/..." into a file URL; map those back to the stubs too.
  for (const [spec, target] of map) {
    if (spec.startsWith("@/") && (resolved.url.endsWith("/" + spec.slice(2) + ".ts") || resolved.url.endsWith("/" + spec.slice(2) + "/index.ts"))) {
      return { url: stub(target), shortCircuit: true };
    }
  }
  return resolved;
}
