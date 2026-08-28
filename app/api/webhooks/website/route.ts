import { NextRequest, NextResponse } from "next/server";
import { ingestCommunicationInquiry, recordWebhookEvent } from "@/src/services/communications-server.service";
import { enforceRequestRateLimit, requestRateLimitHeaders } from "@/src/security/request-rate-limit";

export const runtime = "nodejs";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.WEBSITE_WEBHOOK_SECRET?.trim();
    if (!secret) return NextResponse.json({ ok: false, error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
    if (request.headers.get("x-turbolev-secret") !== secret) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (Number(request.headers.get("content-length") || 0) > 64_000) return NextResponse.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    const rate = await enforceRequestRateLimit(request, { bucketKey: "website-webhook", limit: 120, windowSeconds: 60 });
    if (!rate.allowed) return NextResponse.json({ ok: false, error: "RATE_LIMITED" }, { status: 429, headers: requestRateLimitHeaders(rate) });

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 64_000) return NextResponse.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ ok: false, error: "INVALID_PAYLOAD" }, { status: 400 });
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "INVALID_PAYLOAD" }, { status: 400 });
    const externalId = String(body.id || body.externalId || `website-${Date.now()}`);
    await recordWebhookEvent("WEBSITE", externalId, "lead-form", body);

    const subject = String(body.subject || body.service || body.need || "Заявка з сайту").trim();
    const message = String(body.message || body.comment || body.description || subject).trim();
    const inquiry = await ingestCommunicationInquiry({
      channel: "WEBSITE",
      externalId,
      externalMessageId: `${externalId}:form`,
      name: text(body.name) || text(body.customerName),
      phone: text(body.phone),
      subject,
      preview: message,
      message,
      vehicle: text(body.vehicle) || text(body.car),
      plate: text(body.plate) || text(body.plateNumber),
      sourceDetail: text(body.formName) || text(body.page) || "Форма сайту",
      campaign: text(body.campaign) || text(body.utm_campaign),
      utm: text(body.utm) || [text(body.utm_source), text(body.utm_medium), text(body.utm_campaign)].filter(Boolean).join(" / ") || undefined,
      metadata: body,
    });

    return NextResponse.json({ ok: true, inquiry }, { status: 201, headers: requestRateLimitHeaders(rate) });
  } catch (error) {
    console.error("POST /api/webhooks/website failed", error);
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
