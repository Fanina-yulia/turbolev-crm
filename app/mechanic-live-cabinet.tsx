"use client";

import dynamic from "next/dynamic";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";

const MechanicVehicleScanner = dynamic(
  () => import("./mechanic-vehicle-scanner").then((module) => module.MechanicVehicleScanner),
  { ssr: false },
);
const MechanicDiagnosticsArrivalBridge = dynamic(
  () => import("./mechanic-diagnostics-arrival-bridge").then((module) => module.MechanicDiagnosticsArrivalBridge),
  { ssr: false },
);

/**
 * The mechanic cabinet has one canonical notification surface:
 * MechanicStandaloneCabinet. Keep this wrapper limited to the legacy scanner
 * bridges so assignment notifications cannot be rendered a second time.
 */
export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  return <div style={{ minHeight: "100dvh", background: "#0f141a" }}>
    <MechanicStandaloneCabinet userName={userName} />
    <MechanicVehicleScanner />
    <MechanicDiagnosticsArrivalBridge />
  </div>;
}
