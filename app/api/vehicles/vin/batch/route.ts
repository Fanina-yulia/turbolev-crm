import { NextResponse } from "next/server";
import { decodeVinIntelligence } from "@/src/services/vin-intelligence.service";
import { validateVin } from "@/src/domain/vin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { vins?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "INVALID_BODY", message: "Очікується JSON." }, { status: 400 });
  }

  const raw = Array.isArray(body.vins) ? body.vins : [];
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
