import { NextRequest, NextResponse } from "next/server";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { patchTaskForUser } from "@/src/services/tasks.service";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await getAccessContext(request);
    if (access.provisioningState !== "ACTIVE" || !access.user) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 401 });
    if (access.enforcementMode === "ENFORCED" && !hasPermission(access, PERMISSIONS.OVERVIEW_READ)) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const task = await patchTaskForUser(access.user.id, id, body);
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "TASK_NOT_FOUND") return NextResponse.json({ ok: false, error: "Задачу не знайдено" }, { status: 404 });
    if (message === "AUTO_TASK_READ_ONLY") {
      return NextResponse.json({
        ok: false,
        error: "AUTO_TASK_READ_ONLY",
        message: "Автоматична задача закриється сама після усунення причини в CRM.",
      }, { status: 409 });
    }
    if (["TITLE_REQUIRED", "INVALID_DATE", "INVALID_PRIORITY", "INVALID_STATUS"].includes(message)) return NextResponse.json({ ok: false, error: message }, { status: 422 });
    console.error("PATCH /api/tasks/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити задачу" }, { status: 500 });
  }
}
