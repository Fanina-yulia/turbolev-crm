import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VEHICLE_LOCATION_LABELS } from "../src/domain/workflow";

const service = await readFile(join(process.cwd(), "src/services/vehicle-location.service.ts"), "utf8");
const schema = await readFile(join(process.cwd(), "prisma/vehicle-location.prisma"), "utf8");
const route = await readFile(join(process.cwd(), "app/api/vehicles/[id]/location/route.ts"), "utf8");

assert.match(service, /VEHICLE_LOCATION_CODES = \[/);
assert.match(service, /moveVehicleLocation/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /VEHICLE_POST_OCCUPIED/);
assert.match(service, /VehicleLocationEvent/);
assert.match(service, /syncVehicleLocationFromAppointment/);
assert.match(service, /locationForAppointmentStatus/);
assert.match(schema, /model VehicleLocation \{/);
assert.match(schema, /model VehicleLocationEvent \{/);
assert.match(schema, /vehicleId\s+String\s+@unique/);
assert.match(route, /PERMISSIONS\.PRODUCTION_READ/);
assert.match(route, /PERMISSIONS\.PRODUCTION_WRITE/);
assert.match(route, /Idempotency-Key/);

for (const code of [
  "OUTSIDE",
  "RECEPTION",
  "QUEUE",
  "POST",
  "PARKING",
  "WAITING_PARTS",
  "QUALITY_CONTROL",
  "READY_ZONE",
  "DELIVERED",
] as const) {
  assert.ok(VEHICLE_LOCATION_LABELS[code], "location label missing for " + code);
}

console.log("vehicle-location-contract-smoke: ok");
