import { normalizeVin, validateVin } from "@/src/domain/vin";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePartNeed } from "@/src/services/part-normalization.service";
import { resolvePartKnowledge } from "@/src/services/parts-knowledge.service";
import type { SupplierVehicleContext } from "@/src/services/suppliers/types";

export type PartFitmentStatus =
  | "VERIFIED"
  | "REFERENCE_ONLY"
  | "MANUAL_REQUIRED"
  | "CATALOG_NOT_CONNECTED"
  | "NO_MATCH";

export type PartOfferClass = "OEM" | "ANALOG" | "UNKNOWN";

export type PartSearchIntent = {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  axis?: string | null;
  genericArticleId?: string | null;
  position?: string | null;
  side?: string | null;
  subPosition?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  plate?: string | null;
};

export type CatalogFitmentMatch = {
  productId: string;
  article: string;
  brand: string | null;
  name: string;
  offerClass: PartOfferClass;
  oeNumbers: string[];
  position: string | null;
  imageUrl?: string | null;
  analogOfArticle?: string | null;
  vehicleMatch?: string | null;
  fitment: {
    status: "VERIFIED";
    confidence: number;
    source: string;
    sourceVersion: string | null;
    sourceFitmentId: string;
    reason: string;
  };
};

export type PartFitmentContext = {
  status: PartFitmentStatus;
  /**
   * True means the selected part can be auto-approved for the vehicle.
   * Supplier search results never set this value; only a canonical
   * VehicleCatalogLink + VehicleFitment match can do so.
   */
  confirmed: boolean;
  exact: boolean;
  confidence: number;
  reason: string;
  vehicle: {
    id: string | null;
    vin: string | null;
    brand: string | null;
    model: string | null;
    year: number | null;
  } | null;
  providerVehicle: SupplierVehicleContext | null;
  catalog: {
    vehicleReferenceId: string | null;
    fitmentKey: string;
    source: string;
    sourceVersion: string | null;
    status: string;
    exact: boolean;
  } | null;
  genericArticle: {
    id: string;
    code: string;
    name: string;
    slug: string;
  } | null;
  matches: CatalogFitmentMatch[];
  oeNumbers: string[];
  catalogArticles: string[];
  analogArticles: string[];
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeCatalogNumber(value: unknown) {
  return clean(value, 180).toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/giu, "");
}

export function normalizePartPosition(value: unknown) {
  const source = clean(value, 120).toLocaleLowerCase("uk-UA").replace(/[_-]+/g, " ");
  if (!source) return null;

  const front = /(front|перед|передн|передня|передній|передня)/u.test(source);
  const rear = /(rear|зад|задн|задня|задній)/u.test(source);
  const left = /(left|лів|ліва|лівою|лев|левая)/u.test(source);
  const right = /(right|прав|права|правою|правая)/u.test(source);
  const upper = /(upper|верх)/u.test(source);
  const lower = /(lower|нижн)/u.test(source);

  const axis = front ? "FRONT" : rear ? "REAR" : null;
  const side = left ? "LEFT" : right ? "RIGHT" : null;
  const vertical = upper ? "UPPER" : lower ? "LOWER" : null;
  return [axis, side, vertical].filter(Boolean).join("_") || source;
}

function intentPosition(intent: PartSearchIntent) {
  return [intent.position, intent.side]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

async function findGenericArticle(intent: PartSearchIntent) {
  const prisma = getPrisma();
  const genericArticleId = clean(intent.genericArticleId, 160);
  if (genericArticleId) {
    return prisma.genericArticle.findFirst({
      where: { id: genericArticleId, status: "ACTIVE" },
      select: { id: true, code: true, name: true, slug: true },
    });
  }

  const normalized = await normalizePartNeed({
    query: intent.query,
    partName: intent.partName,
    canonicalCode: intent.canonicalCode,
    genericArticleId: null,
    position: intentPosition(intent),
    axis: intent.axis,
    side: intent.side,
    subPosition: intent.subPosition,
  });
  if (normalized.genericArticle) return normalized.genericArticle;

  const knowledge = await resolvePartKnowledge({
    query: intent.query,
    partName: intent.partName,
    canonicalCode: intent.canonicalCode,
    position: intentPosition(intent),
    side: intent.side,
    subPosition: intent.subPosition,
  });
  if (knowledge.genericArticleId) {
    const linked = await prisma.genericArticle.findFirst({
      where: { id: knowledge.genericArticleId, status: "ACTIVE" },
      select: { id: true, code: true, name: true, slug: true },
    });
    if (linked) return linked;
  }

  const definition = knowledge.definition;
  const normalizedSlug = normalized.canonicalSlug?.trim();
  if (!definition && !normalizedSlug) return null;
  const conditions = [
    ...(definition ? [{ slug: { contains: definition.slug, mode: "insensitive" as const } }] : []),
    ...(normalizedSlug ? [{ slug: { contains: normalizedSlug, mode: "insensitive" as const } }] : []),
    ...(definition ? definition.aliases.map((term) => ({ name: { contains: term, mode: "insensitive" as const } })) : []),
    ...(normalized.canonicalName ? [{ name: { contains: normalized.canonicalName, mode: "insensitive" as const } }] : []),
  ];
  return prisma.genericArticle.findFirst({
    where: { status: "ACTIVE", OR: conditions },
    orderBy: { updatedAt: "desc" },
    select: { id: true, code: true, name: true, slug: true },
  });
}

export function fitmentPositionMatches(storedPosition: string | null, requestedPosition: string | null) {
  if (!requestedPosition) return true;
  if (!storedPosition) return false;
  const stored = normalizePartPosition(storedPosition);
  if (stored === requestedPosition) return true;

  const knownTokens = new Set(["FRONT", "REAR", "LEFT", "RIGHT", "UPPER", "LOWER"]);
  const requestedTokens = requestedPosition.split("_").filter((token) => knownTokens.has(token));
  const storedTokens = new Set(stored?.split("_") || []);
  return requestedTokens.length > 0 && requestedTokens.every((token) => storedTokens.has(token));
}

function classifyProduct(oeReferences: Array<{ relationType: string | null }>): PartOfferClass {
  if (oeReferences.some((reference) => /^(OE|OEM|ORIGINAL)$/iu.test(reference.relationType || ""))) return "OEM";
  return "UNKNOWN";
}

function confidenceValue(...values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length ? Math.min(...valid) : 80;
}

function emptyContext(status: PartFitmentStatus, reason: string, vehicle: PartFitmentContext["vehicle"] = null): PartFitmentContext {
  return {
    status,
    confirmed: false,
    exact: false,
    confidence: 0,
    reason,
    vehicle,
    providerVehicle: null,
    catalog: null,
    genericArticle: null,
    matches: [],
    oeNumbers: [],
    catalogArticles: [],
    analogArticles: [],
  };
}

export function buildModelScopedProviderVehicle(input: {
  vehicleId: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin?: string | null;
}): SupplierVehicleContext | null {
  const brand = clean(input.brand, 100);
  const model = clean(input.model, 180);
  if (!brand || !model) return null;
  return {
    provider: "bm-parts",
    vehicleKey: ["CRM", brand, model].join(":").slice(0, 240),
    externalVehicleId: null,
    externalSecurityKey: null,
    catalogCode: null,
    brand,
    model,
    variant: input.year == null ? null : String(input.year),
    confidence: 70,
    exact: false,
    source: "CRM_VEHICLE_MODEL_FILTER",
    sourceVersion: "crm-v1",
    rawEvidence: {
      vehicleId: input.vehicleId,
      foundBy: "crm_vehicle_model",
      year: input.year,
      vin: clean(input.vin, 40) || null,
    },
  };
}

export async function resolvePartFitment(intent: PartSearchIntent): Promise<PartFitmentContext> {
  const requestedVin = normalizeVin(clean(intent.vin, 40));
  const requestedPlate = normalizeRegistrationPlate(clean(intent.plate, 40));
  const vehicleId = clean(intent.vehicleId, 160);
  let vehicle: {
    id: string;
    vin: string | null;
    brand: string | null;
    model: string | null;
    year: number | null;
    catalogLink: {
      status: "PROVISIONAL" | "VERIFIED" | "STALE" | "CONFLICT";
      confidence: number;
      source: string;
      sourceVersion: string | null;
      vehicleReferenceId: string;
      vehicleReference: {
        status: "ACTIVE" | "DEPRECATED" | "MERGED" | "DISABLED";
        fitmentKey: string;
      };
    } | null;
  } | null = null;

  try {
    const prisma = getPrisma();
    vehicle = vehicleId
      ? await prisma.vehicle.findUnique({
          where: { id: vehicleId },
          select: {
            id: true,
            vin: true,
            brand: true,
            model: true,
            year: true,
            catalogLink: {
              select: {
                status: true,
                confidence: true,
                source: true,
                sourceVersion: true,
                vehicleReferenceId: true,
                vehicleReference: {
                  select: { status: true, fitmentKey: true },
                },
              },
            },
          },
        })
      : requestedVin
        ? await prisma.vehicle.findUnique({
            where: { vin: requestedVin },
            select: {
              id: true,
              vin: true,
              brand: true,
              model: true,
              year: true,
              catalogLink: {
                select: {
                  status: true,
                  confidence: true,
                  source: true,
                  sourceVersion: true,
                  vehicleReferenceId: true,
                  vehicleReference: {
                    select: { status: true, fitmentKey: true },
                  },
                },
              },
            },
          })
        : requestedPlate
          ? await prisma.vehicle.findFirst({
              where: {
                OR: [
                  { plateNormalized: requestedPlate },
                  { plateNumber: { equals: clean(intent.plate, 40), mode: "insensitive" } },
                ],
              },
              orderBy: { updatedAt: "desc" },
              select: {
                id: true,
                vin: true,
                brand: true,
                model: true,
                year: true,
                catalogLink: {
                  select: {
                    status: true,
                    confidence: true,
                    source: true,
                    sourceVersion: true,
                    vehicleReferenceId: true,
                    vehicleReference: {
                      select: { status: true, fitmentKey: true },
                    },
                  },
                },
              },
            })
          : null;
  } catch (error) {
    console.warn("Parts fitment context could not read catalog tables", error);
    return emptyContext("CATALOG_NOT_CONNECTED", "Канонічний каталог OE/сумісності ще не підключений до CRM.");
  }

  const vehicleSummary = vehicle
    ? {
        id: vehicle.id,
        vin: vehicle.vin || requestedVin || null,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
      }
    : null;

  if (!vehicle) {
    return emptyContext(
      requestedVin || requestedPlate ? "MANUAL_REQUIRED" : "REFERENCE_ONLY",
      requestedVin
        ? "Автомобіль з таким VIN не знайдено в CRM. Перевірте VIN у картці авто."
        : requestedPlate
          ? "Автомобіль з таким держномером не знайдено в CRM. Перевірте номер у картці авто."
          : "Пошук виконано без ідентифікованого автомобіля.",
      null,
    );
  }
  if (!vehicleSummary) {
    return emptyContext("MANUAL_REQUIRED", "Не вдалося сформувати контекст автомобіля.", null);
  }

  const identityVin = normalizeVin(vehicle.vin || requestedVin);
  const vinValidation = validateVin(identityVin);
  const hasValidVin = vinValidation.formatValid
    && !(vinValidation.northAmerican && vinValidation.checkDigit.status === "INVALID");

  let genericArticle: Awaited<ReturnType<typeof findGenericArticle>> = null;
  try {
    genericArticle = await findGenericArticle(intent);
  } catch (error) {
    console.warn("Generic article lookup failed", error);
  }

  // Supplier adapters never establish fitment. They may provide price/stock only
  // after the canonical CRM catalog has verified this vehicle and article.
  const providerVehicle: SupplierVehicleContext | null = null;
  const link = vehicle.catalogLink;
  const hasVerifiedCatalogLink = Boolean(
    link
    && link.status === "VERIFIED"
    && link.vehicleReference.status === "ACTIVE",
  );

  if (!hasValidVin && !providerVehicle && !hasVerifiedCatalogLink) {
    return emptyContext(
      "MANUAL_REQUIRED",
      "У картці автомобіля немає коректного VIN і немає підтвердженого зв’язку з OE-каталогом.",
      vehicleSummary,
    );
  }

  if (!link || link.status !== "VERIFIED" || link.vehicleReference.status !== "ACTIVE") {
    return {
      ...emptyContext(
        "CATALOG_NOT_CONNECTED",
        "VIN визначив автомобіль, але для нього немає підтвердженого зв’язку з OE-каталогом.",
        vehicleSummary,
      ),
      providerVehicle,
      confidence: link?.confidence || 0,
      catalog: link
        ? {
            vehicleReferenceId: link.vehicleReferenceId,
            fitmentKey: link.vehicleReference.fitmentKey,
            source: link.source,
            sourceVersion: link.sourceVersion,
            status: link.status,
            exact: false,
          }
        : null,
    };
  }

  const catalog = {
    vehicleReferenceId: link.vehicleReferenceId,
    fitmentKey: link.vehicleReference.fitmentKey,
    source: link.source,
    sourceVersion: link.sourceVersion,
    status: link.status,
    exact: true,
  };

  if (!genericArticle) {
    return {
      ...emptyContext(
        "NO_MATCH",
        "Не вдалося однозначно зіставити назву деталі з товарною групою каталогу. Оберіть OEM-номер або виконайте ручну перевірку.",
        vehicleSummary,
      ),
      confidence: link.confidence,
      catalog,
      genericArticle: null,
      providerVehicle,
    };
  }

  try {
    const prisma = getPrisma();
    const fitments = await prisma.vehicleFitment.findMany({
      where: {
        vehicleReferenceId: link.vehicleReferenceId,
        status: "ACTIVE",
        OR: [
          { genericArticleId: genericArticle.id },
          { genericArticleId: null, product: { genericArticleId: genericArticle.id } },
        ],
        product: {
          status: "ACTIVE",
          brand: { status: "ACTIVE" },
        },
      },
      select: {
        productId: true,
        position: true,
        confidence: true,
        source: true,
        sourceVersion: true,
        sourceFitmentId: true,
        product: {
          select: {
            id: true,
            status: true,
            mpnRaw: true,
            title: true,
            brand: { select: { canonicalName: true, status: true } },
            oeReferences: {
              select: {
                oeNumberRaw: true,
                relationType: true,
                confidence: true,
              },
            },
            crossFrom: {
              select: {
                type: true,
                confidence: true,
                toProduct: {
                  select: {
                    id: true,
                    status: true,
                    mpnRaw: true,
                    title: true,
                    brand: { select: { canonicalName: true, status: true } },
                    oeReferences: {
                      select: {
                        oeNumberRaw: true,
                        relationType: true,
                        confidence: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      take: 200,
    });

    const requestedPosition = normalizePartPosition(intentPosition(intent));
    const matches: CatalogFitmentMatch[] = [];
    const seen = new Set<string>();

    for (const fitment of fitments) {
      if (!fitmentPositionMatches(fitment.position, requestedPosition)) continue;
      const primary = fitment.product;
      if (primary.status !== "ACTIVE" || primary.brand.status !== "ACTIVE") continue;
      const primaryKey = "OEM:" + primary.id;
      if (!seen.has(primaryKey)) {
        seen.add(primaryKey);
        const oeNumbers = primary.oeReferences.map((reference) => reference.oeNumberRaw.trim()).filter(Boolean);
        matches.push({
          productId: primary.id,
          article: primary.mpnRaw,
          brand: primary.brand.canonicalName,
          name: primary.title,
          offerClass: classifyProduct(primary.oeReferences),
          oeNumbers,
          position: fitment.position,
          fitment: {
            status: "VERIFIED",
            confidence: confidenceValue(link.confidence, fitment.confidence, ...primary.oeReferences.map((reference) => reference.confidence)),
            source: fitment.source,
            sourceVersion: fitment.sourceVersion,
            sourceFitmentId: fitment.sourceFitmentId,
            reason: "Застосовність підтверджена записом VehicleFitment для конкретного VIN-профілю.",
          },
        });
      }

      for (const cross of primary.crossFrom) {
        if (!["EQUIVALENT", "REPLACEMENT", "SUPERSEDES", "ALTERNATIVE"].includes(cross.type)) continue;
        const analog = cross.toProduct;
        if (analog.status !== "ACTIVE" || analog.brand.status !== "ACTIVE") continue;
        const analogKey = "ANALOG:" + analog.id;
        if (seen.has(analogKey)) continue;
        seen.add(analogKey);
        const oeNumbers = analog.oeReferences.map((reference) => reference.oeNumberRaw.trim()).filter(Boolean);
        matches.push({
          productId: analog.id,
          article: analog.mpnRaw,
          brand: analog.brand.canonicalName,
          name: analog.title,
          offerClass: "ANALOG",
          oeNumbers,
          position: fitment.position,
          analogOfArticle: primary.mpnRaw,
          fitment: {
            status: "VERIFIED",
            confidence: confidenceValue(link.confidence, fitment.confidence, cross.confidence, ...analog.oeReferences.map((reference) => reference.confidence)),
            source: fitment.source,
            sourceVersion: fitment.sourceVersion,
            sourceFitmentId: fitment.sourceFitmentId,
            reason: "Аналог отриманий через підтверджений крос-номер канонічного каталогу.",
          },
        });
      }
    }

    if (!matches.length) {
      return {
        ...emptyContext(
          "NO_MATCH",
          "Для цього автомобіля й позиції в каталозі не знайдено підтверджених деталей. Не використовуйте загальний список без ручної перевірки.",
          vehicleSummary,
        ),
        confidence: link.confidence,
        catalog,
        genericArticle,
        providerVehicle,
      };
    }

    const catalogArticles = [...new Set(matches.map((match) => normalizeCatalogNumber(match.article)).filter(Boolean))];
    const oeNumbers = [...new Set(matches.flatMap((match) => match.oeNumbers.map(normalizeCatalogNumber)).filter(Boolean))];
    const analogArticles = [...new Set(matches.filter((match) => match.offerClass === "ANALOG").map((match) => normalizeCatalogNumber(match.article)).filter(Boolean))];

    return {
      status: "VERIFIED",
      confirmed: true,
      exact: true,
      confidence: Math.min(100, Math.max(...matches.map((match) => match.fitment.confidence))),
      reason: "Знайдено деталі, сумісність яких підтверджена VIN-профілем у канонічному каталозі.",
      vehicle: vehicleSummary,
      providerVehicle,
      catalog,
      genericArticle,
      matches,
      oeNumbers,
      catalogArticles,
      analogArticles,
    };
  } catch (error) {
    console.warn("Vehicle fitment lookup failed", error);
    return {
      ...emptyContext("CATALOG_NOT_CONNECTED", "Каталог OE/сумісності не відповів або ще не має імпортованих даних.", vehicleSummary),
      confidence: link.confidence,
      catalog,
      genericArticle,
      providerVehicle,
    };
  }
}
