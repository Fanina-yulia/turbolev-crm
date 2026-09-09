import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { canAccessWorkOrder } from "@/src/security/work-order-scope";
import { WorkOrderDocumentPackageError } from "@/src/services/work-order-document-package.service";
import { renderCommercialProposalPdfForWorkOrder } from "@/src/services/commercial-proposal-pdf.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

function safeDownloadName(value: string) {
  const normalized = value.replace(/[\r\n"]/g, "_");
  const asciiFallback = normalized.replace(/[^\x20-\x7e]/g, "_") || "commercial-proposal.pdf";
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

    const rendered = await renderCommercialProposalPdfForWorkOrder(id);
    const url = new URL(request.url);
    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new Response(rendered.bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(rendered.bytes.byteLength),
        "Content-Disposition": `${disposition}; ${safeDownloadName(rendered.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof WorkOrderDocumentPackageError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET /api/work-orders/[id]/commercial-proposal-pdf failed", { id, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "COMMERCIAL_PROPOSAL_PDF_FAILED" }, { status: 500 });
  }
}
