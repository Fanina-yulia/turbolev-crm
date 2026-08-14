import { NextResponse } from "next/server";
import { lookupVehicleByPlate, normalizeRegistrationPlate } from "@/src/services/vehicle-lookup.service";

export const runtime = "nodejs";
// Deep historical MVS lookup may need to inspect several annual archives on a cache miss.
export const maxDuration = 300;

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
    return NextResponse.json(result);
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
