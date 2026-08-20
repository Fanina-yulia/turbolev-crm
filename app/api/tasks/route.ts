import { NextRequest, NextResponse } from "next/server";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { createManualTask, listTasksForUser } from "@/src/services/tasks.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeTasks(context: Awaited<ReturnType<typeof getAccessContext>>) {
  if (context.provisioningState !== "ACTIVE" || !context.user) return { ok: false as const, status: 401 };
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, PERMISSIONS.OVERVIEW_READ)) return { ok: false as const, status: 403 };
  return { ok: true as const, userId: context.user.id };
}

export async function GET(request: NextRequest) {
  try {
    const context = await getAccessContext(request);
    const auth = authorizeTasks(context);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Access denied" }, { status: auth.status });
    const tasks = await listTasksForUser(auth.userId);
    return NextResponse.json({ ok: true, tasks, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error("GET /api/tasks failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити задачі" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getAccessContext(request);
    const auth = authorizeTasks(context);
    if (!auth.ok) return NextResponse.json({ ok: false, error: "Access denied" }, { status: auth.status });
    const body = await request.json() as Record<string, unknown>;
    const task = await createManualTask(auth.userId, body);
    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "TITLE_REQUIRED" || message === "INVALID_DATE") return NextResponse.json({ ok: false, error: message }, { status: 422 });
    console.error("POST /api/tasks failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося створити задачу" }, { status: 500 });
  }
}
