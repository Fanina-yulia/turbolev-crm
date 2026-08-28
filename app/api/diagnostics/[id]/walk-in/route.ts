import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  chooseWalkInPostPaymentRoute,
  getWalkInDiagnosticSettlement,
  payWalkInDiagnostic,
  WalkInDiagnosticSettlementError,
} from "@/src/services/walk-in-diagnostic-settlement.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof WalkInDiagnosticSettlementError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error("walk-in diagnostic settlement failed", error);
  return NextResponse.json({ ok: false, error: "WALK_IN_SETTLEMENT_FAILED", message: "Не вдалося оновити позаплановий візит." }, { status: 500 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "ASSIGNED", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }
    const result = await getWalkInDiagnosticSettlement(access.context.user.id, id);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "").toUpperCase();

    if (action === "PAY") {
      const method = String(body.paymentMethod || "").toUpperCase();
      const paymentMethod = method === "CASH"
        ? "CASH"
        : method === "TERMINAL"
          ? "TERMINAL"
          : method === "ONLINE"
            ? "ONLINE"
            : method as "CASH" | "TERMINAL" | "ONLINE";
      const result = await payWalkInDiagnostic(
        access.context.user.id,
        id,
        paymentMethod,
        body.amount,
      );
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "COMPLETE_VISIT" || action === "SEND_TO_REPAIR_FLOW") {
      await chooseWalkInPostPaymentRoute(access.context.user.id, id, action);
      const result = await getWalkInDiagnosticSettlement(access.context.user.id, id);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION", message: "Оберіть дію для позапланового візиту." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
