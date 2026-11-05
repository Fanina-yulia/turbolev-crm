export type Session = { id: string; name: string; employeeName?: string; permissions: Record<string, string>; stationId: string; assignedWorkOrders?: string[] };
export const state = globalThis as unknown as {
  __session: Session | null;
  __workOrderStation: Record<string, string>;
  __executors: Record<string, string[]>; // workOrderId -> user ids
  __calls: Array<{ fn: string; args: unknown[] }>;
  __numbers: Array<{ workOrderId: string; number: number }>;
};
state.__session ??= null; state.__workOrderStation ??= {}; state.__executors ??= {}; state.__calls ??= []; state.__numbers ??= [];
