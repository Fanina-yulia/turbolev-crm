CREATE INDEX IF NOT EXISTS "VehicleImageGenerationJob_status_requestedAt_idx"
  ON public."VehicleImageGenerationJob" ("status", "requestedAt");
