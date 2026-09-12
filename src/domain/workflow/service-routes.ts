/**
 * The three production service routes are intentionally explicit.
 *
 * A diagnostic request without a Work Order is a diagnostic-only visit.
 * A Work Order without a diagnostic request is a direct repair.
 * Both records together form the combined diagnostic-to-repair route.
 */

export const SERVICE_ROUTE_KINDS = [
  "DIAGNOSTICS_ONLY",
  "REPAIR_ONLY",
  "DIAGNOSTICS_TO_REPAIR",
] as const;

export type ServiceRouteKind = (typeof SERVICE_ROUTE_KINDS)[number];

export const SERVICE_ROUTE_LABELS: Readonly<Record<ServiceRouteKind, string>> = {
  DIAGNOSTICS_ONLY: "Лише діагностика",
  REPAIR_ONLY: "Лише ремонт",
  DIAGNOSTICS_TO_REPAIR: "Діагностика → ремонт",
};

export const SERVICE_ROUTE_REQUIRED_STAGES: Readonly<Record<ServiceRouteKind, readonly string[]>> = {
  DIAGNOSTICS_ONLY: [
    "diagnostics",
    "diagnostic_confirmed",
    "diagnostic_card_final",
  ],
  REPAIR_ONLY: [
    "work_order",
    "repair_completed",
    "qc",
    "finance_actual",
    "payment",
    "closed",
  ],
  DIAGNOSTICS_TO_REPAIR: [
    "diagnostics",
    "diagnostic_confirmed",
    "diagnostic_card_final",
    "work_order",
    "estimate",
    "approval",
    "repair_completed",
    "qc",
    "finance_actual",
    "payment",
    "closed",
  ],
};

export function deriveServiceRoute(input: {
  hasDiagnostic: boolean;
  hasRepair: boolean;
}): ServiceRouteKind {
  if (input.hasDiagnostic && input.hasRepair) return "DIAGNOSTICS_TO_REPAIR";
  if (input.hasDiagnostic) return "DIAGNOSTICS_ONLY";
  return "REPAIR_ONLY";
}

export function requiredStagesForServiceRoute(route: ServiceRouteKind): readonly string[] {
  return SERVICE_ROUTE_REQUIRED_STAGES[route];
}
