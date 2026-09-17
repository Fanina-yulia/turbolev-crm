import { findPartTerminologyMatches, normalizePartTerminology } from "@/src/services/parts-terminology.service";
import type { SupplierOffer } from "@/src/services/suppliers/types";

export type PartFamilyDecision = {
  requestedCanonicalCode: string | null;
  detectedCanonicalCodes: string[];
  matchedCanonicalCode: string | null;
  conflict: boolean;
  reason: string;
};

export type VehicleMakeEvidence = {
  requestedMake: string | null;
  detectedMakes: string[];
  supplierBrandMake: string | null;
  conflict: boolean;
  reason: string;
};

const VEHICLE_MAKES: Array<{ canonical: string; aliases: RegExp[] }> = [
  { canonical: "GEELY", aliases: [/\bGEELY\b/iu, /\bДЖИЛ[ІИ]\b/iu] },
  { canonical: "AUDI", aliases: [/\bAUDI\b/iu] },
  { canonical: "VOLKSWAGEN", aliases: [/\bVOLKSWAGEN\b/iu, /\bVW\b/iu] },
  { canonical: "SKODA", aliases: [/\bSKODA\b/iu, /\bŠKODA\b/iu] },
  { canonical: "MERCEDES", aliases: [/\bMERCEDES(?:\s*BENZ)?\b/iu, /\bSPRINTER\b/iu] },
  { canonical: "RENAULT", aliases: [/\bRENAULT\b/iu] },
  { canonical: "FIAT", aliases: [/\bFIAT\b/iu] },
  { canonical: "HYUNDAI", aliases: [/\bHYUNDAI\b/iu] },
  { canonical: "KIA", aliases: [/\bKIA\b/iu] },
  { canonical: "TOYOTA", aliases: [/\bTOYOTA\b/iu] },
  { canonical: "LEXUS", aliases: [/\bLEXUS\b/iu] },
  { canonical: "BMW", aliases: [/\bBMW\b/iu] },
  { canonical: "FORD", aliases: [/\bFORD\b/iu] },
  { canonical: "OPEL", aliases: [/\bOPEL\b/iu] },
  { canonical: "PEUGEOT", aliases: [/\bPEUGEOT\b/iu] },
  { canonical: "CITROEN", aliases: [/\bCITRO[EË]N\b/iu] },
  { canonical: "NISSAN", aliases: [/\bNISSAN\b/iu] },
  { canonical: "MITSUBISHI", aliases: [/\bMITSUBISHI\b/iu] },
  { canonical: "HONDA", aliases: [/\bHONDA\b/iu] },
  { canonical: "MAZDA", aliases: [/\bMAZDA\b/iu] },
  { canonical: "SUBARU", aliases: [/\bSUBARU\b/iu] },
  { canonical: "CHEVROLET", aliases: [/\bCHEVROLET\b/iu] },
  { canonical: "DAEWOO", aliases: [/\bDAEWOO\b/iu] },
  { canonical: "VOLVO", aliases: [/\bVOLVO\b/iu] },
  { canonical: "LAND ROVER", aliases: [/\bLAND\s+ROVER\b/iu] },
  { canonical: "JEEP", aliases: [/\bJEEP\b/iu] },
  { canonical: "DODGE", aliases: [/\bDODGE\b/iu] },
  { canonical: "CHERY", aliases: [/\bCHERY\b/iu] },
  { canonical: "GREAT WALL", aliases: [/\bGREAT\s+WALL\b/iu] },
  { canonical: "HAVAL", aliases: [/\bHAVAL\b/iu] },
  { canonical: "BYD", aliases: [/\bBYD\b/iu] },
  { canonical: "JAC", aliases: [/\bJAC\b/iu] },
  { canonical: "SUZUKI", aliases: [/\bSUZUKI\b/iu] },
  { canonical: "PORSCHE", aliases: [/\bPORSCHE\b/iu] },
  { canonical: "SEAT", aliases: [/\bSEAT\b/iu] },
  { canonical: "TESLA", aliases: [/\bTESLA\b/iu] },
  { canonical: "CHANGAN", aliases: [/\bCHANGAN\b/iu] },
  { canonical: "MG", aliases: [/\bMG\b/iu] },
];

const AFTERMARKET_BRANDS = new Set([
  "BOSCH", "BREMBO", "TRW", "MOOG", "SKF", "FAG", "FEBI", "FEBEST", "SACHS", "KYB", "MONROE",
  "TEXTAR", "MINTEX", "ATE", "ZIMMERMANN", "MASUMA", "PATRON", "ZEKKERT", "MILES", "MEYLE", "LEMFORDER",
  "LEMFÖRDER", "DELPHI", "HELLA", "NGK", "DENSO", "MANN", "MAHLE", "PURFLUX", "FILTRON", "GATES", "CONTITECH",
  "DAYCO", "INA", "LUK", "SNR", "NTN", "GSP", "JAPANPARTS", "BLUE PRINT", "SWAG", "OSSCA", "EEP",
]);

const SPECIAL_FAMILY_PATTERNS: Array<{ code: string; patterns: RegExp[] }> = [
  { code: "BRAKE_DISC", patterns: [/\bbrake\s*(?:disc|rotor)s?\b/iu, /(?:гальмівн|тормозн)\w*\s+диск\w*/iu] },
  { code: "BRAKE_PAD", patterns: [/\bbrake\s*pads?\b/iu, /(?:гальмівн|тормозн)\w*\s+колод\w*/iu, /комплект\s+(?:гальмівн|тормозн)\w*\s+колод\w*/iu] },
  { code: "BRAKE_CALIPER", patterns: [/\bbrake\s*caliper\b/iu, /(?:гальмівн|тормозн)\w*\s+суп+орт\w*/iu, /\bсуп+орт\w*/iu] },
  { code: "BRAKE_HOSE", patterns: [/\bbrake\s*hose\b/iu, /(?:гальмівн|тормозн)\w*\s+шланг\w*/iu] },
  { code: "STABILIZER_BUSHING", patterns: [/(?:втулк\w*.*стабіл\w*|втулк\w*.*стабилиз\w*|stabili[sz]er.*bush|sway\s*bar.*bush)/iu] },
  { code: "STABILIZER_LINK", patterns: [/(?:стійк\w*.*стабіл\w*|стойк\w*.*стабилиз\w*|stabili[sz]er.*link|sway\s*bar.*link)/iu] },
  { code: "WHEEL_HUB_BEARING", patterns: [/(?:підшипник|подшипник).*(?:ступиц|маточин)|wheel\s*(?:hub\s*)?bearing/iu] },
  { code: "WHEEL_HUB_ASSEMBLY", patterns: [/(?:ступиц|маточин).*(?:в\s+(?:збор|сбор)|assembly|комплект)|wheel\s*hub\s*assembly/iu] },
  { code: "BALL_JOINT", patterns: [/(?:кульов\w*|шаров\w*|ball\s*joint)/iu] },
  { code: "CONTROL_ARM", patterns: [/(?:важел\w*|рычаг\w*|control\s*arm)/iu] },
];

function clean(value: unknown, max = 360) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizedCode(value: unknown) {
  return clean(value, 80).toUpperCase().replace(/[^A-Z0-9_]/gu, "");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function detectPartFamilies(value: unknown) {
  const raw = clean(value, 500);
  if (!raw) return [] as string[];
  const terminology = findPartTerminologyMatches(raw).map((match) => match.definition.code);
  const special = SPECIAL_FAMILY_PATTERNS
    .filter((item) => item.patterns.some((pattern) => pattern.test(raw)))
    .map((item) => item.code);
  return unique([...special, ...terminology]);
}

export function evaluatePartFamily(offer: SupplierOffer, requestedCanonicalCode?: string | null): PartFamilyDecision {
  const requested = normalizedCode(requestedCanonicalCode) || null;
  const detected = detectPartFamilies(`${offer.name || ""} ${offer.offerReason || ""}`);
  if (!requested) {
    return {
      requestedCanonicalCode: null,
      detectedCanonicalCodes: detected,
      matchedCanonicalCode: detected[0] || null,
      conflict: false,
      reason: "Canonical family не визначена; family guard не може виконати hard reject.",
    };
  }
  if (!detected.length) {
    return {
      requestedCanonicalCode: requested,
      detectedCanonicalCodes: [],
      matchedCanonicalCode: null,
      conflict: false,
      reason: "Назва постачальника не дозволяє надійно визначити canonical family.",
    };
  }
  if (detected.includes(requested)) {
    return {
      requestedCanonicalCode: requested,
      detectedCanonicalCodes: detected,
      matchedCanonicalCode: requested,
      conflict: false,
      reason: `Назва товару відповідає canonical family ${requested}.`,
    };
  }
  return {
    requestedCanonicalCode: requested,
    detectedCanonicalCodes: detected,
    matchedCanonicalCode: detected[0] || null,
    conflict: true,
    reason: `Очікується ${requested}, але товар класифіковано як ${detected.join(", ")}.`,
  };
}

export function canonicalVehicleMake(value: unknown) {
  const raw = clean(value, 180);
  if (!raw) return null;
  for (const make of VEHICLE_MAKES) {
    if (make.aliases.some((pattern) => pattern.test(raw))) return make.canonical;
  }
  const normalized = normalizePartTerminology(raw).toUpperCase();
  return normalized || null;
}

export function detectVehicleMakes(value: unknown) {
  const raw = clean(value, 600);
  if (!raw) return [] as string[];
  return unique(VEHICLE_MAKES
    .filter((make) => make.aliases.some((pattern) => pattern.test(raw)))
    .map((make) => make.canonical));
}

export function supplierBrandAsVehicleMake(value: unknown) {
  const raw = clean(value, 160);
  if (!raw) return null;
  const upper = raw.toLocaleUpperCase("uk-UA");
  if (AFTERMARKET_BRANDS.has(upper)) return null;
  return detectVehicleMakes(raw)[0] || null;
}

export function evaluateVehicleMakeEvidence(offer: SupplierOffer, requestedMake?: string | null): VehicleMakeEvidence {
  const requested = canonicalVehicleMake(requestedMake);
  const detected = detectVehicleMakes(`${offer.name || ""} ${offer.vehicleMatch || ""}`);
  const supplierBrandMake = supplierBrandAsVehicleMake(offer.brand);
  const effective = unique([...detected, ...(supplierBrandMake ? [supplierBrandMake] : [])]);
  const conflict = Boolean(requested && effective.length && !effective.includes(requested));
  return {
    requestedMake: requested,
    detectedMakes: detected,
    supplierBrandMake,
    conflict,
    reason: conflict
      ? `Товар має explicit vehicle evidence ${effective.join(", ")}, автомобіль — ${requested}.`
      : effective.length
        ? `Vehicle evidence не суперечить автомобілю: ${effective.join(", ")}.`
        : "У назві/бренді немає однозначної марки автомобіля.",
  };
}

export function detectOfferAxis(value: unknown): "FRONT" | "REAR" | null {
  const source = clean(value, 500).toLocaleUpperCase("uk-UA");
  const front = /(?:^|\s)(?:FRONT|ПЕРЕД[А-ЯІЇЄҐ]*)(?:\s|$)/u.test(source);
  const rear = /(?:^|\s)(?:REAR|ЗАД[А-ЯІЇЄҐ]*)(?:\s|$)/u.test(source);
  if (front === rear) return null;
  return front ? "FRONT" : "REAR";
}

export function detectOfferSide(value: unknown): "LEFT" | "RIGHT" | null {
  const source = clean(value, 500).toLocaleUpperCase("uk-UA");
  const left = /(?:^|\s)(?:LEFT|ЛІВ[А-ЯІЇЄҐ]*|ЛЕВ[А-ЯІЇЄҐ]*)(?:\s|$)/u.test(source);
  const right = /(?:^|\s)(?:RIGHT|ПРАВ[А-ЯІЇЄҐ]*)(?:\s|$)/u.test(source);
  if (left === right) return null;
  return left ? "LEFT" : "RIGHT";
}
