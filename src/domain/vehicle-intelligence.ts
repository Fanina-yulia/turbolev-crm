export type VehicleType =
  | "PASSENGER"
  | "CROSSOVER"
  | "SUV"
  | "MINIVAN"
  | "VAN_SMALL"
  | "VAN"
  | "VAN_LARGE"
  | "COMMERCIAL_HEAVY"
  | "UNKNOWN";

export type TurboLevClass =
  | "L1"
  | "L2"
  | "L3"
  | "C1"
  | "S1"
  | "M1"
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "UNKNOWN";

export type ClassificationSource =
  | "CRM"
  | "EXTERNAL_PLATE"
  | "VIN_DECODER"
  | "RULES"
  | "MANUAL"
  | "UNKNOWN";

export type VehicleTechnicalInput = {
  make?: string;
  model?: string;
  year?: string;
  engine?: string;
  engineVolume?: string;
  fuelType?: string;
  bodyType?: string;
  grossWeight?: string;
  driveType?: string;
  vehicleType?: VehicleType | string;
};

export type VehicleClassification = {
  vehicleType: VehicleType;
  turboLevClass: TurboLevClass;
  priceCoefficient: number;
  source: ClassificationSource;
  confidence: number;
  reason: string;
};

export type VehicleLookupResult = VehicleTechnicalInput & {
  plate: string;
  vin?: string;
  source: "CRM" | "EXTERNAL_PLATE" | "VIN_DECODER";
  confidence: number;
};

export interface VehicleLookupProvider {
  readonly name: string;
  lookupByPlate(plate: string): Promise<VehicleLookupResult | null>;
}

export const TURBO_LEV_CLASS_LABELS: Record<TurboLevClass, string> = {
  L1: "Легковий ≤ 1.6",
  L2: "Легковий 1.7–2.5",
  L3: "Легковий > 2.5",
  C1: "Кросовер",
  S1: "Позашляховик / SUV / пікап",
  M1: "Мінівен / MPV",
  V1: "Малий бус",
  V2: "Бус",
  V3: "Великий бус",
  V4: "Дуже великий / комерційний",
  UNKNOWN: "Не визначено",
};

/**
 * Central price policy for labour only. Parts must never be multiplied by
 * this coefficient. Keep all future labour calculators tied to this map so
 * one policy change updates the whole CRM.
 */
export const TURBO_LEV_CLASS_COEFFICIENTS: Record<TurboLevClass, number> = {
  L1: 1,
  L2: 1.1,
  L3: 1.15,
  C1: 1.15,
  S1: 1.2,
  M1: 1.15,
  V1: 1.2,
  V2: 1.35,
  V3: 1.5,
  V4: 1.65,
  UNKNOWN: 1,
};

export const VEHICLE_CLASS_AUTO_APPLY_CONFIDENCE = 85;

export type LabourPriceAdjustment = {
  basePrice: number;
  suggestedCoefficient: number;
  appliedCoefficient: number;
  adjustedPrice: number;
  surcharge: number;
  autoApplied: boolean;
  requiresConfirmation: boolean;
};

type Inference = {
  vehicleType: VehicleType;
  confidence: number;
  reason: string;
};

type ModelRule = {
  vehicleType: VehicleType;
  models: readonly string[];
  reason: string;
};

// Ordered from the most specific commercial platforms to broader passenger
// categories. This intentionally fixes MVS cases where a crossover is stored
// only as "легковий / універсал" (Toyota Venza is a common example).
const MODEL_TYPE_RULES: readonly ModelRule[] = [
  {
    vehicleType: "VAN_SMALL",
    reason: "Модель належить до класу малих фургонів / компактних бусів",
    models: [
      "transit connect", "caddy", "berlingo", "partner", "rifter", "kangoo",
      "townstar", "doblo", "combo", "dokker", "proace city", "nv200",
      "evalia", "bipper", "nemo", "fiorino",
    ],
  },
  {
    vehicleType: "VAN",
    reason: "Модель належить до середньорозмірних бусів",
    models: [
      "transit custom", "transporter", "multivan", "caravelle", "vito", "viano",
      "trafic", "vivaro", "expert", "jumpy", "scudo", "proace", "talento",
      "nv300", "primastar",
    ],
  },
  {
    vehicleType: "VAN_LARGE",
    reason: "Модель належить до великих бусів / великого комерційного транспорту",
    models: [
      "sprinter", "crafter", "ducato", "boxer", "jumper", "master", "movano",
      "daily", "interstar", "transit",
    ],
  },
  {
    vehicleType: "MINIVAN",
    reason: "Модель належить до мінівенів / MPV",
    models: [
      "s-max", "s max", "galaxy", "touran", "sharan", "alhambra", "zafira",
      "c4 picasso", "grand c4 picasso", "c4 spacetourer", "scenic", "grand scenic",
      "espace", "odyssey", "sienna", "previa", "verso", "avensis verso", "freemont",
      "voyager", "pacifica", "carnival", "carens", "multipla", "b-max", "b max",
    ],
  },
  {
    vehicleType: "SUV",
    reason: "Модель належить до великих SUV / рамних позашляховиків / пікапів",
    models: [
      "land cruiser", "prado", "sequoia", "4runner", "4 runner", "highlander",
      "pajero", "montero", "patrol", "pathfinder", "armada", "terrano",
      "touareg", "q7", "q8", "x5", "x6", "x7", "gle", "gls", "g class",
      "g-class", "gl class", "gl-class", "xc90", "cayenne", "range rover",
      "discovery", "defender", "grand cherokee", "commander", "wrangler",
      "tahoe", "suburban", "escalade", "navigator", "expedition", "explorer",
      "sorento", "telluride", "santa fe", "palisade", "pilot", "passport",
      "cx-9", "cx 9", "cx-90", "cx 90", "kodiaq", "atlas", "teramont",
      "lx470", "lx 470", "lx570", "lx 570", "lx600", "lx 600", "gx460", "gx 460",
      "gx470", "gx 470", "model x", "hilux", "ranger", "amarok", "navara",
      "frontier", "l200", "triton", "d-max", "d max", "bt-50", "bt 50",
      "ram 1500", "ram 2500", "f-150", "f 150", "silverado", "tundra",
    ],
  },
  {
    vehicleType: "CROSSOVER",
    reason: "Модель визначена як кросовер",
    models: [
      "venza", "rav4", "rav 4", "c-hr", "c hr", "corolla cross", "yaris cross",
      "qashqai", "x-trail", "x trail", "juke", "murano", "rogue",
      "cr-v", "cr v", "hr-v", "hr v", "zr-v", "zr v", "element",
      "tucson", "kona", "ix35", "sportage", "niro", "seltos",
      "tiguan", "t-roc", "t roc", "t-cross", "t cross", "taos",
      "kuga", "escape", "edge", "ecosport", "puma", "mokka", "antara",
      "captiva", "equinox", "tracker", "trax", "trailblazer",
      "cx-3", "cx 3", "cx-30", "cx 30", "cx-5", "cx 5", "cx-50", "cx 50", "cx-60", "cx 60",
      "outlander", "asx", "eclipse cross", "forester", "outback", "xv", "crosstrek",
      "duster", "koleos", "kadjar", "arkana", "austral", "500x",
      "vitara", "grand vitara", "s-cross", "s cross", "sx4", "sx 4",
      "compass", "renegade", "cherokee", "avenger",
      "x1", "x2", "x3", "x4", "q2", "q3", "q4", "q5", "gla", "glb", "glc",
      "xc40", "xc60", "macan", "nx200", "nx 200", "nx300", "nx 300", "nx350", "nx 350",
      "rx300", "rx 300", "rx350", "rx 350", "rx450", "rx 450", "ux200", "ux 200",
      "model y", "enyaq", "karoq", "kamiq", "ateca", "formentor",
    ],
  },
];

export function parseNumber(value?: string) {
  if (!value) return 0;
  const normalized = value.replace(",", ".").replace(/[^0-9.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function inferEngineVolume(engine?: string) {
  if (!engine) return "";
  const match = engine.replace(",", ".").match(/\b([0-9]\.[0-9])\b/);
  return match?.[1] ?? "";
}

function normalizeText(value?: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/[^a-zа-яіїє0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(value: string, words: readonly string[]) {
  return words.some((word) => value.includes(normalizeText(word)));
}

function explicitVehicleType(input: VehicleTechnicalInput): VehicleType | null {
  const explicit = (input.vehicleType ?? "").toUpperCase() as VehicleType;
  return [
    "PASSENGER",
    "CROSSOVER",
    "SUV",
    "MINIVAN",
    "VAN_SMALL",
    "VAN",
    "VAN_LARGE",
    "COMMERCIAL_HEAVY",
  ].includes(explicit) ? explicit : null;
}

function inferFromModel(input: VehicleTechnicalInput): Inference | null {
  const model = normalizeText(input.model);
  if (!model) return null;

  for (const rule of MODEL_TYPE_RULES) {
    if (rule.models.some((signature) => model.includes(normalizeText(signature)))) {
      return { vehicleType: rule.vehicleType, confidence: 95, reason: rule.reason };
    }
  }
  return null;
}

function inferVehicleTypeDetailed(input: VehicleTechnicalInput): Inference {
  const explicit = explicitVehicleType(input);
  if (explicit) {
    return {
      vehicleType: explicit,
      confidence: 100,
      reason: "Тип транспортного засобу задано у картці автомобіля",
    };
  }

  const grossWeight = parseNumber(input.grossWeight);
  if (grossWeight > 5000) {
    return {
      vehicleType: "COMMERCIAL_HEAVY",
      confidence: 98,
      reason: `Повна маса ${Math.round(grossWeight)} кг > 5000 кг`,
    };
  }

  const modelInference = inferFromModel(input);
  if (modelInference) return modelInference;

  const text = normalizeText(`${input.make ?? ""} ${input.model ?? ""} ${input.bodyType ?? ""} ${input.vehicleType ?? ""}`);

  if (containsAny(text, ["pickup", "pick up", "пікап" ])) {
    return { vehicleType: "SUV", confidence: 92, reason: "Тип кузова визначено як пікап" };
  }

  if (containsAny(text, ["crossover", "cuv", "кросовер"])) {
    return { vehicleType: "CROSSOVER", confidence: 92, reason: "Тип кузова визначено як кросовер / CUV" };
  }

  if (containsAny(text, ["sport utility", "suv", "off road", "offroad", "позашляховик", "джип"])) {
    return { vehicleType: "SUV", confidence: 91, reason: "Тип кузова визначено як SUV / позашляховик" };
  }

  if (containsAny(text, ["minivan", "mini van", "mpv", "мінівен", "мінівен" ])) {
    return { vehicleType: "MINIVAN", confidence: 90, reason: "Тип кузова визначено як мінівен / MPV" };
  }

  const commercialText = containsAny(text, [
    "cargo van", "passenger van", "van", "microbus", "minibus", "фургон",
    "мікроавтобус", "автобус", "бус", "вантажний", "вантажопасажирський",
  ]);

  if (commercialText) {
    if (grossWeight > 3500) {
      return {
        vehicleType: "VAN_LARGE",
        confidence: 96,
        reason: `Комерційний тип кузова та повна маса ${Math.round(grossWeight)} кг > 3500 кг`,
      };
    }
    if (grossWeight > 0 && grossWeight <= 2500) {
      return {
        vehicleType: "VAN_SMALL",
        confidence: 91,
        reason: `Комерційний тип кузова та повна маса ${Math.round(grossWeight)} кг`,
      };
    }
    return { vehicleType: "VAN", confidence: 88, reason: "Тип ТЗ визначено як бус / фургон" };
  }

  if (containsAny(text, [
    "легковий", "passenger car", "sedan", "hatchback", "wagon", "estate", "coupe",
    "convertible", "універсал", "седан", "хетчбек", "купе",
  ])) {
    return { vehicleType: "PASSENGER", confidence: 86, reason: "Тип ТЗ визначено як легковий" };
  }

  return {
    vehicleType: "PASSENGER",
    confidence: 62,
    reason: "Тип кузова не підтверджено; тимчасово використано легковий клас",
  };
}

export function inferVehicleType(input: VehicleTechnicalInput): VehicleType {
  return inferVehicleTypeDetailed(input).vehicleType;
}

export function classifyVehicle(input: VehicleTechnicalInput): VehicleClassification {
  const inference = inferVehicleTypeDetailed(input);
  const vehicleType = inference.vehicleType;
  const engineVolume = parseNumber(input.engineVolume || inferEngineVolume(input.engine));
  const grossWeight = parseNumber(input.grossWeight);

  let turboLevClass: TurboLevClass = "UNKNOWN";
  let reason = inference.reason;
  let confidence = inference.confidence;

  switch (vehicleType) {
    case "CROSSOVER":
      turboLevClass = "C1";
      break;
    case "SUV":
      turboLevClass = "S1";
      break;
    case "MINIVAN":
      turboLevClass = "M1";
      break;
    case "VAN_SMALL":
      turboLevClass = "V1";
      break;
    case "VAN":
      turboLevClass = "V2";
      break;
    case "VAN_LARGE":
      turboLevClass = "V3";
      break;
    case "COMMERCIAL_HEAVY":
      turboLevClass = "V4";
      break;
    case "PASSENGER":
      if (engineVolume > 0 && engineVolume <= 1.6) {
        turboLevClass = "L1";
        reason = `${inference.reason}; двигун ${engineVolume.toFixed(1)} л ≤ 1.6 л`;
        confidence = Math.min(96, confidence + 4);
      } else if (engineVolume > 1.6 && engineVolume <= 2.5) {
        turboLevClass = "L2";
        reason = `${inference.reason}; двигун ${engineVolume.toFixed(1)} л`;
        confidence = Math.min(96, confidence + 4);
      } else if (engineVolume > 2.5) {
        turboLevClass = "L3";
        reason = `${inference.reason}; двигун ${engineVolume.toFixed(1)} л > 2.5 л`;
        confidence = Math.min(96, confidence + 4);
      } else {
        turboLevClass = "L1";
        reason = `${inference.reason}; об’єм двигуна ще не підтверджено`;
        confidence = Math.min(confidence, 68);
      }
      break;
    default:
      break;
  }

  if (grossWeight > 5000) {
    turboLevClass = "V4";
    confidence = Math.max(confidence, 98);
    reason = `Важкий комерційний транспорт: повна маса ${Math.round(grossWeight)} кг`;
  }

  return {
    vehicleType,
    turboLevClass,
    priceCoefficient: TURBO_LEV_CLASS_COEFFICIENTS[turboLevClass],
    source: "RULES",
    confidence,
    reason,
  };
}

/**
 * Calculates the labour price only. Low-confidence classification never
 * silently increases the client's bill: it returns the suggested coefficient
 * but applies x1.00 until a manager confirms the class.
 */
export function calculateLaborPriceForVehicle(
  basePrice: number,
  classification: Pick<VehicleClassification, "turboLevClass" | "priceCoefficient" | "confidence">,
  options: { roundTo?: number; minConfidence?: number } = {},
): LabourPriceAdjustment {
  const safeBase = Number.isFinite(basePrice) ? Math.max(0, basePrice) : 0;
  const roundTo = Math.max(1, Math.round(options.roundTo ?? 10));
  const minConfidence = options.minConfidence ?? VEHICLE_CLASS_AUTO_APPLY_CONFIDENCE;
  const requiresConfirmation = classification.turboLevClass === "UNKNOWN" || classification.confidence < minConfidence;
  const suggestedCoefficient = classification.priceCoefficient || 1;
  const appliedCoefficient = requiresConfirmation ? 1 : suggestedCoefficient;
  const rawAdjusted = safeBase * appliedCoefficient;
  const adjustedPrice = Math.ceil(rawAdjusted / roundTo) * roundTo;

  return {
    basePrice: safeBase,
    suggestedCoefficient,
    appliedCoefficient,
    adjustedPrice,
    surcharge: Math.max(0, adjustedPrice - safeBase),
    autoApplied: !requiresConfirmation && appliedCoefficient > 1,
    requiresConfirmation,
  };
}
