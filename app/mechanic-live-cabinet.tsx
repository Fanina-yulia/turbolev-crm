"use client";

import dynamic from "next/dynamic";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";
import { MechanicBottomNavRestore } from "./mechanic-bottom-nav-restore";

const MechanicVehicleScanner = dynamic(
  () => import("./mechanic-vehicle-scanner").then((module) => module.MechanicVehicleScanner),
  { ssr: false },
);
const MechanicDiagnosticsArrivalBridge = dynamic(
  () => import("./mechanic-diagnostics-arrival-bridge").then((module) => module.MechanicDiagnosticsArrivalBridge),
  { ssr: false },
);

/**
 * MechanicStandaloneCabinet remains the canonical mechanic workspace.
 * The scanner and navigation bridges only restore cross-screen mobile controls
 * and must not duplicate mechanic business data or notification rendering.
 */
export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  return <div style={{ minHeight: "100dvh", background: "#0f141a" }}>
    <MechanicStandaloneCabinet userName={userName} />
    <MechanicVehicleScanner />
    <MechanicBottomNavRestore />
    <MechanicDiagnosticsArrivalBridge />
  </div>;
}
