import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { encryptCameraPassword, maskCameraUid } from "@/src/services/camera-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type CameraPurposeValue = "ENTRY" | "EXIT" | "TERRITORY" | "SERVICE_POST";
type CameraStatusValue = "DISABLED" | "NOT_TESTED";
type CameraPatchData = {
  name?: string;
  username?: string;
  purpose?: CameraPurposeValue;
  encryptedPassword?: string;
  isActive?: boolean;
  status?: CameraStatusValue;
};
const PURPOSES = new Set<CameraPurposeValue>(["ENTRY", "EXIT", "TERRITORY", "SERVICE_POST"]);

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const prisma = getPrisma();
  try {
    const { id } = await context.params;
    const current = await prisma.camera.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ ok: false, error: "Камеру не знайдено." }, { status: 404 });

    const body = await request.json() as Record<string, unknown>;
    const data: CameraPatchData = {};

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = clean(body.name, 120);
      if (!name) return NextResponse.json({ ok: false, error: "Вкажіть назву камери." }, { status: 400 });
      data.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, "username")) data.username = clean(body.username, 80) || "admin";
    if (Object.prototype.hasOwnProperty.call(body, "purpose")) {
      const purpose = clean(body.purpose, 32) as CameraPurposeValue;
      if (!PURPOSES.has(purpose)) return NextResponse.json({ ok: false, error: "Невідоме призначення камери." }, { status: 400 });
      data.purpose = purpose;
    }
    if (Object.prototype.hasOwnProperty.call(body, "password")) {
      const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
      data.encryptedPassword = encryptCameraPassword(password);
    }
    if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
      data.isActive = body.isActive === true;
      if (body.isActive !== true) data.status = "DISABLED";
      else if (current.status === "DISABLED") data.status = "NOT_TESTED";
    }

    const camera = await prisma.camera.update({ where: { id }, data });
    return NextResponse.json({ ok: true, camera: publicCamera(camera) });
  } catch (error) {
    console.error("PATCH /api/settings/cameras/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити камеру." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const prisma = getPrisma();
  try {
    const { id } = await context.params;
    await prisma.camera.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/settings/cameras/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося видалити камеру." }, { status: 500 });
  }
}
