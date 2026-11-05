import { state } from "./state";
const RANK: Record<string, number> = { SELF: 1, ASSIGNED: 2, TEAM: 3, LOCATION: 4, ALL: 5 };
export async function authorize(permission: string, options: { minimumScope?: string; request?: Request } = {}) {
  const s = state.__session;
  const ctx = { authenticated: Boolean(s), user: s ? { id: s.id, name: s.name, employeeName: s.employeeName } : null, locationIds: s ? [s.stationId] : [], permissions: s?.permissions ?? {}, session: s };
  if (!s) return { allowed: false, wouldAllow: false, shadowBypass: false, context: ctx, grantedScope: null, response: Response.json({ ok: false, error: "UNAUTHENTICATED", permission }, { status: 401 }) };
  const granted = s.permissions[permission] ?? null;
  const ok = granted !== null && RANK[granted] >= RANK[options.minimumScope ?? "ALL"];
  if (!ok) return { allowed: false, wouldAllow: false, shadowBypass: false, context: ctx, grantedScope: granted, response: Response.json({ ok: false, error: "FORBIDDEN", permission }, { status: 403 }) };
  return { allowed: true, wouldAllow: true, shadowBypass: false, context: ctx, grantedScope: granted, response: null };
}
