import { NextResponse } from "next/server";
import { lookupVehicleByPlate, normalizeRegistrationPlate } from "@/src/services/vehicle-lookup.service";
import { resolveVehicleColorByPlate } from "@/src/services/vehicle-registry-color.service";

export const runtime = "nodejs";
// Vehicle lookup reads the fast Neon registry index first; deep MVS scans are opt-in only.
export const maxDuration = 300;

function cleanVehicleText(value: string | null | undefined) {
  return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function canonicalMake(rawMake: string, rawModel: string) {
  const make = cleanVehicleText(rawMake);
  const model = cleanVehicleText(rawModel);
  if (!make || !model) return make;
  const upperMake = make.toLocaleUpperCase("uk-UA");
  const upperModel = model.toLocaleUpperCase("uk-UA");
  const suffix = ` ${upperModel}`;
  if (upperMake !== upperModel && upperMake.endsWith(suffix)) {
    return make.slice(0, make.length - model.length).trim();
  }
  return make;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const plate = normalizeRegistrationPlate(searchParams.get("plate") ?? "");

  if (plate.length < 6) {
    return NextResponse.json(
      {
        status: "INVALID_PLATE",
        message: "Вкажіть коректний державний номер автомобіля.",
        plate,
      },
      { status: 400 },
    );
  }

  try {
    const result = await lookupVehicleByPlate(plate);
    const color = result.status === "FOUND"
      ? await resolveVehicleColorByPlate(plate, result.vehicle?.id).catch((error) => {
          console.warn("vehicle registry color lookup unavailable", {
            plate,
            message: error instanceof Error ? error.message : "unknown error",
          });
          return null;
        })
      : null;
    const normalizedResult = result.status === "FOUND" && result.vehicle?.make && result.vehicle.model
      ? {
          ...result,
          vehicle: {
            ...result.vehicle,
            make: canonicalMake(result.vehicle.make, result.vehicle.model),
            model: cleanVehicleText(result.vehicle.model),
            ...(color || {}),
          },
        }
      : result;

    // Image generation intentionally starts only after a real Vehicle record exists.
    // This prevents paid/duplicate assets from plate previews that the operator may never save.
    return NextResponse.json(normalizedResult);
  } catch (error) {
    console.error("vehicle lookup failed", error);
    return NextResponse.json(
      {
        status: "LOOKUP_UNAVAILABLE",
        lookupLevel: "EXTERNAL_REQUIRED",
        plate,
        message: "Пошук тимчасово недоступний. Дані можна заповнити вручну.",
      },
      { status: 503 },
    );
  }
}
