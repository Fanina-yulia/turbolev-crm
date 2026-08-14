import { NextResponse } from "next/server";
import { convertInquiryToLead } from "@/src/services/communications-server.service";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await convertInquiryToLead(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "PHONE_REQUIRED") return NextResponse.json({ ok: false, error: "Спочатку потрібно отримати телефон клієнта" }, { status: 422 });
    console.error("POST /api/communications/[id]/convert failed", error);
    return NextResponse.json({ ok: false, error: "Failed to convert inquiry" }, { status: 500 });
  }
}
