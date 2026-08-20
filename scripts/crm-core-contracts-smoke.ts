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

const employee = parseCrmEmployeeCore({
  id: "employee-1",
  firstName: "Іван",
  lastName: "Механік",
  birthDate: null,
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

const personnel = parsePersonnelItem({
  ...employee,
  baseSalary: "20000",
  minimumSalary: null,
  workPercent: "35",
  partsSalesPercent: null,
  partsMarginPercent: null,
  netProfitPercent: null,
  payrollRuleNote: null,
  documents: [],
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
});
assert(personnel);
assert.equal(personnel.access?.roleCode, "MECHANIC");

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
