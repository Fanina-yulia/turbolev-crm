import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { FREE_PARTS_SOURCE, searchReferenceParts } from "@/src/services/free-parts-catalog.service";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";
import { resolveLaborPricing } from "@/src/services/labor-pricing.service";
import { resolvePartFitment } from "@/src/services/parts-fitment.service";
import { normalizePartNeed } from "@/src/services/part-normalization.service";
import { resolvePartKnowledge } from "@/src/services/parts-knowledge.service";
import { enrichOffersWithSellPrice } from "@/src/services/suppliers/order.service";
import { searchConfiguredSuppliers } from "@/src/services/suppliers/registry";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const includeSuppliers = searchParams.get("includeSuppliers") === "1";
  const locationId = searchParams.get("locationId")?.trim() || null;
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

  if (includeSuppliers) {
    const access = await authorizeScopedLocation(PERMISSIONS.PROCUREMENT_READ, request, locationId);
    if (!access.ok) return access.response;
  }

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть щонайменше 2 символи назви деталі." }, { status: 400 });
  }

  const decodeVehicleContext = async (candidate: string) => {
    const validation = validateVin(candidate);
    if (!validation.formatValid || (validation.northAmerican && validation.checkDigit.status === "INVALID")) return null;
    try {
      return await decodeVinIntelligence(validation.vin);
    } catch (error) {
      console.warn("VIN context for parts search unavailable", error);
      return null;
    }
  };
  const rawVehicleContextPromise = decodeVehicleContext(rawVin);

  const fitmentPromise = resolvePartFitment({
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
  const normalizationPromise = normalizePartNeed({
    query: q,
    partName,
    canonicalCode,
    genericArticleId,
    position,
    axis,
    side,
    subPosition,
  });
  const knowledgePromise = resolvePartKnowledge({
    query: q,
    partName,
    canonicalCode,
    genericArticleId,
    position,
    side,
    subPosition,
  });
  const referencePromise = searchReferenceParts(q, 50);
  const fitment = await fitmentPromise;
  const [normalization, knowledge, reference] = await Promise.all([
    normalizationPromise,
    knowledgePromise,
    referencePromise,
  ]);

  // Resolve the mechanic-facing label once and pass the same canonical intent
  // to every supplier. The provider adapters must not independently guess
  // whether "кульова опора — ліва сторона, передня вісь" means a ball joint,
  // a control arm, or a bushing.
  const resolvedGenericArticleId = genericArticleId || normalization.genericArticle?.id || knowledge.genericArticleId || null;
  const resolvedCanonicalCode = canonicalCode
    || normalization.genericArticle?.code
    || normalization.canonicalCode
    || knowledge.definition?.code
    || null;
  const resolvedPartName = normalization.genericArticle?.name
    || knowledge.definition?.canonicalName
    || normalization.canonicalName
    || partName;
  const resolvedAxis = axis || normalization.axis || knowledge.attributes.axis || null;
  const resolvedSide = side || normalization.side || knowledge.attributes.side || null;
  const resolvedSubPosition = subPosition || normalization.subPosition || knowledge.attributes.subPosition || null;
  const resolvedPosition = position || normalization.position || null;

  const supplierPromise = includeSuppliers
    ? searchConfiguredSuppliers(q, 20, {
        vehicleId,
        vin: rawVin,
        plate,
        fitmentStatus: fitment.status,
        fitmentConfidence: fitment.confidence,
        fitmentExact: fitment.exact,
        fitmentSource: fitment.catalog?.source || null,
        fitmentReason: fitment.reason,
        providerVehicle: fitment.providerVehicle,
        fitmentOffers: fitment.matches.flatMap((match) => match.offer ? [match.offer] : []),
        partName: resolvedPartName,
        canonicalCode: resolvedCanonicalCode,
        axis: resolvedAxis,
        side: resolvedSide,
        subPosition: resolvedSubPosition,
        position: resolvedPosition,
        genericArticleId: resolvedGenericArticleId,
        catalogArticles: fitment.catalogArticles,
        analogArticles: fitment.analogArticles,
        oeNumbers: fitment.oeNumbers,
        normalizedQuery: normalization.normalizedQuery,
        analogReferences: fitment.matches.map((match) => ({ brand: match.brand, article: match.article })).slice(0, 8),
      })
    : null;

  let vehicleContext = await rawVehicleContextPromise;
  if (!vehicleContext && fitment.vehicle?.vin && fitment.vehicle.vin !== rawVin) {
    vehicleContext = await decodeVehicleContext(fitment.vehicle.vin);
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
  const pricingPromise = displayVehicle ? resolveLaborPricing({
    make: displayVehicle.make || undefined,
    model: displayVehicle.model || undefined,
    year: displayVehicle.year == null ? undefined : String(displayVehicle.year),
    engine: displayVehicle.engine || undefined,
    engineVolume: displayVehicle.engineVolumeL == null ? undefined : String(displayVehicle.engineVolumeL),
    fuelType: displayVehicle.fuelType || undefined,
    bodyType: displayVehicle.bodyType || undefined,
    driveType: displayVehicle.driveType || undefined,
    vehicleType: displayVehicle.vehicleType || undefined,
  }) : Promise.resolve(null);
  const [pricing, supplierSearch] = await Promise.all([
    pricingPromise,
    supplierPromise || Promise.resolve(null),
  ]);
  const supplierOffers = supplierSearch ? await enrichOffersWithSellPrice(supplierSearch.offers) : null;
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
    context: {
      vehicleId,
      vin: rawVin || null,
      plate,
      findingId,
      manualPartId,
      partName: resolvedPartName,
      canonicalCode: resolvedCanonicalCode,
      genericArticleId: resolvedGenericArticleId,
      axis: resolvedAxis,
      side: resolvedSide,
      subPosition: resolvedSubPosition,
      position: resolvedPosition,
    },
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
    providers: supplierSearch?.providers || [
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
    ...(supplierSearch ? {
      offers: supplierOffers,
      suppliers: supplierSearch.supplierStatuses,
      supplierStatuses: supplierSearch.supplierStatuses,
      configuredSuppliers: supplierSearch.configuredSuppliers,
      supplierProviders: supplierSearch.providers,
      supplierSummary: {
        added: supplierSearch.supplierStatuses.length,
        configured: supplierSearch.configuredSuppliers.length,
        responded: supplierSearch.providers.filter((provider) => provider.ok).length,
        message: supplierSearch.configuredSuppliers.length
          ? supplierSearch.configuredSuppliers.length + " постачальник(и) мають збережені доступи; результат відповіді видно після пошуку."
          : "Постачальники додані, але доступи до API ще не налаштовані.",
      },
      supplierPricing: {
        basis: "SUPPLIER_DEFAULT_MARKUP",
        defaultMarkupPercent: 40,
        message: "Ціна продажу розраховується від закупівельної ціни за правилом постачальника; базове правило Turbo LEV — 40%.",
      },
      supplierSearchBlocked: supplierSearch.blocked,
      supplierSearchBlockReason: supplierSearch.blockReason,
      supplierSearchMode: supplierSearch.searchMode,
    } : {}),
  });
}
