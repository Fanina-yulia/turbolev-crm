import { NextResponse } from "next/server";
import { listSupplierStatuses } from "@/src/services/suppliers/registry";
import { guardIntegrations } from "@/src/security/settings-route-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await guardIntegrations(request);
  if (!guard.ok) return guard.response;

  const suppliers = await listSupplierStatuses();
  return NextResponse.json({ suppliers }, { headers: { "Cache-Control": "no-store" } });
}
