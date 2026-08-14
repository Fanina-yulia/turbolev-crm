import { Readable } from "node:stream";
import { unzipSync } from "fflate";
import { parse } from "csv-parse";
import { classifyVehicle, type VehicleLookupResult } from "@/src/domain/vehicle-intelligence";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";

export const MVS_OPEN_DATA_SOURCE_URL =
  "https://data.gov.ua/dataset/06779371-308f-42d7-895e-5a39833375f0";

export type MvsResource = { year: number; url: string };

/**
 * All annual vehicle-registry archives currently published by MVS on data.gov.ua.
 * Newest first so the most relevant registration event is found as early as possible.
 */
export const MVS_OPEN_DATA_RESOURCES: MvsResource[] = [
  { year: 2026, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/3f13166f-090b-499e-8e23-e9851c5a5f67/download/reestrtz2026.zip" },
  { year: 2025, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/b7e72d22-55f5-4545-87dc-94e6c8ee03ef/download/reestrtz2025.zip" },
  { year: 2024, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c3ffecc4-bb5c-4102-b761-6dcfeb60b4fe/download/reestrtz2024.zip" },
  { year: 2023, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c3a12388-55c2-4546-8b71-b4b7ff0d8b16/download/reestrtz2023.zip" },
  { year: 2022, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/b1bcb4a9-8e60-4a1c-91c0-00faae008816/download/reestrtz2022.zip" },
  { year: 2021, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/c5cb530d-0533-40be-b9ad-f03e06c94b10/download/tz_opendata_z01012021_po01012022.zip" },
  { year: 2020, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/ebeb92fe-424c-41d1-aacf-288e91049dc9/download/tz_opendata_z01012020_po01012021.zip" },
  { year: 2019, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/7a58e8f7-9323-47d4-a21d-19486e014eb4/download/tz_opendata_z01012019_po01012020.zip" },
  { year: 2018, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/01323740-88df-46c2-b06e-fbb58c89fe17/download/tz_opendata_z01012018_po01012019.zip" },
  { year: 2017, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/9ce32352-bd11-4324-a2b4-5addbd228b1b/download/tz_opendata_z01012017_po31122017.zip" },
  { year: 2016, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/7bdc2a1b-5399-4ab0-97e0-633e68837b04/download/tz_opendata_z01012016_po31122016.zip" },
  { year: 2015, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/09c606dc-d740-40db-96f0-e679eeca6ace/download/tz_opendata_z01012015_po31122015.zip" },
  { year: 2014, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/80a115ae-61df-4a13-8771-36c2826268df/download/tz_opendata_z01012014_po31122014.zip" },
  { year: 2013, url: "https://data.gov.ua/dataset/0ffd8b75-0628-48cc-952a-9302f9799ec0/resource/86a9548b-8323-4fa2-972e-0692edf6959f/download/tz_opendata_z01012013_po31122013.zip" },
];

export type MvsOpenDataVehicle = VehicleLookupResult & {
  registrationDate?: string;
  kind?: string;
  ownWeight?: string;
  sourceYear: number;
  sourceUrl: string;
};

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

function detectDelimiter(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  let firstLine = new TextDecoder("utf-8").decode(sample).split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.includes("�")) {
    try {
      firstLine = new TextDecoder("windows-1251").decode(sample).split(/\r?\n/, 1)[0] ?? "";
    } catch {
      // Ignore and keep UTF-8 sample.
    }
  }
  const variants = [",", ";", "\t"];
  return variants.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
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
    plate: normalizeRegistrationPlate(plate),
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

async function parseCsvAndFind(bytes: Uint8Array, resource: MvsResource, targetPlate: string) {
  const delimiter = detectDelimiter(bytes);
  const parser = Readable.from([Buffer.from(bytes)]).pipe(
    parse({
      bom: true,
      columns: (headers: string[]) => headers.map(normalizeHeader),
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );

  let latest: Record<string, unknown> | null = null;
  let latestDate = "";

  for await (const rawRow of parser) {
    const row = rawRow as Record<string, unknown>;
    const plate = normalizeRegistrationPlate(first(row, ["n_reg_new", "plate", "registration_number"]));
    if (plate !== targetPlate) continue;
    const registrationDate = first(row, ["d_reg", "registration_date"]);
    if (!latest || registrationDate >= latestDate) {
      latest = row;
      latestDate = registrationDate;
    }
  }

  return latest ? mapRow(latest, resource.year, resource.url) : null;
}

async function findInZipResource(
  resource: MvsResource,
  targetPlate: string,
  signal?: AbortSignal,
): Promise<MvsOpenDataVehicle | null> {
  const response = await fetch(resource.url, {
    cache: "force-cache",
    signal,
    headers: {
      "user-agent": "TurboLEV-CRM/1.0 (+https://data.gov.ua/)",
      accept: "application/zip,application/octet-stream,*/*",
    },
  });

  if (!response.ok) throw new Error(`MVS resource ${resource.year} returned ${response.status}`);

  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entries = Object.entries(archive).filter(([name]) => /\.(csv|txt)$/i.test(name));
  for (const [, bytes] of entries) {
    const found = await parseCsvAndFind(bytes, resource, targetPlate);
    if (found) return found;
  }
  return null;
}

export async function lookupMvsOpenDataByPlate(rawPlate: string): Promise<MvsOpenDataVehicle | null> {
  const plate = normalizeRegistrationPlate(rawPlate);
  if (plate.length < 6) return null;

  const timeoutMs = Number(process.env.MVS_OPEN_DATA_TIMEOUT_MS ?? 280000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (const resource of MVS_OPEN_DATA_RESOURCES) {
      if (controller.signal.aborted) break;
      try {
        const found = await findInZipResource(resource, plate, controller.signal);
        if (found) return found;
      } catch (error) {
        if (controller.signal.aborted) break;
        console.warn(`MVS archive ${resource.year} lookup failed`, error);
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
