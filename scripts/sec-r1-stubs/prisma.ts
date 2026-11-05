import { state } from "./state.ts";
// Executors are modelled as ServiceMechanic rows; mechanic id == "m:" + user id.
export function getPrisma() {
  const rows = (id: string) => (state.__executors[id] ?? []).map((u) => ({ mechanicId: "m:" + u }));
  return {
    serviceAppointment: { findMany: async ({ where }: any) => rows(where.workOrderId) },
    workOrderLine: { findMany: async () => [] },
    serviceMechanic: { findMany: async ({ where }: any) => where.id.in.map((m: string) => ({ userId: m.slice(2) })) },
    workOrderNumber: { findMany: async () => state.__numbers },
  };
}
