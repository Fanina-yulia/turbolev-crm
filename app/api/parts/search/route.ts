import { NextResponse } from "next/server";
import { FREE_PARTS_SOURCE, searchReferenceParts } from "@/src/services/free-parts-catalog.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";
import { resolveLaborPricing } from "@/src/services/labor-pricing.service";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const rawVin = searchParams.get("vin") ?? "";
  const vehicleId = searchParams.get("vehicleId")?.trim() || null;
  const findingId = searchParams.get("findingId")?.trim() || null;
  const manualPartId = searchParams.get("manualPartId")?.trim() || null;
  const partName = searchParams.get("partName")?.trim() || q;
  const position = searchParams.get("position")?.trim() || null;
  const genericArticleId = searchParams.get("genericArticleId")?.trim() || null;

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть щонайменше 2 символи назви деталі." }, { status: 400 });
  }

  const fitment = await resolvePartFitment({
    query: q,
    partName,
    position,
    genericArticleId,
    vehicleId,
    vin: rawVin,
  });

  let vehicleContext: Awaited<ReturnType<typeof decodeVinIntelligence>> | null = null;
  const validation = validateVin(rawVin || fitment.vehicle?.vin || "");
  if (validation.formatValid && !(validation.northAmerican && validation.checkDigit.status === "INVALID")) {
    try {
      vehicleContext = await decodeVinIntelligence(validation.vin);
    } catch (error) {
      console.warn("VIN context for parts search unavailable", error);
    }
  }

  const vehicle = vehicleContext?.vehicle ?? fitment.vehicle ?? null;
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
  const parts = reference.parts.map((part) => ({
    ...part,
    fitment: {
      status: "REFERENCE_ONLY" as const,
      confidence: vehicle ? 30 : 10,
      confirmed: false,
      reason: "Це довідкова назва деталі. Точна сумісність береться лише з catalogMatches нижче.",
    },
  }));

  return NextResponse.json({
    status: "OK",
    query: q,
    context: { vehicleId, findingId, manualPartId, partName, position },
    vehicle: vehicle ? {
      id: fitment.vehicle?.id || vehicleId,
      vin: vehicle.vin,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      engine: vehicle.engine,
      engineVolumeL: vehicle.engineVolumeL,
      fuelType: vehicle.fuelType,
      confidence: vehicleContext?.confidence ?? fitment.confidence ?? 0,
      source: vehicleContext?.sourceDetail ?? vehicleContext?.source ?? "CRM_VEHICLE",
    } : null,
    pricing: pricing ? {
      vehicleType: pricing.pricingVehicleType,
      vehicleTypeLabel: pricing.pricingVehicleTypeLabel,
      coefficient: pricing.coefficient,
      source: pricing.source,
    } : null,
    fitment: {
      status: fitment.status,
      confirmed: fitment.confirmed,
      confidence: fitment.confidence,
      reason: fitment.reason,
      vehicle: fitment.vehicle,
      catalog: fitment.catalog,
      genericArticle: fitment.genericArticle,
    },
    catalogMatches: fitment.matches,
    oeNumbers: fitment.oeNumbers,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    parts,
    fitmentPolicy: {
      level: fitment.status,
      canAutoApprove: fitment.confirmed,
      requiredForOrder: fitment.confirmed ? "NONE" : "MANUAL_CONFIRMATION_OR_CATALOG",
      message: fitment.reason,
    },
    providers: [
      {
        id: reference.remote ? FREE_PARTS_SOURCE.id : "TURBO_LEV_LOCAL_FALLBACK",
        role: "REFERENCE_CATALOG",
        license: reference.remote ? FREE_PARTS_SOURCE.license : "Turbo LEV internal",
        pinnedCommit: reference.remote ? FREE_PARTS_SOURCE.commit : null,
      },
      {
        id: fitment.catalog?.source || "CATALOG_NOT_CONNECTED",
        role: "VIN_FITMENT",
        status: fitment.status,
        vehicleReferenceId: fitment.catalog?.vehicleReferenceId || null,
      },
    ],
  });
}
