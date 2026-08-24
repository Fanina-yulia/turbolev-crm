import { NextRequest, NextResponse } from "next/server";
import { markCommunicationRead } from "@/src/services/communication-delivery.service";
import { patchCommunicationInquiry } from "@/src/services/communications-server.service";
import {
  CommunicationLifecycleRuleError,
  getCommunicationLifecycleSnapshot,
  resolveCommunicationLifecycleState,
  setCommunicationLifecycleState,
  type CommunicationLifecycleState,
} from "@/src/services/communication-lifecycle.service";

export const runtime = "nodejs";

const lifecycleStates = new Set<CommunicationLifecycleState>(["NEW", "IN_WORK", "WAITING_CLIENT", "CLOSED", "NOT_OUR_CLIENT", "SPAM"]);

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const requestedState = lifecycleStates.has(body.state as CommunicationLifecycleState)
      ? body.state as CommunicationLifecycleState
      : null;

    let inquiry: Record<string, unknown> | null = null;
    if (requestedState) inquiry = await setCommunicationLifecycleState(id, requestedState) as Record<string, unknown>;

    const patch: { unread?: boolean; answered?: boolean; assignedUserId?: string | null } = {};
    if (typeof body.unread === "boolean") patch.unread = body.unread;
    if (typeof body.answered === "boolean" && !requestedState) patch.answered = body.answered;
    if (body.assignedUserId === null || typeof body.assignedUserId === "string") patch.assignedUserId = body.assignedUserId;

    if (Object.keys(patch).length) {
      const updated = await patchCommunicationInquiry(id, patch);
      const snapshot = await getCommunicationLifecycleSnapshot(id);
      inquiry = snapshot
        ? { ...updated, ...snapshot, state: snapshot.lifecycleState }
        : { ...updated, state: resolveCommunicationLifecycleState(updated) };
    }

    if (!inquiry) return NextResponse.json({ ok: false, error: "No changes supplied" }, { status: 422 });

    if (body.unread === false || requestedState === "WAITING_CLIENT" || requestedState === "CLOSED" || requestedState === "NOT_OUR_CLIENT") {
      await markCommunicationRead(id).catch((error) => console.warn("External read sync failed", error));
    }
    return NextResponse.json({ ok: true, inquiry });
  } catch (error) {
    console.error("PATCH /api/communications/[id] failed", error);
    if (error instanceof CommunicationLifecycleRuleError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Failed to update inquiry" }, { status: 500 });
  }
}
