import type {
  NormalizedVehicleImageQuery,
  VehicleImageColorDecision,
  VehicleImageProviderConfig,
  VehicleImageProviderResult,
} from "./types";

function add(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return;
  params.set(key, String(value));
}

export function buildImaginImageUrl(
  query: NormalizedVehicleImageQuery,
  config: VehicleImageProviderConfig,
  color: VehicleImageColorDecision,
) {
  const params = new URLSearchParams();
  add(params, "customer", config.customerId);
  add(params, "make", query.make);
  add(params, "modelFamily", query.model);
  add(params, "modelYear", query.year);
  add(params, "trim", query.trim);
  add(params, "powerTrain", query.powerTrain);
  add(params, "angle", config.angle);
  add(params, "paintId", color.paintId);
  add(params, "paintDescription", color.paintDescription);
  add(params, "zoomType", "fullscreen");
  add(params, "width", config.width);
  add(params, "fileType", config.fileType);
  add(params, "billingTag", "turbolev-crm");
  return `${config.baseUrl.replace(/\/$/, "")}/getImage?${params.toString()}`;
}

export function resolveImaginImage(
  query: NormalizedVehicleImageQuery,
  config: VehicleImageProviderConfig,
  color: VehicleImageColorDecision,
): VehicleImageProviderResult {
  let confidence = 80;
  const reasons = ["марка і модель передані точно"];
  if (query.year) {
    confidence += 10;
    reasons.push("враховано рік");
  }
  if (query.bodyType) {
    confidence += 3;
    reasons.push("враховано тип кузова у внутрішній сигнатурі");
  }
  if (query.trim) {
    confidence += 5;
    reasons.push("враховано комплектацію");
  }
  if (query.powerTrain) {
    confidence += 2;
    reasons.push("враховано силову установку");
  }

  return {
    provider: "IMAGIN",
    sourceUrl: buildImaginImageUrl(query, config, color),
    angle: config.angle,
    requestedColor: color.requestedColor,
    providerPaintId: color.paintId,
    confidence: Math.min(100, confidence),
    reason: reasons.join("; "),
  };
}
