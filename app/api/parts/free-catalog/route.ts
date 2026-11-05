import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { FREE_PARTS_SOURCE, searchReferenceParts } from "@/src/services/free-parts-catalog.service";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_READ, { strict: true, request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json({ status: "INVALID_QUERY", message: "Введіть щонайменше 2 символи." }, { status: 400 });
  }

  const result = await searchReferenceParts(q, 40);
  return NextResponse.json({
    status: "OK",
    source: result.remote ? FREE_PARTS_SOURCE.id : "TURBO_LEV_LOCAL_FALLBACK",
    sourceCommit: result.remote ? FREE_PARTS_SOURCE.commit : null,
    license: result.remote ? FREE_PARTS_SOURCE.license : "Turbo LEV internal",
    referenceOnly: true,
    warning: "Довідковий каталог. Не підтверджує точну сумісність деталі з VIN і не замінює TecDoc/OEM-каталог або каталог постачальника.",
    parts: result.parts,
  });
}
