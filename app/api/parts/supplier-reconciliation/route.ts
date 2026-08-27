import { NextRequest, NextResponse } from "next/server";
import { authorize as authorizePermission } from "@/src/security/authorize";
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

async function authorizeReconciliation(request: NextRequest, write = false) {
  const permission = write ? PERMISSIONS.PARTS_WRITE : PERMISSIONS.PARTS_READ;
  // Supplier identity mappings are global canonical data. LOCATION/ASSIGNED scope
  // must never be enough to read or mutate the reconciliation workspace.
  const decision = await authorizePermission(permission, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!decision.allowed || !decision.context.user) {
    return {
      ok: false as const,
      response: decision.response ?? NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }),
    };
  }
  return {
    ok: true as const,
    context: decision.context,
    actor: {
      actorId: decision.context.user.id,
      actorName: decision.context.user.employeeName || decision.context.user.name || "CRM / Запчастини",
    },
  };
}

function errorResponse(error: unknown) {
  if (error instanceof SupplierReconciliationError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 400 : 409;
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
  }
  console.error("supplier reconciliation API failed", error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ ok: false, error: "Не вдалося виконати supplier reconciliation." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeReconciliation(request, false);
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
  const auth = await authorizeReconciliation(request, true);
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
