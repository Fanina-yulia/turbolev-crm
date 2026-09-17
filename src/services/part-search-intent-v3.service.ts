import { getPartPackageRule, type PartPackageRule } from "@/src/services/part-operation-catalog.service";
import { resolvePartTerminology } from "@/src/services/parts-terminology.service";

export const PARTS_SEARCH_V3_ALGORITHM = "EVIDENCE_FIRST_V3" as const;

export type SearchAxis = "FRONT" | "REAR" | null;
export type SearchSide = "LEFT" | "RIGHT" | null;
export type SearchSubPosition = "FRONT" | "REAR" | "UPPER" | "LOWER" | null;
export type SearchSourceType = "DIAGNOSTIC" | "DIRECT_REPAIR" | "MANUAL_SEARCH" | "PROCUREMENT";

export type PartSearchIntentV3 = {
  version: "3.0";
  algorithm: typeof PARTS_SEARCH_V3_ALGORITHM;
  vehicle: {
    vehicleId: string | null;
    vin: string | null;
    plate: string | null;
    make: string | null;
    model: string | null;
    generation: string | null;
    year: number | null;
    engineCode: string | null;
    engineVolume: number | null;
    fuelType: string | null;
    driveType: string | null;
    bodyType: string | null;
  };
  part: {
    originalText: string;
    genericArticleId: string | null;
    canonicalCode: string | null;
    canonicalName: string;
    axis: SearchAxis;
    side: SearchSide;
    subPosition: SearchSubPosition;
    position: string | null;
  };
  quantity: {
    requested: number;
    soldAs: PartPackageRule["soldAs"];
    scope: PartPackageRule["coverage"];
  };
  policy: {
    axisSensitive: boolean;
    sideSensitive: boolean;
    sideIgnoredByCommercialScope: boolean;
    requiresVin: boolean;
  };
  source: {
    type: SearchSourceType;
    sourceId: string | null;
  };
};

export type BuildPartSearchIntentV3Input = {
  query?: string | null;
  partName?: string | null;
  genericArticleId?: string | null;
  canonicalCode?: string | null;
  canonicalName?: string | null;
  axis?: string | null;
  side?: string | null;
  subPosition?: string | null;
  position?: string | null;
  quantity?: number | null;
  vehicleId?: string | null;
  vin?: string | null;
  plate?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleGeneration?: string | null;
  vehicleYear?: number | null;
  engineCode?: string | null;
  engineVolume?: number | null;
  fuelType?: string | null;
  driveType?: string | null;
  bodyType?: string | null;
  sourceType?: SearchSourceType;
  sourceId?: string | null;
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function axisValue(value: unknown): SearchAxis {
  const source = clean(value, 80).toLocaleUpperCase("uk-UA");
  if (source === "FRONT" || /ПЕРЕД/u.test(source)) return "FRONT";
  if (source === "REAR" || /ЗАД/u.test(source)) return "REAR";
  return null;
}

function sideValue(value: unknown): SearchSide {
  const source = clean(value, 80).toLocaleUpperCase("uk-UA");
  if (source === "LEFT" || /ЛІВ|ЛЕВ/u.test(source)) return "LEFT";
  if (source === "RIGHT" || /ПРАВ/u.test(source)) return "RIGHT";
  return null;
}

function subPositionValue(value: unknown): SearchSubPosition {
  const source = clean(value, 80).toLocaleUpperCase("uk-UA");
  if (source === "FRONT" || /ПЕРЕД/u.test(source)) return "FRONT";
  if (source === "REAR" || /ЗАД/u.test(source)) return "REAR";
  if (source === "UPPER" || /ВЕРХ/u.test(source)) return "UPPER";
  if (source === "LOWER" || /НИЖ/u.test(source)) return "LOWER";
  return null;
}

function quantityValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.min(999, parsed));
}

export function resolvePositionPolicyV3(input: {
  canonicalCode?: string | null;
  partName?: string | null;
  axis?: string | null;
  side?: string | null;
  position?: string | null;
  subPosition?: string | null;
  quantity?: number | null;
}) {
  const terminology = resolvePartTerminology({
    query: input.partName,
    partName: input.partName,
    canonicalCode: input.canonicalCode,
    axis: input.axis,
    side: input.side,
    position: input.position,
    subPosition: input.subPosition,
  });
  const canonicalCode = clean(input.canonicalCode, 80).toUpperCase() || terminology.definition?.code || null;
  const packageRule = getPartPackageRule({
    canonicalCode,
    partName: input.partName,
    axis: input.axis,
    side: input.side,
    position: input.position,
    subPosition: input.subPosition,
    quantityHint: input.quantity,
  });

  const axis = axisValue(input.axis) || terminology.attributes.axis || axisValue(input.position);
  const rawSide = sideValue(input.side) || terminology.attributes.side || sideValue(input.position);
  const subPosition = subPositionValue(input.subPosition) || terminology.attributes.subPosition;
  const sideIgnoredByCommercialScope = packageRule.coverage === "AXLE"
    || packageRule.coverage === "VEHICLE"
    || packageRule.coverage === "FLUID";
  const sideSensitive = !sideIgnoredByCommercialScope
    && ["WHEEL", "SIDE"].includes(packageRule.coverage);
  const normalizedSide = sideSensitive ? rawSide : null;
  const axisSensitive = packageRule.coverage === "AXLE"
    || packageRule.coverage === "WHEEL"
    || packageRule.coverage === "SIDE";

  return {
    canonicalCode,
    canonicalName: terminology.definition?.canonicalName || clean(input.partName) || canonicalCode || "Деталь",
    axis,
    side: normalizedSide,
    rawSide,
    subPosition,
    position: clean(input.position, 120) || null,
    packageRule,
    axisSensitive,
    sideSensitive,
    sideIgnoredByCommercialScope,
  };
}

export function buildPartSearchIntentV3(input: BuildPartSearchIntentV3Input): PartSearchIntentV3 {
  const originalText = clean(input.partName || input.query, 240) || "Деталь";
  const positionPolicy = resolvePositionPolicyV3({
    canonicalCode: input.canonicalCode,
    partName: originalText,
    axis: input.axis,
    side: input.side,
    position: input.position,
    subPosition: input.subPosition,
    quantity: input.quantity,
  });

  return {
    version: "3.0",
    algorithm: PARTS_SEARCH_V3_ALGORITHM,
    vehicle: {
      vehicleId: clean(input.vehicleId, 160) || null,
      vin: clean(input.vin, 40) || null,
      plate: clean(input.plate, 40) || null,
      make: clean(input.vehicleMake, 120) || null,
      model: clean(input.vehicleModel, 180) || null,
      generation: clean(input.vehicleGeneration, 120) || null,
      year: typeof input.vehicleYear === "number" && Number.isFinite(input.vehicleYear) ? input.vehicleYear : null,
      engineCode: clean(input.engineCode, 80) || null,
      engineVolume: typeof input.engineVolume === "number" && Number.isFinite(input.engineVolume) ? input.engineVolume : null,
      fuelType: clean(input.fuelType, 80) || null,
      driveType: clean(input.driveType, 80) || null,
      bodyType: clean(input.bodyType, 80) || null,
    },
    part: {
      originalText,
      genericArticleId: clean(input.genericArticleId, 160) || null,
      canonicalCode: positionPolicy.canonicalCode,
      canonicalName: clean(input.canonicalName, 180) || positionPolicy.canonicalName,
      axis: positionPolicy.axis,
      side: positionPolicy.side,
      subPosition: positionPolicy.subPosition,
      position: positionPolicy.position,
    },
    quantity: {
      requested: quantityValue(input.quantity),
      soldAs: positionPolicy.packageRule.soldAs,
      scope: positionPolicy.packageRule.coverage,
    },
    policy: {
      axisSensitive: positionPolicy.axisSensitive,
      sideSensitive: positionPolicy.sideSensitive,
      sideIgnoredByCommercialScope: positionPolicy.sideIgnoredByCommercialScope,
      requiresVin: positionPolicy.packageRule.canonicalCode !== null,
    },
    source: {
      type: input.sourceType || "MANUAL_SEARCH",
      sourceId: clean(input.sourceId, 160) || null,
    },
  };
}
