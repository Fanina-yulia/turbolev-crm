export type OpenAIVehiclePaintInput = {
  exteriorColorName?: string | null;
  exteriorColorHex?: string | null;
  exteriorPaintCode?: string | null;
  exteriorColorSource?: string | null;
  exteriorColorConfirmed?: boolean | null;
};

export type OpenAIVehiclePaintSpec = {
  signature: string;
  requestedColor: string;
  instruction: string;
  source: "REAL" | "THEME";
};

function clean(value: string | null | undefined) {
  return (value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function signaturePart(value: string | null | undefined) {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}#._-]+/gu, "-").replace(/^-+|-+$/g, "") || "none";
}

function validHex(value: string | null | undefined) {
  const source = clean(value).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(source) ? source : null;
}

function genericEnglishColor(value: string | null | undefined) {
  const source = clean(value).toLowerCase();
  if (!source) return null;
  if (/чорн|black/.test(source)) return "black";
  if (/бі(л|л)|white|ivory/.test(source)) return "white";
  if (/сріб|silver/.test(source)) return "silver";
  if (/сір|grey|gray/.test(source)) return "grey";
  if (/блакит|light blue|cyan/.test(source)) return "light blue";
  if (/син|blue/.test(source)) return "blue";
  if (/черв|red|бордо|burgundy/.test(source)) return "red";
  if (/зелен|green/.test(source)) return "green";
  if (/жовт|yellow/.test(source)) return "yellow";
  if (/помаранч|orange/.test(source)) return "orange";
  if (/беж|beige/.test(source)) return "beige";
  if (/корич|brown/.test(source)) return "brown";
  if (/фіолет|purple|violet/.test(source)) return "purple";
  if (/золот|gold/.test(source)) return "gold";
  return null;
}

export function themePaintDescription(theme: string) {
  const map: Record<string, string> = {
    "Imagin-black": "deep glossy graphite-black automotive paint",
    "Imagin-grey": "clean metallic graphite-grey automotive paint",
    "Imagin-white": "clean pearl-white automotive paint with subtle grey shading",
    "Imagin-blue": "rich modern automotive blue paint",
    "Imagin-yellow": "warm premium yellow-gold automotive paint",
    "Imagin-red": "deep premium red automotive paint",
    "Imagin-orange": "rich warm orange automotive paint, approximately #EF6B24",
    "Imagin-green": "deep modern automotive green paint",
  };
  return map[theme] || map["Imagin-orange"];
}

export function getOpenAIVehiclePaint(input: OpenAIVehiclePaintInput, theme: string): OpenAIVehiclePaintSpec {
  const name = clean(input.exteriorColorName);
  const paintCode = clean(input.exteriorPaintCode);
  const hex = validHex(input.exteriorColorHex);
  const source = clean(input.exteriorColorSource).toUpperCase() || "UNKNOWN";
  const confirmed = input.exteriorColorConfirmed === true && Boolean(name || paintCode || hex);

  if (confirmed) {
    const generic = genericEnglishColor(name);
    const descriptors = [
      name ? `registered/factory color name: "${name}"${generic && generic !== name.toLowerCase() ? ` (${generic} color family)` : ""}` : null,
      paintCode ? `manufacturer paint code: "${paintCode}"` : null,
      hex ? `reference color: ${hex}` : null,
    ].filter(Boolean).join("; ");
    const registryNote = source === "REGISTRY"
      ? "The registry color can be a broad official color family rather than an OEM paint formula; match that recorded family faithfully and never switch to another hue."
      : "Treat the supplied confirmed paint metadata as authoritative for the body color.";
    const requestedColor = name || paintCode || hex || "confirmed vehicle color";

    return {
      signature: ["real", signaturePart(source), signaturePart(name), signaturePart(paintCode), signaturePart(hex)].join(":"),
      requestedColor,
      source: "REAL",
      instruction: [
        `IMPORTANT COLOR REQUIREMENT: the exterior body color must match the confirmed real vehicle color (${descriptors}).`,
        registryNote,
        "This real vehicle color overrides every CRM theme/accent color. Do not recolor the car orange or adapt its paint to the interface theme.",
        "Keep the same hue across all factory-painted body panels under neutral white catalog lighting, using only physically realistic metallic/pearl reflections when appropriate.",
      ].join(" "),
    };
  }

  const themePaint = themePaintDescription(theme);
  return {
    signature: `theme:${signaturePart(theme)}`,
    requestedColor: theme,
    source: "THEME",
    instruction: `No confirmed real exterior color is available. Use ${themePaint} as the CRM fallback paint while keeping realistic automotive reflections.`,
  };
}
