import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`[mechanic-performance] Missing required file: ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`[mechanic-performance] Missing ${label}: ${needle}`);
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) throw new Error(`[mechanic-performance] Forbidden regression: ${label}`);
}

const coordinator = read("app/mechanic-request-coordinator.tsx");
const scanner = read("app/mechanic-vehicle-scanner.tsx");
const arrivalBridge = read("app/mechanic-diagnostics-arrival-bridge.tsx");
const page = read("app/page.tsx");
const accessContext = read("src/security/access-context.ts");
read("app/api/cabinet/mechanic/snapshot/route.ts");
read("app/api/cabinet/mechanic/diagnostics/[id]/bootstrap/route.ts");
read("app/api/diagnostics/[id]/checks/batch/route.ts");
read("src/services/quick-diagnostic-batch.service.ts");

requireText(page, "<MechanicRequestCoordinator>", "mechanic coordinator mount gate");
requireText(coordinator, "/api/cabinet/mechanic/snapshot", "consolidated snapshot usage");
requireText(coordinator, "/checks/batch", "diagnostic batch usage");
requireText(coordinator, "/bootstrap", "single diagnostic bootstrap usage");
requireText(coordinator, "document.visibilityState", "hidden-tab protection");
requireText(accessContext, "LAST_SEEN_TOUCH_INTERVAL_MS", "lastSeen throttle");

forbid(scanner, /new\s+MutationObserver\s*\(/, "scanner must not observe the entire DOM");
forbid(arrivalBridge, /new\s+MutationObserver\s*\(/, "diagnostics bridge must not observe the entire DOM");
forbid(arrivalBridge, /setInterval[\s\S]{0,160}15000/, "diagnostics bridge 15-second polling");
forbid(scanner, /observe\(document\.body/, "scanner document.body observer");
forbid(arrivalBridge, /observe\(document\.body/, "diagnostics bridge document.body observer");

console.log("[mechanic-performance] Snapshot, bootstrap, batch, hidden-tab, throttle and DOM-observer guards OK.");
