import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ ok: true, count: 0, items: [] }, { headers: { "Cache-Control": "no-store" } });
  const prisma = getPrisma();
  try {
    const now = new Date();
    const items = await prisma.supplierProductQuote.findMany({
      where: {
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            OR: [
              { article: { contains: q, mode: "insensitive" } },
              { brand: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: [{ fetchedAt: "desc" }],
      take: 20,
      include: { supplier: { select: { id: true, code: true, name: true, defaultMarkupPercent: true, defaultCurrency: true } } },
    });
    return NextResponse.json({ ok: true, count: items.length, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("supplier quotes GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося знайти збережені пропозиції постачальників." }, { status: 500 });
  }
}
