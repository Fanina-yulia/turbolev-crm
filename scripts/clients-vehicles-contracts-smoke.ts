import assert from "node:assert/strict";
import { parseClientsVehiclesPayload } from "@/src/lib/contracts/clients-vehicles-payload.parsers";

const payload = parseClientsVehiclesPayload({
  ok: true,
  total: 1,
  offset: 0,
  limit: 100,
  clients: [{
    id: "client-1",
    name: "Марія",
    phone: "+380670000000",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    _count: { vehicles: 1, workOrders: 2, diagnosticRequests: 1 },
    workOrders: [{
      id: "wo-1",
      status: "IN_REPAIR",
      createdAt: "2026-08-19T09:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      closedAt: null,
    }],
    vehicles: [{
      id: "vehicle-1",
      clientId: "client-1",
      plateNumber: "AA1234AA",
      vin: "WVWZZZ3CZEE000001",
      brand: "Volkswagen",
      model: "Passat",
      year: 2018,
      mileageKm: 125000,
      engineName: "2.0 TDI",
      engineVolumeCm3: 1968,
      fuelType: "DIESEL",
      bodyType: "SEDAN",
      driveType: "FWD",
      vehicleType: "PASSENGER",
      turboLevClass: "B",
      priceCoefficient: "1.15",
      vehicleDataSource: "CRM",
      vehicleDataConfidence: 95,
      exteriorColorName: null,
      exteriorColorHex: null,
      exteriorPaintCode: null,
      exteriorColorSource: null,
      exteriorColorConfirmed: false,
      createdAt: "2026-08-10T09:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      _count: { workOrders: 2, diagnosticRequests: 1 },
    }],
  }],
});

assert(payload);
assert.equal(payload.total, 1);
assert.equal(payload.clients[0]?.vehicles[0]?.clientId, "client-1");
assert.equal(payload.clients[0]?.vehicles[0]?._count.workOrders, 2);
assert.equal(payload.clients[0]?.workOrders[0]?.status, "IN_REPAIR");

assert.equal(parseClientsVehiclesPayload({
  ok: true,
  total: 1,
  offset: 0,
  limit: 100,
  clients: [{
    id: "client-1",
    name: "Марія",
    phone: "+380670000000",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    _count: { vehicles: 1, workOrders: 0, diagnosticRequests: 0 },
    workOrders: [],
    vehicles: [{
      id: "vehicle-1",
      plateNumber: "AA1234AA",
      vin: null,
      brand: "Volkswagen",
      model: "Passat",
      year: 2018,
      mileageKm: null,
      engineName: null,
      engineVolumeCm3: null,
      fuelType: null,
      bodyType: null,
      driveType: null,
      vehicleType: null,
      turboLevClass: null,
      priceCoefficient: 1,
      vehicleDataSource: null,
      vehicleDataConfidence: null,
      exteriorColorName: null,
      exteriorColorHex: null,
      exteriorPaintCode: null,
      exteriorColorSource: null,
      exteriorColorConfirmed: false,
      createdAt: "2026-08-10T09:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
      _count: { workOrders: 0, diagnosticRequests: 0 },
    }],
  }],
}), null);

assert.equal(parseClientsVehiclesPayload({
  ok: true,
  total: -1,
  offset: 0,
  limit: 100,
  clients: [],
}), null);

console.log("Clients-vehicles contracts smoke: OK");
