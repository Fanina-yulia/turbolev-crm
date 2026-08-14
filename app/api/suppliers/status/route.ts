import { NextResponse } from "next/server";
import { listSupplierStatuses } from "@/src/services/suppliers/registry";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ suppliers: listSupplierStatuses() }, { headers: { "Cache-Control": "no-store" } });
}
