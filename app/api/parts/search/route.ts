import { NextResponse } from "next/server";
import { getGenerationByYear, searchParts } from "auto-parts-db";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";

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
  const generation = vehicle?.make && vehicle?.model && vehicle?.year
    ? getGenerationByYear(vehicle.make, vehicle.model, vehicle.year)
    : null;

  const fitmentConfidence = generation ? 45 : vehicle ? 30 : 10;
  const parts = searchParts(q).slice(0, 50).map((part) => ({
    ...part,
    fitment: {
      status: "REFERENCE_ONLY" as const,
      confidence: fitmentConfidence,
      confirmed: false,
      reason: generation
        ? `Каталог знає покоління ${vehicle?.make ?? ""} ${vehicle?.model ?? ""}, але не містить OEM/VIN-прив'язки цієї деталі.`
        : vehicle
          ? "VIN визначив автомобіль, але безкоштовний каталог не підтверджує точну сумісність деталі."
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
      generation,
      confidence: vehicleContext?.confidence ?? 0,
      source: vehicleContext?.sourceDetail ?? vehicleContext?.source ?? null,
    } : null,
    parts,
    fitmentPolicy: {
      level: "REFERENCE_ONLY",
      canAutoApprove: false,
      requiredForOrder: "OEM_OR_SUPPLIER_CONFIRMATION",
      message: "CRM не має права позначити деталь як сумісну лише за збігом назви. Перед замовленням потрібне підтвердження OEM-каталогом або API постачальника.",
    },
    providers: [
      { id: "AUTO_PARTS_DB", role: "REFERENCE_CATALOG", license: "MIT" },
      { id: vehicleContext?.sourceDetail ?? "VIN_NOT_USED", role: "VEHICLE_IDENTITY" },
    ],
  });
}
