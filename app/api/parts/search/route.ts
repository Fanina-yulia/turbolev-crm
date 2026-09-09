import { NextResponse } from "next/server";
import { FREE_PARTS_SOURCE, searchReferenceParts } from "@/src/services/free-parts-catalog.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";
import { resolveLaborPricing } from "@/src/services/labor-pricing.service";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";
import { normalizePartNeed } from "@/src/services/part-normalization.service";
import { resolvePartKnowledge } from "@/src/services/parts-knowledge.service";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const rawVin = searchParams.get("vin") ?? "";
  const vehicleId = searchParams.get("vehicleId")?.trim() || null;
  const plate = searchParams.get("plate")?.trim() || null;
  const findingId = searchParams.get("findingId")?.trim() || null;
  const manualPartId = searchParams.get("manualPartId")?.trim() || null;
  const partName = searchParams.get("partName")?.trim() || q;
  const canonicalCode = searchParams.get("canonicalCode")?.trim() || null;
  const axis = searchParams.get("axis")?.trim() || null;
  const side = searchParams.get("side")?.trim() || null;
  const subPosition = searchParams.get("subPosition")?.trim() || null;
  const position = searchParams.get("position")?.trim() || null;
  const genericArticleId = searchParams.get("genericArticleId")?.trim() || null;
  const locationId = searchParams.get("locationId")?.trim() || null;

  const access = await authorizeScopedLocation(PERMISSIONS.PARTS_READ, request, locationId);
  if (!access.ok) return access.response;

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть щонайменше 2 символи назви деталі." }, { status: 400 });
  }

  const fitment = await resolvePartFitment({
    query: q,
    partName,
    canonicalCode,
    axis,
    position,
    side,
    subPosition,
    genericArticleId,
    vehicleId,
    vin: rawVin,
    plate,
  });
  const normalization = await normalizePartNeed({
    query: q,
    partName,
    canonicalCode,
    genericArticleId,
    position,
    axis,
    side,
    subPosition,
  });
  const knowledge = await resolvePartKnowledge({
    query: q,
    partName,
    canonicalCode,
    genericArticleId,
    position,
    side,
    subPosition,
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

  const displayVehicle = vehicleContext?.vehicle
    ? vehicleContext.vehicle
    : fitment.vehicle
      ? {
          id: fitment.vehicle.id || vehicleId,
          vin: fitment.vehicle.vin,
          make: fitment.vehicle.brand,
          model: fitment.vehicle.model,
          year: fitment.vehicle.year,
          engine: null,
          engineVolumeL: null,
          fuelType: null,
          bodyType: null,
          driveType: null,
          vehicleType: null,
        }
      : null;
  const pricing = displayVehicle ? await resolveLaborPricing({
    make: displayVehicle.make || undefined,
    model: displayVehicle.model || undefined,
    year: displayVehicle.year == null ? undefined : String(displayVehicle.year),
    engine: displayVehicle.engine || undefined,
    engineVolume: displayVehicle.engineVolumeL == null ? undefined : String(displayVehicle.engineVolumeL),
    fuelType: displayVehicle.fuelType || undefined,
    bodyType: displayVehicle.bodyType || undefined,
    driveType: displayVehicle.driveType || undefined,
    vehicleType: displayVehicle.vehicleType || undefined,
  }) : null;
  const reference = await searchReferenceParts(q, 50);
  const parts = reference.parts.map((part) => ({
    ...part,
    fitment: {
      status: "REFERENCE_ONLY" as const,
      confidence: displayVehicle ? 30 : 10,
      confirmed: false,
      reason: "Це довідкова назва деталі. Точна сумісність береться лише з catalogMatches нижче.",
    },
  }));

  return NextResponse.json({
    status: "OK",
    query: q,
    context: { vehicleId, vin: rawVin || null, plate, findingId, manualPartId, partName, canonicalCode, axis, side, subPosition, position },
    vehicle: displayVehicle ? {
      id: fitment.vehicle?.id || vehicleId,
      vin: displayVehicle.vin,
      make: displayVehicle.make,
      model: displayVehicle.model,
      year: displayVehicle.year,
      engine: displayVehicle.engine,
      engineVolumeL: displayVehicle.engineVolumeL,
      fuelType: displayVehicle.fuelType,
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
      exact: fitment.exact,
      reason: fitment.reason,
      vehicle: fitment.vehicle,
      providerVehicle: fitment.providerVehicle,
      catalog: fitment.catalog,
      genericArticle: fitment.genericArticle,
      normalization,
    },
    catalogMatches: fitment.matches,
    oeNumbers: fitment.oeNumbers,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    normalization,
    knowledge: {
      source: knowledge.source,
      matchType: knowledge.matchType,
      confidence: knowledge.confidence,
      aliasId: knowledge.aliasId,
      matchedAlias: knowledge.matchedAlias,
      genericArticleId: knowledge.genericArticleId,
      canonical: knowledge.definition
        ? {
            code: knowledge.definition.code,
            slug: knowledge.definition.slug,
            name: knowledge.definition.canonicalName,
          }
        : null,
    },
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
        fitmentExact: fitment.exact,
      },
    ],
  });
}
