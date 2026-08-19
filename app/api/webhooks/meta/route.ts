import { NextRequest, NextResponse } from "next/server";
import {
  processMetaWebhook,
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
} from "@/src/services/meta-communications.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode") || "";
  const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  if (mode !== "subscribe" || !challenge || !(await verifyMetaWebhookToken(token))) {
    return NextResponse.json({ ok: false, error: "Verification failed" }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    if (!(await verifyMetaWebhookSignature(rawBody, signature))) {
      return NextResponse.json({ ok: false, error: "Invalid Meta webhook signature" }, { status: 401 });
    }
    const result = await processMetaWebhook(rawBody);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Meta webhook processing failed", error);
    return NextResponse.json({ ok: false, error: "Meta webhook processing failed" }, { status: 500 });
  }
}
