import { NextResponse } from "next/server";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";
import { classifyVehicle, TURBO_LEV_CLASS_LABELS } from "@/src/domain/vehicle-intelligence";
import { MVS_OPEN_DATA_SOURCE_URL } from "@/src/services/mvs-open-data.provider";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vin = searchParams.get("vin") ?? "";
  const forceRefresh = searchParams.get("refresh") === "1";
  const validation = validateVin(vin);

  if (!validation.formatValid) {
    return NextResponse.json({
      status: "INVALID_VIN",
      vin: validation.vin,
      validation,
      message: validation.warnings[0] ?? "VIN має містити 17 коректних символів.",
    }, { status: 400 });
  }

  if (validation.northAmerican && validation.checkDigit.status === "INVALID") {
    return NextResponse.json({
      status: "INVALID_VIN",
      vin: validation.vin,
      validation,
      message: "VIN не пройшов перевірку контрольної цифри. Перевірте введення.",
    }, { status: 400 });
  }

  try {
    const result = await decodeVinIntelligence(validation.vin, { forceRefresh });
    const classification = result.vehicle ? classifyVehicle({
      make: result.vehicle.make ?? "",
      model: result.vehicle.model ?? "",
      year: result.vehicle.year?.toString() ?? "",
      engine: result.vehicle.engine ?? "",
      engineVolume: result.vehicle.engineVolumeL?.toString() ?? "",
      fuelType: result.vehicle.fuelType ?? "",
      bodyType: result.vehicle.bodyType ?? "",
      driveType: result.vehicle.driveType ?? "",
      vehicleType: result.vehicle.vehicleType ?? "",
    }) : null;

    return NextResponse.json({
      ...result,
      classification: classification ? {
        ...classification,
        label: TURBO_LEV_CLASS_LABELS[classification.turboLevClass],
        autoPriceAdjustmentAllowed: classification.confidence >= 85 && classification.turboLevClass !== "UNKNOWN",
      } : null,
      attributionUrl: result.source === "MVS_INDEX" || result.sourceDetail.startsWith("MVS_")
        ? MVS_OPEN_DATA_SOURCE_URL
        : "https://vpic.nhtsa.dot.gov/",
    });
  } catch (error) {
    console.error("VIN intelligence lookup failed", error);
    return NextResponse.json({
      status: "LOOKUP_UNAVAILABLE",
      vin: validation.vin,
      validation,
      source: "NHTSA_VPIC_API",
      message: "VIN-декодер тимчасово недоступний. CRM не буде вигадувати дані — їх можна внести вручну або повторити запит.",
    }, { status: 503 });
  }
}
