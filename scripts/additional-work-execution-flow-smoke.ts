import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function expect(source: string, needle: string, label: string) {
  if (!source.includes(needle)) throw new Error(`additional-work-execution-flow: missing ${label}: ${needle}`);
}

const api = read("app/api/cabinet/mechanic/tasks/[lineId]/additional-work/route.ts");
expect(api, '"ADDITIONAL_DIAGNOSTIC"', "additional diagnostic kind");
expect(api, '"REPAIR_COMPLICATION"', "repair complication kind");
expect(api, '"BLOCKS_REPAIR"', "blocking impact");
expect(api, "createOperationalBlocker", "operational blocker creation");
expect(api, 'sourceEntity: "MECHANIC_ADDITIONAL_WORK"', "canonical work-order source");
expect(api, "plannedUnitPrice: 0", "mechanic cannot set price");
expect(api, "tx.crmTask.createMany", "required-action task creation");
expect(api, 'bucket: "ACTION"', "required-action queue metadata");
expect(api, 'routeSection: "Комерційна пропозиція"', "commercial proposal task navigation");

const bridge = read("app/mechanic-additional-work-bridge.tsx");
expect(bridge, "＋ Додати виявлене", "mechanic discovered-work action label");
expect(bridge, "Додаткова діагностика", "mechanic additional diagnostic choice");
expect(bridge, "Ускладнення під час ремонту", "mechanic complication choice");
expect(bridge, "Ні, потрібне рішення / погодження", "blocking choice");
expect(bridge, "kind, impact", "request augmentation");

const summaryApi = read("app/api/planner/[id]/commercial-summary/route.ts");
expect(summaryApi, "PERMISSIONS.PLANNER_READ", "planner permission gate");
expect(summaryApi, "APPROVED_STATUSES", "approved amount lifecycle");
expect(summaryApi, "approvedAmount", "approved amount projection");
expect(summaryApi, "pendingAmount", "pending amount projection");
expect(summaryApi, "mechanicRequestedPendingCount", "mechanic pending projection");
expect(summaryApi, 'editTarget: "WORK_ORDER"', "post-work-order edit target");

const plannerUi = read("app/planner-commercial-summary-enhancer.tsx");
expect(plannerUi, "Погоджено", "planner approved amount label");
expect(plannerUi, "Очікує погодження", "planner pending amount label");
expect(plannerUi, 'navigateCrm("Комерційна пропозиція"', "planner work-order navigation");
expect(plannerUi, "Від механіка очікує рішення", "mechanic pending hint");

const migration = read("prisma/migrations/20260913143000_additional_work_blocker_lifecycle/migration.sql");
expect(migration, 'COALESCE(NEW."sourceEntity", \'\') <> \'MECHANIC_ADDITIONAL_WORK\'', "trigger source guard");
expect(migration, 'NEW."status"::text NOT IN (\'APPROVED\', \'CANCELLED\')', "approval/cancellation lifecycle");
expect(migration, "OPERATIONAL_BLOCKER_AUTO_RESOLVED", "blocker auto resolve audit");
expect(migration, "OPERATIONAL_BLOCKER_AUTO_CANCELLED", "blocker auto cancel audit");
expect(migration, 'UPDATE "CrmTask"', "required-action auto completion");
expect(migration, '"status" = \'DONE\'', "required-action done state");

const spec = read("docs/TZ_ADDITIONAL_WORK_EXECUTION_FLOW_V1.md");
expect(spec, "Work Order є єдиним джерелом правди", "single source of truth");
expect(spec, "DRAFT → APPROVED → IN_PROGRESS → COMPLETED", "canonical line lifecycle");
expect(spec, "Механік не може самостійно обійти", "mechanic approval gate");
expect(spec, "Погоджено", "approved amount requirement");
expect(spec, "Очікує погодження", "pending amount requirement");

console.log("additional-work-execution-flow-smoke: ok");
