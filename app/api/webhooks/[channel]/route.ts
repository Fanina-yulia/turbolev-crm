import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestCommunicationInquiry, recordWebhookEvent, type CommunicationChannel } from "@/src/services/communications-server.service";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";

function resolveChannel(slug: string, body?: any): CommunicationChannel | null {
  if (slug === "website") return "WEBSITE";
  if (slug === "tiktok") return "TIKTOK";
  if (slug === "olx") return "OLX";
  if (slug === "meta") return String(body?.object || body?.channel || "").toLowerCase().includes("instagram") ? "INSTAGRAM" : "FACEBOOK";
  return null;
}

function pick(body: any, keys: string[]) {
  for (const key of keys) if (body?.[key] !== undefined && body?.[key] !== null && body?.[key] !== "") return body[key];
  return undefined;
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  const { channel } = await context.params;
  if (channel !== "meta") return NextResponse.json({ ok: true });

  const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const meta = await getIntegrationCredential("META").catch(() => null);
  const expected = meta?.verifyToken?.trim() || process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() || "";
  if (expected && token && secureEqual(token, expected) && challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  try {
    const { channel: slug } = await context.params;
    if (slug === "binotel") {
      return NextResponse.json(
        { ok: false, error: "Use the protected Binotel telephony webhook", endpoint: "/api/telephony/binotel-webhook" },
        { status: 410 },
      );
    }

    const rawBody = await request.text();
    let body: any;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

    if (slug === "meta") {
      const meta = await getIntegrationCredential("META").catch(() => null);
      const appSecret = meta?.appSecret || process.env.META_APP_SECRET || "";
      if (appSecret) {
        const supplied = request.headers.get("x-hub-signature-256") || "";
        const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
        if (!supplied || !secureEqual(supplied, expected)) {
          return NextResponse.json({ ok: false, error: "Invalid Meta webhook signature" }, { status: 401 });
        }
      }
    }

    const channel = resolveChannel(slug, body);
    if (!channel) return NextResponse.json({ ok: false, error: "Unsupported webhook" }, { status: 404 });

    const externalEventId = String(pick(body, ["event_id","eventId","call_id","callId","id","request_id","requestId"]) || `${slug}-${randomUUID()}`);
    await recordWebhookEvent(channel, externalEventId, String(pick(body, ["event_type","eventType","type","status"]) || "event"), body);

    const normalized = body.normalized && typeof body.normalized === "object" ? body.normalized : body;
    const message = pick(normalized, ["message","text","comment","description"]);
    const phone = pick(normalized, ["phone","phoneNumber","phone_number"]);
    const subject = pick(normalized, ["subject","service","need","title"]) || (message ? "Нове звернення" : undefined);
    if (!message && !phone && !subject) return NextResponse.json({ ok: true, accepted: true, normalized: false });

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
