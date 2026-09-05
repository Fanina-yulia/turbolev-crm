/**
 * Shared diagnostic workflow contract.
 *
 * DiagnosticRequest.status is the legacy/process status used by existing
 * planner and work-order gates. DiagnosticReview.state is the authoritative
 * human-review state for the structured diagnostic card. Every cabinet must
 * resolve the effective state through this function instead of interpreting
 * either field on its own.
 */

export type DiagnosticWorkflowState =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "RETURNED"
  | "CONFIRMED"
  | "CANCELLED";

export function resolveDiagnosticWorkflowState(
  requestStatus: string | null | undefined,
  reviewState: string | null | undefined,
): DiagnosticWorkflowState {
  if (reviewState === "SUBMITTED") return "SUBMITTED";
  if (reviewState === "RETURNED") return "RETURNED";
  if (reviewState === "CONFIRMED" || requestStatus === "CONFIRMED") return "CONFIRMED";
  if (requestStatus === "CANCELLED") return "CANCELLED";
  if (requestStatus === "PENDING") return "PENDING";
  return "IN_PROGRESS";
}

export function isDiagnosticReviewPending(reviewState: string | null | undefined) {
  return reviewState === "SUBMITTED";
}

export function diagnosticWorkflowLabel(state: DiagnosticWorkflowState) {
  const labels: Record<DiagnosticWorkflowState, string> = {
    PENDING: "Очікує",
    IN_PROGRESS: "В роботі",
    SUBMITTED: "На перевірці",
    RETURNED: "На доопрацюванні",
    CONFIRMED: "Підтверджена",
    CANCELLED: "Скасована",
  };
  return labels[state];
}
