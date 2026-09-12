import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const service = await readFile(join(process.cwd(), "src/services/inventory-ledger.service.ts"), "utf8");
const schema = await readFile(join(process.cwd(), "prisma/inventory-ledger.prisma"), "utf8");
const ledgerRoute = await readFile(join(process.cwd(), "app/api/inventory/ledger/route.ts"), "utf8");
const reservationRoute = await readFile(join(process.cwd(), "app/api/inventory/reservations/route.ts"), "utf8");

assert.match(schema, /model InventoryBalance \{/);
assert.match(schema, /model InventoryLedgerEntry \{/);
assert.match(schema, /model InventoryReservation \{/);
assert.match(schema, /idempotencyKey\s+String\?\s+@unique/);
assert.match(service, /postInventoryMovement/);
assert.match(service, /reserveInventory/);
assert.match(service, /transitionInventoryReservation/);
assert.match(service, /INVENTORY_INSUFFICIENT/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /INVENTORY_MOVEMENT_POSTED/);
assert.match(ledgerRoute, /PERMISSIONS\.PROCUREMENT_WRITE/);
assert.match(reservationRoute, /PERMISSIONS\.PROCUREMENT_WRITE/);

console.log("inventory-ledger-contract-smoke: ok");
