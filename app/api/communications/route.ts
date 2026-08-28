import { NextRequest, NextResponse } from "next/server";
import { ingestCommunicationInquiry, listCommunicationInquiries, type CommunicationChannel } from "@/src/services/communications-server.service";
import { withCommunicationLifecycleState } from "@/src/services/communication-lifecycle.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channels = new Set(["FACEBOOK","INSTAGRAM","TIKTOK","BINOTEL","OLX","WEBSITE"]);

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  try {
    const params = request.nextUrl.searchParams;
    const channel = params.get("channel") || undefined;
    const result = await listCommunicationInquiries({
      channel,
      unread: params.get("unread") === "1",
      noReply: params.get("noReply") === "1",
      search: params.get("search") || undefined,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      items: result.items.map((item) => withCommunicationLifecycleState(item)),
    });
  } catch (error) {
    console.error("GET /api/communications failed", error);
    return NextResponse.json({ ok: false, error: "Communications database is not ready" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_WRITE, { request, strict: true, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json();
    if (!channels.has(String(body.channel))) return NextResponse.json({ ok: false, error: "Unsupported channel" }, { status: 400 });
    if (!String(body.subject || "").trim()) return NextResponse.json({ ok: false, error: "subject is required" }, { status: 400 });

    const inquiry = await ingestCommunicationInquiry({
      channel: body.channel as CommunicationChannel,
      externalId: body.externalId,
      externalMessageId: body.externalMessageId,
      name: body.name,
      phone: body.phone,
      handle: body.handle,
      subject: String(body.subject).trim(),
      preview: body.preview,
      message: body.message,
      vehicle: body.vehicle,
      plate: body.plate,
      receivedAt: body.receivedAt,
      sourceDetail: body.sourceDetail,
      campaign: body.campaign,
      utm: body.utm,
      assignedUserId: body.assignedUserId,
      metadata: body.metadata,
    });
    return NextResponse.json({ ok: true, inquiry: withCommunicationLifecycleState(inquiry) }, { status: 201 });
  } catch (error) {
    console.error("POST /api/communications failed", error);
    return NextResponse.json({ ok: false, error: "Failed to create inquiry" }, { status: 500 });
  }
}
