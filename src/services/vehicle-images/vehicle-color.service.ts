import type { NormalizedVehicleImageQuery, VehicleImageColorDecision, VehicleImageColorMode } from "./types";

const GENERIC_PAINTS = new Set([
  "Imagin-black",
  "Imagin-grey",
  "Imagin-white",
  "Imagin-blue",
  "Imagin-yellow",
  "Imagin-red",
  "Imagin-orange",
  "Imagin-green",
]);

function genericFromName(value: string | null | undefined) {
  const source = (value || "").toLowerCase();
  if (/black|чорн/.test(source)) return "Imagin-black";
  if (/white|бі(л|л)|перламутр|ivory/.test(source)) return "Imagin-white";
  if (/blue|син|блакит/.test(source)) return "Imagin-blue";
  if (/yellow|жовт|gold|золот/.test(source)) return "Imagin-yellow";
  if (/red|черв|бордо/.test(source)) return "Imagin-red";
  if (/orange|помаранч/.test(source)) return "Imagin-orange";
  if (/green|зелен/.test(source)) return "Imagin-green";
  if (/grey|gray|silver|сір|сріб/.test(source)) return "Imagin-grey";
  return null;
}

function genericFromHex(value: string | null | undefined) {
  const raw = (value || "").trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (lightness < 0.16) return "Imagin-black";
  if (lightness > 0.88 && delta < 0.1) return "Imagin-white";
  if (delta < 0.09) return "Imagin-grey";

  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  if (hue < 18 || hue >= 345) return "Imagin-red";
  if (hue < 48) return "Imagin-orange";
  if (hue < 75) return "Imagin-yellow";
  if (hue < 170) return "Imagin-green";
  if (hue < 270) return "Imagin-blue";
  return "Imagin-red";
}

export function normalizeThemePaint(value: string | null | undefined, fallback = "Imagin-orange") {
  if (value && GENERIC_PAINTS.has(value)) return value;
  const normalized = value ? `Imagin-${value.toLowerCase().replace(/^imagin-/, "")}` : "";
  if (GENERIC_PAINTS.has(normalized)) return normalized;
  return GENERIC_PAINTS.has(fallback) ? fallback : "Imagin-orange";
}

function realColor(query: NormalizedVehicleImageQuery): VehicleImageColorDecision | null {
  if (!query.realColorConfirmed) return null;
  if (query.realPaintCode) {
    return {
      paintId: query.realPaintCode,
      paintDescription: query.realColorName || null,
      requestedColor: query.realColorName || query.realPaintCode,
      source: "REAL",
    };
  }
  const generic = genericFromName(query.realColorName) || genericFromHex(query.realColorHex);
  if (!generic) return null;
  return {
    paintId: generic,
    paintDescription: query.realColorName || null,
    requestedColor: query.realColorName || generic,
    source: "REAL",
  };
}

export function resolveVehicleImageColor(
  query: NormalizedVehicleImageQuery,
  mode: VehicleImageColorMode,
  themePaint: string,
  fallbackPaint: string,
): VehicleImageColorDecision {
  const actual = realColor(query);
  if (mode === "REAL") {
    return actual ?? {
      paintId: "Imagin-grey",
      paintDescription: null,
      requestedColor: "Neutral grey",
      source: "NEUTRAL",
    };
  }

  if (mode === "AUTO" && actual) return actual;
  const paintId = normalizeThemePaint(themePaint, fallbackPaint);
  return {
    paintId,
    paintDescription: null,
    requestedColor: paintId,
    source: "THEME",
  };
}
