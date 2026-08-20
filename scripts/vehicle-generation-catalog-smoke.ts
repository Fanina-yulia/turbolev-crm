import { normalizeVehicleGenerationIdentity } from "../src/services/vehicle-images/vehicle-generation-catalog.service";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const duplicated = normalizeVehicleGenerationIdentity("DAEWOO LANOS", "LANOS");
assertEqual(duplicated.make, "DAEWOO", "duplicate model suffix in make");
assertEqual(duplicated.model, "LANOS", "Daewoo model");

const octavia = normalizeVehicleGenerationIdentity("Škoda", "Octavia A5");
assertEqual(octavia.make, "SKODA", "Skoda alias");
assertEqual(octavia.model, "OCTAVIA", "Octavia generation alias");

const vw = normalizeVehicleGenerationIdentity("VW", "Passat");
assertEqual(vw.make, "VOLKSWAGEN", "VW alias");
assertEqual(vw.model, "PASSAT", "Passat model");

const rav4 = normalizeVehicleGenerationIdentity("Toyota", "RAV 4");
assertEqual(rav4.model, "RAV4", "RAV4 alias");

const xtrail = normalizeVehicleGenerationIdentity("Nissan", "X Trail");
assertEqual(xtrail.model, "X-TRAIL", "X-Trail alias");

console.log("vehicle generation catalog smoke: ok");
