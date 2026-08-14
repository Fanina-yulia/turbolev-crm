import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  BinotelWebhookPayloadError,
  UnsupportedBinotelWebhookEvent,
  processBinotelWebhook,
} from "@/src/services/binotel-webhook.service";
import { getIntegrationCredential } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function webhookToken() {
  const stored = await getIntegrationCredential("BINOTEL").catch(() => null);
  return stored?.webhookToken?.trim() || process.env.BINOTEL_WEBHOOK_TOKEN?.trim() || "";
}

async function readWebhookBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BinotelWebhookPayloadError("Webhook JSON body must be an object");
    }
    return body as Record<string, unknown>;
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const body: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) body[key] = typeof value === "string" ? value : value.name;
    return body;
  }

  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through to URLSearchParams for providers that omit content-type.
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function attachEventFromQuery(request: NextRequest, payload: Record<string, unknown>): Record<string, unknown> {
  const queryEvent = request.nextUrl.searchParams.get("event")?.trim();
  if (!queryEvent) return payload;
  const bodyAlreadyIdentifiesEvent = ["eventName", "eventType", "requestType", "action", "method", "event"]
    .some((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== "");
  return bodyAlreadyIdentifiesEvent ? payload : { ...payload, eventName: queryEvent };
}

export async function POST(request: NextRequest) {
  const expected = await webhookToken();
  if (process.env.NODE_ENV === "production" && !expected) {
    return NextResponse.json(
      { ok: false, error: "Binotel webhook is not enabled: webhook token is missing" },
      { status: 503 },
    );
  }

  const headerToken = request.headers.get("x-binotel-webhook-token")?.trim();
  const queryToken = request.nextUrl.searchParams.get("token")?.trim();
  const supplied = headerToken || queryToken || "";
  const authorized = expected ? Boolean(supplied && secureEqual(supplied, expected)) : process.env.NODE_ENV !== "production";
  if (!authorized) return NextResponse.json({ ok: false, error: "Unauthorized webhook" }, { status: 401 });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = attachEventFromQuery(request, await readWebhookBody(request));
    const result = await processBinotelWebhook(payload);
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof UnsupportedBinotelWebhookEvent) {
      console.warn("Ignored unsupported Binotel webhook event", {
        event: error.eventName || "unknown",
        payloadKeys: payload ? Object.keys(payload) : [],
      });
      return NextResponse.json({ ok: true, ignored: true, event: error.eventName || null }, { status: 202 });
    }

    if (error instanceof BinotelWebhookPayloadError) {
      console.warn("Invalid Binotel webhook payload", {
        message: error.message,
        payloadKeys: payload ? Object.keys(payload) : [],
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }

    console.error("Binotel webhook processing failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
