import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import {
  getWorkOrderDocumentPackage,
  WorkOrderDocumentPackageError,
} from "@/src/services/work-order-document-package.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, {
    strict: true,
    request,
    minimumScope: "ASSIGNED",
  });
  if (!access.allowed) return access.response!;

  const { id } = await context.params;
  try {
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    }
    const packageData = await getWorkOrderDocumentPackage(id);
    return NextResponse.json(
      { ok: true, package: packageData },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof WorkOrderDocumentPackageError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    }
    console.error("GET /api/work-orders/[id]/documents failed", {
      id,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ ok: false, error: "Не вдалося сформувати пакет документів." }, { status: 500 });
  }
}
