import { NextRequest, NextResponse } from "next/server";
import { markCommunicationRead } from "@/src/services/communication-delivery.service";
import { patchCommunicationInquiry } from "@/src/services/communications-server.service";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const patch: { unread?: boolean; answered?: boolean; state?: "NEW" | "IN_WORK" | "CONVERTED" | "LINKED" | "SPAM"; assignedUserId?: string | null } = {};
    if (typeof body.unread === "boolean") patch.unread = body.unread;
    if (typeof body.answered === "boolean") patch.answered = body.answered;
    if (["NEW","IN_WORK","CONVERTED","LINKED","SPAM"].includes(body.state)) patch.state = body.state;
    if (body.assignedUserId === null || typeof body.assignedUserId === "string") patch.assignedUserId = body.assignedUserId;
    const inquiry = await patchCommunicationInquiry(id, patch);
    if (body.unread === false) {
      await markCommunicationRead(id).catch((error) => console.warn("External read sync failed", error));
    }
    return NextResponse.json({ ok: true, inquiry });
  } catch (error) {
    console.error("PATCH /api/communications/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Failed to update inquiry" }, { status: 500 });
  }
}
