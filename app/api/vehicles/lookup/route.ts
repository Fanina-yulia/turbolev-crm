import { after, NextResponse } from "next/server";
import { lookupVehicleByPlate, normalizeRegistrationPlate } from "@/src/services/vehicle-lookup.service";
import { generateVehicleImageForConfirmedDescriptor } from "@/src/services/vehicle-images/vehicle-image-descriptor-background.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

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
    const normalizedResult = result.status === "FOUND" && result.vehicle?.make && result.vehicle.model
      ? {
          ...result,
          vehicle: {
            ...result.vehicle,
            make: canonicalMake(result.vehicle.make, result.vehicle.model),
            model: cleanVehicleText(result.vehicle.model),
          },
        }
      : result;

    if (normalizedResult.status === "FOUND" && normalizedResult.vehicle?.make && normalizedResult.vehicle.model) {
      // Vehicle lookup itself stays readable for its existing callers. The paid OpenAI
      // side effect is stricter: only an authenticated CRM user with vehicle/client
      // write permission may enqueue generation.
      const access = await authorize(PERMISSIONS.CLIENTS_WRITE, { request, strict: true });
      if (access.allowed) {
        const descriptor = {
          make: normalizedResult.vehicle.make,
          model: normalizedResult.vehicle.model,
          year: normalizedResult.vehicle.year,
          bodyType: normalizedResult.vehicle.bodyType,
        };
        after(async () => {
          try {
            await generateVehicleImageForConfirmedDescriptor(descriptor);
          } catch (error) {
            console.error("background vehicle image generation after plate confirmation failed", {
              plate,
              make: descriptor.make,
              model: descriptor.model,
              message: error instanceof Error ? error.message : "unknown error",
            });
          }
        });
      }
    }

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
