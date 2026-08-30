import { NextResponse } from "next/server";
import { FREE_PARTS_SOURCE, searchReferenceParts } from "@/src/services/free-parts-catalog.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";
import { resolveLaborPricing } from "@/src/services/labor-pricing.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const rawVin = searchParams.get("vin") ?? "";

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть щонайменше 2 символи назви деталі." }, { status: 400 });
  }

  let vehicleContext: Awaited<ReturnType<typeof decodeVinIntelligence>> | null = null;
  const validation = validateVin(rawVin);
  if (rawVin && validation.formatValid && !(validation.northAmerican && validation.checkDigit.status === "INVALID")) {
    try {
      vehicleContext = await decodeVinIntelligence(validation.vin);
    } catch (error) {
      console.warn("VIN context for parts search unavailable", error);
    }
  }

  const vehicle = vehicleContext?.vehicle ?? null;
  const pricing = vehicle ? await resolveLaborPricing({
    make: vehicle.make || undefined,
    model: vehicle.model || undefined,
    year: vehicle.year == null ? undefined : String(vehicle.year),
    engine: vehicle.engine || undefined,
    engineVolume: vehicle.engineVolumeL == null ? undefined : String(vehicle.engineVolumeL),
    fuelType: vehicle.fuelType || undefined,
    bodyType: vehicle.bodyType || undefined,
    driveType: vehicle.driveType || undefined,
    vehicleType: vehicle.vehicleType || undefined,
  }) : null;
  const reference = await searchReferenceParts(q, 50);
  const fitmentConfidence = vehicle ? 30 : 10;
  const parts = reference.parts.map((part) => ({
    ...part,
    fitment: {
      status: "REFERENCE_ONLY" as const,
      confidence: fitmentConfidence,
      confirmed: false,
      reason: vehicle
        ? "VIN визначив автомобіль, але безкоштовний довідник не містить OEM/VIN-прив'язки цієї деталі."
        : "Пошук лише за назвою деталі без підтвердження автомобіля.",
    },
  }));

  return NextResponse.json({
    status: "OK",
    query: q,
    vehicle: vehicle ? {
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      engine: vehicle.engine,
      engineVolumeL: vehicle.engineVolumeL,
      fuelType: vehicle.fuelType,
      confidence: vehicleContext?.confidence ?? 0,
      source: vehicleContext?.sourceDetail ?? vehicleContext?.source ?? null,
    } : null,
    pricing: pricing ? {
      vehicleType: pricing.pricingVehicleType,
      vehicleTypeLabel: pricing.pricingVehicleTypeLabel,
      coefficient: pricing.coefficient,
      source: pricing.source,
    } : null,
    parts,
    fitmentPolicy: {
      level: "REFERENCE_ONLY",
      canAutoApprove: false,
      requiredForOrder: "OEM_OR_SUPPLIER_CONFIRMATION",
      message: "CRM не має права позначити деталь як сумісну лише за збігом назви. Перед замовленням потрібне підтвердження OEM-каталогом або API постачальника.",
    },
    providers: [
      {
        id: reference.remote ? FREE_PARTS_SOURCE.id : "TURBO_LEV_LOCAL_FALLBACK",
        role: "REFERENCE_CATALOG",
        license: reference.remote ? FREE_PARTS_SOURCE.license : "Turbo LEV internal",
        pinnedCommit: reference.remote ? FREE_PARTS_SOURCE.commit : null,
      },
      { id: vehicleContext?.sourceDetail ?? "VIN_NOT_USED", role: "VEHICLE_IDENTITY" },
    ],
  });
}
