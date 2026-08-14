import { NextResponse } from "next/server";
import { getGenerationByYear, searchModels, searchParts } from "auto-parts-db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const make = (searchParams.get("make") ?? "").trim();
  const model = (searchParams.get("model") ?? "").trim();
  const year = Number(searchParams.get("year") ?? "");

  const parts = q.length >= 2 ? searchParts(q).slice(0, 40) : [];
  const generation = make && model && Number.isFinite(year) && year > 1900
    ? getGenerationByYear(make, model, year)
    : null;
  const models = q.length >= 2 ? searchModels(q).slice(0, 20) : [];

  return NextResponse.json({
    status: "OK",
    source: "AUTO_PARTS_DB",
    license: "MIT",
    referenceOnly: true,
    warning: "Довідковий безкоштовний каталог. Не підтверджує точну сумісність деталі з VIN і не замінює TecDoc/OEM-каталог.",
    vehicle: generation ? { make, model, year, generation } : null,
    parts,
    models,
  });
}
