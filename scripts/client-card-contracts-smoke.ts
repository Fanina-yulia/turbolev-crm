import assert from "node:assert/strict";
import {
  parseClientCardGetPayload,
  parseClientCardSavePayload,
  parseClientCardVehicleSavePayload,
} from "@/src/lib/contracts/client-card-payload.parsers";

const vehicle = {
  id: "vehicle-1",
  plateNumber: "AA1234AA",
  vin: "WVWZZZ3CZEE000001",
  brand: "Volkswagen",
  model: "Passat",
  year: 2018,
  engineName: "2.0 TDI",
  fuelType: "DIESEL",
  driveType: "FWD",
  vehicleDataSource: "MVS",
  vehicleDataConfidence: 95,
};

const client = {
  id: "client-1",
  name: "Марія",
  phone: "+380670000000",
  phones: [{
    id: "cp-1",
    phone: "+380670000000",
    phoneNormalized: "380670000000",
    label: "Основний",
    isPrimary: true,
  }],
  vehicles: [vehicle],
  serviceHistory: [{
    id: "wo-1",
    vehicleId: "vehicle-1",
    status: "IN_REPAIR",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    closedAt: null,
  }],
};

const getPayload = parseClientCardGetPayload({ client });
assert(getPayload?.client);
assert.equal(getPayload.client.vehicles[0]?.id, "vehicle-1");
assert.equal(getPayload.client.serviceHistory[0]?.vehicleId, "vehicle-1");

assert.deepEqual(parseClientCardGetPayload({ client: null }), { client: null });

const savePayload = parseClientCardSavePayload({ ok: true, client });
assert(savePayload);
assert.equal(savePayload.client.phones[0]?.isPrimary, true);

const vehicleSavePayload = parseClientCardVehicleSavePayload({ ok: true, client, vehicle });
assert(vehicleSavePayload);
assert.equal(vehicleSavePayload.vehicle.vin, "WVWZZZ3CZEE000001");

assert.equal(parseClientCardGetPayload({
  client: { ...client, vehicles: [{ ...vehicle, vehicleDataConfidence: "95" }] },
}), null);

assert.equal(parseClientCardSavePayload({
  ok: true,
  client: { ...client, serviceHistory: [{ ...client.serviceHistory[0], vehicleId: null }] },
}), null);

assert.equal(parseClientCardVehicleSavePayload({ ok: true, client, vehicle: { ...vehicle, id: "" } }), null);

console.log("Client-card contracts smoke: OK");
