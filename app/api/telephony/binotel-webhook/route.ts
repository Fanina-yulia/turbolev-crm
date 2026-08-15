import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CommunicationChannel, Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
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

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstWebhookText(payload: Record<string, unknown>, keys: string[]) {
  const containers = [payload, nestedRecord(payload.callDetails), nestedRecord(payload.data), nestedRecord(payload.call)].filter(Boolean) as Record<string, unknown>[];
  for (const container of containers) {
    for (const key of keys) {
      const value = container[key];
      if (typeof value === "string" || typeof value === "number") {
        const text = String(value).trim();
        if (text) return text;
      }
    }
  }
  return null;
}

function eventIdentity(payload: Record<string, unknown>) {
  const eventType = firstWebhookText(payload, ["eventName", "eventType", "requestType", "action", "method", "event"]);
  const callId = firstWebhookText(payload, ["generalCallID", "generalCallId", "callID", "callId", "id"]);
  if (callId) return { externalEventId: `${callId}:${eventType || "unknown"}`, eventType };
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 40);
  return { externalEventId: `payload:${fingerprint}`, eventType };
}

function jsonPayload(payload: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

async function recordDelivery(payload: Record<string, unknown>, status: string, error?: string | null) {
  const identity = eventIdentity(payload);
  try {
    await getPrisma().webhookEvent.upsert({
      where: {
        channel_externalEventId: {
          channel: CommunicationChannel.BINOTEL,
          externalEventId: identity.externalEventId,
        },
      },
      create: {
        id: randomUUID(),
        channel: CommunicationChannel.BINOTEL,
        externalEventId: identity.externalEventId,
        eventType: identity.eventType,
        payload: jsonPayload(payload),
        status,
        processedAt: status === "PROCESSED" || status === "IGNORED" ? new Date() : null,
        error: error || null,
      },
      update: {
        eventType: identity.eventType,
        payload: jsonPayload(payload),
        status,
        processedAt: status === "PROCESSED" || status === "IGNORED" ? new Date() : null,
        error: error || null,
      },
    });
  } catch (recordError) {
    console.warn("Could not persist Binotel webhook delivery", {
      message: recordError instanceof Error ? recordError.message : "unknown error",
    });
  }
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
    await recordDelivery(payload, "RECEIVED");
    const result = await processBinotelWebhook(payload);
    await recordDelivery(payload, "PROCESSED");
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof UnsupportedBinotelWebhookEvent) {
      if (payload) await recordDelivery(payload, "IGNORED", `Unsupported event: ${error.eventName || "unknown"}`);
      console.warn("Ignored unsupported Binotel webhook event", {
        event: error.eventName || "unknown",
        payloadKeys: payload ? Object.keys(payload) : [],
      });
      return NextResponse.json({ ok: true, ignored: true, event: error.eventName || null }, { status: 202 });
    }

    if (error instanceof BinotelWebhookPayloadError) {
      if (payload) await recordDelivery(payload, "ERROR", error.message);
      console.warn("Invalid Binotel webhook payload", {
        message: error.message,
        payloadKeys: payload ? Object.keys(payload) : [],
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }

    if (payload) await recordDelivery(payload, "ERROR", error instanceof Error ? error.message : "unknown error");
    console.error("Binotel webhook processing failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
