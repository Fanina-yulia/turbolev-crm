import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

function normalizeVin(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
}

function numberOrNull(value: unknown) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = normalizeVin(searchParams.get("vin") ?? "");

  if (vin.length !== 17) {
    return NextResponse.json({ status: "INVALID_VIN", vin, message: "VIN має містити 17 символів." }, { status: 400 });
  }

  try {
    const url = `${VPIC_BASE}/${encodeURIComponent(vin)}?format=json`;
    const response = await fetch(url, {
      headers: { "User-Agent": "TurboLEV-CRM/1.0" },
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`vPIC HTTP ${response.status}`);
    const payload = await response.json();
    const row = Array.isArray(payload?.Results) ? payload.Results[0] : null;

    if (!row) {
      return NextResponse.json({ status: "NOT_FOUND", vin, source: "NHTSA_VPIC" });
    }

    const make = String(row.Make ?? "").trim();
    const model = String(row.Model ?? "").trim();
    const year = numberOrNull(row.ModelYear);
    const errorCode = String(row.ErrorCode ?? "").trim();
    const errorText = String(row.ErrorText ?? "").trim();
    const hasUsefulData = Boolean(make || model || year);

    return NextResponse.json({
      status: hasUsefulData ? "FOUND" : "NOT_FOUND",
      vin,
      source: "NHTSA_VPIC",
      attributionUrl: "https://vpic.nhtsa.dot.gov/",
      warning: errorCode && errorCode !== "0" ? errorText : null,
      vehicle: hasUsefulData ? {
        vin,
        make: make || null,
        model: model || null,
        year,
        trim: String(row.Trim ?? "").trim() || null,
        series: String(row.Series ?? "").trim() || null,
        bodyType: String(row.BodyClass ?? "").trim() || null,
        vehicleType: String(row.VehicleType ?? "").trim() || null,
        engineModel: String(row.EngineModel ?? "").trim() || null,
        engineVolumeL: numberOrNull(row.DisplacementL),
        cylinders: numberOrNull(row.EngineCylinders),
        fuelType: String(row.FuelTypePrimary ?? "").trim() || null,
        secondaryFuelType: String(row.FuelTypeSecondary ?? "").trim() || null,
        driveType: String(row.DriveType ?? "").trim() || null,
        transmission: [row.TransmissionStyle, row.TransmissionSpeeds ? `${row.TransmissionSpeeds} ст.` : ""].filter(Boolean).join(" · ") || null,
        plantCountry: String(row.PlantCountry ?? "").trim() || null,
        plantCompany: String(row.PlantCompanyName ?? "").trim() || null,
        manufacturer: String(row.Manufacturer ?? "").trim() || null,
      } : null,
    });
  } catch (error) {
    console.error("VIN decode failed", error);
    return NextResponse.json({ status: "LOOKUP_UNAVAILABLE", vin, source: "NHTSA_VPIC", message: "VIN-декодер тимчасово недоступний." }, { status: 503 });
  }
}
