import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, null);
  if (!access.ok) return access.response;
  try {
    const categories = await getPrisma().financialCategory.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, pnlSection: true, cashFlowSection: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ ok: true, categories }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[finance-categories]", error);
    return NextResponse.json({ ok: false, code: "CATEGORIES_LOAD_FAILED", error: "Не вдалося завантажити категорії." }, { status: 500 });
  }
}
