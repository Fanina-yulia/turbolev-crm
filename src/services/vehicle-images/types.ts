export type VehicleImageColorMode = "AUTO" | "REAL" | "THEME";

export type VehicleImageQuery = {
  vehicleId: string;
  make: string;
  model: string;
  year: number | null;
  bodyType: string | null;
  trim?: string | null;
  powerTrain?: string | null;
  realColorName?: string | null;
  realColorHex?: string | null;
  realPaintCode?: string | null;
  realColorConfirmed?: boolean;
  themePaint?: string | null;
};

export type NormalizedVehicleImageQuery = VehicleImageQuery & {
  make: string;
  model: string;
  bodyType: string | null;
};

export type VehicleImageProviderConfig = {
  provider: "IMAGIN";
  customerId: string;
  baseUrl: string;
  angle: string;
  width: number;
  fileType: "webp" | "png" | "jpg";
  colorMode: VehicleImageColorMode;
  fallbackPaint: string;
};

export type VehicleImageColorDecision = {
  paintId: string | null;
  paintDescription: string | null;
  requestedColor: string | null;
  source: "REAL" | "THEME" | "NEUTRAL";
};

export type VehicleImageProviderResult = {
  provider: "IMAGIN";
  sourceUrl: string;
  angle: string;
  requestedColor: string | null;
  providerPaintId: string | null;
  confidence: number;
  reason: string;
};

export type ResolvedVehicleImage = {
  assetId: string;
  vehicleId: string;
  provider: string;
  sourceUrl: string;
  proxyUrl: string;
  confidence: number;
  angle: string;
  requestedColor: string | null;
  status: "READY" | "MANUAL";
};
