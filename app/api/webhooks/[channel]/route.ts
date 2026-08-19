import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestCommunicationInquiry, recordWebhookEvent, type CommunicationChannel } from "@/src/services/communications-server.service";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;

function asRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function optionalString(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" ? value : String(value);
}
function resolveChannel(slug: string, body?: JsonObject): CommunicationChannel | null {
  if (slug === "website") return "WEBSITE";
  if (slug === "tiktok") return "TIKTOK";
  if (slug === "olx") return "OLX";
  if (slug === "meta") {
    const object = optionalString(body?.object) || optionalString(body?.channel) || "";
    return object.toLowerCase().includes("instagram") ? "INSTAGRAM" : "FACEBOOK";
  }
  return null;
}
function pick(body: JsonObject, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
function secureEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyTikTokSignature(header: string, rawBody: string, secret: string) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.trim().split("=", 2)).filter((part) => part.length === 2));
  const timestamp = parts.t || "";
  const signature = parts.s || "";
  const timestampNumber = Number(timestamp);
  if (!timestamp || !signature || !Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNumber) > 5 * 60) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return secureEqual(signature, expected);
}

function verifyOlxSignature(header: string, body: JsonObject, secret: string) {
  const objectId = optionalString(body.object_id) || "";
  const transactionId = optionalString(body.transaction_id) || "";
  if (!header || !objectId || !transactionId) return false;
  const expected = createHmac("sha1", secret).update(`${objectId},${transactionId}`, "utf8").digest("hex");
  return secureEqual(header, expected);
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
      return NextResponse.json({ ok: false, error: "Use the protected Binotel telephony webhook", endpoint: "/api/telephony/binotel-webhook" }, { status: 410 });
    }

    const rawBody = await request.text();
    let parsed: unknown;
    try { parsed = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
    const body = asRecord(parsed);
    if (!body) return NextResponse.json({ ok: false, error: "JSON body must be an object" }, { status: 400 });

    if (slug === "meta") {
      const meta = await getIntegrationCredential("META").catch(() => null);
      const appSecret = meta?.appSecret || process.env.META_APP_SECRET || "";
      if (appSecret) {
        const supplied = request.headers.get("x-hub-signature-256") || "";
        const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
        if (!supplied || !secureEqual(supplied, expected)) return NextResponse.json({ ok: false, error: "Invalid Meta webhook signature" }, { status: 401 });
      }
    }

    if (slug === "tiktok") {
      const tiktok = await getIntegrationCredential("TIKTOK").catch(() => null);
      const secret = tiktok?.clientSecret || process.env.TIKTOK_CLIENT_SECRET || "";
      if (!secret) return NextResponse.json({ ok: false, error: "TikTok webhook secret is not configured" }, { status: 503 });
      const signature = request.headers.get("tiktok-signature") || request.headers.get("TikTok-Signature") || "";
      if (!verifyTikTokSignature(signature, rawBody, secret)) return NextResponse.json({ ok: false, error: "Invalid TikTok webhook signature" }, { status: 401 });
    }

    if (slug === "olx") {
      const olx = await getIntegrationCredential("OLX").catch(() => null);
      const secret = olx?.notificationSecret || process.env.OLX_NOTIFICATION_SECRET || "";
      if (!secret) return NextResponse.json({ ok: false, error: "OLX notification secret is not configured" }, { status: 503 });
      const signature = request.headers.get("x-signature") || "";
      if (!verifyOlxSignature(signature, body, secret)) return NextResponse.json({ ok: false, error: "Invalid OLX webhook signature" }, { status: 401 });
    }

    const channel = resolveChannel(slug, body);
    if (!channel) return NextResponse.json({ ok: false, error: "Unsupported webhook" }, { status: 404 });

    const externalEventId = optionalString(pick(body, ["transaction_id", "event_id", "eventId", "call_id", "callId", "id", "request_id", "requestId"])) || `${slug}-${randomUUID()}`;
    const eventType = optionalString(pick(body, ["event_type", "eventType", "flow", "type", "status"])) || "event";
    await recordWebhookEvent(channel, externalEventId, eventType, body);

    const providerData = asRecord(body.data);
    const normalized = asRecord(body.normalized) || providerData || body;
    const message = optionalString(pick(normalized, ["message", "text", "comment", "description"]));
    const phone = optionalString(pick(normalized, ["phone", "phoneNumber", "phone_number"]));
    const subject = optionalString(pick(normalized, ["subject", "service", "need", "title"])) || (message ? "Нове звернення" : undefined);
    if (!message && !phone && !subject) return NextResponse.json({ ok: true, accepted: true, normalized: false });

    const inquiry = await ingestCommunicationInquiry({
      channel,
      externalId: optionalString(pick(normalized, ["conversationId", "conversation_id", "leadId", "lead_id", "object_id", "id"])) || optionalString(body.object_id) || externalEventId,
      externalMessageId: optionalString(pick(normalized, ["messageId", "message_id", "event_id"])) || `${externalEventId}:message`,
      name: optionalString(pick(normalized, ["name", "customerName", "customer_name", "senderName", "sender_name"])),
      phone,
      handle: optionalString(pick(normalized, ["handle", "username", "senderUsername", "sender_username"])),
      subject: subject || "Нове звернення",
      preview: message || subject || "Нове звернення",
      message,
      vehicle: optionalString(pick(normalized, ["vehicle", "car"])),
      plate: optionalString(pick(normalized, ["plate", "plateNumber", "plate_number"])),
      sourceDetail: optionalString(pick(normalized, ["sourceDetail", "source_detail", "adName", "ad_name"])),
      campaign: optionalString(pick(normalized, ["campaign", "campaignName", "campaign_name"])),
      utm: optionalString(pick(normalized, ["utm", "utm_source"])),
      metadata: body,
    });

    return NextResponse.json({ ok: true, accepted: true, normalized: true, inquiry });
  } catch (error) {
    console.error("Generic webhook failed", error);
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
