import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import {
  getWorkOrderDocumentPackage,
  WorkOrderDocumentPackageError,
} from "@/src/services/work-order-document-package.service";
import { buildWorkOrderInvoicePdfData } from "@/src/services/work-order-invoice-pdf.service";
import { renderWorkOrderInvoicePdf } from "@/src/services/work-order-invoice-pdf-renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

function safeDownloadName(value: string) {
  const normalized = value.replace(/[\r\n"]/g, "_");
  const asciiFallback = normalized.replace(/[^\x20-\x7e]/g, "_") || "nakladna.pdf";
  return `filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { request, strict: true, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
      return NextResponse.json({ ok: false, error: "WORK_ORDER_FORBIDDEN" }, { status: 403 });
    }

    const packageData = await getWorkOrderDocumentPackage(id);
    const renderedBytes = await renderWorkOrderInvoicePdf(buildWorkOrderInvoicePdfData(packageData));
    const fileName = `nakladna-${packageData.workOrder.displayNumber}-${packageData.workOrder.vehicle.plateNumber || packageData.workOrder.vehicle.vin || "vehicle"}.pdf`;
    const url = new URL(request.url);
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(renderedBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(renderedBytes.byteLength),
        "Content-Disposition": `${disposition}; ${safeDownloadName(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-CRM-Vehicle": packageData.workOrder.vehicle.plateNumber || packageData.workOrder.vehicle.vin || "unknown",
      },
    });
  } catch (error) {
    if (error instanceof WorkOrderDocumentPackageError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET /api/work-orders/[id]/invoice-pdf failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "WORK_ORDER_INVOICE_PDF_FAILED" }, { status: 500 });
  }
}
