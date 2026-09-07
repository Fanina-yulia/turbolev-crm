import { normalizeVin, validateVin } from "@/src/domain/vin";
import { getPrisma } from "@/src/lib/prisma";

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
  genericArticleId?: string | null;
  position?: string | null;
  side?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
};

export type CatalogFitmentMatch = {
  productId: string;
  article: string;
  brand: string | null;
  name: string;
  offerClass: PartOfferClass;
  oeNumbers: string[];
  position: string | null;
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
  confirmed: boolean;
  confidence: number;
  reason: string;
  vehicle: {
    id: string | null;
    vin: string | null;
    brand: string | null;
    model: string | null;
    year: number | null;
  } | null;
  catalog: {
    vehicleReferenceId: string;
    fitmentKey: string;
    source: string;
    sourceVersion: string | null;
    status: string;
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

const GENERIC_ARTICLE_ALIASES = [
  {
    slug: "ball-joint",
    terms: ["шарова опора", "кульова опора", "шаровая опора", "ball joint", "ball-joint"],
  },
  {
    slug: "shock-absorber",
    terms: ["амортизатор", "shock absorber", "shock-absorber"],
  },
  {
    slug: "brake-pad",
    terms: ["гальмівні колодки", "тормозные колодки", "brake pad", "brake-pad"],
  },
  {
    slug: "wheel-bearing",
    terms: ["ступичний підшипник", "ступичный подшипник", "wheel bearing", "wheel-bearing"],
  },
  {
    slug: "control-arm-bushing",
    terms: ["сайлентблок", "сайлентблок важеля", "control arm bushing", "control-arm-bushing"],
  },
  {
    slug: "coil-spring",
    terms: ["пружина", "пружина підвіски", "coil spring", "coil-spring"],
  },
] as const;

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

function aliasForIntent(intent: PartSearchIntent) {
  const source = [intent.partName, intent.query].filter(Boolean).join(" ").toLocaleLowerCase("uk-UA");
  return GENERIC_ARTICLE_ALIASES.find((alias) => alias.terms.some((term) => source.includes(term.toLocaleLowerCase("uk-UA")))) || null;
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

  const alias = aliasForIntent(intent);
  if (!alias) return null;
  const conditions = [
    { slug: { contains: alias.slug, mode: "insensitive" as const } },
    ...alias.terms.map((term) => ({ name: { contains: term, mode: "insensitive" as const } })),
  ];
  return prisma.genericArticle.findFirst({
    where: { status: "ACTIVE", OR: conditions },
    orderBy: { updatedAt: "desc" },
    select: { id: true, code: true, name: true, slug: true },
  });
}

function fitmentPositionMatches(storedPosition: string | null, requestedPosition: string | null) {
  if (!requestedPosition || !storedPosition) return true;
  return normalizePartPosition(storedPosition) === requestedPosition;
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
    confidence: 0,
    reason,
    vehicle,
    catalog: null,
    genericArticle: null,
    matches: [],
    oeNumbers: [],
    catalogArticles: [],
    analogArticles: [],
  };
}

export async function resolvePartFitment(intent: PartSearchIntent): Promise<PartFitmentContext> {
  const requestedVin = normalizeVin(clean(intent.vin, 40));
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
      requestedVin ? "MANUAL_REQUIRED" : "REFERENCE_ONLY",
      requestedVin
        ? "Автомобіль з таким VIN не знайдено в CRM. Перевірте VIN у картці авто."
        : "Пошук виконано без ідентифікованого автомобіля.",
      null,
    );
  }

  const identityVin = normalizeVin(vehicle.vin || requestedVin);
  const vinValidation = validateVin(identityVin);
  if (!vinValidation.formatValid) {
    return emptyContext("MANUAL_REQUIRED", "У картці автомобіля немає коректного 17-символьного VIN.", vehicleSummary);
  }

  const link = vehicle.catalogLink;
  if (!link || link.status !== "VERIFIED" || link.vehicleReference.status !== "ACTIVE") {
    return {
      ...emptyContext(
        "CATALOG_NOT_CONNECTED",
        "VIN визначив автомобіль, але для нього немає підтвердженого зв’язку з канонічним каталогом OE.",
        vehicleSummary,
      ),
      confidence: link?.confidence || 0,
      catalog: link
        ? {
            vehicleReferenceId: link.vehicleReferenceId,
            fitmentKey: link.vehicleReference.fitmentKey,
            source: link.source,
            sourceVersion: link.sourceVersion,
            status: link.status,
          }
        : null,
    };
  }

  let genericArticle: Awaited<ReturnType<typeof findGenericArticle>> = null;
  try {
    genericArticle = await findGenericArticle(intent);
  } catch (error) {
    console.warn("Generic article lookup failed", error);
    return emptyContext("CATALOG_NOT_CONNECTED", "Каталог деталей тимчасово недоступний для пошуку.", vehicleSummary);
  }

  const catalog = {
    vehicleReferenceId: link.vehicleReferenceId,
    fitmentKey: link.vehicleReference.fitmentKey,
    source: link.source,
    sourceVersion: link.sourceVersion,
    status: link.status,
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
    };
  }

  try {
    const prisma = getPrisma();
    const fitments = await prisma.vehicleFitment.findMany({
      where: {
        vehicleReferenceId: link.vehicleReferenceId,
        genericArticleId: genericArticle.id,
        status: "ACTIVE",
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
            mpnRaw: true,
            title: true,
            brand: { select: { canonicalName: true } },
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
                    mpnRaw: true,
                    title: true,
                    brand: { select: { canonicalName: true } },
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

    const requestedPosition = normalizePartPosition(intent.position || intent.side);
    const matches: CatalogFitmentMatch[] = [];
    const seen = new Set<string>();

    for (const fitment of fitments) {
      if (!fitmentPositionMatches(fitment.position, requestedPosition)) continue;
      const primary = fitment.product;
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
      };
    }

    const catalogArticles = [...new Set(matches.map((match) => normalizeCatalogNumber(match.article)).filter(Boolean))];
    const oeNumbers = [...new Set(matches.flatMap((match) => match.oeNumbers.map(normalizeCatalogNumber)).filter(Boolean))];
    const analogArticles = [...new Set(matches.filter((match) => match.offerClass === "ANALOG").map((match) => normalizeCatalogNumber(match.article)).filter(Boolean))];

    return {
      status: "VERIFIED",
      confirmed: true,
      confidence: Math.min(100, Math.max(...matches.map((match) => match.fitment.confidence))),
      reason: "Знайдено деталі, сумісність яких підтверджена VIN-профілем у канонічному каталозі.",
      vehicle: vehicleSummary,
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
    };
  }
}
