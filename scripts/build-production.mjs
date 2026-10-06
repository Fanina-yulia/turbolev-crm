import "./check-ui-font-floor.mjs";
import "./check-critical-api-security.mjs";
import "./check-mechanic-performance.mjs";
import "./check-personnel-analytics.mjs";
import "./check-quality-analytics.mjs";
import "./check-customer-ltv.mjs";
import "./check-telephony-popup.mjs";
import "./check-crm-page-integrity.mjs";
import "./check-one-screen-contracts.mjs";
import "./check-crm-ui-scale.mjs";
import "./check-unified-page-header.mjs";
import "./check-payments-register-v2.mjs";
import "./check-prisma-advisory-locks.mjs";
import "./check-sidebar-settings-submenu.mjs";
import "./check-visit-financial-state.mjs";
import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function exitFrom(result) {
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function run(args) {
  const command = args[0] === "tsx" ? process.execPath : npx;
  const commandArgs = args[0] === "tsx" ? ["--import", "tsx", ...args.slice(1)] : args;
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) exitFrom(result);
}

function runNodeScript(path) {
  const result = spawnSync(process.execPath, [path], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) exitFrom(result);
}

console.log("[build] Verifying complete API security policy inventory before compilation.");
runNodeScript("scripts/crm-hardening-smoke.mjs");
runNodeScript("scripts/deployment-pipeline-contract-smoke.mjs");
runNodeScript("scripts/access-context-cache-contract-smoke.mjs");
runNodeScript("scripts/polling-performance-contract-smoke.mjs");
runNodeScript("scripts/sql-scope-performance-contract-smoke.mjs");
runNodeScript("scripts/db-hotpath-performance-contract-smoke.mjs");
runNodeScript("scripts/database-observability-contract-smoke.mjs");
runNodeScript("scripts/warranty-scope-performance-contract-smoke.mjs");
runNodeScript("scripts/walkin-lifecycle-finance-contract-smoke.mjs");
runNodeScript("scripts/financial-center-v3-contract-smoke.mjs");
run(["tsx", "scripts/api-security-policy-smoke.ts"]);
run(["tsx", "scripts/mechanic-process-card-contract-smoke.ts"]);
run(["tsx", "scripts/parts-picker-cart-v4-smoke.ts"]);
run(["tsx", "scripts/parts-oe-first-search-contract-smoke.ts"]);

console.log("[build] Build is read-only with respect to production data. Database release steps run separately.");
run(["prisma", "generate"]);
run(["next", "build"]);
