import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await getPrisma().user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error("GET /api/users/active failed", error);
    return NextResponse.json({ ok: false, items: [] }, { status: 500 });
  }
}
