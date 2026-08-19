import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { invalidateVehicleImages } from "@/src/services/vehicle-images/vehicle-image.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cleanHex(value: unknown) {
  const source = cleanText(value, 16);
  if (!source) return null;
  const normalized = source.startsWith("#") ? source : `#${source}`;
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = cleanText(body.exteriorColorName);
  const paintCode = cleanText(body.exteriorPaintCode, 48);
  const hex = cleanHex(body.exteriorColorHex);
  const confirmed = body.exteriorColorConfirmed === true;

  if (body.exteriorColorHex && !hex) {
    return NextResponse.json({ ok: false, error: "HEX колір має формат #RRGGBB." }, { status: 400 });
  }

  try {
    const vehicle = await getPrisma().vehicle.update({
      where: { id },
      data: {
        exteriorColorName: name,
        exteriorColorHex: hex,
        exteriorPaintCode: paintCode,
        exteriorColorSource: name || hex || paintCode ? "USER" : null,
        exteriorColorConfirmed: confirmed && Boolean(name || hex || paintCode),
      },
      select: {
        id: true,
        exteriorColorName: true,
        exteriorColorHex: true,
        exteriorPaintCode: true,
        exteriorColorSource: true,
        exteriorColorConfirmed: true,
        updatedAt: true,
      },
    });
    await invalidateVehicleImages(id);
    return NextResponse.json({ ok: true, vehicle }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle appearance PATCH failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося зберегти колір автомобіля." }, { status: 500 });
  }
}
