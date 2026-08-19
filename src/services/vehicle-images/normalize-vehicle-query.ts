import type { NormalizedVehicleImageQuery, VehicleImageQuery } from "./types";

const MAKE_ALIASES: Record<string, string> = {
  "mercedes benz": "mercedes-benz",
  "mercedesbenz": "mercedes-benz",
  "mercedes": "mercedes-benz",
  "vw": "volkswagen",
  "volks wagen": "volkswagen",
  "land rover": "land-rover",
  "alfa romeo": "alfa-romeo",
  "aston martin": "aston-martin",
};

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9а-яіїєґ]+/giu, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeMake(value: string) {
  const plain = value.trim().toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/giu, " ").replace(/\s+/g, " ").trim();
  return MAKE_ALIASES[plain] ?? slug(value);
}

function normalizeModel(value: string) {
  return slug(value)
    .replace(/^class-/, "")
    .replace(/-class$/, "")
    .replace(/^xc-90$/, "xc90")
    .replace(/^xc-60$/, "xc60")
    .replace(/^cx-5$/, "cx-5");
}

function normalizeBodyType(value: string | null | undefined) {
  if (!value) return null;
  const source = value.toLowerCase();
  if (/suv|позашлях|кросовер|crossover/.test(source)) return "suv";
  if (/wagon|універсал|estate/.test(source)) return "wagon";
  if (/hatch|хетч/.test(source)) return "hatchback";
  if (/sedan|седан/.test(source)) return "sedan";
  if (/coupe|купе/.test(source)) return "coupe";
  if (/pickup|пікап/.test(source)) return "pickup";
  if (/van|фургон|бус|minivan|mpv/.test(source)) return "van";
  return slug(value);
}

export function normalizeVehicleImageQuery(query: VehicleImageQuery): NormalizedVehicleImageQuery | null {
  const make = normalizeMake(query.make || "");
  const model = normalizeModel(query.model || "");
  if (!make || !model) return null;

  return {
    ...query,
    make,
    model,
    bodyType: normalizeBodyType(query.bodyType),
    trim: query.trim?.trim() || null,
    powerTrain: query.powerTrain?.trim().toLowerCase() || null,
  };
}
