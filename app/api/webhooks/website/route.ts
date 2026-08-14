import { NextRequest, NextResponse } from "next/server";
import { ingestCommunicationInquiry, recordWebhookEvent } from "@/src/services/communications-server.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.WEBSITE_WEBHOOK_SECRET?.trim();
    if (secret && request.headers.get("x-turbolev-secret") !== secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const externalId = String(body.id || body.externalId || `website-${Date.now()}`);
    await recordWebhookEvent("WEBSITE", externalId, "lead-form", body);

    const subject = String(body.subject || body.service || body.need || "Заявка з сайту").trim();
    const message = String(body.message || body.comment || body.description || subject).trim();
    const inquiry = await ingestCommunicationInquiry({
      channel: "WEBSITE",
      externalId,
      externalMessageId: `${externalId}:form`,
      name: body.name || body.customerName,
      phone: body.phone,
      subject,
      preview: message,
      message,
      vehicle: body.vehicle || body.car,
      plate: body.plate || body.plateNumber,
      sourceDetail: body.formName || body.page || "Форма сайту",
      campaign: body.campaign || body.utm_campaign,
      utm: body.utm || [body.utm_source, body.utm_medium, body.utm_campaign].filter(Boolean).join(" / ") || undefined,
      metadata: body,
    });

    return NextResponse.json({ ok: true, inquiry }, { status: 201 });
  } catch (error) {
    console.error("POST /api/webhooks/website failed", error);
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
