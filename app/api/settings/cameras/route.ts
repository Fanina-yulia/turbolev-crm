import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { encryptCameraPassword, maskCameraUid } from "@/src/services/camera-credentials.service";
import { generateCameraIngestToken, hashCameraIngestToken } from "@/src/services/camera-ingest-token.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSES = new Set(["ENTRY", "EXIT", "TERRITORY", "SERVICE_POST"] as const);
const CONNECTION_MODES = new Set(["EMAIL_EVENTS", "UID_P2P", "LOCAL"] as const);

type CameraPurposeValue = "ENTRY" | "EXIT" | "TERRITORY" | "SERVICE_POST";
type CameraConnectionModeValue = "EMAIL_EVENTS" | "UID_P2P" | "LOCAL";

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeUid(value: unknown) {
  return clean(value, 40).replace(/\s+/g, "").toUpperCase();
}

function publicCamera(camera: {
  id: string;
  name: string;
  provider: string;
  uid: string;
  username: string;
  purpose: string;
  connectionMode: string;
  status: string;
  model: string | null;
  lastSeenAt: Date | null;
  lastTestAt: Date | null;
  lastTestMessage: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: camera.id,
    name: camera.name,
    provider: camera.provider,
    maskedUid: maskCameraUid(camera.uid),
    username: camera.username,
    purpose: camera.purpose,
    connectionMode: camera.connectionMode,
    status: camera.status,
    model: camera.model,
    lastSeenAt: camera.lastSeenAt,
    lastTestAt: camera.lastTestAt,
    lastTestMessage: camera.lastTestMessage,
    isActive: camera.isActive,
    createdAt: camera.createdAt,
    updatedAt: camera.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_READ, {
    request,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const cameras = await prisma.camera.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ ok: true, cameras: cameras.map(publicCamera) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/cameras failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити камери." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_WRITE, {
    request,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = clean(body.name, 120);
    const uid = normalizeUid(body.uid);
    const username = clean(body.username, 80) || "admin";
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    const purposeRaw = clean(body.purpose, 32) as CameraPurposeValue;
    const purpose: CameraPurposeValue = PURPOSES.has(purposeRaw) ? purposeRaw : "TERRITORY";
    const modeRaw = clean(body.connectionMode, 32) as CameraConnectionModeValue;
    const connectionMode: CameraConnectionModeValue = CONNECTION_MODES.has(modeRaw) ? modeRaw : "EMAIL_EVENTS";

    if (!name) return NextResponse.json({ ok: false, error: "Вкажіть назву камери." }, { status: 400 });
    if (!/^[A-Z0-9]{12,40}$/.test(uid)) return NextResponse.json({ ok: false, error: "Перевірте UID Reolink." }, { status: 400 });

    const ingestToken = connectionMode === "EMAIL_EVENTS" ? generateCameraIngestToken() : null;
    const camera = await prisma.camera.create({
      data: {
        name,
        uid,
        username,
        encryptedPassword: encryptCameraPassword(password),
        ingestTokenHash: ingestToken ? hashCameraIngestToken(ingestToken) : null,
        provider: "REOLINK",
        purpose,
        connectionMode,
        status: "NOT_TESTED",
      },
    });

    return NextResponse.json({
      ok: true,
      camera: publicCamera(camera),
      ingestToken,
      ingestEndpoint: connectionMode === "EMAIL_EVENTS" ? "/api/camera-events/email" : null,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (/unique constraint|Camera_uid_key|uid/i.test(message)) {
      return NextResponse.json({ ok: false, error: "Камера з таким UID уже додана." }, { status: 409 });
    }
    console.error("POST /api/settings/cameras failed", { message });
    return NextResponse.json({ ok: false, error: "Не вдалося додати камеру." }, { status: 500 });
  }
}
