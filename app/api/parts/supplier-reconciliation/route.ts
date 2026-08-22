import { NextRequest, NextResponse } from "next/server";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  escalateSupplierReconciliationTask,
  listSupplierReconciliationTasks,
  rejectSupplierReconciliationTask,
  resolveSupplierReconciliationTask,
  searchSupplierReconciliationProducts,
  startReviewSupplierReconciliationTask,
  SupplierReconciliationError,
} from "@/src/services/supplier-reconciliation.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest, write = false) {
  const context = await getAccessContext(request);
  if (context.provisioningState !== "ACTIVE" || !context.user) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Потрібна авторизація." }, { status: 401 }) };
  }
  const permission = write ? PERMISSIONS.PROCUREMENT_WRITE : PERMISSIONS.PROCUREMENT_READ;
  if (context.enforcementMode === "ENFORCED" && !hasPermission(context, permission)) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "Недостатньо прав для supplier reconciliation." }, { status: 403 }) };
  }
  return {
    ok: true as const,
    context,
    actor: {
      actorId: context.user.id,
      actorName: context.user.employeeName || context.user.name || "CRM / Закупівлі",
    },
  };
}

function errorResponse(error: unknown) {
  if (error instanceof SupplierReconciliationError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 400 : 409;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  console.error("supplier reconciliation API failed", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ ok: false, error: "Не вдалося виконати supplier reconciliation." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request, false);
  if (!auth.ok) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    if (params.get("mode") === "products") {
      const q = params.get("q") || "";
      const products = await searchSupplierReconciliationProducts(q, Number(params.get("take") || 20));
      return NextResponse.json({ ok: true, products }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const statusParam = params.getAll("status").flatMap((value) => value.split(",")).filter(Boolean);
    const result = await listSupplierReconciliationTasks({
      statuses: statusParam,
      supplierId: params.get("supplierId"),
      reason: params.get("reason"),
      q: params.get("q"),
      take: Number(params.get("take") || 50),
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, true);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "").trim().toUpperCase();
    const taskId = String(body.taskId || "").trim();
    const notes = typeof body.notes === "string" ? body.notes : null;
    if (!taskId) return NextResponse.json({ ok: false, error: "Не вказано reconciliation task." }, { status: 400 });
    const common = { taskId, notes, ...auth.actor };

    if (action === "START_REVIEW") {
      const result = await startReviewSupplierReconciliationTask(common);
      return NextResponse.json({ ok: true, result });
    }
    if (action === "RESOLVE") {
      const productId = String(body.productId || "").trim();
      const result = await resolveSupplierReconciliationTask({ ...common, productId });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "REJECT") {
      const result = await rejectSupplierReconciliationTask(common);
      return NextResponse.json({ ok: true, result });
    }
    if (action === "ESCALATE") {
      const result = await escalateSupplierReconciliationTask(common);
      return NextResponse.json({ ok: true, result });
    }
    return NextResponse.json({ ok: false, error: "Непідтримувана reconciliation action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
