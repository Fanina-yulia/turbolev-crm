import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { searchPartNameSuggestions } from "@/src/services/parts-knowledge.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_READ, { request, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();
  const requestedLimit = Number(searchParams.get("limit") || 8);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(12, Math.floor(requestedLimit))) : 8;

  if (query.length < 2) {
    return NextResponse.json({
      ok: true,
      query,
      source: "NONE",
      suggestions: [],
      message: "Введіть щонайменше 2 символи назви деталі.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    const suggestions = await searchPartNameSuggestions(query, limit);
    return NextResponse.json({
      ok: true,
      query,
      source: suggestions.some((item) => item.source === "CRM_CATALOG") ? "CRM_CATALOG" : "STATIC_FALLBACK",
      suggestions,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/parts/autocomplete failed", error);
    return NextResponse.json({
      ok: false,
      error: "PART_AUTOCOMPLETE_FAILED",
      message: "Каталог назв деталей тимчасово недоступний. Введену назву можна зберегти вручну.",
      suggestions: [],
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
