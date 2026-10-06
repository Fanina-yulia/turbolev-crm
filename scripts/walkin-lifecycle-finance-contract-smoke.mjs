import assert from "node:assert/strict";
import fs from "node:fs";

const walkIn = fs.readFileSync("src/services/mechanic-walk-in.service.ts","utf8");
const settlement = fs.readFileSync("src/services/walk-in-diagnostic-settlement.service.ts","utf8");
const plannerService = fs.readFileSync("src/services/planner.service.ts","utf8");
const plannerDay = fs.readFileSync("app/planner-day-view.tsx","utf8");
const planner = fs.readFileSync("app/planner-v2.tsx","utf8");
const finance = fs.readFileSync("app/financial-center-legacy.tsx","utf8");
const financeControl = fs.readFileSync("app/financial-center-v3-control.tsx","utf8");
const financeSurface = finance + "\n" + financeControl;

assert.match(walkIn,/findCurrentWalkInPlacement/);
assert.match(walkIn,/postId: post\?\.id \|\| null/);
assert.equal(/findNearestWalkInSlot/.test(walkIn),false,"walk-in must never search future planner days");
assert.equal(/searchUntil/.test(walkIn),false,"walk-in must never search a 31-day future window");

assert.match(settlement,/ensureWalkInCharge/);
assert.match(settlement,/revenueRecognizedOnDiagnosticCompletion: true/);
assert.match(settlement,/recognizedAt: input\.recognizedAt/);
assert.match(settlement,/occurredAt: now/);
assert.match(settlement,/DIAGNOSTIC_NOT_COMPLETED/);

assert.match(plannerService,/source: "WALK_IN", actualStartAt:/);
assert.match(plannerService,/actualArrivalAt:/);
assert.match(plannerService,/diagnosticObligations/);
assert.match(plannerService,/WALK_IN_DIAGNOSTIC/);

assert.match(plannerDay,/function displayWindow/);
assert.match(plannerDay,/actualStartAt \|\| item\.actualArrivalAt/);
assert.match(plannerDay,/visibleRange/);
assert.match(plannerDay,/function collisionLayout/);
assert.match(plannerDay,/ПОЗАПЛАНОВИЙ/);

assert.match(planner,/function displayStartAt/);
assert.match(planner,/ФАКТИЧНІ ДАТА ТА ЧАС/);
assert.match(planner,/позаплановий заїзд/);

assert.match(financeSurface,/Залишок коштів зараз/);
assert.match(financeSurface,/не залежить від періоду/);
assert.match(financeSurface,/Рух грошей за період/);
assert.match(financeSurface,/Надійшло/);

console.log("[walkin-truth] factual planner timing, collision visibility and completion-based finance contracts OK.");
