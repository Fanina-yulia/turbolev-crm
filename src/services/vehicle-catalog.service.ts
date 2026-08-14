const VPIC_API = "https://vpic.nhtsa.dot.gov/api/vehicles";

export type VehicleMakeOption = { id: number | null; name: string };
export type VehicleModelOption = { id: number | null; name: string; makeId: number | null; makeName: string };

const FALLBACK_MAKES = [
  "Audi", "BMW", "Chevrolet", "Citroen", "Dacia", "Fiat", "Ford", "Honda", "Hyundai", "Infiniti", "Jaguar", "Jeep",
  "Kia", "Land Rover", "Lexus", "Mazda", "Mercedes-Benz", "Mini", "Mitsubishi", "Nissan", "Opel", "Peugeot", "Porsche",
  "Renault", "Seat", "Skoda", "Subaru", "Suzuki", "Tesla", "Toyota", "Volkswagen", "Volvo", "ЗАЗ", "ГАЗ", "УАЗ"
];

function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.toLocaleLowerCase("uk-UA");
    if (!item.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getJson(path: string) {
  const response = await fetch(`${VPIC_API}${path}`, {
    headers: { "User-Agent": "TurboLEV-CRM/2.1" },
    next: { revalidate: 86_400 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`vPIC catalog HTTP ${response.status}`);
  return response.json();
}

export async function listVehicleMakes(query = ""): Promise<{ items: VehicleMakeOption[]; source: string }> {
  const fallback: VehicleMakeOption[] = FALLBACK_MAKES.map((name) => ({ id: null, name }));
  let remote: VehicleMakeOption[] = [];
  let source = "FALLBACK";

  try {
    const payload = await getJson("/GetAllMakes?format=json");
    remote = Array.isArray(payload?.Results)
      ? payload.Results.map((row: Record<string, unknown>): VehicleMakeOption => ({
          id: Number.isFinite(Number(row.Make_ID)) ? Number(row.Make_ID) : null,
          name: normalizeName(row.Make_Name),
        }))
      : [];
    source = "NHTSA_VPIC";
  } catch (error) {
    console.warn("Vehicle make catalog fallback", error);
  }

  const needle = query.trim().toLocaleLowerCase("uk-UA");
  const items = uniqueByName<VehicleMakeOption>([...fallback, ...remote])
    .filter((item) => !needle || item.name.toLocaleLowerCase("uk-UA").includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, "uk-UA"));

  return { items, source };
}

export async function listVehicleModels(make: string): Promise<{ items: VehicleModelOption[]; source: string }> {
  const normalizedMake = make.trim();
  if (!normalizedMake) return { items: [], source: "EMPTY" };

  try {
    const payload = await getJson(`/GetModelsForMake/${encodeURIComponent(normalizedMake)}?format=json`);
    const rawModels: VehicleModelOption[] = Array.isArray(payload?.Results)
      ? payload.Results.map((row: Record<string, unknown>): VehicleModelOption => ({
          id: Number.isFinite(Number(row.Model_ID)) ? Number(row.Model_ID) : null,
          name: normalizeName(row.Model_Name),
          makeId: Number.isFinite(Number(row.Make_ID)) ? Number(row.Make_ID) : null,
          makeName: normalizeName(row.Make_Name) || normalizedMake,
        }))
      : [];

    const items = uniqueByName<VehicleModelOption>(rawModels)
      .sort((a, b) => a.name.localeCompare(b.name, "uk-UA"));

    return { items, source: "NHTSA_VPIC" };
  } catch (error) {
    console.warn("Vehicle model catalog unavailable", error);
    return { items: [], source: "UNAVAILABLE" };
  }
}
