import { Readable } from "node:stream";
import { parse } from "csv-parse";
import unzipper from "unzipper";
import { classifyVehicle, type VehicleLookupResult } from "@/src/domain/vehicle-intelligence";

export const MVS_OPEN_DATA_SOURCE_URL =
  "https://data.gov.ua/dataset/06779371-308f-42d7-895e-5a39833375f0";

const CURRENT_RESOURCE = {
  year: 2026,
  url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/3f13166f-090b-499e-8e23-e9851c5a5f67/download/reestrtz2026.zip",
};

const EXTRA_RESOURCES = [
  {
    year: 2025,
    url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/b7e72d22-55f5-4545-87dc-94e6c8ee03ef/download/reestrtz2025.zip",
  },
  {
    year: 2024,
    url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c3ffecc4-bb5c-4102-b761-6dcfeb60b4fe/download/reestrtz2024.zip",
  },
];

export type MvsOpenDataVehicle = VehicleLookupResult & {
  registrationDate?: string;
  kind?: string;
  ownWeight?: string;
  sourceYear: number;
  sourceUrl: string;
};

function normalizePlate(value: string) {
  return value.toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
}

function normalizeHeader(value: string) {
  return value.trim().replace(/^\uFEFF/, "").toLowerCase();
}

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function first(row: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = asText(row[name]);
    if (value) return value;
  }
  return "";
}

function toInt(value: string) {
  const parsed = Number.parseInt(value.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapRow(row: Record<string, unknown>, sourceYear: number, sourceUrl: string): MvsOpenDataVehicle {
  const capacity = first(row, ["capacity", "engine_capacity", "volume"]);
  const kind = first(row, ["kind", "vehicle_kind", "type"]);
  const body = first(row, ["body", "body_type"]);
  const fuel = first(row, ["fuel", "fuel_type"]);
  const grossWeight = first(row, ["total_weight", "gross_weight"]);
  const make = first(row, ["brand", "make"]);
  const model = first(row, ["model"]);
  const year = first(row, ["make_year", "year"]);
  const vin = first(row, ["vin", "vin_code"]);
  const plate = first(row, ["n_reg_new", "plate", "registration_number"]);

  const engineVolumeCm3 = toInt(capacity);
  const engineVolume = engineVolumeCm3 ? String(engineVolumeCm3 / 1000) : "";
  const classification = classifyVehicle({
    make,
    model,
    year,
    engineVolume,
    fuelType: fuel,
    bodyType: `${kind} ${body}`.trim(),
    grossWeight,
  });

  return {
    plate: normalizePlate(plate),
    vin,
    make,
    model,
    year,
    engine: engineVolume ? `${engineVolume} ${fuel}`.trim() : fuel,
    engineVolume,
    fuelType: fuel,
    bodyType: body || kind,
    grossWeight,
    vehicleType: classification.vehicleType,
    source: "EXTERNAL_PLATE",
    confidence: vin ? 96 : 90,
    registrationDate: first(row, ["d_reg", "registration_date"]),
    kind,
    ownWeight: first(row, ["own_weight", "curb_weight"]),
    sourceYear,
    sourceUrl,
  };
}

async function findInZipResource(
  resource: { year: number; url: string },
  targetPlate: string,
  signal?: AbortSignal,
): Promise<MvsOpenDataVehicle | null> {
  const response = await fetch(resource.url, {
    cache: "no-store",
    signal,
    headers: {
      "user-agent": "TurboLEV-CRM/1.0 (+https://data.gov.ua/)",
      accept: "application/zip,application/octet-stream,*/*",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`MVS resource ${resource.year} returned ${response.status}`);
  }

  const zipStream = Readable.fromWeb(response.body as never).pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of zipStream) {
    if (entry.type !== "File" || !/\.(csv|txt)$/i.test(entry.path)) {
      entry.autodrain();
      continue;
    }

    const parser = entry.pipe(
      parse({
        bom: true,
        columns: (headers: string[]) => headers.map(normalizeHeader),
        delimiter: [",", ";", "\t"],
        relax_column_count: true,
        relax_quotes: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );

    for await (const rawRow of parser) {
      const row = rawRow as Record<string, unknown>;
      const plate = normalizePlate(first(row, ["n_reg_new", "plate", "registration_number"]));
      if (plate && plate === targetPlate) {
        zipStream.destroy();
        return mapRow(row, resource.year, resource.url);
      }
    }
  }

  return null;
}

export async function lookupMvsOpenDataByPlate(rawPlate: string): Promise<MvsOpenDataVehicle | null> {
  const plate = normalizePlate(rawPlate);
  if (plate.length < 6) return null;

  const timeoutMs = Number(process.env.MVS_OPEN_DATA_TIMEOUT_MS ?? 22000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Current year is small enough for live lookup and gives an immediate free result.
    const current = await findInZipResource(CURRENT_RESOURCE, plate, controller.signal);
    if (current) return current;

    // Historical live scans are opt-in because older archives are much larger.
    const historicalEnabled = process.env.MVS_OPEN_DATA_HISTORICAL_LIVE === "true";
    if (!historicalEnabled) return null;

    for (const resource of EXTRA_RESOURCES) {
      const found = await findInZipResource(resource, plate, controller.signal);
      if (found) return found;
    }

    return null;
  } finally {
    clearTimeout(timer);
  }
}
