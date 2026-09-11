import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import { getWorkOrderDocumentPackage } from "@/src/services/work-order-document-package.service";
import { renderWorkOrderInvoicePdf } from "@/src/services/work-order-invoice-pdf-renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };
function safeName(value: string) {
  return value.replace(/[\r\n"]/g, "_").replace(/[^\x20-\x7e]/g, "_") || "akt-vykonanykh-robit.pdf";
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await authorize(PERMISSIONS.WORK_ORDERS_READ, { request, strict: true, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  if (!(await canAccessWorkOrder(access.context, access.grantedScope, id))) {
    return NextResponse.json({ ok: false, error: "WORK_ORDER_FORBIDDEN" }, { status: 403 });
  }
  try {
    const packageData = await getWorkOrderDocumentPackage(id);
    if (!packageData.documents.act.available) return NextResponse.json({ ok: false, error: "COMPLETION_ACT_NOT_AVAILABLE" }, { status: 409 });
    const actLines = (Array.isArray(packageData.documents.act.lines) ? packageData.documents.act.lines : []).map((value) => {
      const line = record(value);
      return {
        type: String(line.type || "OTHER"),
        description: String(line.description || "Робота"),
        code: typeof line.code === "string" ? line.code : null,
        article: typeof line.article === "string" ? line.article : null,
        brand: typeof line.brand === "string" ? line.brand : null,
        quantity: typeof line.quantity === "string" || typeof line.quantity === "number" ? line.quantity : 1,
        unitPrice: typeof line.unitPrice === "string" || typeof line.unitPrice === "number" ? line.unitPrice : 0,
        total: typeof line.total === "string" || typeof line.total === "number" ? line.total : 0,
      };
    });
    const rendered = await renderWorkOrderInvoicePdf({
      vehicleLabel: [packageData.workOrder.vehicle.brand, packageData.workOrder.vehicle.model, packageData.workOrder.vehicle.year].filter(Boolean).join(" ") || "Автомобіль",
      vin: packageData.workOrder.vehicle.vin,
      date: packageData.documents.act.completedAt || packageData.generatedAt,
      parts: actLines.filter((line) => line.type === "PART"),
      works: actLines.filter((line) => line.type !== "PART"),
      documentTitle: "АКТ ВИКОНАНИХ РОБІТ",
      documentSubtitle: packageData.documents.act.number ? `№ ${packageData.documents.act.number}` : "РЕМОНТ АВТОМОБІЛЯ",
      warning: "Акт сформовано за фактично завершеними роботами та встановленими деталями.",
    });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    const fileName = `akt-${packageData.workOrder.displayNumber}-${packageData.workOrder.vehicle.plateNumber || "vehicle"}.pdf`;
    return new Response(rendered, { status: 200, headers: { "Content-Type": "application/pdf", "Content-Length": String(rendered.byteLength), "Content-Disposition": `${disposition}; filename="${safeName(fileName)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("GET /api/work-orders/[id]/completion-act/pdf failed", { id, error });
    return NextResponse.json({ ok: false, error: "COMPLETION_ACT_PDF_FAILED" }, { status: 500 });
  }
}
