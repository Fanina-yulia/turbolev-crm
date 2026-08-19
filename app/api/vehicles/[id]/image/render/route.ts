import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { markVehicleImageFailure, resolveVehicleImage } from "@/src/services/vehicle-images/vehicle-image.service";
import { normalizeThemePaint } from "@/src/services/vehicle-images/vehicle-color.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const XML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function xml(value: string) {
  return value.replace(/[&<>"']/g, (char) => XML_ENTITIES[char] ?? char);
}

function fallbackHex(themePaint: string | null) {
  const paint = normalizeThemePaint(themePaint, "Imagin-orange");
  const map: Record<string, string> = {
    "Imagin-black": "#25282d", "Imagin-grey": "#8a929b", "Imagin-white": "#e9edf1", "Imagin-blue": "#3b72d9",
    "Imagin-yellow": "#d6a313", "Imagin-red": "#c84141", "Imagin-orange": "#ef6b24", "Imagin-green": "#389266",
  };
  return map[paint] || "#ef6b24";
}

function fallbackSvg(input: { make: string | null; model: string | null; bodyType: string | null; themePaint: string | null }) {
  const color = fallbackHex(input.themePaint);
  const title = xml([input.make, input.model].filter(Boolean).join(" ") || "Автомобіль");
  const body = (input.bodyType || "").toLowerCase();
  const tall = /suv|van|bus|mpv|позашлях|кросовер|фургон|бус/.test(body);
  const bodyPath = tall
    ? "M56 142 C61 119 72 104 93 94 L145 77 L176 44 C188 31 204 24 224 24 L288 24 C308 24 324 34 338 51 L363 84 L391 94 C405 99 414 112 416 130 L417 151 L51 151 Z"
    : "M56 142 C61 121 73 106 94 97 L147 82 L178 61 C192 49 210 43 231 42 L290 42 C309 42 325 50 339 64 L363 88 L391 97 C405 102 414 114 416 130 L417 151 L51 151 Z";
  const glassPath = tall
    ? "M177 78 L198 50 C206 40 217 35 231 35 L284 35 C297 35 309 41 320 53 L339 78 Z"
    : "M177 82 L199 64 C209 56 220 52 234 52 L282 52 C296 52 309 57 320 67 L336 82 Z";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220" viewBox="35 10 395 205" role="img" aria-label="${title}">
  <defs><linearGradient id="paint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".98"/><stop offset="1" stop-color="${color}" stop-opacity=".67"/></linearGradient><linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dce6ef"/><stop offset="1" stop-color="#637487"/></linearGradient><filter id="shadow" x="-20%" y="-30%" width="140%" height="170%"><feGaussianBlur stdDeviation="7"/></filter></defs>
  <ellipse cx="237" cy="176" rx="150" ry="15" fill="#0b0d10" opacity=".16" filter="url(#shadow)"/>
  <path d="${bodyPath}" fill="url(#paint)" stroke="#1f2933" stroke-opacity=".34" stroke-width="2"/><path d="${glassPath}" fill="url(#glass)" opacity=".93"/>
  <path d="M258 36 V82 M321 55 L343 91" stroke="#eef3f7" stroke-opacity=".42" stroke-width="3"/><path d="M74 126 H390" stroke="#ffffff" stroke-opacity=".22" stroke-width="3"/>
  <circle cx="130" cy="151" r="31" fill="#22272d"/><circle cx="130" cy="151" r="17" fill="#a9b1b9"/><circle cx="130" cy="151" r="7" fill="#4b5560"/><circle cx="333" cy="151" r="31" fill="#22272d"/><circle cx="333" cy="151" r="17" fill="#a9b1b9"/><circle cx="333" cy="151" r="7" fill="#4b5560"/>
  <path d="M60 126 H101 M365 119 H402" stroke="#f8fafc" stroke-width="7" stroke-linecap="round" opacity=".88"/><text x="235" y="207" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#6b7280">${title}</text></svg>`;
}

async function imageFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "image/webp,image/png,image/jpeg,image/*" } });
  } finally {
    clearTimeout(timeout);
  }
}

function svgResponse(svg: string) {
  return new NextResponse(svg, { status: 200, headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400", "X-Vehicle-Image-Fallback": "1" } });
}

function isResolvedVehicle(response: Response) {
  const resolved = response.headers.get("x-imaginstudio-request-resolved");
  const found = response.headers.get("x-imaginstudio-request-found");
  if (resolved && resolved.toLowerCase() === "false") return false;
  if (found && found.toLowerCase() === "false") return false;
  return true;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const themePaint = request.nextUrl.searchParams.get("theme");
  const fallbackVehicle = await getPrisma().vehicle.findUnique({ where: { id }, select: { brand: true, model: true, bodyType: true } });
  if (!fallbackVehicle) return NextResponse.json({ ok: false, error: "Автомобіль не знайдено." }, { status: 404 });
  const fallback = () => svgResponse(fallbackSvg({ ...fallbackVehicle, themePaint }));

  try {
    const image = await resolveVehicleImage(id, { themePaint });
    if (!image) return fallback();
    const response = await imageFetch(image.sourceUrl);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/") || !isResolvedVehicle(response)) {
      const resolved = response.headers.get("x-imaginstudio-request-resolved") || "unknown";
      const found = response.headers.get("x-imaginstudio-request-found") || "unknown";
      await markVehicleImageFailure(image.assetId, `Provider HTTP ${response.status}; content-type=${contentType || "unknown"}; resolved=${resolved}; found=${found}`);
      return fallback();
    }

    const performedMatches = response.headers.get("x-imaginstudio-performed-matches");
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "X-Vehicle-Image-Provider": image.provider,
        "X-Vehicle-Image-Confidence": String(image.confidence),
        ...(performedMatches ? { "X-Vehicle-Image-Matches": performedMatches.slice(0, 240) } : {}),
      },
    });
  } catch (error) {
    console.error("vehicle image render failed", error);
    return fallback();
  }
}
