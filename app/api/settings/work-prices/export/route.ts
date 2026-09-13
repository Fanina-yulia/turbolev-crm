import { NextResponse } from "next/server";
import { buildActiveServiceCatalogExport } from "@/src/services/service-catalog-export.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const { bytes } = await buildActiveServiceCatalogExport();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="turbo-lev-active-price-${date}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("service catalog export failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося експортувати діючий прайс." }, { status: 500 });
  }
}
