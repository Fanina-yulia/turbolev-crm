import { NextResponse } from "next/server";
import { getSupplierAdapter, testSupplier } from "@/src/services/suppliers/registry";
import type { SupplierId } from "@/src/services/suppliers/types";
import { guardIntegrations } from "@/src/security/settings-route-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const guard = await guardIntegrations(request);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const supplier = (searchParams.get("supplier") ?? "") as SupplierId;
  const adapter = getSupplierAdapter(supplier);

  if (!adapter) {
    return NextResponse.json({ ok: false, message: "Невідомий постачальник." }, { status: 404 });
  }

  const result = await testSupplier(supplier);
  return NextResponse.json(result, { status: result.ok || result.state === "MANUAL_SETUP" || result.state === "NOT_CONFIGURED" ? 200 : 502 });
}
