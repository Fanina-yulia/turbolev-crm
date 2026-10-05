"use client";

import dynamic from "next/dynamic";
import { MechanicStandaloneCabinet } from "./mechanic-standalone-cabinet";
import { MechanicCabinetPreferences } from "./mechanic-cabinet-preferences";
import { MechanicWorkActionVisibilityGuard } from "./mechanic-work-action-visibility-guard";
import compactStyles from "./mechanic-mobile-compact.module.css";
import polishStyles from "./mechanic-mobile-polish.module.css";
import statusLayoutStyles from "./mechanic-mobile-status-layout.module.css";
import mobileFirstStyles from "./mechanic-mobile-first-v3.module.css";

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
 * MechanicStandaloneCabinet. The dedicated preferences layer replaces only the
 * visible top-right trigger; the original notification action stays mounted
 * and is available from the settings sheet.
 *
 * The mobile wrappers and preferences are presentation-only. They do not alter
 * workflow, task, diagnostics or scanner behavior.
 */
export function MechanicLiveCabinet({ userName }: { userName?: string | null }) {
  return <div className={`${compactStyles.compactViewport} ${polishStyles.polishViewport} ${statusLayoutStyles.statusLayoutViewport} ${mobileFirstStyles.mobileFirstV3}`}>
    <MechanicStandaloneCabinet userName={userName} />
    <MechanicWorkActionVisibilityGuard />
    <MechanicCabinetPreferences />
    <MechanicVehicleScanner />
    <MechanicDiagnosticsArrivalBridge />
  </div>;
}
