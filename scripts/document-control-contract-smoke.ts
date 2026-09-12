import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const schema = read("prisma/document-control.prisma");
const migration = read("prisma/migrations/20260912140000_document_control_revisions/migration.sql");
const service = read("src/services/document-control.service.ts");
const route = read("app/api/work-orders/[id]/documents/revisions/route.ts");
const packageRoute = read("app/api/work-orders/[id]/documents/route.ts");
const workOrders = read("src/services/work-orders.service.ts");

assert.match(schema, /model ControlledDocumentRevision/);
assert.match(schema, /ControlledDocumentRevisionStatus/);
assert.match(schema, /contentHash/);
assert.match(migration, /CREATE TABLE "ControlledDocumentRevision"/);
assert.match(migration, /cdr_document_key_revision_key/);
assert.match(service, /issueControlledDocumentRevision/);
assert.match(service, /voidControlledDocumentRevision/);
assert.match(service, /captureWorkOrderDocumentRevision/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /SUPERSEDED/);
assert.match(service, /Для прямого ремонту діагностична карта не створюється/);
assert.match(route, /action === "VOID"/);
assert.match(route, /PERMISSIONS\.WORK_ORDERS_WRITE/);
assert.match(packageRoute, /controlledRevisions/);
assert.match(workOrders, /createDirectRepairWorkOrderTx/);

console.log("document-control-contract-smoke: ok");
