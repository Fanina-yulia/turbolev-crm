import { NextResponse } from "next/server";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import {
  lookupMvsOpenDataByPlateYear,
  MVS_OPEN_DATA_RESOURCES,
  MVS_OPEN_DATA_SOURCE_URL,
} from "@/src/services/mvs-open-data.provider";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const plate = normalizeRegistrationPlate(searchParams.get("plate") ?? "");
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);

  if (plate.length < 6) {
    return NextResponse.json({ status: "INVALID_PLATE", plate }, { status: 400 });
  }

  if (!MVS_OPEN_DATA_RESOURCES.some((item) => item.year === year)) {
    return NextResponse.json(
      { status: "INVALID_YEAR", plate, year, availableYears: MVS_OPEN_DATA_RESOURCES.map((item) => item.year) },
      { status: 400 },
    );
  }

  try {
    const vehicle = await lookupMvsOpenDataByPlateYear(plate, year);
    if (!vehicle) {
      return NextResponse.json({
        status: "NOT_FOUND",
        plate,
        year,
        attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
      });
    }

    return NextResponse.json({
      status: "FOUND",
      plate,
      year,
      lookupLevel: "MVS_OPEN_DATA",
      attributionUrl: MVS_OPEN_DATA_SOURCE_URL,
      vehicle,
    });
  } catch (error) {
    console.error(`MVS ${year} lookup failed`, error);
    return NextResponse.json(
      { status: "LOOKUP_UNAVAILABLE", plate, year },
      { status: 503 },
    );
  }
}
