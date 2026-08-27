import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import { validateVin } from "@/src/domain/vin";

export type VehicleIdentityInputType = "PLATE" | "VIN";

export type ParsedVehicleIdentityInput = {
  type: VehicleIdentityInputType;
  normalized: string;
  masked: string;
};

export class VehicleIdentityInputError extends Error {
  readonly code: "INVALID_VEHICLE_IDENTIFIER";

  constructor(message = "Введіть коректний державний номер або VIN") {
    super(message);
    this.name = "VehicleIdentityInputError";
    this.code = "INVALID_VEHICLE_IDENTIFIER";
  }
}

const PLATE_RE = /^[A-Z0-9]{6,10}$/;

export function maskPlate(plate: string) {
  const normalized = normalizeRegistrationPlate(plate);
  if (normalized.length <= 4) return "••••";
  return `${normalized.slice(0, 2)}${"•".repeat(Math.max(2, normalized.length - 4))}${normalized.slice(-2)}`;
}

export function maskVin(vin: string) {
  const normalized = validateVin(vin).vin;
  if (normalized.length < 6) return "••••••";
  return `${normalized.slice(0, 3)}${"•".repeat(Math.max(8, normalized.length - 7))}${normalized.slice(-4)}`;
}

export function parseVehicleIdentityInput(rawInput: string): ParsedVehicleIdentityInput {
  const raw = String(rawInput ?? "").trim();
  if (!raw) throw new VehicleIdentityInputError();

  const vin = validateVin(raw);
  if (vin.formatValid) {
    if (vin.northAmerican && vin.checkDigit.status === "INVALID") {
      throw new VehicleIdentityInputError("Контрольна цифра VIN не збігається");
    }
    return { type: "VIN", normalized: vin.vin, masked: maskVin(vin.vin) };
  }

  const plate = normalizeRegistrationPlate(raw);
  if (PLATE_RE.test(plate)) {
    return { type: "PLATE", normalized: plate, masked: maskPlate(plate) };
  }

  throw new VehicleIdentityInputError();
}
