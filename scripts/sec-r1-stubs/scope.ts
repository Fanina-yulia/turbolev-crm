import { state } from "./state.ts";
export async function canAccessWorkOrder(ctx: any, scope: string | null, id: string) {
  if (scope === "ALL") return true;
  const s = ctx.session; if (!s || !scope) return false;
  if (scope === "LOCATION") return state.__workOrderStation[id] === s.stationId;
  return (s.assignedWorkOrders ?? []).includes(id);
}
export async function resolveVisibleWorkOrderIds(ctx: any, scope: string | null) {
  if (scope === "ALL") return null;
  return Object.keys(state.__workOrderStation).filter((id) => ctx.session && (scope === "LOCATION" ? state.__workOrderStation[id] === ctx.session.stationId : (ctx.session.assignedWorkOrders ?? []).includes(id)));
}
