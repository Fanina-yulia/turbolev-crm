/**
 * SEC-R1 behavioural smoke. Run from repo root:
 *   npx tsx --import ./scripts/sec-r1-stubs/register.mjs scripts/work-orders-subroutes-auth-smoke.ts
 * Real code under test: the 7 route handlers, src/security/work-order-route-guard.ts, permissions.ts.
 * Database, session and services are in-memory fakes (scripts/sec-r1-stubs); no real data is touched.
 */
import assert from "node:assert/strict";
import { state, type Session } from "./sec-r1-stubs/state";
import { PERMISSIONS as P } from "../src/security/permissions";

const W1 = "wo-1"; const W_OTHER = "wo-s2";
state.__workOrderStation = { [W1]: "S1", [W_OTHER]: "S2" };
state.__numbers = [{ workOrderId: W1, number: 101 }, { workOrderId: W_OTHER, number: 202 }];
state.__executors = { [W1]: ["u-exec"] };

const base = { permissions: {}, stationId: "S1" };
const sessions: Record<string, Session> = {
  mechanic: { id: "u-mech", name: "Mech", ...base, permissions: { [P.WORK_ORDERS_READ]: "ASSIGNED", [P.QC_READ]: "ASSIGNED" }, assignedWorkOrders: [W1] },
  advisor: { id: "u-adv", name: "Adv", employeeName: "Сервіс Менеджер", stationId: "S1", permissions: { [P.WORK_ORDERS_READ]: "LOCATION", [P.WORK_ORDERS_WRITE]: "LOCATION", [P.WORK_ORDERS_ESTIMATE]: "LOCATION", [P.PROCUREMENT_READ]: "LOCATION", [P.PROCUREMENT_WRITE]: "LOCATION", [P.QC_READ]: "LOCATION" } },
  advisorS2: { id: "u-adv2", name: "Adv2", stationId: "S2", permissions: { [P.WORK_ORDERS_READ]: "LOCATION", [P.WORK_ORDERS_WRITE]: "LOCATION", [P.WORK_ORDERS_ESTIMATE]: "LOCATION", [P.QC_READ]: "LOCATION", [P.QC_WRITE]: "LOCATION", [P.WORK_ORDERS_QC_APPROVE]: "LOCATION" } },
  qcNoApprove: { id: "u-qc", name: "QC", stationId: "S1", permissions: { [P.QC_READ]: "LOCATION", [P.QC_WRITE]: "LOCATION" } },
  manager: { id: "u-mgr", name: "Mgr", employeeName: "Керівник Станції", stationId: "S1", permissions: { [P.WORK_ORDERS_READ]: "LOCATION", [P.QC_READ]: "LOCATION", [P.QC_WRITE]: "LOCATION", [P.WORK_ORDERS_QC_APPROVE]: "LOCATION" } },
  executorManager: { id: "u-exec", name: "ExecMgr", stationId: "S1", permissions: { [P.QC_READ]: "LOCATION", [P.QC_WRITE]: "LOCATION", [P.WORK_ORDERS_QC_APPROVE]: "LOCATION" } },
};

const routes = {
  lines: await import("../app/api/work-orders/[id]/lines/route"),
  line: await import("../app/api/work-orders/[id]/lines/[lineId]/route"),
  estimate: await import("../app/api/work-orders/[id]/estimate/route"),
  decision: await import("../app/api/work-orders/[id]/estimate/decision/route"),
  parts: await import("../app/api/work-orders/[id]/parts-request/route"),
  qc: await import("../app/api/work-orders/[id]/qc/route"),
  numbers: await import("../app/api/work-orders/numbers/route"),
};

type Case = { name: string; run: (id: string, body?: unknown) => Promise<Response> };
const req = (method: string, body?: unknown, url = "http://t/x") => {
  const r: any = new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  r.nextUrl = new URL(url);
  return r;
};
const ctx = (id: string, lineId = "l1") => ({ params: Promise.resolve({ id, lineId }) });
const mutations: Case[] = [
  { name: "lines POST", run: (id, b) => routes.lines.POST(req("POST", b), ctx(id)) },
  { name: "lines PATCH", run: (id, b) => routes.line.PATCH(req("PATCH", b), ctx(id)) },
  { name: "lines DELETE", run: (id, b) => routes.line.DELETE(req("DELETE", b), ctx(id)) },
  { name: "estimate POST", run: (id, b) => routes.estimate.POST(req("POST", b), ctx(id)) },
  { name: "estimate decision POST", run: (id, b) => routes.decision.POST(req("POST", { decision: "APPROVE", ...(b as object) }), ctx(id)) },
  { name: "parts-request POST", run: (id, b) => routes.parts.POST(req("POST", b), ctx(id)) },
  { name: "qc POST", run: (id, b) => routes.qc.POST(req("POST", { action: "START", ...(b as object) }), ctx(id)) },
];
const reads: Case[] = [
  { name: "lines GET", run: (id) => routes.lines.GET(req("GET"), ctx(id)) },
  { name: "estimate GET", run: (id) => routes.estimate.GET(req("GET"), ctx(id)) },
  { name: "parts-request GET", run: (id) => routes.parts.GET(req("GET"), ctx(id)) },
  { name: "qc GET", run: (id) => routes.qc.GET(req("GET"), ctx(id)) },
];
const serviceCalls = () => state.__calls.length;
const as = (who: keyof typeof sessions | null) => { state.__session = who ? sessions[who] : null; state.__calls.length = 0; };
let passed = 0;
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); passed++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.equal(a, b, msg); passed++; };

// 1. No authorization -> 401 and no service touched
as(null);
for (const c of [...mutations, ...reads]) { const r = await c.run(W1, {}); eq(r.status, 401, `[1] ${c.name} anon -> 401`); eq(serviceCalls(), 0, `[1] ${c.name} anon touches no service`); }
{ const r = await routes.numbers.GET(req("GET", undefined, "http://t/api/work-orders/numbers?ids=wo-1")); eq(r.status, 401, "[1] numbers anon -> 401"); }

// 2. Authenticated without rights -> 403 (mechanic cannot write/estimate/parts; no-approve cannot read lines)
as("mechanic");
for (const c of mutations) { const r = await c.run(W1, {}); eq(r.status, 403, `[2] ${c.name} mechanic -> 403`); eq(serviceCalls(), 0, `[2] ${c.name} mechanic touches no service`); }
for (const c of reads.filter((x) => x.name !== "lines GET" && x.name !== "qc GET" && x.name !== "estimate GET")) { const r = await c.run(W1); eq(r.status, 403, `[2] ${c.name} mechanic -> 403`); }
as("qcNoApprove");
{ const r = await routes.lines.GET(req("GET"), ctx(W1)); eq(r.status, 403, "[2] lines GET without WORK_ORDERS.READ -> 403"); }

// 3. Other station -> 404 (non-disclosing), no service touched
as("advisorS2");
for (const c of [...mutations.filter((m) => m.name !== "parts-request POST" && m.name !== "qc POST"), ...reads.filter((r) => r.name !== "parts-request GET")]) {
  const r = await c.run(W1, {}); eq(r.status, 404, `[3] ${c.name} other station -> 404`); eq(serviceCalls(), 0, `[3] ${c.name} other station touches no service`);
}
{ const r = await routes.qc.POST(req("POST", { action: "PASS" }), ctx(W1)); eq(r.status, 404, "[3] qc PASS other station -> 404"); }
{ const r = await routes.numbers.GET(req("GET", undefined, "http://t/api/work-orders/numbers?ids=wo-1,wo-s2")); const j: any = await r.json(); eq(r.status, 200, "[3] numbers ok"); eq(j.rows.length, 1, "[3] numbers hides other-station orders"); eq(j.rows[0].workOrderId, W_OTHER, "[3] numbers returns only own station"); }

// 4. Forged executor: actorName/userId/roles in body are ignored; identity = session
as("advisor");
{
  const forged = { actorName: "Власник (підроблено)", actorId: "u-owner", userId: "u-owner", roles: ["OWNER"], approvedByName: "Клієнт" };
  await routes.estimate.POST(req("POST", forged), ctx(W1));
  const send = state.__calls.find((c) => c.fn === "sendEstimate")!; eq(send.args[1], "Сервіс Менеджер", "[4] estimate actor from session");
  state.__calls.length = 0;
  await routes.decision.POST(req("POST", { decision: "APPROVE", ...forged }), ctx(W1));
  const dec = state.__calls.find((c) => c.fn === "decideEstimate")!; eq(dec.args[2], "Сервіс Менеджер", "[4] decision actor from session");
  eq((dec.args[1] as any).approvedByName, "Клієнт", "[4] customer name stays business data");
  state.__calls.length = 0;
  await routes.lines.POST(req("POST", { ...forged, title: "x" }), ctx(W1));
  eq(state.__calls.find((c) => c.fn === "createWorkOrderLine")!.args[2], "Сервіс Менеджер", "[4] line create actor from session");
  state.__calls.length = 0;
  await routes.line.PATCH(req("PATCH", { ...forged, plannedUnitPrice: 1 }), ctx(W1));
  eq(state.__calls.find((c) => c.fn === "updateWorkOrderLine")!.args[3], "Сервіс Менеджер", "[4] line update actor from session");
  state.__calls.length = 0;
  await routes.parts.POST(req("POST", forged), ctx(W1));
  eq(state.__calls.find((c) => c.fn === "openPartsRequest")!.args[1], "Сервіс Менеджер", "[4] parts actor from session");
}
as("manager");
{
  await routes.qc.POST(req("POST", { action: "PASS", actorName: "Хтось інший", performedByName: "Хтось інший" }), ctx(W1));
  const upd = state.__calls.find((c) => c.fn === "updateQualityControl")!;
  eq(upd.args[2], "Керівник Станції", "[4] qc actor from session"); eq((upd.args[1] as any).performedByName, "Керівник Станції", "[4] qc performedBy overwritten by session");
  const tr = state.__calls.find((c) => c.fn === "transitionWorkOrder")!; eq(tr.args[2], "Керівник Станції", "[4] qc transition actor from session");
}

// 5. Unauthorized change of work cost (lines) — mechanic and wrong-station user blocked, service untouched (covered above); explicit price payload
as("mechanic");
{ const r = await routes.line.PATCH(req("PATCH", { plannedUnitPrice: 1, actualUnitPrice: 1 }), ctx(W1)); eq(r.status, 403, "[5] mechanic cannot change line price"); eq(serviceCalls(), 0, "[5] no price write"); }
as(null);
{ const r = await routes.lines.POST(req("POST", { plannedUnitPrice: 0 }), ctx(W1)); eq(r.status, 401, "[5] anon cannot add line"); }

// 6. Unauthorized estimate approval
for (const who of ["mechanic", "qcNoApprove"] as const) { as(who); const r = await routes.decision.POST(req("POST", { decision: "APPROVE" }), ctx(W1)); eq(r.status, 403, `[6] ${who} cannot approve estimate`); eq(serviceCalls(), 0, `[6] ${who} no approval written`); }
as("advisorS2"); { const r = await routes.decision.POST(req("POST", { decision: "APPROVE" }), ctx(W1)); eq(r.status, 404, "[6] other station cannot approve estimate"); eq(serviceCalls(), 0, "[6] nothing written"); }

// 7. Unauthorized QC pass
for (const who of ["mechanic", "advisor"] as const) { as(who); const r = await routes.qc.POST(req("POST", { action: "PASS" }), ctx(W1)); eq(r.status, 403, `[7] ${who} cannot PASS QC`); eq(serviceCalls(), 0, `[7] ${who} no QC written`); }
as("qcNoApprove"); { const r = await routes.qc.POST(req("POST", { action: "PASS" }), ctx(W1)); eq(r.status, 403, "[7] QC.WRITE without QC_APPROVE cannot PASS"); eq(serviceCalls(), 0, "[7] no QC written"); const f = await routes.qc.POST(req("POST", { action: "FAIL" }), ctx(W1)); eq(f.status, 403, "[7] ... nor FAIL"); }
as("executorManager"); { const r = await routes.qc.POST(req("POST", { action: "PASS" }), ctx(W1)); const j: any = await r.json(); eq(r.status, 403, "[7] executor cannot approve own work"); eq(j.error, "QC_APPROVER_IS_EXECUTOR", "[7] explicit reason"); eq(serviceCalls(), 0, "[7] no QC written for executor"); }
as("qcNoApprove"); { const r = await routes.qc.POST(req("POST", { action: "START" }), ctx(W1)); eq(r.status, 200, "[7] START needs only QC.WRITE"); }

// 8. Authorised users work as before
as("advisor");
for (const c of [mutations[0], mutations[1], mutations[2], mutations[3], mutations[4], mutations[5]]) { state.__calls.length = 0; const r = await c.run(W1, {}); ok(r.status < 300, `[8] advisor ${c.name} allowed (status ${r.status})`); ok(serviceCalls() > 0, `[8] ${c.name} reached service`); }
for (const c of reads.filter((r) => r.name !== "qc GET")) { const r = await c.run(W1); eq(r.status, 200, `[8] advisor ${c.name} -> 200`); }
as("manager");
{ const r = await routes.qc.POST(req("POST", { action: "PASS" }), ctx(W1)); ok(r.status < 300, "[8] manager (not executor, with QC_APPROVE) can PASS"); ok(state.__calls.some((c) => c.fn === "transitionWorkOrder" && c.args[1] === "READY_FOR_PICKUP"), "[8] PASS moves to READY_FOR_PICKUP via existing transition"); }
{ const r = await routes.qc.GET(req("GET"), ctx(W1)); eq(r.status, 200, "[8] manager reads QC"); }
as("mechanic"); { const r = await routes.lines.GET(req("GET"), ctx(W1)); eq(r.status, 200, "[8] assigned mechanic can still read lines"); const q = await routes.qc.GET(req("GET"), ctx(W1)); eq(q.status, 200, "[8] assigned mechanic can read QC state"); const o = await routes.lines.GET(req("GET"), ctx(W_OTHER)); eq(o.status, 404, "[8] ... but not unassigned order"); }
as("advisor"); { const r = await routes.numbers.GET(req("GET", undefined, "http://t/api/work-orders/numbers?ids=wo-1,wo-s2")); const j: any = await r.json(); eq(j.rows.length, 1, "[8] numbers filtered to own station"); }

console.log(`SEC-R1 work-orders sub-routes auth smoke passed (${passed} assertions)`);
