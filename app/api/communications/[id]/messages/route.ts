import { NextRequest, NextResponse } from "next/server";
import { addCommunicationMessage } from "@/src/services/communications-server.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
    const result = await addCommunicationMessage(id, text);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST /api/communications/[id]/messages failed", error);
    return NextResponse.json({ ok: false, error: "Failed to save message" }, { status: 500 });
  }
}
