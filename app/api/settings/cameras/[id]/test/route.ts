import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { decryptCameraPassword } from "@/src/services/camera-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };
type BridgeResult = {
  ok?: boolean;
  message?: string;
  model?: string;
  connection?: string;
  snapshotDataUrl?: string;
};

function bridgeEndpoint() {
  const base = process.env.CAMERA_BRIDGE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/v1/reolink/test` : "";
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const prisma = getPrisma();
  const { id } = await context.params;
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) return NextResponse.json({ ok: false, error: "Камеру не знайдено." }, { status: 404 });
  if (!camera.isActive) return NextResponse.json({ ok: false, error: "Камера вимкнена." }, { status: 409 });

  const endpoint = bridgeEndpoint();
  if (!endpoint) {
    const message = "Конфігурацію камери збережено. Camera Bridge ще не підключений до CRM.";
    await prisma.camera.update({
      where: { id },
      data: { status: "NOT_TESTED", lastTestAt: new Date(), lastTestMessage: message },
    });
    return NextResponse.json({ ok: false, pending: true, status: "NOT_TESTED", message }, { status: 503 });
  }

  try {
    const token = process.env.CAMERA_BRIDGE_TOKEN?.trim();
    const password = decryptCameraPassword(camera.encryptedPassword);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 26_000);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          cameraId: camera.id,
          provider: "REOLINK",
          uid: camera.uid,
          username: camera.username,
          password,
          connectionMode: camera.connectionMode,
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timeout);
    }

    const result = await response.json().catch(() => ({})) as BridgeResult;
    if (!response.ok || !result.ok) {
      const message = result.message || `Camera Bridge повернув HTTP ${response.status}.`;
      await prisma.camera.update({
        where: { id },
        data: { status: "ERROR", lastTestAt: new Date(), lastTestMessage: message },
      });
      return NextResponse.json({ ok: false, status: "ERROR", message }, { status: 502 });
    }

    const now = new Date();
    const message = result.message || "P2P-з'єднання з камерою встановлено.";
    const updated = await prisma.camera.update({
      where: { id },
      data: {
        status: "CONNECTED",
        model: result.model?.trim().slice(0, 120) || camera.model,
        lastSeenAt: now,
        lastTestAt: now,
        lastTestMessage: message,
      },
    });

    return NextResponse.json({
      ok: true,
      status: updated.status,
      model: updated.model,
      connection: result.connection || "UID_P2P",
      snapshotDataUrl: result.snapshotDataUrl || null,
      message,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Camera Bridge не відповів за 26 секунд."
      : "CRM не змогла зв'язатися з Camera Bridge.";
    await prisma.camera.update({
      where: { id },
      data: { status: "ERROR", lastTestAt: new Date(), lastTestMessage: message },
    }).catch(() => undefined);
    console.error("POST /api/settings/cameras/[id]/test failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ ok: false, status: "ERROR", message }, { status: 502 });
  }
}
