import type { VehicleCardContract, VehicleStatusItem, VehicleStatusTone } from "@/src/lib/contracts/crm-core";

export type VehicleTabKey = "diagnostics" | "proposal" | "history";
export type VehicleTabStatus = Pick<VehicleStatusItem, "tone" | "label">;

const ACTIVE_WORK_ORDER_STATUSES = new Set([
  "PARTS_REVIEW",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "PAUSED",
  "REWORK",
  "WAITING_QC",
]);

const NOT_STARTED: VehicleTabStatus = { tone: "danger", label: "Не розпочато" };

export function getVehicleTabStatus(vehicle: VehicleCardContract, tab: VehicleTabKey): VehicleTabStatus {
  if (tab === "diagnostics") return vehicle.statusSummary?.diagnostics || NOT_STARTED;
  if (tab === "proposal") return vehicle.statusSummary?.proposal || { tone: "danger", label: "Не відправлена" };
  if (!vehicle.workOrders.length) return { tone: "danger", label: "Немає історії" };
  if (vehicle.workOrders.some((workOrder) => ACTIVE_WORK_ORDER_STATUSES.has(String(workOrder.status)))) return { tone: "warning", label: "В роботі" };
  return { tone: "success", label: "Історія є" };
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
