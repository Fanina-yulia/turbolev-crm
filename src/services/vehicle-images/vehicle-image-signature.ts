import { createHash } from "node:crypto";
import type { NormalizedVehicleImageQuery, VehicleImageColorDecision, VehicleImageProviderConfig } from "./types";

export function vehicleImageSignature(
  query: NormalizedVehicleImageQuery,
  config: VehicleImageProviderConfig,
  color: VehicleImageColorDecision,
) {
  const source = [
    query.make,
    query.model,
    query.year ?? "",
    query.bodyType ?? "",
    query.trim ?? "",
    query.powerTrain ?? "",
    config.provider,
    config.angle,
    config.width,
    config.fileType,
    color.paintId ?? "",
    color.paintDescription ?? "",
  ].join("|");
  return createHash("sha256").update(source, "utf8").digest("hex");
}
