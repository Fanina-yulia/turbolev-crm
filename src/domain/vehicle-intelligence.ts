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
  S1: "Позашляховик / SUV",
  M1: "Мінівен / MPV",
  V1: "Малий бус",
  V2: "Бус",
  V3: "Великий бус",
  V4: "Дуже великий / комерційний",
  UNKNOWN: "Не визначено",
};

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

function containsAny(value: string, words: string[]) {
  return words.some((word) => value.includes(word));
}

export function inferVehicleType(input: VehicleTechnicalInput): VehicleType {
  const explicit = (input.vehicleType ?? "").toUpperCase() as VehicleType;
  if (
    [
      "PASSENGER",
      "CROSSOVER",
      "SUV",
      "MINIVAN",
      "VAN_SMALL",
      "VAN",
      "VAN_LARGE",
      "COMMERCIAL_HEAVY",
    ].includes(explicit)
  ) {
    return explicit;
  }

  const text = `${input.make ?? ""} ${input.model ?? ""} ${input.bodyType ?? ""}`.toLowerCase();
  const grossWeight = parseNumber(input.grossWeight);

  if (containsAny(text, ["crossover", "кросовер"])) return "CROSSOVER";
  if (containsAny(text, ["suv", "4x4", "off-road", "позашляховик", "джип"])) return "SUV";
  if (containsAny(text, ["mpv", "minivan", "мінівен"])) return "MINIVAN";

  if (containsAny(text, ["van", "bus", "microbus", "minibus", "фургон", "мікроавтобус", "автобус", "бус"])) {
    if (grossWeight > 5000) return "COMMERCIAL_HEAVY";
    if (grossWeight > 3500) return "VAN_LARGE";
    if (grossWeight > 0 && grossWeight <= 2500) return "VAN_SMALL";
    return "VAN";
  }

  return "PASSENGER";
}

export function classifyVehicle(input: VehicleTechnicalInput): VehicleClassification {
  const vehicleType = inferVehicleType(input);
  const engineVolume = parseNumber(input.engineVolume || inferEngineVolume(input.engine));
  const grossWeight = parseNumber(input.grossWeight);

  let turboLevClass: TurboLevClass = "UNKNOWN";
  let reason = "Недостатньо даних для автоматичної класифікації";
  let confidence = 55;

  switch (vehicleType) {
    case "CROSSOVER":
      turboLevClass = "C1";
      reason = "Тип кузова визначено як кросовер";
      confidence = 88;
      break;
    case "SUV":
      turboLevClass = "S1";
      reason = "Тип кузова визначено як SUV / позашляховик";
      confidence = 88;
      break;
    case "MINIVAN":
      turboLevClass = "M1";
      reason = "Тип кузова визначено як мінівен / MPV";
      confidence = 86;
      break;
    case "VAN_SMALL":
      turboLevClass = "V1";
      reason = "Комерційний кузов і мала повна маса";
      confidence = grossWeight ? 92 : 78;
      break;
    case "VAN":
      turboLevClass = "V2";
      reason = "Тип ТЗ визначено як бус / фургон";
      confidence = 88;
      break;
    case "VAN_LARGE":
      turboLevClass = "V3";
      reason = "Великий бус за типом кузова / повною масою";
      confidence = grossWeight ? 94 : 82;
      break;
    case "COMMERCIAL_HEAVY":
      turboLevClass = "V4";
      reason = "Важкий комерційний транспорт";
      confidence = grossWeight ? 95 : 82;
      break;
    case "PASSENGER":
      if (engineVolume > 0 && engineVolume <= 1.6) {
        turboLevClass = "L1";
        reason = `Легковий автомобіль, двигун ${engineVolume.toFixed(1)} л ≤ 1.6 л`;
        confidence = 90;
      } else if (engineVolume > 1.6 && engineVolume <= 2.5) {
        turboLevClass = "L2";
        reason = `Легковий автомобіль, двигун ${engineVolume.toFixed(1)} л`;
        confidence = 90;
      } else if (engineVolume > 2.5) {
        turboLevClass = "L3";
        reason = `Легковий автомобіль, двигун ${engineVolume.toFixed(1)} л > 2.5 л`;
        confidence = 90;
      } else {
        turboLevClass = "L1";
        reason = "Легковий автомобіль; об’єм двигуна ще не підтверджено";
        confidence = 62;
      }
      break;
    default:
      break;
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
