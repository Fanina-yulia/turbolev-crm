import { NextResponse } from "next/server";
import { listSupplierStatuses } from "@/src/services/suppliers/registry";

export const runtime = "nodejs";

export async function GET() {
  const suppliers = await listSupplierStatuses();
  return NextResponse.json({ suppliers }, { headers: { "Cache-Control": "no-store" } });
}
