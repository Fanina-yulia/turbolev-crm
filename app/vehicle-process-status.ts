import type { VehicleCardContract, VehicleStatusItem, VehicleStatusTone } from "@/src/lib/contracts/crm-core";

export type VehicleTabKey = "diagnostics" | "proposal" | "history";
export type VehicleTabStatus = Pick<VehicleStatusItem, "tone" | "label">;

const CRITICAL_SERVICE_STATUSES = new Set(["REWORK", "WARRANTY"]);
const CRITICAL_CONCLUSION = /(критич|небезпеч|аварійн|термінов)/i;

const NOT_CREATED: VehicleTabStatus = { tone: "neutral", label: "Не створена" };

export function getVehicleTabStatus(vehicle: VehicleCardContract, tab: VehicleTabKey): VehicleTabStatus {
  if (tab === "diagnostics") return vehicle.statusSummary?.diagnostics || NOT_CREATED;
  if (tab === "proposal") return vehicle.statusSummary?.proposal || NOT_CREATED;

  const hasHistory = vehicle.workOrders.length > 0 || vehicle.diagnosticRequests.length > 0;
  if (!hasHistory) return { tone: "neutral", label: "Історія відсутня" };

  const hasCriticalServiceState = vehicle.workOrders.some((workOrder) => CRITICAL_SERVICE_STATUSES.has(String(workOrder.status)));
  const hasCriticalConclusion = vehicle.diagnosticRequests.some((request) => CRITICAL_CONCLUSION.test(request.technicalConclusion || ""));
  if (hasCriticalServiceState || hasCriticalConclusion) return { tone: "danger", label: "Потребує уваги" };

  return { tone: "success", label: "Актуальна" };
}

export function vehicleTabToneClass(tone: VehicleStatusTone, styles: Record<string, string>) {
  return styles[
    tone === "success"
      ? "statusSuccess"
      : tone === "warning"
        ? "statusWarning"
        : tone === "danger"
          ? "statusDanger"
          : "statusNeutral"
  ];
}
