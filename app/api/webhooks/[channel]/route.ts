import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestCommunicationInquiry, recordWebhookEvent, type CommunicationChannel } from "@/src/services/communications-server.service";

export const runtime = "nodejs";

function resolveChannel(slug: string, body?: any): CommunicationChannel | null {
  if (slug === "binotel") return "BINOTEL";
  if (slug === "tiktok") return "TIKTOK";
  if (slug === "olx") return "OLX";
  if (slug === "meta") return String(body?.object || body?.channel || "").toLowerCase().includes("instagram") ? "INSTAGRAM" : "FACEBOOK";
  return null;
}

function pick(body: any, keys: string[]) {
  for (const key of keys) if (body?.[key] !== undefined && body?.[key] !== null && body?.[key] !== "") return body[key];
  return undefined;
}

export async function GET(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;
  if (channel !== "meta") return NextResponse.json({ ok: true });
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (expected && token === expected && challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  try {
    const { channel: slug } = await context.params;
    const body = await request.json();
    const channel = resolveChannel(slug, body);
    if (!channel) return NextResponse.json({ ok: false, error: "Unsupported webhook" }, { status: 404 });

    const externalEventId = String(pick(body, ["event_id","eventId","call_id","callId","id","request_id","requestId"]) || `${slug}-${randomUUID()}`);
    await recordWebhookEvent(channel, externalEventId, String(pick(body, ["event_type","eventType","type","status"]) || "event"), body);

    if (channel === "BINOTEL") {
      const phone = String(pick(body, ["externalNumber","external_number","phone","src","caller","from"]) || "");
      const status = String(pick(body, ["status","callStatus","disposition"]) || "").toLowerCase();
      const duration = Number(pick(body, ["duration","billsec","seconds"]) || 0);
      const callType = String(pick(body, ["callType","call_type","direction","type"]) || "incoming").toLowerCase();
      const isIncoming = !callType || callType.includes("in") || callType.includes("incoming");
      const isMissed = status.includes("miss") || status.includes("busy") || status.includes("no_answer") || status.includes("no answer") || (duration === 0 && isIncoming);
      if (phone && isIncoming && isMissed) {
        const inquiry = await ingestCommunicationInquiry({
          channel: "BINOTEL",
          externalId: externalEventId,
          externalMessageId: `${externalEventId}:call`,
          name: pick(body, ["name","clientName","client_name"]) || "Невідомий номер",
          phone,
          subject: "Пропущений дзвінок",
          preview: "Пропущений дзвінок — потрібно передзвонити",
          message: "Пропущений вхідний дзвінок. Потрібно передзвонити клієнту.",
          sourceDetail: "Binotel · пропущений",
          metadata: body,
        });
        return NextResponse.json({ ok: true, accepted: true, inquiry });
      }
      return NextResponse.json({ ok: true, accepted: true, inquiry: null });
    }

    const normalized = body.normalized && typeof body.normalized === "object" ? body.normalized : body;
    const message = pick(normalized, ["message","text","comment","description"]);
    const phone = pick(normalized, ["phone","phoneNumber","phone_number"]);
    const subject = pick(normalized, ["subject","service","need","title"]) || (message ? "Нове звернення" : undefined);

    if (!message && !phone && !subject) {
      return NextResponse.json({ ok: true, accepted: true, normalized: false });
    }

    const inquiry = await ingestCommunicationInquiry({
      channel,
      externalId: String(pick(normalized, ["conversationId","conversation_id","leadId","lead_id","id"]) || externalEventId),
      externalMessageId: String(pick(normalized, ["messageId","message_id","event_id"]) || `${externalEventId}:message`),
      name: pick(normalized, ["name","customerName","customer_name","senderName","sender_name"]),
      phone,
      handle: pick(normalized, ["handle","username","senderUsername","sender_username"]),
      subject: String(subject || "Нове звернення"),
      preview: String(message || subject || "Нове звернення"),
      message: message ? String(message) : undefined,
      vehicle: pick(normalized, ["vehicle","car"]),
      plate: pick(normalized, ["plate","plateNumber","plate_number"]),
      sourceDetail: pick(normalized, ["sourceDetail","source_detail","adName","ad_name"]),
      campaign: pick(normalized, ["campaign","campaignName","campaign_name"]),
      utm: pick(normalized, ["utm","utm_source"]),
      metadata: body,
    });

    return NextResponse.json({ ok: true, accepted: true, normalized: true, inquiry });
  } catch (error) {
    console.error("Generic webhook failed", error);
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
