import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { verifyCameraIngestToken } from "@/src/services/camera-ingest-token.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const MAX_SNAPSHOT_BYTES = 2_500_000;
const SNAPSHOT_RETENTION_HOURS = 72;

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeUid(value: unknown) {
  return clean(value, 40).replace(/\s+/g, "").toUpperCase();
}

function decodeSnapshot(value: unknown, mimeType: string) {
  if (!value) return null;
  if (typeof value !== "string") throw new Error("INVALID_SNAPSHOT");
  if (!mimeType.toLowerCase().startsWith("image/")) throw new Error("INVALID_SNAPSHOT_TYPE");
  if (value.length > Math.ceil(MAX_SNAPSHOT_BYTES * 4 / 3) + 100) throw new Error("SNAPSHOT_TOO_LARGE");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length) throw new Error("INVALID_SNAPSHOT");
  if (bytes.length > MAX_SNAPSHOT_BYTES) throw new Error("SNAPSHOT_TOO_LARGE");
  return bytes;
}

function parseDetectedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export async function POST(request: NextRequest) {
  const prisma = getPrisma();
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 4_000_000) {
      return NextResponse.json({ ok: false, error: "Знімок завеликий для Email Events." }, { status: 413 });
    }

    const body = await request.json() as Record<string, unknown>;
    const cameraUid = normalizeUid(body.cameraUid);
    const token = clean(body.token, 180);
    const sourceEventId = clean(body.gmailMessageId, 180);
    const subject = clean(body.subject, 500);
    const sender = clean(body.from, 320);
    const recipient = clean(body.to, 320);
    const attachmentName = clean(body.attachmentName, 260);
    const snapshotMimeType = clean(body.attachmentContentType, 80) || "image/jpeg";
    const detectedAt = parseDetectedAt(body.receivedAt);

    if (!/^[A-Z0-9]{12,40}$/.test(cameraUid)) {
      return NextResponse.json({ ok: false, error: "Некоректний UID камери." }, { status: 400 });
    }
    if (!sourceEventId) {
      return NextResponse.json({ ok: false, error: "Відсутній Gmail message ID." }, { status: 400 });
    }

    const camera = await prisma.camera.findUnique({ where: { uid: cameraUid } });
    if (!camera || !camera.isActive || camera.connectionMode !== "EMAIL_EVENTS") {
      return NextResponse.json({ ok: false, error: "Email Events для цієї камери не активні." }, { status: 404 });
    }
    if (!verifyCameraIngestToken(token, camera.ingestTokenHash)) {
      return NextResponse.json({ ok: false, error: "Невірний ключ камери." }, { status: 401 });
    }

    const existing = await prisma.cameraEvent.findFirst({
      where: { cameraId: camera.id, sourceEventId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, eventId: existing.id });
    }

    const snapshotData = decodeSnapshot(body.attachmentBase64, snapshotMimeType);
    const now = new Date();
    const event = await prisma.cameraEvent.create({
      data: {
        cameraId: camera.id,
        eventType: "VEHICLE_DETECTED",
        source: "GMAIL_EMAIL",
        sourceEventId,
        recognitionStatus: "PENDING",
        detectedAt,
        snapshotData,
        snapshotMimeType: snapshotData ? snapshotMimeType : null,
        snapshotSize: snapshotData?.length || null,
        rawPayload: {
          gmailMessageId: sourceEventId,
          subject,
          from: sender,
          to: recipient,
          attachmentName,
          transport: "GOOGLE_APPS_SCRIPT",
        },
      },
      select: { id: true, detectedAt: true, snapshotSize: true },
    });

    await prisma.camera.update({
      where: { id: camera.id },
      data: {
        status: "CONNECTED",
        lastSeenAt: now,
        lastTestAt: now,
        lastTestMessage: "Email Event від Reolink отримано через Gmail.",
      },
    });

    const retentionBefore = new Date(now.getTime() - SNAPSHOT_RETENTION_HOURS * 60 * 60 * 1000);
    await prisma.cameraEvent.updateMany({
      where: {
        cameraId: camera.id,
        detectedAt: { lt: retentionBefore },
        snapshotData: { not: null },
      },
      data: {
        snapshotData: null,
        snapshotMimeType: null,
        snapshotSize: null,
      },
    }).catch((error) => console.warn("camera snapshot retention cleanup failed", error));

    return NextResponse.json({
      ok: true,
      eventId: event.id,
      detectedAt: event.detectedAt,
      recognitionStatus: "PENDING",
      hasSnapshot: Boolean(event.snapshotSize),
    }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "SNAPSHOT_TOO_LARGE") {
      return NextResponse.json({ ok: false, error: "JPEG перевищує 2.5 МБ." }, { status: 413 });
    }
    if (code === "INVALID_SNAPSHOT" || code === "INVALID_SNAPSHOT_TYPE") {
      return NextResponse.json({ ok: false, error: "Некоректне вкладення з камери." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "unknown";
    if (/unique constraint|CameraEvent_cameraId_sourceEventId_key/i.test(message)) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error("POST /api/camera-events/email failed", { message });
    return NextResponse.json({ ok: false, error: "Не вдалося зберегти подію камери." }, { status: 500 });
  }
}
