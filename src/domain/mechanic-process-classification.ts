export type MechanicProcessAppointmentKind = "DIAGNOSTIC" | "REPAIR" | "UNCLASSIFIED";

export type MechanicProcessAppointmentLike = {
  id: string;
  purpose: string | null;
  workOrderId: string | null;
  status: string;
  source?: string | null;
};

/**
 * Canonical precedence for mechanic process cards:
 * 1. DiagnosticVisitLink owns the appointment boundary and always wins.
 * 2. Explicit purpose wins for non-linked rows.
 * 3. Legacy NULL rows use diagnostic signals first, then WorkOrder as repair.
 * 4. Anything still ambiguous remains UNCLASSIFIED instead of being guessed.
 */
export function classifyMechanicProcessAppointment(
  appointment: MechanicProcessAppointmentLike,
  diagnosticAppointmentIds: ReadonlySet<string>,
): MechanicProcessAppointmentKind {
  if (diagnosticAppointmentIds.has(appointment.id)) return "DIAGNOSTIC";
  if (appointment.purpose === "DIAGNOSTICS") return "DIAGNOSTIC";
  if (appointment.purpose === "REPAIR") return "REPAIR";

  if (appointment.purpose == null) {
    if (appointment.source === "WALK_IN" || appointment.status === "DIAGNOSTICS") return "DIAGNOSTIC";
    if (appointment.workOrderId) return "REPAIR";
  }

  return "UNCLASSIFIED";
}
