"use client";

import dynamic from "next/dynamic";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";
import compactStyles from "./mechanic-mobile-compact.module.css";
import polishStyles from "./mechanic-mobile-polish.module.css";
import statusLayoutStyles from "./mechanic-mobile-status-layout.module.css";

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
 *
 * The mobile wrappers are presentation-only. They give the mechanic cabinet a
 * dedicated phone layout without changing workflow, task, diagnostics or
 * scanner behavior.
 */
export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  return <div className={`${compactStyles.compactViewport} ${polishStyles.polishViewport} ${statusLayoutStyles.statusLayoutViewport}`}>
    <MechanicStandaloneCabinet userName={userName} />
    <MechanicVehicleScanner />
    <MechanicDiagnosticsArrivalBridge />
  </div>;
}
