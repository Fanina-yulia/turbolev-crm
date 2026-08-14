import {
  calculateLaborPriceForVehicle,
  classifyVehicle,
  type TurboLevClass,
  type VehicleType,
} from "../src/domain/vehicle-intelligence";

type Case = {
  name: string;
  input: Parameters<typeof classifyVehicle>[0];
  vehicleType: VehicleType;
  turboLevClass: TurboLevClass;
  coefficient: number;
};

const cases: Case[] = [
  {
    name: "Toyota Venza from MVS wagon label",
    input: { make: "TOYOTA", model: "VENZA", engineVolume: "3.456", bodyType: "ЛЕГКОВИЙ / УНІВЕРСАЛ" },
    vehicleType: "CROSSOVER",
    turboLevClass: "C1",
    coefficient: 1.15,
  },
  {
    name: "Volkswagen Caddy small van",
    input: { make: "VOLKSWAGEN", model: "CADDY", engineVolume: "1.9", bodyType: "ФУРГОН" },
    vehicleType: "VAN_SMALL",
    turboLevClass: "V1",
    coefficient: 1.2,
  },
  {
    name: "Mercedes Sprinter large van",
    input: { make: "MERCEDES-BENZ", model: "SPRINTER", engineVolume: "2.2", bodyType: "ФУРГОН" },
    vehicleType: "VAN_LARGE",
    turboLevClass: "V3",
    coefficient: 1.5,
  },
  {
    name: "Toyota Land Cruiser SUV",
    input: { make: "TOYOTA", model: "LAND CRUISER", engineVolume: "4.6", bodyType: "ЛЕГКОВИЙ / УНІВЕРСАЛ" },
    vehicleType: "SUV",
    turboLevClass: "S1",
    coefficient: 1.2,
  },
  {
    name: "Toyota Corolla base passenger",
    input: { make: "TOYOTA", model: "COROLLA", engineVolume: "1.6", bodyType: "ЛЕГКОВИЙ / СЕДАН" },
    vehicleType: "PASSENGER",
    turboLevClass: "L1",
    coefficient: 1,
  },
  {
    name: "BMW 3 series passenger 2.0",
    input: { make: "BMW", model: "320D", engineVolume: "2.0", bodyType: "SEDAN" },
    vehicleType: "PASSENGER",
    turboLevClass: "L2",
    coefficient: 1.1,
  },
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

for (const testCase of cases) {
  const result = classifyVehicle(testCase.input);
  assert(result.vehicleType === testCase.vehicleType, `${testCase.name}: expected vehicleType ${testCase.vehicleType}, got ${result.vehicleType}`);
  assert(result.turboLevClass === testCase.turboLevClass, `${testCase.name}: expected class ${testCase.turboLevClass}, got ${result.turboLevClass}`);
  assert(result.priceCoefficient === testCase.coefficient, `${testCase.name}: expected coefficient ${testCase.coefficient}, got ${result.priceCoefficient}`);
  assert(result.confidence >= 85, `${testCase.name}: confidence too low (${result.confidence})`);
}

const venza = classifyVehicle({ make: "TOYOTA", model: "VENZA", engineVolume: "3.456", bodyType: "ЛЕГКОВИЙ / УНІВЕРСАЛ" });
const venzaPrice = calculateLaborPriceForVehicle(600, venza);
assert(venzaPrice.adjustedPrice === 690, `Venza labour price: expected 690, got ${venzaPrice.adjustedPrice}`);
assert(venzaPrice.autoApplied, "Venza coefficient should auto-apply at high confidence");

const uncertain = classifyVehicle({ make: "UNKNOWN", model: "UNKNOWN", engineVolume: "3.0" });
const uncertainPrice = calculateLaborPriceForVehicle(1000, uncertain);
assert(uncertainPrice.requiresConfirmation, "Low-confidence classification must require manager confirmation");
assert(uncertainPrice.appliedCoefficient === 1, "Low-confidence classification must not silently increase labour price");
assert(uncertainPrice.adjustedPrice === 1000, "Low-confidence classification must preserve base labour price until confirmation");

console.log(`Vehicle pricing classifier smoke test passed: ${cases.length + 2} checks`);
