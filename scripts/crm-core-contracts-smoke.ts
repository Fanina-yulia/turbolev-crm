import assert from "node:assert/strict";
import {
  parseCrmClientCore,
  parseCrmEmployeeCore,
  parseCrmVehicleCore,
  parseCrmWorkOrderCore,
  parsePersonnelItem,
  parseVehicleDirectoryItem,
  parseWorkOrderListItem,
} from "@/src/lib/contracts/crm-core.parsers";
import {
  parseClientDirectoryPayload,
  parseVehicleAppearancePayload,
  parseVehicleCardPayload,
  parseVehicleDirectoryPayload,
  parseVehicleImageRefreshPayload,
} from "@/src/lib/contracts/directory-payload.parsers";
import {
  parsePersonnelCatalogPayload,
  parsePersonnelListPayload,
  parsePersonnelOkPayload,
  parsePersonnelSavePayload,
} from "@/src/lib/contracts/personnel-payload.parsers";

const now = "2026-08-20T12:00:00.000Z";

const client = parseCrmClientCore({
  id: "client-1",
  name: "Марія",
  phone: "+380670000000",
  createdAt: now,
  updatedAt: now,
});
assert(client);
assert.equal(client.id, "client-1");
assert.equal(parseCrmClientCore({ id: "client-2" }), null);

const vehicle = parseCrmVehicleCore({
  id: "vehicle-1",
  clientId: "client-1",
  plateNumber: "AA1234AA",
  vin: "WVWZZZ1JZXW000001",
  brand: "Volkswagen",
  model: "Passat",
  year: 2018,
  mileageKm: 120000,
  engineName: "2.0 TDI",
  engineVolumeCm3: 1968,
  fuelType: "DIESEL",
  bodyType: "SEDAN",
  driveType: "FWD",
  vehicleType: "PASSENGER",
  turboLevClass: "M",
  priceCoefficient: "1.15",
  vehicleDataSource: "CRM",
  vehicleDataConfidence: 100,
  exteriorColorName: "Чорний",
  exteriorColorHex: "#111111",
  exteriorPaintCode: "LC9X",
  exteriorColorSource: "REGISTRY",
  exteriorColorConfirmed: true,
  createdAt: now,
  updatedAt: now,
});
assert(vehicle);
assert.equal(vehicle.priceCoefficient, "1.15");
assert.equal(vehicle.exteriorColorConfirmed, true);

const directoryVehicle = parseVehicleDirectoryItem({
  ...vehicle,
  client: { id: "client-1", name: "Марія", phone: "+380670000000" },
  _count: { workOrders: 3, diagnosticRequests: 2 },
});
assert(directoryVehicle);
assert.equal(directoryVehicle._count.workOrders, 3);

const clientDirectoryPayload = parseClientDirectoryPayload({
  ok: true,
  total: 1,
  page: 1,
  limit: 24,
  pages: 1,
  clients: [{
    ...client,
    _count: { vehicles: 1, workOrders: 1, diagnosticRequests: 0 },
    workOrders: [{ id: "wo-ref", status: "CLOSED", createdAt: now, updatedAt: now, closedAt: now }],
    vehicles: [{ id: "vehicle-1", plateNumber: "AA1234AA", vin: "WVWZZZ1JZXW000001", brand: "Volkswagen", model: "Passat", year: 2018 }],
  }],
});
assert(clientDirectoryPayload);
assert.equal(clientDirectoryPayload.clients[0]?.vehicles[0]?.plateNumber, "AA1234AA");
assert.equal(parseClientDirectoryPayload({ ok: true, total: 1, page: 1, limit: 24, pages: 1, clients: [{ id: "broken" }] }), null);

const vehicleDirectoryPayload = parseVehicleDirectoryPayload({
  ok: true,
  total: 1,
  page: 1,
  limit: 24,
  pages: 1,
  vehicles: [directoryVehicle],
});
assert(vehicleDirectoryPayload);
assert.equal(vehicleDirectoryPayload.vehicles[0]?.client.phone, "+380670000000");

const vehicleCardPayload = parseVehicleCardPayload({
  ok: true,
  vehicle: {
    ...directoryVehicle,
    classificationSource: "AUTO",
    classificationConfidence: 95,
    lastVehicleLookupAt: now,
    diagnosticRequests: [{ id: "diag-card", status: "CONFIRMED", technicalConclusion: "OK", confirmedAt: now, createdAt: now, updatedAt: now }],
    workOrders: [{ id: "wo-card", status: "IN_REPAIR", createdAt: now, updatedAt: now, closedAt: null }],
  },
});
assert(vehicleCardPayload);
assert.equal(vehicleCardPayload.classificationConfidence, 95);

const appearancePayload = parseVehicleAppearancePayload({
  ok: true,
  vehicle: {
    id: "vehicle-1",
    brand: "Volkswagen",
    model: "Passat",
    exteriorColorName: "Чорний",
    exteriorColorHex: "#111111",
    exteriorPaintCode: "LC9X",
    exteriorColorSource: "USER",
    exteriorColorConfirmed: true,
    updatedAt: now,
  },
});
assert(appearancePayload);
assert.equal(appearancePayload.exteriorColorSource, "USER");
assert.equal(parseVehicleAppearancePayload({ ok: true, vehicle: { id: "vehicle-1" } }), null);

const imageRefreshPayload = parseVehicleImageRefreshPayload({ ok: true, fallback: false });
assert(imageRefreshPayload);
assert.equal(imageRefreshPayload.fallback, false);

const employee = parseCrmEmployeeCore({
  id: "employee-1",
  firstName: "Іван",
  lastName: "Механік",
  birthDate: null,
  hireDate: now,
  email: "ivan@example.com",
  phone: "+380671111111",
  phoneCountry: "UA",
  address: null,
  photoUrl: null,
  personnelCategory: "Механіки",
  position: "Механік",
  crmLogin: "ivan@example.com",
  isActive: true,
});
assert(employee);
assert.equal(employee.position, "Механік");

const personnelSource = {
  ...employee,
  employmentType: "STAFF",
  baseSalary: "20000",
  minimumSalary: null,
  workPercent: "35",
  partsSalesPercent: null,
  partsMarginPercent: null,
  netProfitPercent: null,
  payrollRuleNote: null,
  documents: [{ id: "doc-1", type: "PASSPORT", name: "Паспорт", status: "UPLOADED", fileUrl: "/files/doc-1" }],
  roleAssignments: [{
    id: "assignment-1",
    isPrimary: true,
    role: { code: "MECHANIC", name: "Механік", category: "Механіки" },
    location: { id: "loc-1", name: "Глеваха" },
  }],
  access: {
    roleCode: "MECHANIC",
    roleName: "Механік",
    location: { id: "loc-1", name: "Глеваха" },
    cabinetStatus: "ACTIVE",
    cabinetEnabled: true,
    userId: "user-1",
    authLinked: true,
    lastLoginAt: now,
    mechanicResource: {
      id: "mechanic-1",
      name: "Іван Механік",
      locationId: "loc-1",
      isActive: true,
      userId: "user-1",
    },
  },
};

const personnel = parsePersonnelItem(personnelSource);
assert(personnel);
assert.equal(personnel.access?.roleCode, "MECHANIC");

const personnelPayload = parsePersonnelListPayload({ ok: true, items: [personnelSource] });
assert(personnelPayload);
assert.equal(personnelPayload.items[0]?.employmentType, "STAFF");
assert.equal(personnelPayload.items[0]?.documents[0]?.id, "doc-1");
assert.equal(parsePersonnelListPayload({ ok: true, items: [{ id: "broken" }] }), null);

const personnelCatalog = parsePersonnelCatalogPayload({
  ok: true,
  roles: [{ code: "MECHANIC", name: "Механік", category: "Механіки", economicsMode: "WORK_PERCENT", requiresLocation: true, description: null }],
  locations: [{ id: "loc-1", name: "Глеваха" }],
});
assert(personnelCatalog);
assert.equal(personnelCatalog.roles[0]?.requiresLocation, true);
assert.equal(parsePersonnelCatalogPayload({ ok: true, roles: [{ code: "MECHANIC" }], locations: [] }), null);

const personnelSave = parsePersonnelSavePayload({ ok: true, id: "employee-1", userId: "user-1" });
assert(personnelSave);
assert.equal(personnelSave.id, "employee-1");
assert(parsePersonnelOkPayload({ ok: true }));
assert.equal(parsePersonnelSavePayload({ ok: true }), null);

const workOrderCore = parseCrmWorkOrderCore({
  id: "wo-1",
  status: "IN_REPAIR",
  createdAt: now,
  updatedAt: now,
  closedAt: null,
});
assert(workOrderCore);

const workOrder = parseWorkOrderListItem({
  ...workOrderCore,
  statusLabel: "У ремонті",
  statusTone: "active",
  stage: "repair",
  client: { id: "client-1", name: "Марія", phone: "+380670000000" },
  vehicle: {
    id: "vehicle-1",
    brand: "Volkswagen",
    model: "Passat",
    year: 2018,
    plateNumber: "AA1234AA",
    vin: "WVWZZZ1JZXW000001",
    mileageKm: 120000,
    turboLevClass: "M",
  },
  diagnosticRequest: {
    id: "diag-1",
    status: "CONFIRMED",
    technicalConclusion: "OK",
    confirmedAt: now,
    leadId: "lead-1",
    createdAt: now,
  },
  transitions: [{
    to: "WAITING_QC",
    label: "На контроль якості",
    allowed: true,
    code: "OK",
    requiredGates: [],
    missingGates: [],
    actions: [],
    unsupportedActions: [],
  }],
}, 124);
assert(workOrder);
assert.equal(workOrder.number, 124);
assert.equal(workOrder.vehicle.plateNumber, "AA1234AA");
assert.equal(workOrder.transitions[0]?.to, "WAITING_QC");

console.log("CRM core contracts smoke: OK");
