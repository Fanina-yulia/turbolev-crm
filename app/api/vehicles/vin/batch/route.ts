import { NextResponse } from "next/server";
import { validateVin } from "@/src/domain/vin";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";

export const runtime = "nodejs";
export const maxDuration = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ status: "INVALID_BODY", message: "Очікується JSON." }, { status: 400 });
  }
  if (!isRecord(parsed)) {
    return NextResponse.json({ status: "INVALID_BODY", message: "Очікується JSON-об’єкт із полем vins." }, { status: 400 });
  }

  const raw = Array.isArray(parsed.vins) ? parsed.vins : [];
  const vins = [...new Set(raw.map((item) => validateVin(String(item ?? "")).vin).filter(Boolean))].slice(0, 50);
  if (!vins.length) return NextResponse.json({ status: "INVALID_BODY", message: "Передайте до 50 VIN у полі vins." }, { status: 400 });

  const results = await Promise.all(vins.map(async (vin) => {
    const validation = validateVin(vin);
    if (!validation.formatValid || (validation.northAmerican && validation.checkDigit.status === "INVALID")) {
      return { status: "INVALID_VIN", vin, validation };
    }
    try {
      return await decodeVinIntelligence(vin);
    } catch (error) {
      console.error("Batch VIN decode failed", vin, error);
      return { status: "LOOKUP_UNAVAILABLE", vin, validation };
    }
  }));

  return NextResponse.json({ status: "OK", count: results.length, results });
}
