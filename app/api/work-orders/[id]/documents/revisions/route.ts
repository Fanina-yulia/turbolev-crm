import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import {
  captureWorkOrderDocumentRevision,
  ControlledDocumentError,
  listControlledDocumentRevisions,
  voidControlledDocumentRevision,
  type ControlledDocumentTypeCode,
} from "@/src/services/document-control.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function actorName(access: { context: { user?: { employeeName?: string | null; name?: string | null } | null } }) {
  return (access.context.user?.employeeName || access.context.user?.name || "CRM / Документи").trim().slice(0, 160);
}

function errorResponse(error: unknown) {
  if (error instanceof ControlledDocumentError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  }
  console.error("work-order document revisions failed", error);
  return NextResponse.json({ ok: false, code: "CONTROLLED_DOCUMENT_FAILED", error: "Не вдалося обробити ревізію документа." }, { status: 500 });
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "WORK_ORDER_FORBIDDEN" }, { status: 403 });
    }
    const type = new URL(request.url).searchParams.get("type") as ControlledDocumentTypeCode | null;
    const revisions = await listControlledDocumentRevisions(id, type);
    return NextResponse.json({ ok: true, revisions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await authorize(PERMISSIONS.WORK_ORDERS_WRITE, { strict: true, request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "WORK_ORDER_FORBIDDEN" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action.toUpperCase() : "ISSUE";
    const actor = actorName(access);
    if (action === "VOID") {
      const revisionId = typeof body.revisionId === "string" ? body.revisionId : "";
      if (!revisionId) return NextResponse.json({ ok: false, code: "DOCUMENT_REVISION_REQUIRED", error: "Передайте ідентифікатор ревізії." }, { status: 400 });
      const revision = await voidControlledDocumentRevision(revisionId, actor, typeof body.reason === "string" ? body.reason : null, access.context.user?.id || null);
      return NextResponse.json({ ok: true, action, revision }, { headers: { "Cache-Control": "no-store" } });
    }
    const type = typeof body.type === "string" ? body.type as ControlledDocumentTypeCode : null;
    if (!type) return NextResponse.json({ ok: false, code: "DOCUMENT_TYPE_REQUIRED", error: "Передайте тип документа." }, { status: 400 });
    const result = await captureWorkOrderDocumentRevision(id, type, actor, access.context.user?.id || null);
    return NextResponse.json({ ok: true, action: "ISSUE", ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
