/** A mechanic may collect only a standalone diagnostic charge, never a repair balance. */
export function mechanicPaymentBlockReason(input: {
  purpose: string | null;
  appointmentWorkOrderId: string | null;
  diagnosticWorkOrderId: string | null;
  requiresDiagnosticFirst: boolean;
  status: string;
  locationId: string;
  mechanicLocationId: string;
  vehicleMatches: boolean;
}): string | null {
  if (input.locationId !== input.mechanicLocationId || !input.vehicleMatches) {
    return "Дані візиту не відповідають призначенню. Оплату контролює старший станції.";
  }
  if (input.purpose !== "DIAGNOSTICS" || input.appointmentWorkOrderId
    || input.diagnosticWorkOrderId || input.requiresDiagnosticFirst) {
    return "Є ремонт, замовлення-наряд або змішаний візит. Оплату контролює старший станції.";
  }
  if (!["ARRIVED", "DIAGNOSTICS", "WAITING_PAYMENT"].includes(input.status)) {
    return "На цьому етапі оплату контролює старший станції.";
  }
  return null;
}
